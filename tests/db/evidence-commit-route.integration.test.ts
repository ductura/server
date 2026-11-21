import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { type ChildProcess, spawn } from "node:child_process";

import pg from "pg";
import { SERVER_NODE_FLAGS } from "../../scripts/build/index.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createActorReader,
  createPendingReceiptStore,
  createSettingsWriter,
  createWebAuthnCredentials,
  createWithActor,
  createWorkOpener,
} from "../../server/database/index.ts";
import {
  canonicalizeJcs,
  digestEvidenceReceiptPayloadV2,
  type EvidenceDomainKey,
  type EvidenceReceiptPayloadV2,
  verifySignedEvidenceReceiptV2,
} from "../../server/domain/index.ts";
import {
  DEV_SIGNING_KEY_FILE,
  PersistentDevelopmentEd25519SigningKeyProvider,
} from "../../server/external/keys/index.ts";
import {
  EVIDENCE_STORAGE_DOMAINS,
  InMemoryEvidencePayloadStore,
} from "../../server/external/storage/index.ts";
import {
  createDatabases,
  createEvidenceCommitRouteFor,
  createEvidenceOpenRoute,
  createLayers,
  type Running,
  startServer,
} from "../../server/http/index.ts";

// DAN-815 c, plan of attack ductura/server#119 parts D1, D2 and G3: open,
// commit and open again through a real server over real PostgreSQL with RLS,
// a ductus_app login, the development signer (NODE_ENV test only) and
// payload storage in memory. The segment is the invented golden segment
// rewritten for this run's document. Every institution, person, token and
// key is random and synthetic; the login exists only while this file runs.
const ADMIN_URL =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const APP_LOGIN = "it_evidence_commit_route_app";
const ORIGIN = "https://ductura.example.invalid";
const ROOT = join(import.meta.dirname, "../..");
const password = randomBytes(24).toString("hex");
const suffix = randomBytes(4).toString("hex");
const id = {
  a: randomUUID(),
  adminA: randomUUID(),
  vesna: randomUUID(),
  ana: randomUUID(),
  iva: randomUUID(),
  k1: randomUUID(),
  z1: randomUUID(),
  domainA: randomUUID(),
};
const token = randomBytes(32).toString("base64url");
/** iva's session: protocol 2 on the second server (DAN-821-4). */
const ivaToken = randomBytes(32).toString("base64url");
// One student per NODE_ENV case of the entry point, each with a session of their own.
const ENTRY_CASES = ["production", "unset", "staging", "test"] as const;
const entry = Object.fromEntries(
  ENTRY_CASES.map((name) => [
    name,
    { user: randomUUID(), token: randomBytes(32).toString("base64url") },
  ]),
) as Record<(typeof ENTRY_CASES)[number], { user: string; token: string }>;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// The seed lives outside the repository, as the signer demands.
const seedDir = mkdtempSync(join(tmpdir(), "dan815-route-"));
const SEED = join(seedDir, "seed");
writeFileSync(SEED, randomBytes(32), { mode: 0o600 });
const signer = new PersistentDevelopmentEd25519SigningKeyProvider(
  { NODE_ENV: "test", [DEV_SIGNING_KEY_FILE]: SEED },
  ROOT,
);
const payloads = new InMemoryEvidencePayloadStore();

type GoldenSegment = Record<string, unknown> & { events: Record<string, unknown>[] };
const { chain } = JSON.parse(
  readFileSync(join(ROOT, "server/domain/forensics/golden-vectors/evidence-v2.json"), "latin1"),
) as {
  chain: {
    segments: { segment: GoldenSegment }[];
    documentStates: { value: unknown }[];
  };
};

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
let app: pg.Pool;
let appUrl: string;
let server: Running;
/** The same routes with protocol 2 on, its own storage and a signer that counts (DAN-821-4). */
let deferred: Running;
let webSigns = 0;
const WORKER_LOGIN = "it_evidence_commit_route_worker";
let worker: pg.Pool;

