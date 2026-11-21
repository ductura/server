// M3.6 (D-212): what a repeated commit of the same segment means. The same
// documentId and clientTransactionId with the same segment gets the first
// answer again, marked `duplicate: true`, and no second row is written. Every
// value here is invented.
import { describe, expect, it } from "vitest";

import type { EvidenceCommitRequestOutcome } from "../evidence/index.ts";
import { commitAnswer } from "./evidence-commit.ts";

const RECEIPT = { payload: { receiptId: "potvrda-izmisljena" } } as never;

/** A store that keeps one row per (document, transaction), as the acceptance RPC does. */
function store() {
  const rows = new Map<string, { revision: number; segment: string }>();
  let revision = 0;
  return {
    rows,
    ingest(documentId: string, txId: string, segment: string): EvidenceCommitRequestOutcome {
      const key = `${documentId}/${txId}`;
      const known = rows.get(key);
      if (known !== undefined) {
        if (known.segment !== segment) return { status: "txid_reused" };
        return { status: "duplicate", revision: known.revision, signedReceipt: RECEIPT };
      }
      revision += 1;
      rows.set(key, { revision, segment });
      return { status: "committed", revision, signedReceipt: RECEIPT };
    },
  };
}

describe("repeated ingest (M3.6, D-212)", () => {
  it("answers the same segment with the first revision and duplicate: true, and writes no new row", () => {
    const s = store();
    const first = commitAnswer(s.ingest("dokument-1", "tx-1", "segment-a"));
    const again = commitAnswer(s.ingest("dokument-1", "tx-1", "segment-a"));
    const third = commitAnswer(s.ingest("dokument-1", "tx-1", "segment-a"));
    expect(s.rows.size).toBe(1);
    expect(first.body).not.toHaveProperty("duplicate");
    expect(again).toEqual({
      status: 200,
      body: {
        status: "duplicate",
        duplicate: true,
        revision: 1,
        receipt: { status: "signed", signedReceipt: RECEIPT },
      },
    });
    expect(third).toEqual(again);
  });

  it("marks a pending duplicate too, and never a first commit", () => {
    expect(commitAnswer({ status: "duplicate_pending", revision: 3 }).body).toEqual({
      status: "duplicate",
      duplicate: true,
      revision: 3,
      receipt: { status: "pending_signature" },
    });
    expect(commitAnswer({ status: "committed_pending", revision: 3 }).body).not.toHaveProperty(
      "duplicate",
    );
  });

  it("refuses the same transaction with another segment instead of calling it a duplicate", () => {
    const s = store();
    s.ingest("dokument-1", "tx-1", "segment-a");
    const other = commitAnswer(s.ingest("dokument-1", "tx-1", "segment-b"));
    expect(other).toEqual({ status: 409, body: { status: "txid_reused" } });
    expect(s.rows.size).toBe(1);
  });
});
