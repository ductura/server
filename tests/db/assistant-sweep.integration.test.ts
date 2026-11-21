import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ASSISTANT_SWEEP_JOB,
  ASSISTANT_SWEEP_QUEUE,
  STALE_RESERVED_AFTER_SECONDS,
  STALE_SENT_AFTER_SECONDS,
  createSweepHandler,
  scanSweepDue,
  type SweepHandler,
} from "../../server/assistant/index.ts";
import {
  createAssistantRequests,
  createWithActor,
  sweepAndSettle,
  sweepDue,
  type BeginRequestInput,
  type WorkerQuery,
} from "../../server/database/index.ts";
import {
  openJobQueue,
  type AttemptFence,
  type JobHandler,
  type JobQueue,
} from "../../server/database/queue/index.ts";
import { buildPortInput } from "../../server/domain/index.ts";
import { createSyntheticAssistant } from "../../server/external/assistant/index.ts";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url.ts";

// SRV-1205 (Val 12 / M9.0-S2, Ductus#2052): the worker's job of sweeping and
// settling assistant requests, step 5 of Ductus docs/contracts/ai-request-v1.md
// ("Stanja"; "Testovi prije koda": double settlement, the day boundary, a new
// period published, I4). The job runs as the worker would run it: a login
// that is only ductus_worker scans assistant.sweep_due, the real pg-boss queue
// takes one job per request (its body only the request id, M10) and the
// handler calls assistant.sweep_and_settle. The web side is played by `flow`
// over the synthetic port (no network, no secret), as in
// assistant-budget.integration.test.ts.
//
// After every scenario the counters equal the ledger. Rows that must look old
// (a stale reservation, a request sent yesterday) are written by the owner
// role with old times and their counters, as begin_request would have written
// them then. Every institution, person and text is invented; amounts are
// invented test values (T8), providers and models provider-test-a and
// model-test-1 (S4). The service scope is shared by the whole database, so
// this file publishes its own service caps and takes them, every row it
// wrote, its jobs and its login away at the end. Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(
  SAFE_ADMIN_URL,
  "The assistant sweep test runs only against a loopback database (DATABASE_URL).",
);
const suffix = randomBytes(5).toString("hex");
const applicationName = `it_assistant_sweep_${suffix}`;
const workerRole = `it_assistant_sweep_${suffix}`;
const workerPassword = randomBytes(24).toString("hex");
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 4 });
const app = new pg.Pool({
  connectionString: process.env.APP_DATABASE_URL,
  max: 16,
  application_name: applicationName,
});
const withActor = createWithActor(app);
const port = createAssistantRequests(withActor);

const R = 7n; // one reservation, an invented amount
const HUGE = 1_000_000_000_000n;
const institutions: string[] = [];
const serviceVersions: string[] = [];
const touched: string[] = [];

let worker: pg.Pool;
let queue: JobQueue;
let handler: SweepHandler;
let query: WorkerQuery;

type Person = { id: string; token: string };
type World = { institutionId: string; assignmentId: string; admin: Person; students: Person[] };

const token = () => randomBytes(32).toString("base64url");

function workerUrl(): string {
  const target = new URL(SAFE_ADMIN_URL);
  target.username = workerRole;
  target.password = workerPassword;
  target.searchParams.set("application_name", applicationName);
  return target.toString();
}

const fence = (): AttemptFence => ({
  arm(ms) {
    const timer = setTimeout(() => {
      throw new Error(`a sweep attempt outlived its ${ms} ms`);
    }, ms);
    return () => clearTimeout(timer);
  },
  close: async () => {},
});