async function fixture(): Promise<void> {
  const q = (text: string, values: unknown[] = []) => admin.query(text, values);
  await q("BEGIN");
  await q("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [
    id.a,
    `it-ecr-${suffix}`,
  ]);
  await q(
    `INSERT INTO institution.institution_settings
       (institution_id, display_name, enrollment_attempt_limit, enrollment_attempt_window)
     VALUES ($1, 'Fakultet A (test)', 5, '15 minutes')`,
    [id.a],
  );
  const accounts: [string, string][] = [
    ...(["adminA", "vesna", "ana", "iva"] as const).map(
      (name) => [id[name], name] as [string, string],
    ),
    ...ENTRY_CASES.map((name) => [entry[name].user, `ulaz-${name}`] as [string, string]),
  ];
  for (const [user, name] of accounts) {
    await q(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.test', $3, $4)`,
      [user, id.a, `sub-${name}-${suffix}`, `${name}-${suffix}@fak.invalid`],
    );
  }
  for (const name of ENTRY_CASES) {
    await q(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
      [entry[name].token, entry[name].user, id.a],
    );
  }
  await q(
    `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
     VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
    [token, id.ana, id.a],
  );
  await q(
    `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
     VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
    [ivaToken, id.iva, id.a],
  );
  await q("SELECT institution.appoint_institution_admin($1, $2)", [id.adminA, `Zahtjev ${suffix}`]);
  await q(
    `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
     VALUES ($1, $2, 'teacher', $3, now())`,
    [id.a, id.vesna, id.adminA],
  );
  await q(
    `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
     VALUES ($1, $2, 'Kolegij (test)', '2026/2027', 'partially_allowed', $3)`,
    [id.k1, id.a, id.vesna],
  );
  await q(
    `INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
     SELECT $1::uuid, $2::uuid, $3::uuid, 'teacher' UNION ALL SELECT $1::uuid, $2::uuid, unnest($4::uuid[]), 'student'`,
    [id.k1, id.a, id.vesna, [id.ana, id.iva, ...ENTRY_CASES.map((name) => entry[name].user)]],
  );
  await q(
    `INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
     VALUES ($1, $2, $3, 1, $4)`,
    [id.z1, id.k1, id.a, id.vesna],
  );
  await q(
    `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type,
       opens_at, due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
     VALUES ($1, 1, 'Zadatak (test)', 'Upute za izmišljeni zadatak.', 'essay', now(),
       now() + interval '30 days', 'partially_allowed', '{proofreading}', 'basic', true, $2)`,
    [id.z1, id.vesna],
  );
  await q(
    `INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
     SELECT $1::uuid, 1, unnest($2::uuid[]), $3::uuid`,
    [id.z1, [id.ana, id.iva, ...ENTRY_CASES.map((name) => entry[name].user)], id.a],
  );
  await q(
    "INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, 'eu-central-1')",
    [id.domainA, id.a],
  );
  const key = await signer.publicVerificationKey();
  if (!key.ok) throw new Error("development key");
  await q(
    `INSERT INTO evidence.signing_key
       (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm, key_base64url, valid_from)
     VALUES ($1, $2, $3, $4, 'receipt', 'Ed25519', $5, date_trunc('minute', now()) - interval '1 day')`,
    [key.value.keyId, key.value.keyVersion, id.domainA, id.a, key.value.keyBase64Url],
  );
  await q("COMMIT");
}

