// SRV-1205 (Val 12 / M9.0-S2, Ductus#2052): the worker's listing of the
// assistant requests due for the sweep, step 5 of Ductus
// docs/contracts/ai-request-v1.md (migration 20261122120000). The worker reads
// no request row directly; assistant.sweep_due gives it the ids, oldest first,
// and nothing else, so a job can carry only the id (M10). Which rows are due
// is the database's: the deadlines are its named constants
// assistant.stale_reserved_after() and assistant.stale_sent_after().
//
// The answer is the ids or a closed status, never a database message:
// ZD422 (a bound outside 1 to 1000) invalid, anything else unavailable, and a
// row of an unexpected shape unavailable too.
import type { WorkerQuery } from "./assistant-requests.ts";

/** The largest bound of one listing; assistant.sweep_due refuses more. */
export const SWEEP_DUE_MAX = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SweepDue =
  | { readonly status: "ok"; readonly requestIds: readonly string[] }
  | { readonly status: "invalid" | "unavailable" };

/** Up to `limit` ids of requests the sweep would change now, oldest request first. */
export async function sweepDue(query: WorkerQuery, limit: number): Promise<SweepDue> {
  if (!Number.isInteger(limit) || limit < 1 || limit > SWEEP_DUE_MAX) return { status: "invalid" };
  let rows: Record<string, unknown>[];
  try {
    rows = (
      await query("SELECT request_id FROM assistant.sweep_due($1) AS d (request_id)", [limit])
    ).rows;
  } catch (thrown) {
    return { status: codeOf(thrown) === "ZD422" ? "invalid" : "unavailable" };
  }
  const ids: string[] = [];
  for (const row of rows) {
    const id: unknown = row["request_id"];
    if (typeof id !== "string" || !UUID.test(id)) return { status: "unavailable" };
    ids.push(id);
  }
  if (ids.length > limit || new Set(ids).size !== ids.length) return { status: "unavailable" };
  return { status: "ok", requestIds: Object.freeze(ids) };
}

/** The code of a database error; a getter or Proxy that throws has none. */
function codeOf(thrown: unknown): unknown {
  try {
    return thrown && typeof thrown === "object" && "code" in thrown ? thrown.code : undefined;
  } catch {
    return undefined;
  }
}