async function person(client: pg.PoolClient, institutionId: string, name: string): Promise<Person> {
  const p = { id: randomUUID(), token: token() };
  await client.query(
    `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      p.id,
      institutionId,
      `https://issuer-${suffix}.test`,
      `sub-${name}-${p.id}`,
      `${name}-${p.id}@${suffix}.invalid`,
    ],
  );
  await client.query(
    `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
     VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
    [p.token, p.id, institutionId],
  );
  return p;
}

/** A new institution: an administrator, a teacher, a course with one assignment, n students. */
async function world(students: number): Promise<World> {
  const institutionId = randomUUID();
  institutions.push(institutionId);
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [
      institutionId,
      `it-sweep-${suffix}-${institutions.length}`,
    ]);
    await client.query(
      `INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmišljeni fakultet')`,
      [institutionId],
    );
    const adm = await person(client, institutionId, "admin");
    const teacher = await person(client, institutionId, "teacher");
    const people: Person[] = [];
    for (let i = 0; i < students; i += 1)
      people.push(await person(client, institutionId, `student${i}`));
    await client.query("SELECT institution.appoint_institution_admin($1, $2)", [
      adm.id,
      `Zahtjev ${suffix}`,
    ]);
    await client.query(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
       VALUES ($1, $2, 'teacher', $3, now())`,
      [institutionId, teacher.id, adm.id],
    );
    const course = randomUUID();
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, 'Izmišljeni kolegij', '2026/2027', 'encouraged', $3)`,
      [course, institutionId, teacher.id],
    );
    for (const [user, role] of [
      [teacher, "teacher"],
      ...people.map((p) => [p, "student"] as const),
    ] as const) {
      await client.query(
        `INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, $4)`,
        [course, institutionId, user.id, role],
      );
    }
    const assignmentId = randomUUID();
    await client.query(
      `INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, $3, 1, $4)`,
      [assignmentId, course, institutionId, teacher.id],
    );
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmišljeni zadatak', 'Izmišljene upute.', 'essay', now(), now() + interval '30 days',
               'encouraged', '{proofreading,translation}', 'basic', false, $2)`,
      [assignmentId, teacher.id],
    );
    await client.query("COMMIT");
    return { institutionId, assignmentId, admin: adm, students: people };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const versionOf = async (institutionId: string | null) =>
  Number(
    (
      await admin.query<{ n: number }>(
        "SELECT coalesce(max(version_no), 0) AS n FROM assistant.cost_config_version WHERE institution_id IS NOT DISTINCT FROM $1",
        [institutionId],
      )
    ).rows[0]!.n,
  );

/** The operator's cap of an institution, or of the service for null. */
async function cap(institutionId: string | null, micro: bigint, period: "day" | "month") {
  const version = await versionOf(institutionId);
  await admin.query("SELECT assistant.publish_cost_cap($1, $2, $3, $4, $5)", [
    institutionId,
    version,
    micro.toString(),
    period,
    `Zahtjev ${suffix}/${version + 1}`,
  ]);
  if (institutionId === null) {
    serviceVersions.push(
      (
        await admin.query<{ id: string }>(
          "SELECT id FROM assistant.cost_config_version WHERE institution_id IS NULL AND version_no = $1",
          [version + 1],
        )
      ).rows[0]!.id,
    );
  }
}

async function configured(students: number, opts: { day?: bigint; period?: "day" | "month" } = {}) {
  const w = await world(students);
  await cap(w.institutionId, HUGE, opts.period ?? "day");
  const answer = await port.publishCostConfig(w.admin.token, {
    expectedVersion: await versionOf(w.institutionId),
    studentDayMicro: opts.day ?? HUGE,
    studentAssignmentDayMicro: HUGE,
    reserveMicro: R,
  });
  expect(answer).toMatchObject({ status: "published" });
  return w;
}

let n = 0;
const input = (w: World): BeginRequestInput => ({
  idempotencyKey: randomUUID(),
  assignmentId: w.assignmentId,
  conversationId: null,
  purposeCatalogVersion: 1,
  purposeKey: "proofreading",
  paragraph: `Izmišljeni odlomak broj ${(n += 1)}.`,
  providerId: "provider-test-a",
  modelId: "model-test-1",
  configVersion: "test-1",
});

/** The route of step 4 over the synthetic port: begin, mark_sent, port, outcome. */
async function flow(
  student: Person,
  w: World,
  branch: "success" | "timeout" | "aborted_after_send" = "success",
): Promise<{ final: string; requestId: string | null }> {
  const req = input(w);
  const begun = await port.begin(student.token, req);
  if (begun.status !== "ok") return { final: begun.status, requestId: null };
  touched.push(begun.requestId);
  if (begun.state !== "reserved")
    return { final: begun.reason ?? begun.state, requestId: begun.requestId };
  const sent = await port.markSent(student.token, begun.requestId);
  if (sent.status !== "ok" || sent.state !== "sent")
    return { final: sent.status === "ok" ? sent.state : sent.status, requestId: begun.requestId };
  const outcome = await createSyntheticAssistant(
    branch === "success" ? { branch, actualMicro: R } : { branch },
  ).complete(
    buildPortInput({
      instructions: "Izmišljene upute poslužitelja.",
      paragraph: req.paragraph,
      purposeKey: req.purposeKey,
      modelId: req.modelId,
      maxResponseCodePoints: 2000,
    }),
  );
  const done =
    outcome.kind === "success"
      ? await port.complete(student.token, begun.requestId, outcome.text, outcome.actualMicro)
      : await port.markOutcomeUnknown(student.token, begun.requestId);
  return { final: done.status === "ok" ? done.state : done.status, requestId: begun.requestId };
}

/**
 * A request reserved (and, for "sent", sent) `ago` before now, with its
 * paragraph, its ledger row and its counters under the keys of that moment:
 * the day in Europe/Zagreb, the institution's cap period and a monthly
 * service period, as begin_request would have written them then.
 */
async function planted(
  w: World,
  student: Person,
  state: "reserved" | "sent",
  ago: string,
  institutionPeriod: "day" | "month" = "day",
): Promise<string> {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE ductus_identity");
    const conv = await client.query<{ id: string }>(
      "INSERT INTO assistant.conversation (institution_id, student_id, assignment_id) VALUES ($1, $2, $3) RETURNING id",
      [w.institutionId, student.id, w.assignmentId],
    );
    const id = (
      await client.query<{ id: string }>(
        `INSERT INTO assistant.request (institution_id, student_id, assignment_id, assignment_version, conversation_id,
           idempotency_key, request_sha256, purpose_catalog_version, purpose_key, provider_id, model_id, config_version,
           state, requested_at, sent_at)
         VALUES ($1, $2, $3, 1, $4, $5, repeat('e', 64), 1, 'proofreading', 'provider-test-a', 'model-test-1', 'test-1',
                 $6, now() - $7::interval, CASE WHEN $6 = 'sent' THEN now() - $7::interval END) RETURNING id`,
        [w.institutionId, student.id, w.assignmentId, conv.rows[0]!.id, randomUUID(), state, ago],
      )
    ).rows[0]!.id;
    touched.push(id);
    await client.query(
      `INSERT INTO assistant.message (conversation_id, institution_id, seq, request_id, role, content, content_sha256)
       VALUES ($1, $2, 1, $3, 'student_paragraph', 'Davni izmišljeni odlomak.',
               encode(sha256(convert_to('Davni izmišljeni odlomak.', 'UTF8')), 'hex'))`,
      [conv.rows[0]!.id, w.institutionId, id],
    );
    const keys = `(SELECT assistant.budget_day(now() - $1::interval) AS d) x`;
    await client.query(
      `INSERT INTO assistant.cost_ledger (request_id, institution_id, student_id, assignment_id, budget_day,
         institution_cap_period_start, service_cap_period_start, reserved_micro, state, reserved_at)
       SELECT $2, $3, $4, $5, d, assistant.period_start(d, $7), assistant.period_start(d, 'month'), $6, 'reserved',
              now() - $1::interval
         FROM ${keys}`,
      [ago, id, w.institutionId, student.id, w.assignmentId, R.toString(), institutionPeriod],
    );
    for (const [scope, key, period] of [
      ["service_cap", "", "assistant.period_start(d, 'month')"],
      ["institution_cap", w.institutionId, "assistant.period_start(d, $5::text)"],
      ["student_day", `${w.institutionId}:${student.id}`, "d"],
      ["student_assignment_day", `${w.institutionId}:${student.id}:${w.assignmentId}`, "d"],
    ] as const) {
      await client.query(
        `INSERT INTO assistant.budget_counter (scope, scope_key, institution_id, period_start, used_micro)
         SELECT $2, $3, $4, ${period}, $6 FROM ${keys} WHERE $5::text IS NOT NULL
         ON CONFLICT (scope, scope_key, period_start)
           DO UPDATE SET used_micro = assistant.budget_counter.used_micro + EXCLUDED.used_micro`,
        [
          ago,
          scope,
          key,
          scope === "service_cap" ? null : w.institutionId,
          institutionPeriod,
          R.toString(),
        ],
      );
    }
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** One scan and every job it queued, as the worker process runs them. */
async function sweepNow(): Promise<{ queued: number; duplicate: number; rejected: number }> {
  const scan = await scanSweepDue({
    sweepDue: (limit) => sweepDue(query, limit),
    enqueue: (name, body) => queue.enqueue(name, body),
  });
  if (scan.status !== "ok") throw new Error("the scan was unavailable");
  await drain();
  return scan;
}

async function drain(): Promise<void> {
  for (;;) {
    const outcome = await queue.runOnce(ASSISTANT_SWEEP_JOB.name, handler as JobHandler);
    if (outcome.status === "idle") return;
    expect(outcome).toEqual({ status: "completed" });
  }
}

type Ledger = { state: string; reserved: string; actual: string | null; settledAt: string | null };
async function ledger(requestId: string): Promise<Ledger & { request: string }> {
  return (
    await admin.query<Ledger & { request: string }>(
      `SELECT r.state AS request, l.state, l.reserved_micro::text AS reserved, l.actual_micro::text AS actual,
              l.settled_at::text AS "settledAt"
         FROM assistant.request r JOIN assistant.cost_ledger l ON l.request_id = r.id WHERE r.id = $1`,
      [requestId],
    )
  ).rows[0]!;
}

/** Counters whose used amount is not the sum of the ledger rows they hold (the invariant of the contract). */
async function drift(): Promise<string[]> {
  return (
    await admin.query<{ k: string }>(
      `SELECT b.scope || ' ' || b.scope_key || ' ' || b.period_start || ' ' || b.used_micro AS k
         FROM assistant.budget_counter b
        WHERE b.used_micro <> coalesce((
          SELECT sum(coalesce(l.actual_micro, l.reserved_micro)) FROM assistant.cost_ledger l
           WHERE l.state IN ('reserved', 'settled') AND CASE b.scope
             WHEN 'service_cap' THEN l.service_cap_period_start = b.period_start
             WHEN 'institution_cap' THEN l.institution_id::text = b.scope_key AND l.institution_cap_period_start = b.period_start
             WHEN 'student_day' THEN l.institution_id || ':' || l.student_id = b.scope_key AND l.budget_day = b.period_start
             ELSE l.institution_id || ':' || l.student_id || ':' || l.assignment_id = b.scope_key AND l.budget_day = b.period_start
           END), 0)`,
    )
  ).rows.map((r) => r.k);
}

/** The used amount of one counter, by the day `ago` before now (or a given period start). */
async function usedOn(scope: string, key: string, ago = "0", period?: string): Promise<bigint> {
  return BigInt(
    (
      await admin.query<{ u: string }>(
        `SELECT coalesce(sum(used_micro), 0)::text AS u FROM assistant.budget_counter
          WHERE scope = $1 AND scope_key = $2
            AND period_start = coalesce($4::date, assistant.budget_day(now() - $3::interval))`,
        [scope, key, ago, period ?? null],
      )
    ).rows[0]!.u,
  );
}

/** The current period of the service cap, and its counter row (made if missing). */
async function serviceCounterPeriod(): Promise<string> {
  const row = (
    await admin.query<{ p: string }>(
      `SELECT assistant.period_start(assistant.budget_day(now()), v.cap_period)::text AS p
         FROM assistant.cost_config_version v WHERE v.institution_id IS NULL ORDER BY v.version_no DESC LIMIT 1`,
    )
  ).rows[0]!;
  await admin.query(
    `INSERT INTO assistant.budget_counter (scope, scope_key, institution_id, period_start, used_micro)
     VALUES ('service_cap', '', NULL, $1, 0) ON CONFLICT DO NOTHING`,
    [row.p],
  );
  return row.p;
}

/**
 * Starts every call while an admin transaction holds the service counter row,
 * waits until `waiting` of them wait on a lock in PostgreSQL, then lets go.
 */
async function race<T>(calls: (() => Promise<T>)[], waiting: number): Promise<T[]> {
  const period = await serviceCounterPeriod();
  const holder = await admin.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(
      "SELECT 1 FROM assistant.budget_counter WHERE scope = 'service_cap' AND scope_key = '' AND period_start = $1 FOR UPDATE",
      [period],
    );
    const running = calls.map((call) => call());
    running.forEach((p) => void p.catch(() => undefined));
    const deadline = Date.now() + 10_000;
    for (;;) {
      const blocked = Number(
        (
          await admin.query<{ n: string }>(
            `SELECT count(*) AS n FROM pg_stat_activity
              WHERE application_name = $1 AND state = 'active' AND wait_event_type = 'Lock'`,
            [applicationName],
          )
        ).rows[0]!.n,
      );
      if (blocked >= waiting) break;
      if (Date.now() > deadline)
        throw new Error(`only ${blocked} of ${waiting} calls reached PostgreSQL and waited`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    await holder.query("COMMIT");
    return await Promise.all(running);
  } catch (error) {
    await holder.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    holder.release();
  }
}

beforeAll(async () => {
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_worker', $1::text, $2::text) AS ddl",
    [workerRole, workerPassword],
  );
  await admin.query(ddl.rows[0]!.ddl);
  worker = new pg.Pool({ connectionString: workerUrl(), max: 4 });
  query = async (text, values) => worker.query<Record<string, unknown>>(text, [...values]);
  handler = createSweepHandler({ sweepAndSettle: (requestId) => sweepAndSettle(query, requestId) });
  queue = await openJobQueue({
    connectionString: workerUrl(),
    definitions: [ASSISTANT_SWEEP_JOB],
    ...ASSISTANT_SWEEP_QUEUE,
    retryDelaySeconds: 0,
    fence,
  });
  // Jobs another run left behind would be taken by this file's drain.
  await admin.query("DELETE FROM pgboss.job WHERE name = $1", [ASSISTANT_SWEEP_JOB.name]);
  await cap(null, HUGE, "month");
}, 60_000);

afterEach(async () => {
  expect(await drift()).toEqual([]);
});

afterAll(async () => {
  try {
    await queue?.stop();
    await worker?.end();
    await app.end();
  } finally {
    // The ledger and the trail are append-only even for the superuser: this
    // file's rows go with the triggers off, in one transaction. The shared
    // service counter gives back exactly what this file's ledger rows put on it.
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM pgboss.job WHERE name = $1 AND data->>'requestId' = ANY ($2)",
        [ASSISTANT_SWEEP_JOB.name, touched],
      );
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `UPDATE assistant.budget_counter b SET used_micro = b.used_micro - s.total
           FROM (SELECT service_cap_period_start AS p, sum(coalesce(actual_micro, reserved_micro)) AS total
                   FROM assistant.cost_ledger WHERE institution_id = ANY ($1) AND state IN ('reserved', 'settled')
                  GROUP BY 1) s
          WHERE b.scope = 'service_cap' AND b.period_start = s.p`,
        [institutions],
      );
      await client.query(
        "DELETE FROM assistant.budget_counter WHERE scope = 'service_cap' AND used_micro = 0",
      );
      await client.query(
        "DELETE FROM audit.assistant_cost_config_event WHERE config_version_id = ANY ($1)",
        [serviceVersions],
      );
      await client.query("DELETE FROM assistant.cost_config_version WHERE id = ANY ($1)", [
        serviceVersions,
      ]);
      const tables = await client.query<{ t: string }>(
        `SELECT format('%I.%I', c.table_schema, c.table_name) AS t FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.column_name = 'institution_id' AND t.table_type = 'BASE TABLE'
            AND c.table_schema NOT IN ('pg_catalog', 'information_schema', 'public', 'pgboss')`,
      );
      for (const { t } of tables.rows) {
        await client.query(`DELETE FROM ${t} WHERE institution_id = ANY ($1)`, [institutions]);
      }
      await client.query("DELETE FROM identity.institution WHERE id = ANY ($1)", [institutions]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await admin.query(`DROP ROLE IF EXISTS ${workerRole}`).catch(() => undefined);
      await admin.end();
    }
  }
});

describe("assistant sweep: the job and its deadlines", () => {
  it("names the database's deadlines in code, and the worker login lists ids only", async () => {
    const row = (
      await admin.query<{ reserved: string; sent: string }>(
        `SELECT extract(epoch FROM assistant.stale_reserved_after())::int::text AS reserved,
                extract(epoch FROM assistant.stale_sent_after())::int::text AS sent`,
      )
    ).rows[0]!;
    expect(row).toEqual({
      reserved: String(STALE_RESERVED_AFTER_SECONDS),
      sent: String(STALE_SENT_AFTER_SECONDS),
    });
    await expect(query("SELECT count(*) FROM assistant.request", [])).rejects.toMatchObject({
      code: "42501",
    });
    expect(await sweepDue(query, 0)).toEqual({ status: "invalid" });
  });

  it("queues one job per request, its body only the request id (M10)", async () => {
    const w = await configured(1);
    const lost = await flow(w.students[0]!, w, "timeout");
    expect(lost.final).toBe("outcome_unknown");
    const scan = await scanSweepDue({
      sweepDue: (limit) => sweepDue(query, limit),
      enqueue: (name, body) => queue.enqueue(name, body),
    });
    expect(scan).toMatchObject({ status: "ok" });
    const again = await scanSweepDue({
      sweepDue: (limit) => sweepDue(query, limit),
      enqueue: (name, body) => queue.enqueue(name, body),
    });
    expect(again).toMatchObject({ status: "ok", queued: 0 });
    const jobs = await admin.query<{ data: unknown }>(
      "SELECT data FROM pgboss.job WHERE name = $1 AND data->>'requestId' = $2",
      [ASSISTANT_SWEEP_JOB.name, lost.requestId],
    );
    expect(jobs.rows).toEqual([{ data: { requestId: lost.requestId } }]);
    await drain();
    expect(await ledger(lost.requestId!)).toMatchObject({ request: "settled", state: "settled" });
  });
});

describe("assistant sweep: twice settles once", () => {
  it("a second job for a settled request, and two at once, change nothing", async () => {
    const w = await configured(1);
    const student = w.students[0]!;
    const first = await flow(student, w, "timeout");
    const second = await flow(student, w, "aborted_after_send");
    expect([first.final, second.final]).toEqual(["outcome_unknown", "outcome_unknown"]);
    const day = `${w.institutionId}:${student.id}`;
    expect(await usedOn("student_day", day)).toBe(2n * R);

    await sweepNow();
    const settled = await ledger(first.requestId!);
    expect(settled).toMatchObject({
      request: "settled",
      state: "settled",
      reserved: R.toString(),
      actual: R.toString(),
    });
    expect(await ledger(second.requestId!)).toMatchObject({ request: "settled", actual: "7" });
    expect(await usedOn("student_day", day)).toBe(2n * R);

    // The same id queued again after its job completed: the job runs, nothing moves.
    expect(await queue.enqueue(ASSISTANT_SWEEP_JOB.name, { requestId: first.requestId })).toBe(
      "queued",
    );
    await drain();
    // Two handlers on one request at once: the row lock lets one settle, once.
    const both = await Promise.all([
      handler({ requestId: second.requestId! }, new AbortController().signal),
      handler({ requestId: second.requestId! }, new AbortController().signal),
    ]);
    expect(both).toEqual([{ ok: true }, { ok: true }]);
    expect(await ledger(first.requestId!)).toEqual(settled);
    expect((await ledger(second.requestId!)).actual).toBe(R.toString());
    expect(await usedOn("student_day", day)).toBe(2n * R);
    // Nothing of these is listed any more.
    const due = await sweepDue(query, 1000);
    expect(due.status === "ok" && due.requestIds.filter((id) => touched.includes(id))).toEqual([]);
  });

  it("rejects a stale reservation once and releases its cost, and leaves fresh ones alone", async () => {
    const w = await configured(1);
    const student = w.students[0]!;
    const stale = await planted(
      w,
      student,
      "reserved",
      `${STALE_RESERVED_AFTER_SECONDS + 60} seconds`,
    );
    const fresh = await planted(
      w,
      student,
      "reserved",
      `${STALE_RESERVED_AFTER_SECONDS - 60} seconds`,
    );
    const sentFresh = await planted(w, student, "sent", `${STALE_SENT_AFTER_SECONDS - 60} seconds`);
    const sentStale = await planted(w, student, "sent", `${STALE_SENT_AFTER_SECONDS + 60} seconds`);
    const day = `${w.institutionId}:${student.id}`;
    expect(await usedOn("student_day", day)).toBe(4n * R);

    await sweepNow();
    await sweepNow();
    expect(await ledger(stale)).toMatchObject({
      request: "rejected",
      state: "released",
      actual: null,
    });
    expect(await ledger(sentStale)).toMatchObject({ request: "settled", actual: R.toString() });
    expect(await ledger(fresh)).toMatchObject({ request: "reserved", state: "reserved" });
    expect(await ledger(sentFresh)).toMatchObject({ request: "sent", state: "reserved" });
    const reason = await admin.query<{ reason: string }>(
      "SELECT reason FROM assistant.request WHERE id = $1",
      [stale],
    );
    expect(reason.rows[0]!.reason).toBe("request_outcome_unknown");
    expect(await usedOn("student_day", day)).toBe(3n * R);
  });
});

describe("assistant sweep: the keys written in the ledger row (T6)", () => {
  it("after midnight it releases and settles into yesterday's counters, and today is not freed", async () => {
    const w = await configured(1, { day: R });
    const student = w.students[0]!;
    const day = `${w.institutionId}:${student.id}`;
    const reservedYesterday = await planted(w, student, "reserved", "1 day");
    const sentYesterday = await planted(w, student, "sent", "1 day");
    expect(await usedOn("student_day", day, "1 day")).toBe(2n * R);
    // Today fills its own day.
    expect((await flow(student, w)).final).toBe("completed");
    expect(await usedOn("student_day", day)).toBe(R);

    await sweepNow();
    expect(await ledger(reservedYesterday)).toMatchObject({
      request: "rejected",
      state: "released",
    });
    expect(await ledger(sentYesterday)).toMatchObject({ request: "settled", actual: R.toString() });
    expect(await usedOn("student_day", day, "1 day")).toBe(R);
    expect(await usedOn("student_assignment_day", `${day}:${w.assignmentId}`, "1 day")).toBe(R);
    expect(await usedOn("student_day", day)).toBe(R);
    // Releasing yesterday's reservation did not free today.
    expect((await flow(student, w)).final).toBe("budget_exceeded");
  });

  it("after a configuration with other periods is published, it settles and releases under the periods it reserved in", async () => {
    await cap(null, HUGE, "month");
    const w = await configured(1, { period: "day" });
    const student = w.students[0]!;
    const lost = await flow(student, w, "timeout");
    expect(lost.final).toBe("outcome_unknown");
    const stale = await planted(
      w,
      student,
      "reserved",
      `${STALE_RESERVED_AFTER_SECONDS + 60} seconds`,
    );
    const keysOf = async (id: string) =>
      (
        await admin.query<{ s: string; i: string; d: string }>(
          `SELECT service_cap_period_start::text AS s, institution_cap_period_start::text AS i, budget_day::text AS d
             FROM assistant.cost_ledger WHERE request_id = $1`,
          [id],
        )
      ).rows[0]!;
    const before = { lost: await keysOf(lost.requestId!), stale: await keysOf(stale) };
    expect(before.lost.s).toBe(`${before.lost.d.slice(0, 8)}01`);
    expect(before.lost.i).toBe(before.lost.d);
    expect(await usedOn("institution_cap", w.institutionId, "0", before.lost.i)).toBe(2n * R);
    try {
      await cap(null, HUGE, "day");
      await cap(w.institutionId, HUGE, "month");

      await sweepNow();
      expect(await ledger(lost.requestId!)).toMatchObject({ request: "settled", actual: "7" });
      expect(await ledger(stale)).toMatchObject({ request: "rejected", state: "released" });
      expect({ lost: await keysOf(lost.requestId!), stale: await keysOf(stale) }).toEqual(before);
      // The institution's daily counter of that day lost the release only.
      expect(await usedOn("institution_cap", w.institutionId, "0", before.lost.i)).toBe(R);
      const monthStart = `${before.lost.d.slice(0, 8)}01`;
      if (monthStart !== before.lost.i) {
        expect(await usedOn("institution_cap", w.institutionId, "0", monthStart)).toBe(0n);
      }
    } finally {
      await cap(null, HUGE, "month");
    }
  });
});

describe("assistant sweep: settling while a new request meets the edge (I4)", () => {
  it("settling an outcome_unknown never lets the sum pass the limit", async () => {
    const w = await configured(1, { day: 2n * R });
    const student = w.students[0]!;
    const lost = await flow(student, w, "timeout");
    expect(lost.final).toBe("outcome_unknown");
    const signal = new AbortController().signal;
    const [settled, b, c] = await race<unknown>(
      [
        () => handler({ requestId: lost.requestId! }, signal),
        () => flow(student, w),
        () => flow(student, w),
      ],
      2,
    );
    expect(settled).toEqual({ ok: true });
    expect([(b as { final: string }).final, (c as { final: string }).final].sort()).toEqual([
      "budget_exceeded",
      "completed",
    ]);
    expect(await ledger(lost.requestId!)).toMatchObject({ request: "settled", actual: "7" });
    expect(await usedOn("student_day", `${w.institutionId}:${student.id}`)).toBe(2n * R);
  });

  it("releasing a stale reservation never lets the sum pass the limit", async () => {
    const w = await configured(1, { day: 2n * R });
    const student = w.students[0]!;
    const day = `${w.institutionId}:${student.id}`;
    const stale = await planted(
      w,
      student,
      "reserved",
      `${STALE_RESERVED_AFTER_SECONDS + 60} seconds`,
    );
    expect((await flow(student, w)).final).toBe("completed");
    expect(await usedOn("student_day", day)).toBe(2n * R);
    const signal = new AbortController().signal;
    const results = await race<unknown>(
      [() => handler({ requestId: stale }, signal), () => flow(student, w), () => flow(student, w)],
      3,
    );
    expect(results[0]).toEqual({ ok: true });
    expect(await ledger(stale)).toMatchObject({ request: "rejected", state: "released" });
    const finals = results.slice(1).map((r) => (r as { final: string }).final);
    const completed = finals.filter((f) => f === "completed").length;
    // At most the one released reservation is taken again: the day stays at the limit.
    expect(completed).toBeLessThanOrEqual(1);
    expect(finals.filter((f) => f !== "completed").every((f) => f === "budget_exceeded")).toBe(
      true,
    );
    expect(await usedOn("student_day", day)).toBe(R + BigInt(completed) * R);
    expect(await usedOn("student_day", day)).toBeLessThanOrEqual(2n * R);
  });
});
