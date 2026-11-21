// SRV-1502 (M3.2, B-9, D-210) over the migrated PostgreSQL: a deferred
// commit leaves a receipt in `pending_signature`; a worker that dies inside
// its attach leaves it there, and a new worker recovers it with the same
// bytes through the real worker functions under the ductus_worker role. A
// second attach of the same signature is `already_signed`. The key is only
// the fake port's ephemeral key; every person, document and key is invented
// (db/main/tests/fixtures).
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import {
  createPendingReceiptObjectSource,
  createPendingReceiptQueue,
  createPendingReceiptStore,
} from "../../database/index.ts";
import { createLogger, type LogLevel } from "../../log/index.ts";
import { createTestDatabase, type TestDatabase } from "../../../test-support/database/index.ts";
import { testSigner } from "../../../test-support/pending-receipt/index.ts";

import { createReceiptSigningWorker, RECEIPT_SIGNING_PASS_EVENT } from "./index.ts";

const FIXTURES = new URL("../../../db/main/tests/fixtures/", import.meta.url);
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const KEY_ID = "kljuc-radnika-izmisljeni";
const STORAGE_REF = "synthetic://pkg-a/request-1";

/** The fixture of the evidence RPC tests, with its `\ir` of the institution inlined. */
function evidenceFixture(): string {
  const institution = readFileSync(new URL("institution.inc", FIXTURES), "utf8");
  const evidence = readFileSync(new URL("evidence-acceptance.inc", FIXTURES), "utf8");
  return evidence.replace(/^\\ir institution\.inc$/mu, () => institution);
}

/** The worker's login: every statement runs as ductus_worker, as in its own pool. */
function asWorker(db: TestDatabase, failOn?: (text: string) => boolean) {
  return {
    async query(text: string, values?: unknown[]) {
      if (failOn?.(text)) throw new Error("radnik je pao usred upisa potpisa");
      await db.exec("SET LOCAL ROLE ductus_worker");
      try {
        return await db.query(text, values);
      } finally {
        await db.exec("RESET ROLE");
      }
    },
  };
}

function captureLog() {
  const lines: { level: LogLevel; record: Record<string, unknown> }[] = [];
  const log = createLogger((level, line) => {
    lines.push({ level, record: JSON.parse(line) as Record<string, unknown> });
  });
  return { log, lines };
}

function workerOver(db: ReturnType<typeof asWorker>, port: ReturnType<typeof testSigner>) {
  const captured = captureLog();
  const worker = createReceiptSigningWorker({
    queue: createPendingReceiptQueue(db as never),
    store: createPendingReceiptStore(db as never),
    objects: createPendingReceiptObjectSource(db as never),
    locator: { storageRefFor: async () => ({ status: "ok", storageRef: STORAGE_REF }) },
    presence: { headImmutable: async () => ({ status: "present" }) },
    signer: port.provider,
    log: captured.log,
    config: { signTimeoutMs: 5_000 },
  });
  return { worker, ...captured };
}

it("recovers a receipt left in pending_signature by a worker that died mid-attach, with the same bytes", async () => {
  const db = await createTestDatabase("main", { authority: true });
  try {
    await db.exec(evidenceFixture());
    const port = testSigner(KEY_ID);
    await db.exec("SET LOCAL ROLE ductus_evidence");
    await db.query(
      `INSERT INTO evidence.signing_key (key_id, key_version, evidence_domain_id, institution_id,
         purpose, algorithm, key_base64url, valid_from, valid_to, revoked_at)
       VALUES ($1, '1', $2, pg_temp.id('fak_a'), 'receipt', 'Ed25519', $3,
         date_trunc('minute', now()) - interval '1 day', NULL, NULL)`,
      [KEY_ID, DOMAIN, port.key().keyBase64Url],
    );
    await db.exec("RESET ROLE");
    const committed = await db.query<{ outcome: string }>(
      `SELECT pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0,
         repeat('a', 64), repeat('d', 64), repeat('b', 64)) AS outcome`,
    );
    expect(committed.rows[0]?.outcome).toBe("reserved");
    const status = async () =>
      (
        await db.query<{ status: string; signature: unknown }>(
          "SELECT status, signature FROM evidence.receipt WHERE client_request_id = 'request-1'",
        )
      ).rows[0];
    expect((await status())?.status).toBe("pending_signature");

    // The first worker signs, then dies inside the attach: nothing is stored.
    const dying = workerOver(
      asWorker(db, (text) => text.includes("worker_attach_receipt_signature")),
      port,
    );
    const died = await dying.worker.runPass();
    expect(died?.summary.receipts.unavailable).toBe(1);
    expect(port.provider.sign).toHaveBeenCalledTimes(1);
    expect((await status())?.status).toBe("pending_signature");
    expect(dying.lines[0]?.record.event).toBe(RECEIPT_SIGNING_PASS_EVENT);
    expect(dying.lines[0]?.record.fields).toMatchObject({ pendingReceipts: 1, signed: 0 });
    const lostInput = port.inputs[0]!;

    // A new worker process recovers it on its first pass.
    const fresh = workerOver(asWorker(db), port);
    const recovered = await fresh.worker.runPass();
    expect(recovered?.recovery).toBe(true);
    expect(recovered?.summary.receipts.signed).toBe(1);
    const stored = await status();
    expect(stored?.status).toBe("signed");
    // Ed25519 over the same signing input: the stored bytes are the lost ones.
    expect(Buffer.from(port.inputs[1]!)).toEqual(Buffer.from(lostInput));
    expect(stored?.signature).toEqual(port.envelope(lostInput));

    // Nothing is pending any more, and the metric says so.
    const after = await fresh.worker.runPass();
    expect(after?.summary.pendingTotal).toBe(0);
    expect(fresh.lines.at(-1)?.record.fields).toMatchObject({ pendingReceipts: 0 });

    // A second attach of the same receipt keeps the first signature.
    const store = createPendingReceiptStore(asWorker(db) as never);
    const receiptId = (
      await db.query<{ id: string }>(
        "SELECT id::text FROM evidence.receipt WHERE client_request_id = 'request-1'",
      )
    ).rows[0]!.id;
    const digest = Buffer.from(lostInput).subarray(-32).toString("hex");
    const again = await store.attachSignature({
      receiptId,
      payloadDigestSha256: digest,
      signature: port.envelope(lostInput),
    });
    expect(again.outcome).toBe("already_signed");
    expect((await status())?.signature).toEqual(stored?.signature);
  } finally {
    await db.close();
  }
});
