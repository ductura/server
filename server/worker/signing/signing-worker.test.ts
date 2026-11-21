// SRV-1502 (M3.2, B-9, D-210): the worker signs a pending receipt through the
// signing port it is handed, recovers a receipt left by a worker that died
// mid-signature, keeps one signature when the same receipt is signed twice,
// and writes the number of receipts still pending in one structured line per
// pass. The key is only ever the fake port's ephemeral key; every id, key and
// text is invented (test-support/pending-receipt).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createLogger, type LogLevel } from "../../log/index.ts";
import {
  DOMAIN,
  memoryStore,
  PAYLOAD,
  RECEIPT,
  ROW,
  sha256,
  TEXT,
  testSigner,
} from "../../../test-support/pending-receipt/index.ts";

import {
  createReceiptSigningWorker,
  RECEIPT_SIGNING_FAILED_EVENT,
  RECEIPT_SIGNING_PASS_EVENT,
  type ReceiptSigningWorkerDeps,
} from "./index.ts";

const KEY_ID = "kljuc-potvrde-izmisljeni";
const INSTITUTION = "00000000-0000-4000-8000-0000000000f1";
const STORAGE_REF = "s3://izmisljeno.invalid/paket/segment";
const CREATED = "2026-11-21T09:00:00.000Z";
const NOW = Date.parse("2026-11-21T09:00:05.000Z");

type Envelope = ReturnType<ReturnType<typeof testSigner>["envelope"]>;
type Mode = (input: Uint8Array, honest: () => Envelope) => Promise<unknown> | unknown;

/** One fake signing port with one ephemeral key; its behaviour can change between workers. */
function fakePort() {
  let mode: Mode = (_, honest) => honest();
  const made = testSigner(KEY_ID, (input, honest) => mode(input, honest));
  return {
    ...made,
    behave(next: Mode) {
      mode = next;
    },
    /** The port's own signature over the first input it was asked to sign. */
    expected(): Envelope {
      const input = made.inputs[0];
      if (input === undefined) throw new Error("the port was never asked to sign");
      return made.envelope(input);
    },
  };
}

/** The database as the worker sees it: one pending receipt v2 until a signature is stored. */
function database(
  port: ReturnType<typeof fakePort>,
  gate?: Parameters<typeof memoryStore>[1],
  pendingCount = 1,
) {
  const { store, stored } = memoryStore(() => [port.key()], gate);
  const pending = () => !stored.has(RECEIPT);
  const queue = {
    backlog: vi.fn(async () => ({
      status: "ok" as const,
      rows: pending() ? [{ evidenceDomainId: DOMAIN, pendingCount, oldestCreatedAt: CREATED }] : [],
    })),
    pendingReceipts: vi.fn(async (_domain: string, _limit: number, after: string | null) => ({
      status: "ok" as const,
      rows: pending() && after !== RECEIPT ? [ROW] : [],
    })),
  };
  const objects = {
    receiptObject: vi.fn(async () =>
      pending()
        ? {
            status: "ok" as const,
            object: {
              institutionId: INSTITUTION,
              evidencePackageId: PAYLOAD.evidencePackageId,
              segmentHash: PAYLOAD.segmentHash,
              payloadBytes: PAYLOAD.payloadBytes,
              storageRef: STORAGE_REF,
            },
          }
        : { status: "not_found" as const },
    ),
  };
  const locator = { storageRefFor: vi.fn(async () => ({ status: "ok", storageRef: STORAGE_REF })) };
  const presence = { headImmutable: vi.fn(async () => ({ status: "present" as const })) };
  return { store, stored, queue, objects, locator, presence };
}

function captureLog() {
  const lines: { level: LogLevel; record: Record<string, unknown> }[] = [];
  const raw: string[] = [];
  const log = createLogger(
    (level, line) => {
      raw.push(line);
      lines.push({ level, record: JSON.parse(line) as Record<string, unknown> });
    },
    () => new Date(NOW),
  );
  return { log, lines, raw };
}

