// SRV-1205 (Val 12 / M9.0-S2, Ductus#2052): the worker's job of sweeping and
// settling AI assistant requests, step 5 of Ductus
// docs/contracts/ai-request-v1.md ("Stanja", "RPC-ovi", "Poznate granice").
//
// Two parts, both over ports the worker process passes in (it binds them to
// its ductus_worker connection; this area builds no adapter):
//   * the scan lists the requests due now (assistant.sweep_due) and puts one
//     job per request into the queue, its body only the request id (M10). A
//     request already waiting or running is not queued twice (the queue's
//     subject key), so scans may overlap;
//   * the handler takes one job and calls assistant.sweep_and_settle with its
//     id: a stale reservation is rejected and its cost released, a stale sent
//     request becomes outcome_unknown, and an outcome_unknown is settled once,
//     at the reserved amount (no query of the actual cost until OA-1). The
//     database locks the request row and changes each one once, so a second
//     run, or two at once, settle once.
//
// The deadlines are the database's named constants; the mirrors here only
// say when a scan can find something and are checked against the database by
// tests/db/assistant-sweep.integration.test.ts. Nothing here names a
// provider, a model, an amount or a student (OA-1, OA-2, Q-10).
import type { AssistantRefusal, AssistantRequestState, SweepDue } from "../../database/index.ts";
import { parseJobBody, type JobBody, type JobDefinition } from "../../domain/index.ts";

/** The queue of the sweep: one job per request, its body only the request id (M10). */
export const ASSISTANT_SWEEP_JOB: JobDefinition = Object.freeze({
  name: "assistant_sweep",
  fields: Object.freeze(["requestId"]),
  subject: "requestId",
});

/** assistant.stale_reserved_after(): a reservation not sent by then is rejected and released. */
export const STALE_RESERVED_AFTER_SECONDS = 5 * 60;
/** assistant.stale_sent_after(): a request sent without an outcome by then is outcome_unknown. */
export const STALE_SENT_AFTER_SECONDS = 10 * 60;
/** How often the worker scans; a request is swept at most this long after its deadline. */
export const SWEEP_SCAN_EVERY_SECONDS = 60;
/** Ids asked for in one scan (assistant.sweep_due takes 1 to 1000); the rest wait for the next. */
export const SWEEP_SCAN_LIMIT = 100;

/** The queue settings of the sweep for the worker process (JobQueueSettings without connection and fence). */
export const ASSISTANT_SWEEP_QUEUE = Object.freeze({
  /** A database that does not answer is tried again; the sweep itself is safe to repeat. */
  retryLimit: 5,
  retryDelaySeconds: 30,
  /** One RPC on one row; well inside the expiry. */
  deadlineMs: 20_000,
  expireSeconds: 60,
  deleteAfterSeconds: 7 * 86_400,
  sweepSeconds: SWEEP_SCAN_EVERY_SECONDS,
});

/** The worker's ports, bound to its ductus_worker connection. */
export type SweepPorts = {
  readonly sweepAndSettle: (
    requestId: string,
  ) => Promise<{ readonly status: "ok"; readonly state: AssistantRequestState } | AssistantRefusal>;
  readonly sweepDue: (limit: number) => Promise<SweepDue>;
};

/** The queue's enqueue (JobQueue.enqueue). */
export type SweepEnqueue = (
  name: string,
  input: unknown,
) => Promise<"queued" | "duplicate" | "rejected">;

/** The shape of the queue's JobHandler; the refusal is a closed code, never a message. */
export type SweepHandler = (
  body: JobBody,
  signal: AbortSignal,
) => Promise<{ ok: true } | { ok: false; code: SweepRefusalCode }>;

export type SweepRefusalCode =
  | "assistant_sweep_body_invalid"
  | "assistant_sweep_aborted"
  | "assistant_request_unknown"
  | "assistant_sweep_unavailable";

/**
 * The handler of one sweep job. Any state the database answers is done: a
 * request that is not stale yet (sent again between the scan and the job, or
 * answered meanwhile) is left as it is and found by a later scan if it goes
 * stale. An id that does not exist is refused with its own code; an
 * unreachable database is refused so the queue tries again.
 */
export function createSweepHandler(ports: Pick<SweepPorts, "sweepAndSettle">): SweepHandler {
  return async (body, signal) => {
    const parsed = parseJobBody(body, ASSISTANT_SWEEP_JOB.fields);
    if (!parsed.ok) return { ok: false, code: "assistant_sweep_body_invalid" };
    if (signal.aborted) return { ok: false, code: "assistant_sweep_aborted" };
    let answer: Awaited<ReturnType<SweepPorts["sweepAndSettle"]>>;
    try {
      answer = await ports.sweepAndSettle(parsed.body["requestId"]!);
    } catch {
      return { ok: false, code: "assistant_sweep_unavailable" };
    }
    if (answer.status === "ok") return { ok: true };
    if (answer.status === "forbidden") return { ok: false, code: "assistant_request_unknown" };
    return { ok: false, code: "assistant_sweep_unavailable" };
  };
}

export type SweepScan =
  | {
      readonly status: "ok";
      readonly queued: number;
      readonly duplicate: number;
      readonly rejected: number;
    }
  | { readonly status: "unavailable" };

/** One scan: the due requests, one job each. Unavailable when the listing or the queue fails. */
export async function scanSweepDue(
  ports: Pick<SweepPorts, "sweepDue"> & { readonly enqueue: SweepEnqueue },
  limit: number = SWEEP_SCAN_LIMIT,
): Promise<SweepScan> {
  let due: SweepDue;
  try {
    due = await ports.sweepDue(limit);
  } catch {
    return { status: "unavailable" };
  }
  if (due.status !== "ok") return { status: "unavailable" };
  const counts = { queued: 0, duplicate: 0, rejected: 0 };
  for (const requestId of due.requestIds) {
    let outcome: unknown;
    try {
      outcome = await ports.enqueue(ASSISTANT_SWEEP_JOB.name, { requestId });
    } catch {
      return { status: "unavailable" };
    }
    if (outcome !== "queued" && outcome !== "duplicate" && outcome !== "rejected")
      return { status: "unavailable" };
    counts[outcome] += 1;
  }
  return { status: "ok", ...counts };
}
