// The worker's read of the segment object a pending receipt names (SRV-1502,
// M3.2, B-9; DAN-301). The function app.worker_receipt_object and the port
// (server/application/ports/pending-receipt-object.ts) already exist; this is
// the adapter between them, over the worker's own login. The shapes are
// written out here, not imported: database imports no copied folder
// (docs/server-map.md §2), and they match the port field for field.
import type { Pool } from "pg";

import { isEvidenceDomainId } from "../../domain/index.ts";

/** A uuid as the database writes it: lowercase, any version. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** The rows of an answer, each a plain record of exactly `columns`; null for anything else. */
function exactRows(answer: unknown, columns: readonly string[]): Record<string, unknown>[] | null {
  const list: unknown = (answer as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(list)) return null;
  for (const row of list) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
    const keys = Reflect.ownKeys(row);
    if (keys.length !== columns.length || !columns.every((c) => Object.hasOwn(row, c))) return null;
  }
  return list as Record<string, unknown>[];
}

async function run(db: Pick<Pool, "query">, text: string, values: unknown[]): Promise<unknown> {
  try {
    return await db.query(text, values);
  } catch {
    // The driver's message can carry the connection string; only the code leaves.
    return undefined;
  }
}

/** The row of `app.worker_receipt_object`, as the object check reads it. */
export type PendingReceiptObject = {
  institutionId: string;
  evidencePackageId: string;
  segmentHash: string;
  payloadBytes: number;
  storageRef: string;
};

/**
 * `not_found` is every case the database answers with no row: a signed
 * receipt, a receipt of another domain or schema, or an unknown id.
 * `unavailable` carries a closed code, never the driver's text.
 */
export type PendingReceiptObjectRead =
  | { status: "ok"; object: PendingReceiptObject }
  | { status: "not_found" }
  | { status: "unavailable"; reason: "request_invalid" | "row_malformed" | "database_error" };

export type PendingReceiptObjectSource = {
  receiptObject(evidenceDomainId: string, receiptId: string): Promise<PendingReceiptObjectRead>;
};

const OBJECT_SQL = `SELECT institution_id::text AS institution_id, evidence_package_id,
       segment_hash, payload_bytes, storage_ref
  FROM app.worker_receipt_object($1::uuid, $2::uuid)`;
const COLUMNS = [
  "institution_id",
  "evidence_package_id",
  "segment_hash",
  "payload_bytes",
  "storage_ref",
] as const;

const fail = (
  reason: "request_invalid" | "row_malformed" | "database_error",
): PendingReceiptObjectRead => ({ status: "unavailable", reason });

const text = (value: unknown): value is string => typeof value === "string" && value !== "";

async function receiptObject(
  db: Pick<Pool, "query">,
  domain: unknown,
  receipt: unknown,
): Promise<PendingReceiptObjectRead> {
  if (!isEvidenceDomainId(domain) || !isUuid(receipt)) return fail("request_invalid");
  const answer = await run(db, OBJECT_SQL, [domain, receipt]);
  if (answer === undefined) return fail("database_error");
  const list = exactRows(answer, COLUMNS);
  if (list === null || list.length > 1) return fail("row_malformed");
  const row = list[0];
  if (row === undefined) return { status: "not_found" };
  const {
    institution_id: institutionId,
    evidence_package_id: evidencePackageId,
    segment_hash: segmentHash,
    payload_bytes: payloadBytes,
    storage_ref: storageRef,
  } = row;
  // Only the form; the object check compares every field with the payload.
  if (
    !isUuid(institutionId) ||
    !text(evidencePackageId) ||
    !text(segmentHash) ||
    typeof payloadBytes !== "number" ||
    !Number.isSafeInteger(payloadBytes) ||
    !text(storageRef)
  ) {
    return fail("row_malformed");
  }
  return {
    status: "ok",
    object: { institutionId, evidencePackageId, segmentHash, payloadBytes, storageRef },
  };
}

/**
 * The object read over a pool of the worker's own login (a member of
 * ductus_worker only); the web process never builds it (D-71, D-102).
 */
export function createPendingReceiptObjectSource(
  db: Pick<Pool, "query">,
): PendingReceiptObjectSource {
  return { receiptObject: (domain, receipt) => receiptObject(db, domain, receipt) };
}