function worker(
  db: ReturnType<typeof database>,
  port: ReturnType<typeof fakePort>,
  extra: Partial<ReceiptSigningWorkerDeps> = {},
) {
  const captured = captureLog();
  const made = createReceiptSigningWorker({
    queue: db.queue,
    store: db.store,
    objects: db.objects,
    locator: db.locator as never,
    presence: db.presence,
    signer: port.provider,
    log: captured.log,
    now: () => NOW,
    config: { signTimeoutMs: 200, intervalMs: 1_000 },
    ...extra,
  });
  return { ...captured, worker: made };
}

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe("createReceiptSigningWorker: signing", () => {
  it("signs the pending receipt through the port it is handed and stores that signature", async () => {
    const port = fakePort();
    const db = database(port);
    const { worker: w } = worker(db, port);
    const pass = await w.runPass();
    expect(pass?.summary.receipts.signed).toBe(1);
    expect(db.stored.get(RECEIPT)).toEqual(port.expected());
    expect(port.provider.sign).toHaveBeenCalledTimes(1);
    // The signed input ends in the SHA-256 of the stored text, never the text itself.
    expect(Buffer.from(port.inputs[0]!).subarray(-32)).toEqual(sha256(TEXT));
    expect(port.inputs[0]!.byteLength).toBeLessThan(TEXT.length);
  });

  it("never signs before the segment object is confirmed in the payload store", async () => {
    const port = fakePort();
    const db = database(port);
    db.presence.headImmutable.mockResolvedValue({ status: "absent" } as never);
    const { worker: w } = worker(db, port);
    const pass = await w.runPass();
    expect(pass?.summary.receipts.held).toBe(1);
    expect(port.provider.sign).not.toHaveBeenCalled();
    expect(db.stored.size).toBe(0);
  });
});

describe("createReceiptSigningWorker: crash mid-signature and recovery", () => {
  it("recovers a receipt left pending by a worker that died before its attach", async () => {
    const port = fakePort();
    // The first worker computes its signature, then its process dies inside the attach.
    const frozen = deferred();
    let firstAttach = true;
    const db = database(port, async () => {
      if (firstAttach) {
        firstAttach = false;
        await frozen.promise;
      }
    });
    const dying = worker(db, port);
    const abandoned = dying.worker.runPass();
    await vi.waitFor(() => expect(db.store.attachSignature).toHaveBeenCalledTimes(1));
    const lostSignature = db.store.attachSignature.mock.calls[0]![0].signature;
    expect(db.stored.size).toBe(0);

    // A new worker process starts; its recovery pass takes the receipt at once,
    // even with a grace period that would otherwise leave a five-second-old receipt.
    const timers = { setTimeout: vi.fn(), clearTimeout: vi.fn() };
    const fresh = worker(db, port, { timers, config: { graceMs: 3_600_000, signTimeoutMs: 200 } });
    const recovered = await fresh.worker.runPass();
    expect(recovered?.recovery).toBe(true);
    expect(recovered?.summary.receipts.signed).toBe(1);
    expect(recovered?.summary.domains.fresh).toBe(0);

    // The same input gives the same bytes: the recovered signature is the lost one.
    expect(db.stored.get(RECEIPT)).toEqual(lostSignature);
    expect(db.stored.get(RECEIPT)).toEqual(port.expected());

    // The dead worker's attach, if it ever completes, finds the stored signature.
    frozen.release();
    const late = await abandoned;
    expect(late?.summary.receipts.alreadySigned).toBe(1);
    expect(db.stored.get(RECEIPT)).toEqual(lostSignature);
  });

  it("leaves the receipt pending when the signer fails mid-signature and signs it on the next pass", async () => {
    const port = fakePort();
    const db = database(port);
    // The signer never answers: the step times out and nothing is stored.
    port.behave(() => new Promise(() => {}));
    const { worker: w, lines } = worker(db, port);
    const failed = await w.runPass();
    expect(failed?.summary.status).toBe("stopped");
    expect(failed?.summary.stoppedAt).toBe("signing");
    expect(db.stored.size).toBe(0);
    expect(lines.at(-1)?.level).toBe("warn");

    port.behave((_, honest) => honest());
    const next = await w.runPass();
    // A stopped sweep did not finish recovery: the next pass is still a recovery pass.
    expect(next?.recovery).toBe(true);
    expect(next?.summary.receipts.signed).toBe(1);
    expect(db.stored.get(RECEIPT)).toEqual(port.expected());
  });

  it("repeats the recovery pass when the backlog could not be read", async () => {
    const port = fakePort();
    const db = database(port);
    db.queue.backlog.mockResolvedValueOnce({
      status: "unavailable",
      reason: "database_error",
    } as never);
    const { worker: w } = worker(db, port, { config: { graceMs: 3_600_000, signTimeoutMs: 200 } });
    expect((await w.runPass())?.summary.status).toBe("unavailable");
    const second = await w.runPass();
    expect(second?.recovery).toBe(true);
    expect(second?.summary.receipts.signed).toBe(1);
    const third = await w.runPass();
    expect(third?.recovery).toBe(false);
  });
});