beforeAll(async () => {
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [APP_LOGIN, password],
  );
  await admin.query(ddl.rows[0]!.ddl);
  await fixture();
  const url = new URL(ADMIN_URL);
  url.username = APP_LOGIN;
  url.password = password;
  appUrl = url.href;
  app = new pg.Pool({ connectionString: url.href, max: 4 });
  const withActor = createWithActor(app);
  const main = {
    withActor,
    actorReader: createActorReader(withActor),
    workOpener: createWorkOpener(withActor),
    settingsWriter: createSettingsWriter(withActor),
    webauthnCredentials: createWebAuthnCredentials(withActor),
  };
  server = await startServer({
    host: "127.0.0.1",
    port: 0,
    layers: createLayers({ expectedOrigin: ORIGIN }),
    databases: createDatabases(),
    routes: [
      createEvidenceOpenRoute(main),
      createEvidenceCommitRouteFor(main, { signer, payloads }),
    ],
  });
  const counting = {
    sign: (message: Uint8Array) => {
      webSigns += 1;
      return signer.sign(message);
    },
  };
  deferred = await startServer({
    host: "127.0.0.1",
    port: 0,
    layers: createLayers({ expectedOrigin: ORIGIN }),
    databases: createDatabases(),
    routes: [
      createEvidenceOpenRoute(main),
      createEvidenceCommitRouteFor(main, {
        signer: counting,
        payloads: new InMemoryEvidencePayloadStore(),
        asyncSigning: true,
      }),
    ],
  });
  await admin.query(`DROP ROLE IF EXISTS ${WORKER_LOGIN}`);
  const role = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_worker', $1::text, $2::text) AS ddl",
    [WORKER_LOGIN, password],
  );
  await admin.query(role.rows[0]!.ddl);
  const workerUrl = new URL(ADMIN_URL);
  workerUrl.username = WORKER_LOGIN;
  workerUrl.password = password;
  worker = new pg.Pool({ connectionString: workerUrl.href, max: 1 });
});

afterAll(async () => {
  await server?.close();
  await deferred?.close();
  await worker?.end();
  // evidence.receipt is append-only; only this file's pending rows go, so a
  // failure between 202 and the worker's signature leaves pgTAP 107 true.
  await admin.query("BEGIN");
  await admin.query("SET LOCAL session_replication_role = replica");
  await admin.query(
    "DELETE FROM evidence.receipt WHERE evidence_domain_id = $1 AND status = 'pending_signature'",
    [id.domainA],
  );
  await admin.query("COMMIT");
  await admin.query(`DROP ROLE IF EXISTS ${WORKER_LOGIN}`);
  await app?.end();
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.end();
  rmSync(seedDir, { recursive: true, force: true });
});

type Answer = {
  status: number;
  body: Record<string, unknown> & { [key: string]: unknown };
  headers: Record<string, unknown>;
};
function post(
  path: string,
  body: unknown,
  who: string = token,
  port: number = server.port,
  protocol = "1",
): Promise<Answer> {
  const text = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path,
        headers: {
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          "ductus-protocol": protocol,
          cookie: `__Host-ductus_session=${who}`,
          "content-length": String(Buffer.byteLength(text)),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end(text);
  });
}

describe("evidence/commit through a real server over real PostgreSQL", () => {
  it("D1, D2, G3: commits a segment with a receipt that verifies under open's keys; a retry is the same bytes; open reports the revision", async () => {
    const opened = await post("/api/v1/evidence/open", { assignmentId: id.z1, start: true });
    expect(opened.status).toBe(200);
    const { documentId, documentHash, evidenceProfileId, receiptKeys } = opened.body as {
      documentId: string;
      documentHash: string;
      evidenceProfileId: string;
      receiptKeys: EvidenceDomainKey[];
    };
    const template = chain.segments[0]!.segment;
    const document = canonicalizeJcs(chain.documentStates[1]!.value);
    const segment = canonicalizeJcs({
      ...template,
      documentId,
      sessionId: `sesija-${suffix}`,
      segmentId: `segment-${suffix}-1`,
      sequenceFrom: 1,
      sequenceTo: 1,
      initialDocumentHash: documentHash,
      finalDocumentHash: sha256(document),
      predecessorSegmentHash: null,
      evidenceProfileId,
      events: [
        {
          ...template.events[0],
          sequence: 1,
          beforeDocumentHash: documentHash,
          afterDocumentHash: sha256(document),
        },
      ],
    });
    const request = {
      documentId,
      clientTransactionId: `tx-${suffix}-1`,
      baseRevision: 0,
      segments: [Buffer.from(segment, "utf8").toString("base64")],
      document: Buffer.from(document, "utf8").toString("base64"),
    };

    const committed = await post("/api/v1/evidence/commit", request);
    expect(committed.status).toBe(200);
    expect(committed.body).toMatchObject({
      status: "committed",
      revision: 1,
      receipt: { status: "signed" },
    });
    const signedReceipt = (committed.body.receipt as { signedReceipt: unknown }).signedReceipt;
    const verified = await verifySignedEvidenceReceiptV2(
      signedReceipt,
      {
        documentId,
        clientTransactionId: request.clientTransactionId,
        revision: 1,
        evidenceDomainId: id.domainA,
      },
      receiptKeys,
    );
    expect(verified.ok).toBe(true);
    expect(payloads.size).toBe(1);

    const again = await post("/api/v1/evidence/commit", request);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("duplicate");
    expect(again.body.duplicate).toBe(true);
    expect(JSON.stringify((again.body.receipt as { signedReceipt: unknown }).signedReceipt)).toBe(
      JSON.stringify(signedReceipt),
    );
    expect(payloads.size).toBe(1);

    const reopened = await post("/api/v1/evidence/open", { assignmentId: id.z1 });
    expect(reopened.body).toMatchObject({
      status: "opened",
      documentId,
      currentRevision: 1,
      documentHash: sha256(document),
      headSegmentHash: sha256(segment),
      lastSequenceTo: 1,
    });
    expect(Buffer.from(String(reopened.body.document), "base64").toString("utf8")).toBe(document);
  });
});

