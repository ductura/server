// Public interface of server/evidence; other areas import only this file.
export {
  createEvidenceService,
  type EvidenceCommitDependencies,
  type EvidenceCommitRequest,
  type EvidenceCommitRequestOutcome,
  type EvidenceService,
} from "./service.ts";
// The closed JSON object of an evidence body, a repeated key refused (M3.1, N-19).
export { parseClosedJsonObject } from "./ingest/index.ts";
export {
  isReplayDocumentId,
  MAX_REPLAY_PAGE_SEGMENTS,
  readReplayPage,
  REPLAY_FORMAT,
  type ReplayPage,
  type ReplayReadResult,
  type ReplayReaderDeps,
} from "./replay.ts";
// SRV-9A: the versions of a work, the same page for its owner and its teacher.
export { answerWorkVersions, type WorkVersionsAnswer } from "./versions/index.ts";
// The worker's signing of a pending receipt v2 (DAN-820, 820c); only the
// worker process builds it, over its own store and signer (D-71, D-102).
export { createSignPendingReceipt, type SignPendingReceiptDeps } from "./sign-pending-receipt.ts";
export type { PendingReceiptObjectCheck } from "./object-check.ts";
// The worker process composes these (SRV-1502, M3.2): the object check before
// a receipt is signed (DAN-301) and the sweep of every pending receipt.
export {
  createCheckPendingReceiptObject,
  type CheckPendingReceiptObjectDeps,
} from "./check-pending-receipt-object.ts";
export {
  createReconcilePendingReceipts,
  MAX_RECONCILE_BATCH,
  MAX_RECONCILE_DOMAINS,
  MAX_RECONCILE_GRACE_MS,
  type ReconcileDeps,
  type ReconcileSummary,
} from "./reconcile-pending-receipts.ts";
// What the worker does after one attempt and the loop of attempts (DAN-822-1, 822-2).
export {
  createSignPendingReceiptWithRetry,
  decideSignatureRetry,
  MAX_SIGNATURE_RETRY_ATTEMPTS,
  MAX_SIGNATURE_RETRY_DELAY_MS,
  signatureRetryDelayMs,
  type SignatureParkReason,
  type SignatureRetryDecision,
  type SignatureRetryDeps,
  type SignatureRetryPolicy,
  type SignatureRetryResult,
} from "./signature-retry.ts";
export type { PendingReceiptHold, SignPendingReceiptOutcome } from "./settle-attach.ts";
// The wire limits of the commit route, as the domain states them: http may not
// import domain (docs/server-map.md §2), so it reads them here.
export {
  DUCTUS_ASYNC_COMMIT_PROTOCOL,
  DUCTUS_PROTOCOL_VERSION,
  MAX_COMMIT_REQUEST_BYTES,
} from "../domain/index.ts";
// A student's submission (B-12 step 4b2, SRV-18): the request with the
// database clock, the reconstruction of that revision and the signed receipt v2.
export { type SubmissionDependencies, type SubmissionOutcome, submitWork } from "./submission.ts";

// The snapshot check of the live view (B-LIVE, server/http/live.ts), as the
// domain states it: the exact JCS bytes of a valid document, at most 2 MiB.
export {
  type DocumentSnapshotVerification,
  MAX_DOCUMENT_SNAPSHOT_BYTES,
  verifyDocumentSnapshot,
} from "../domain/index.ts";

// The comparison of two versions of a work (SRV-9E): both texts reconstructed
// from the record by the replayers the caller gives, the difference by blocks.
export {
  compareWorkVersions,
  type CompareDeps,
  type CompareEntry,
  type CompareResult,
} from "./compare/index.ts";