describe("createReceiptSigningWorker: recovery lasts until the startup backlog is attempted", () => {
  const OTHER = "00000000-0000-4000-8000-0000000000d2";

  it("keeps recovering a domain the first pass deferred, even with a grace period", async () => {
    const port = fakePort();
    const db = database(port);
    // Two young domains, one domain per pass: the other domain is deferred.
    let otherPending = true;
    db.queue.backlog.mockImplementation(async () => ({
      status: "ok" as const,
      rows: [
        ...(db.stored.has(RECEIPT)
          ? []
          : [{ evidenceDomainId: DOMAIN, pendingCount: 1, oldestCreatedAt: CREATED }]),
        ...(otherPending
          ? [{ evidenceDomainId: OTHER, pendingCount: 1, oldestCreatedAt: CREATED }]
          : []),
      ],
    }));
    db.queue.pendingReceipts.mockImplementation(async (domain, _limit, after) => ({
      status: "ok" as const,
      rows: domain === DOMAIN && !db.stored.has(RECEIPT) && after !== RECEIPT ? [ROW] : [],
    }));
    const config = { graceMs: 3_600_000, maxDomains: 1, signTimeoutMs: 200 };
    const { worker: w } = worker(db, port, { config });

    const first = await w.runPass();
    expect(first?.recovery).toBe(true);
    expect(first?.summary.domains.deferred).toBe(1);
    expect(db.stored.has(RECEIPT)).toBe(true);
    const second = await w.runPass();
    // Without the fix this pass left the deferred domain as fresh for an hour.
    expect(second?.recovery).toBe(true);
    expect(second?.summary.domains.fresh).toBe(0);
    expect(second?.summary.domains.swept).toBe(1);
    expect(second?.summary.domains.deferred).toBe(0);

    // That pass attempted the whole backlog it read: the grace period applies after it.
    const third = await w.runPass();
    expect(third?.recovery).toBe(false);
    expect(third?.summary.domains.fresh).toBe(1);
    otherPending = false;
  });

  it("keeps recovering while a pass fills a whole batch", async () => {
    const port = fakePort();
    const db = database(port);
    const { worker: w } = worker(db, port, {
      config: { graceMs: 3_600_000, batchLimit: 1, signTimeoutMs: 200 },
    });
    const first = await w.runPass();
    expect(first?.summary.receipts.signed).toBe(1);
    // One receipt attempted of a batch of one: the domain may hold more behind it.
    expect((await w.runPass())?.recovery).toBe(true);
  });
});