type Vector = { name: string; response: { status: number; headers: Record<string, string> } };
const { vectors } = JSON.parse(
  readFileSync(join(ROOT, "server/contracts/vectors/evidence.commit.post.json"), "utf8"),
) as { vectors: Vector[] };
/** The status and the headers this route must answer for a named vector. */
function expectVector(answer: Answer, name: string) {
  const vector = vectors.find((v) => v.name === name)!;
  expect(answer.status).toBe(vector.response.status);
  expect(answer.headers["cache-control"]).toBe(vector.response.headers["cache-control"]);
  expect(answer.headers["retry-after"]).toBe(vector.response.headers["retry-after"]);
}

// DAN-821-4 (contract Ductus#1836 c.6944925246): the three protocol 2 vectors
// on a real server over real PostgreSQL. A 202 never carries a signature and
// the web process never signs; only the worker's signature, attached through
// its own login, turns the same request into 200 signed.
describe("evidence/commit under protocol 2 through a real server over real PostgreSQL", () => {
  it("202 pending until the worker signs, then 200 with the worker's signature", async () => {
    const opened = await post(
      "/api/v1/evidence/open",
      { assignmentId: id.z1, start: true },
      ivaToken,
      deferred.port,
    );
    expect(opened.status).toBe(200);
    const { documentId, documentHash, evidenceProfileId, receiptKeys } = opened.body as {
      documentId: string;
      documentHash: string;
      evidenceProfileId: string;
      receiptKeys: EvidenceDomainKey[];
    };
    const template = chain.segments[0]!.segment;
    const document = canonicalizeJcs(chain.documentStates[1]!.value);
    const segment = canonicalizeJcs({
      ...template,
      documentId,
      sessionId: `sesija-${suffix}-iva`,
      segmentId: `segment-${suffix}-iva-1`,
      sequenceFrom: 1,
      sequenceTo: 1,
      initialDocumentHash: documentHash,
      finalDocumentHash: sha256(document),
      predecessorSegmentHash: null,
      evidenceProfileId,
      events: [
        {
          ...template.events[0],
          sequence: 1,
          beforeDocumentHash: documentHash,
          afterDocumentHash: sha256(document),
        },
      ],
    });
    const request = {
      documentId,
      clientTransactionId: `tx-${suffix}-iva-1`,
      baseRevision: 0,
      segments: [Buffer.from(segment, "utf8").toString("base64")],
      document: Buffer.from(document, "utf8").toString("base64"),
    };
    const commit = (protocol: string) =>
      post("/api/v1/evidence/commit", request, ivaToken, deferred.port, protocol);
    const stored = async () =>
      (
        await admin.query<{ status: string; signature: unknown }>(
          `SELECT r.status, r.signature FROM evidence.receipt r JOIN evidence.package p ON p.id = r.evidence_package_id
            WHERE p.document_id = $1`,
          [documentId],
        )
      ).rows;
    const pending = { receipt: { status: "pending_signature" }, revision: 1 };

    // V0, V1, V2: two 202s with exactly the closed body, no signature anywhere.
    const first = await commit("2");
    expectVector(first, "committed-pending-signature");
    expect(first.body).toStrictEqual({ status: "committed", ...pending });
    const second = await commit("2");
    expectVector(second, "duplicate-pending-signature");
    expect(second.body).toStrictEqual({ status: "duplicate", duplicate: true, ...pending });
    expect(await stored()).toEqual([{ status: "pending_signature", signature: null }]);
    expect(webSigns).toBe(0);

    // The worker reads the pending receipt and attaches its signature through its own login.
    const read = await worker.query<{ receipt_id: string; receipt_payload: string }>(
      "SELECT receipt_id::text AS receipt_id, receipt_payload FROM app.worker_pending_receipts($1::uuid, 100, NULL)",
      [id.domainA],
    );
    const row = read.rows.find((r) => JSON.parse(r.receipt_payload).documentId === documentId)!;
    const payload = JSON.parse(row.receipt_payload) as EvidenceReceiptPayloadV2;
    const digest = await digestEvidenceReceiptPayloadV2(payload);
    const signed = await signer.sign(digest.signingInput);
    if (!signed.ok) throw new Error("worker signature");
    expect(
      await createPendingReceiptStore(worker).attachSignature({
        receiptId: row.receipt_id,
        payloadDigestSha256: digest.sha256,
        signature: signed.value,
      }),
    ).toMatchObject({ outcome: "signed" });

    // V3: the same request is 200 with the worker's signature, under either protocol.
    const after = await commit("2");
    expectVector(after, "duplicate-signed-after-pending");
    expect(after.body).toMatchObject({
      status: "duplicate",
      duplicate: true,
      revision: 1,
      receipt: { status: "signed" },
    });
    const signedReceipt = (after.body.receipt as { signedReceipt: { signature: unknown } })
      .signedReceipt;
    expect(signedReceipt.signature).toStrictEqual(signed.value);
    const verified = await verifySignedEvidenceReceiptV2(
      signedReceipt,
      {
        documentId,
        clientTransactionId: request.clientTransactionId,
        revision: 1,
        evidenceDomainId: id.domainA,
      },
      receiptKeys,
    );
    expect(verified.ok).toBe(true);
    const again = await commit("1");
    expect(again.status).toBe(200);
    expect(again.body).toStrictEqual(after.body);
    expect(webSigns).toBe(0);
  });
});

