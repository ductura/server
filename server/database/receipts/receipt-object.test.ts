// SRV-1502 (M3.2, B-9): the worker's read of the segment object a pending
// receipt names answers the port's shape, `not_found` for no row, or
// `unavailable` with a closed code; never the driver's text and never a row
// of another form. Every identifier below is invented.
import { describe, expect, it } from "vitest";

import { createPendingReceiptObjectSource } from "./receipt-object.ts";

const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const RECEIPT = "00000000-0000-4000-8000-0000000000a1";
// The five columns of app.worker_receipt_object, built by name: snake_case
// meets the code only in the adapter itself (docs/CODE_STYLE.md, rule 9).
const COLUMNS = [
  "institution_id",
  "evidence_package_id",
  "segment_hash",
  "payload_bytes",
  "storage_ref",
] as const;
const OBJECT = {
  institutionId: "00000000-0000-4000-8000-0000000000c1",
  evidencePackageId: "paket-izmisljeni-1",
  segmentHash: "ab".repeat(32),
  payloadBytes: 512,
  storageRef: "s3://izmisljeno.invalid/objekt",
};
const ROW: Record<string, unknown> = Object.fromEntries(
  COLUMNS.map((column, i) => [column, Object.values(OBJECT)[i]]),
);
const set = (column: (typeof COLUMNS)[number], value: unknown) => ({ ...ROW, [column]: value });
const without = (column: string) =>
  Object.fromEntries(Object.entries(ROW).filter(([name]) => name !== column));

function source(answer: () => unknown) {
  const calls: { text: string; values: unknown }[] = [];
  const db = {
    query: async (text: string, values: unknown) => {
      calls.push({ text, values });
      return answer();
    },
  };
  return { made: createPendingReceiptObjectSource(db as never), calls };
}

describe("createPendingReceiptObjectSource", () => {
  it("reads one row of app.worker_receipt_object with the two ids as parameters", async () => {
    const { made, calls } = source(() => ({ rows: [ROW] }));
    await expect(made.receiptObject(DOMAIN, RECEIPT)).resolves.toEqual({
      status: "ok",
      object: OBJECT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("app.worker_receipt_object($1::uuid, $2::uuid)");
    expect(calls[0]?.values).toEqual([DOMAIN, RECEIPT]);
  });

  it("answers not_found when the database has no row", async () => {
    const { made } = source(() => ({ rows: [] }));
    await expect(made.receiptObject(DOMAIN, RECEIPT)).resolves.toEqual({ status: "not_found" });
  });

  it.each([
    ["a domain that is no uuid", "domena", RECEIPT],
    ["a receipt that is no uuid", DOMAIN, "potvrda"],
    ["an uppercase receipt id", DOMAIN, RECEIPT.toUpperCase()],
    ["a missing receipt", DOMAIN, undefined],
  ])("refuses %s before the database", async (_, domain, receipt) => {
    const { made, calls } = source(() => ({ rows: [ROW] }));
    await expect(made.receiptObject(domain as never, receipt as never)).resolves.toEqual({
      status: "unavailable",
      reason: "request_invalid",
    });
    expect(calls).toHaveLength(0);
  });

  it("closes a driver error to database_error without its text", async () => {
    const { made } = source(() => {
      throw new Error("postgres://korisnik:tajna@izmisljeno.invalid/baza");
    });
    const read = await made.receiptObject(DOMAIN, RECEIPT);
    expect(read).toEqual({ status: "unavailable", reason: "database_error" });
    expect(JSON.stringify(read)).not.toContain("tajna");
  });

  it.each([
    ["no rows array", {}],
    ["two rows", { rows: [ROW, ROW] }],
    ["an extra column", { rows: [{ ...ROW, extra: 1 }] }],
    ["a missing column", { rows: [without("storage_ref")] }],
    ["an institution that is no uuid", { rows: [set("institution_id", "ustanova")] }],
    ["an empty package", { rows: [set("evidence_package_id", "")] }],
    ["a hash that is no string", { rows: [set("segment_hash", 1)] }],
    ["a byte count as text", { rows: [set("payload_bytes", "512")] }],
    ["a fractional byte count", { rows: [set("payload_bytes", 1.5)] }],
    ["an empty reference", { rows: [set("storage_ref", "")] }],
  ])("answers row_malformed for %s", async (_, answer) => {
    const { made } = source(() => answer);
    await expect(made.receiptObject(DOMAIN, RECEIPT)).resolves.toEqual({
      status: "unavailable",
      reason: "row_malformed",
    });
  });
});