describe("createReceiptSigningWorker: a double signature is idempotent", () => {
  it("keeps the first signature when two workers sign the same receipt at once", async () => {
    const port = fakePort();
    const both = deferred();
    let waiting = 0;
    // Both attaches wait until both signatures exist, then race for the row lock.
    const db = database(port, async () => {
      waiting += 1;
      if (waiting === 2) both.release();
      await both.promise;
    });
    const one = worker(db, port);
    const two = worker(db, port);
    const [a, b] = await Promise.all([one.worker.runPass(), two.worker.runPass()]);
    const outcomes = [a?.summary.receipts, b?.summary.receipts];
    expect(outcomes.map((r) => r?.signed).sort()).toEqual([0, 1]);
    expect(outcomes.map((r) => r?.alreadySigned).sort()).toEqual([0, 1]);
    expect(db.stored.size).toBe(1);
    // Both workers sent the same bytes: there is one receipt, whichever won.
    const sent = db.store.attachSignature.mock.calls.map(([c]) => c.signature);
    expect(sent[0]).toEqual(sent[1]);
    expect(Buffer.from(port.inputs[0]!)).toEqual(Buffer.from(port.inputs[1]!));
    expect(db.stored.get(RECEIPT)).toEqual(port.expected());
  });

  it("answers already_signed with the stored signature when the receipt is signed again", async () => {
    const port = fakePort();
    const db = database(port);
    const { worker: w } = worker(db, port);
    await w.runPass();
    const first = db.stored.get(RECEIPT);
    // The queue still lists the receipt once more (a read before the attach was visible).
    db.queue.pendingReceipts.mockResolvedValueOnce({ status: "ok", rows: [ROW] });
    db.queue.backlog.mockResolvedValueOnce({
      status: "ok",
      rows: [{ evidenceDomainId: DOMAIN, pendingCount: 1, oldestCreatedAt: CREATED }],
    });
    db.objects.receiptObject.mockResolvedValueOnce({
      status: "ok",
      object: {
        institutionId: INSTITUTION,
        evidencePackageId: PAYLOAD.evidencePackageId,
        segmentHash: PAYLOAD.segmentHash,
        payloadBytes: PAYLOAD.payloadBytes,
        storageRef: STORAGE_REF,
      },
    });
    const again = await w.runPass();
    expect(again?.summary.receipts.alreadySigned).toBe(1);
    expect(again?.summary.receipts.signed).toBe(0);
    expect(db.stored.get(RECEIPT)).toBe(first);
  });

  it("joins a pass already running instead of starting a second one", async () => {
    const port = fakePort();
    const db = database(port);
    const { worker: w } = worker(db, port);
    const [a, b] = await Promise.all([w.runPass(), w.runPass()]);
    expect(a).toBe(b);
    expect(port.provider.sign).toHaveBeenCalledTimes(1);
  });
});

describe("createReceiptSigningWorker: the metric of pending receipts", () => {
  it("writes one structured line per pass with the receipts still pending, no id and no text", async () => {
    const port = fakePort();
    // Three receipts wait, only the one the queue lists is signable by this key.
    const db = database(port, undefined, 3);
    const { worker: w, lines, raw } = worker(db, port);
    await w.runPass();
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line?.level).toBe("info");
    expect(line?.record.event).toBe(RECEIPT_SIGNING_PASS_EVENT);
    expect(line?.record.fields).toMatchObject({
      recovery: true,
      status: "completed",
      pendingReceipts: 3,
      oldestPendingAgeMs: 5_000,
      signed: 1,
      unavailable: 0,
    });
    for (const secret of [RECEIPT, DOMAIN, TEXT, KEY_ID, PAYLOAD.segmentHash, STORAGE_REF]) {
      expect(raw.join("\n")).not.toContain(secret);
    }
  });

  it("writes the line at warn when receipts stay stuck because the signer refuses", async () => {
    const port = fakePort();
    const db = database(port, undefined, 2);
    port.behave(() => {
      throw new Error("kljuc nedostupan");
    });
    const { worker: w, lines } = worker(db, port);
    await w.runPass();
    expect(lines[0]?.level).toBe("warn");
    expect(lines[0]?.record.fields).toMatchObject({ pendingReceipts: 2, signed: 0 });
    expect(db.stored.size).toBe(0);
  });

  it("treats a clock that throws as an unknown age, not as a failed pass", async () => {
    const port = fakePort();
    const db = database(port);
    const { lines, worker: w } = worker(db, port, {
      now: () => {
        throw new Error("sat");
      },
    });
    // A clock that throws is the sweep's own value (an unknown age), not a failure.
    expect((await w.runPass())?.summary.receipts.signed).toBe(1);
    expect(lines.some((l) => l.record.event === RECEIPT_SIGNING_FAILED_EVENT)).toBe(false);
  });
});