// Self-attack of DAN-815 c: the entry point itself. server/server.ts is
// started as a process with the seed outside the repository and storage on
// plain http to a loopback port that only counts connections. Outside
// NODE_ENV development or test (F-020 allowlist, an unset or misspelt value
// counts as production) the commit is 503 storage, no byte reaches that port
// and nothing is written. Under NODE_ENV test the same setup does reach it,
// so the count is a real witness of the configuration the entry point made.
describe("the entry point mounts evidence/commit over its own environment", () => {
  const KEY_VAR = "EVIDENCE_S3_ULAZ_KEY_ID";
  const SECRET_VAR = "EVIDENCE_S3_ULAZ_SECRET";
  let sink: Server;
  let sinkPort = 0;
  let connections = 0;
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    sink = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    sinkPort = (sink.address() as { port: number }).port;
  });
  afterAll(async () => {
    for (const child of children) child.kill("SIGKILL");
    await new Promise((resolve) => sink.close(resolve));
  });

  async function start(nodeEnv: string | undefined): Promise<number> {
    const endpoint = `http://127.0.0.1:${sinkPort}`;
    const domain = {
      label: "ulaz-lokalno",
      institutionId: id.a,
      endpoint,
      region: "eu-central-1",
      bucket: "ductus-ulaz",
      accessKeyIdVar: KEY_VAR,
      secretAccessKeyVar: SECRET_VAR,
      capability: {
        provider: "fake-s3",
        endpoint,
        conditionalWrite: "verified",
        checksumEcho: "verified",
        verifiedOn: "2026-10-01",
        contractTest: "unit/fake-s3",
      },
    };
    const child = spawn(process.execPath, [...SERVER_NODE_FLAGS, join(ROOT, "server/server.ts")], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        ...(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }),
        PORT: "0",
        APP_ORIGIN: ORIGIN,
        APP_DATABASE_URL: appUrl,
        [DEV_SIGNING_KEY_FILE]: SEED,
        [EVIDENCE_STORAGE_DOMAINS]: JSON.stringify({ requestTimeoutMs: 2_000, domains: [domain] }),
        [KEY_VAR]: "izmisljeni-kljuc-ulaza",
        [SECRET_VAR]: "izmisljena-tajna-ulaza",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += String(chunk)));
    child.stderr?.on("data", () => undefined);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const line = out.split("\n").find((l) => l.includes("server.listening"));
      if (line !== undefined) return (JSON.parse(line) as { port: number }).port;
      if (child.exitCode !== null) throw new Error("the entry point exited");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("the entry point did not start");
  }

  /** Opens the student's work and sends its first segment; the answer and the revision after it. */
  async function commitAt(port: number, who: string) {
    const opened = await post(
      "/api/v1/evidence/open",
      { assignmentId: id.z1, start: true },
      who,
      port,
    );
    expect(opened.status).toBe(200);
    const { documentId, documentHash, evidenceProfileId } = opened.body as {
      documentId: string;
      documentHash: string;
      evidenceProfileId: string;
    };
    const template = chain.segments[0]!.segment;
    const document = canonicalizeJcs(chain.documentStates[1]!.value);
    const segment = canonicalizeJcs({
      ...template,
      documentId,
      sessionId: `sesija-ulaz-${suffix}`,
      segmentId: `segment-ulaz-${suffix}`,
      sequenceFrom: 1,
      sequenceTo: 1,
      initialDocumentHash: documentHash,
      finalDocumentHash: sha256(document),
      predecessorSegmentHash: null,
      evidenceProfileId,
      events: [
        {
          ...template.events[0],
          sequence: 1,
          beforeDocumentHash: documentHash,
          afterDocumentHash: sha256(document),
        },
      ],
    });
    const answer = await post(
      "/api/v1/evidence/commit",
      {
        documentId,
        clientTransactionId: `tx-ulaz-${suffix}`,
        baseRevision: 0,
        segments: [Buffer.from(segment, "utf8").toString("base64")],
        document: Buffer.from(document, "utf8").toString("base64"),
      },
      who,
      port,
    );
    const row = await admin.query<{ current_revision: string }>(
      "SELECT current_revision FROM evidence.document WHERE id = $1",
      [documentId],
    );
    return { answer, revision: Number(row.rows[0]?.current_revision) };
  }

  it.each([
    ["production", "production"],
    ["unset", undefined],
    ["staging", "staging"],
  ] as const)(
    "NODE_ENV %s: 503 storage, nothing reaches plain http, nothing is written",
    async (name, nodeEnv) => {
      const port = await start(nodeEnv);
      const before = connections;
      const { answer, revision } = await commitAt(port, entry[name].token);
      expect(answer.status).toBe(503);
      expect(answer.body).toEqual({ status: "unavailable", stage: "storage" });
      expect(connections).toBe(before);
      expect(revision).toBe(0);
    },
    30_000,
  );

  it("NODE_ENV test: the same configuration does reach the loopback port", async () => {
    const port = await start("test");
    const before = connections;
    const { answer, revision } = await commitAt(port, entry.test.token);
    expect(answer.status).toBe(503);
    expect(answer.body).toEqual({ status: "unavailable", stage: "storage" });
    expect(connections).toBeGreaterThan(before);
    expect(revision).toBe(0);
  }, 30_000);
});
