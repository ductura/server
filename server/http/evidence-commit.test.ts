// Ductus src/server/evidence/commit-route.test.ts, the cases that Ductura's
// integration test (evidence-commit.integration.test.ts, by vectors) did not
// hold one by one: the whole closed mapping of 4.13 t. 4 and the request
// limit derived from D-96. Every value here is invented.
import { describe, expect, it } from "vitest";

import {
  MAX_COMMIT_REQUEST_BYTES,
  MAX_DOCUMENT_SNAPSHOT_BYTES,
  MAX_EVIDENCE_SEGMENT_BYTES,
} from "../domain/index.ts";
import type { EvidenceCommitRequestOutcome } from "../evidence/index.ts";

import { commitAnswer } from "./evidence-commit.ts";

const RECEIPT = {
  payload: { receiptId: "potvrda-izmisljena" },
  payloadDigestSha256: "d",
  signature: { keyId: "kljuc-izmisljeni" },
} as never;
const STATE = {
  currentRevision: 4,
  documentHash: "e".repeat(64),
  headSegmentHash: "f".repeat(64),
  lastSequenceTo: 8,
};
const unavailable = (stage: string) => ({
  status: 503,
  body: { status: "unavailable", stage },
  headers: { "retry-after": "5" },
});
const refusal = (status: number, code: string) => ({ status, body: { status: code } });

describe("commitAnswer: the closed mapping of 4.13 t. 4", () => {
  it.each<[EvidenceCommitRequestOutcome, unknown]>([
    [
      { status: "committed", revision: 5, signedReceipt: RECEIPT },
      {
        status: 200,
        body: {
          status: "committed",
          revision: 5,
          receipt: { status: "signed", signedReceipt: RECEIPT },
        },
      },
    ],
    [
      { status: "duplicate", revision: 5, signedReceipt: RECEIPT },
      {
        status: 200,
        body: {
          status: "duplicate",
          duplicate: true,
          revision: 5,
          receipt: { status: "signed", signedReceipt: RECEIPT },
        },
      },
    ],
    [
      { status: "committed_pending", revision: 5 },
      {
        status: 202,
        body: { status: "committed", revision: 5, receipt: { status: "pending_signature" } },
      },
    ],
    [
      { status: "duplicate_pending", revision: 5 },
      {
        status: 202,
        body: {
          status: "duplicate",
          duplicate: true,
          revision: 5,
          receipt: { status: "pending_signature" },
        },
      },
    ],
    [
      { status: "stale_base", state: STATE },
      { status: 409, body: { status: "stale_base", ...STATE } },
    ],
    [
      { status: "chain_conflict", state: STATE },
      { status: 409, body: { status: "chain_conflict", ...STATE } },
    ],
    [
      { status: "not_continuous", state: STATE },
      { status: 409, body: { status: "not_continuous", ...STATE } },
    ],
    [{ status: "txid_reused" }, refusal(409, "txid_reused")],
    [{ status: "not_accepting" }, refusal(409, "not_accepting")],
    [{ status: "invalid" }, refusal(422, "invalid")],
    [{ status: "document_mismatch" }, refusal(422, "document_mismatch")],
    [{ status: "too_large" }, refusal(413, "too_large")],
    [{ status: "not_found" }, refusal(404, "not_found")],
    [{ status: "unauthenticated" }, refusal(401, "unauthenticated")],
    [
      { status: "unavailable", stage: "signing", code: "signing_failed" } as never,
      unavailable("signing"),
    ],
    [{ status: "unavailable", stage: "storage", code: "storage_conflict" }, unavailable("storage")],
    [
      { status: "unavailable", stage: "repository", code: "commit_failed" } as never,
      unavailable("repository"),
    ],
    [{ status: "unavailable", stage: "context", code: "context_failed" }, unavailable("context")],
    // An outcome outside the closed set is never a success.
    [{ status: "pending_signature" } as never, unavailable("repository")],
  ])("maps %j", (outcome, answer) => {
    expect(commitAnswer(outcome)).toStrictEqual(answer);
  });
});

describe("the request limit (D-96)", () => {
  it("is the segment and the snapshot limits in base64, and 4 KiB of envelope", () => {
    const base64 = (n: number) => 4 * Math.ceil(n / 3);
    expect(MAX_COMMIT_REQUEST_BYTES).toBe(
      base64(MAX_EVIDENCE_SEGMENT_BYTES) + base64(MAX_DOCUMENT_SNAPSHOT_BYTES) + 4096,
    );
  });
});