describe("createReceiptSigningWorker: lifecycle and configuration", () => {
  it("runs the recovery pass on start, then one pass per interval until stop", async () => {
    const port = fakePort();
    const db = database(port);
    const scheduled: { run: () => void; ms: number }[] = [];
    const timers = {
      setTimeout: vi.fn((run: () => void, ms: number) => {
        scheduled.push({ run, ms });
        return scheduled.length;
      }),
      clearTimeout: vi.fn(),
    };
    const { worker: w, lines } = worker(db, port, { timers });
    w.start();
    w.start();
    expect(scheduled.map((s) => s.ms)).toEqual([0]);
    scheduled[0]!.run();
    await vi.waitFor(() => expect(scheduled).toHaveLength(2));
    expect(scheduled[1]!.ms).toBe(1_000);
    expect(lines[0]?.record.fields).toMatchObject({ recovery: true, signed: 1 });
    scheduled[1]!.run();
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines[1]?.record.fields).toMatchObject({ recovery: false, pendingReceipts: 0 });
    await w.stop();
    expect(timers.clearTimeout).toHaveBeenCalledWith(3);
    w.start();
    expect(scheduled).toHaveLength(3);
  });

  it("waits for the running pass on stop and starts nothing after it", async () => {
    const port = fakePort();
    const gate = deferred();
    const db = database(port, () => gate.promise);
    const timers = { setTimeout: vi.fn(), clearTimeout: vi.fn() };
    const { worker: w } = worker(db, port, { timers });
    const running = w.runPass();
    let stopped = false;
    const stopping = w.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    gate.release();
    await stopping;
    await running;
    w.start();
    expect(timers.setTimeout).not.toHaveBeenCalled();
  });

  it.each([
    ["intervalMs 0", { intervalMs: 0 }],
    ["a fractional interval", { intervalMs: 1.5 }],
    ["a negative grace", { graceMs: -1 }],
    ["a batch over 100", { batchLimit: 101 }],
    ["no domains", { maxDomains: 0 }],
    ["a sign timeout over a minute", { signTimeoutMs: 60_001 }],
  ])("refuses %s", (_, config) => {
    const port = fakePort();
    const db = database(port);
    expect(() => worker(db, port, { config })).toThrow(RangeError);
  });

  it("refuses to start without a signer or a log", () => {
    const port = fakePort();
    const db = database(port);
    expect(() => worker(db, port, { signer: undefined as never })).toThrow(TypeError);
    expect(() => worker(db, port, { log: undefined as never })).toThrow(TypeError);
  });
});

describe("the worker holds no key of its own", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const area = join(here, "..");
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    });

  it.each(sources(area).map((path) => [path.slice(area.length + 1), path]))(
    "%s reads no key, no environment and no file",
    (_, path) => {
      const text = readFileSync(path, "utf8");
      for (const forbidden of [
        "external/keys",
        "DevelopmentEd25519",
        "PersistentDevelopment",
        "AwsKms",
        "generateKeyPair",
        "createPrivateKey",
        "process.env",
        "node:fs",
        "test-support",
      ]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    },
  );
});
