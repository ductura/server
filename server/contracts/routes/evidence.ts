import { Type, type TSchema } from "@sinclair/typebox";

import { closed, defineRoute, type ErrorSpec, messageKeyOf } from "../schema/index.ts";

// Port of Ductus src/server/evidence/{open,commit}-route.ts and ingest-http.ts at
// d52a92c3 (docs/BACKEND.md 4.13). These two routes answer every refusal as
// {status: <code>}, not {error: <code>}: the browser client of that revision
// (src/client/evidence-ingest.ts) reads `status`, so the shape is kept.

const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });
const Count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
/** Standard base64 with padding; the route also asks that it encodes back to the same text. */
const Base64 = Type.String({
  pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
});
/** A whole UTC minute, the form of acceptedAt (D-24). */
const Minute = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:00\\.000Z$" });
/** A canonical lowercase UUID v4: evidence domain and principal ids in a receipt. */
const UuidV4 = Type.String({
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});
/** Non-blank text of at most `max` UTF-16 code units, as the receipt validators measure it. */
const Text = (max: number) => Type.String({ minLength: 1, maxLength: max, pattern: "\\S" });
/** isReceiptClientTransactionId: non-blank, at most 128, no control character (Cc). */
const TransactionId = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^(?=.*\\S)[^\\u0000-\\u001f\\u007f-\\u009f]+$",
});
const Positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const Algorithm = Type.Union([
  Type.Literal("Ed25519"),
  Type.Literal("ECDSA_P256_SHA256"),
  Type.Literal("RSA_PSS_SHA256"),
]);

/** Ductus MAX_COMMIT_REQUEST_BYTES: one segment and one snapshot in base64, plus the envelope. */
export const MAX_COMMIT_BODY_BYTES = 5_596_504;

/** A public receipt key of the work's evidence domain (EvidenceDomainKey). */
const ReceiptKey = closed({
  algorithm: Algorithm,
  keyId: Text(2048),
  keyVersion: Text(256),
  encoding: Type.Literal("spki-der"),
  keyBase64Url: Type.String({ pattern: "^[A-Za-z0-9_-]+$", maxLength: 4096 }),
  evidenceDomainId: UuidV4,
  purpose: Type.Literal("receipt"),
  validFrom: Minute,
  validTo: Type.Union([Minute, Type.Null()]),
  revokedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});

/** SignedEvidenceReceiptV2 (server/domain/forensics/evidence-receipt.ts). */
const SignedReceipt = closed({
  payload: closed({
    receiptSchema: Type.Literal("ductus-evidence-receipt-v2"),
    receiptId: Text(256),
    evidencePackageId: Text(256),
    documentId: Text(256),
    sessionId: Text(256),
    segmentId: Text(256),
    segmentHash: Sha256,
    predecessorSegmentHash: Type.Union([Sha256, Type.Null()]),
    previousReceiptId: Type.Union([Text(256), Type.Null()]),
    // isEvidenceSegmentSchema: a receipt names v2 or v3 only.
    evidenceSchema: Type.Union([
      Type.Literal("ductus-evidence-segment-v2"),
      Type.Literal("ductus-evidence-segment-v3"),
    ]),
    evidenceProfileId: Text(120),
    sequenceFrom: Positive,
    sequenceTo: Positive,
    eventCount: Positive,
    payloadBytes: Positive,
    acceptedAt: Minute,
    revision: Positive,
    clientTransactionId: TransactionId,
    evidenceDomainId: UuidV4,
    principalId: UuidV4,
  }),
  payloadDigestSha256: Sha256,
  // D-92: pure Ed25519, 64 raw bytes in unpadded base64url.
  signature: closed({
    algorithm: Type.Literal("Ed25519"),
    keyId: Text(2048),
    keyVersion: Text(256),
    signatureEncoding: Type.Literal("raw"),
    signatureBase64Url: Type.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
  }),
});

/** The work's state, sent with every 409 that asks the author to reconcile. */
const WorkState = {
  currentRevision: Count,
  documentHash: Sha256,
  headSegmentHash: Type.Union([Sha256, Type.Null()]),
  lastSequenceTo: Count,
};

function refusal(status: number, code: string, extra: Record<string, TSchema> = {}): ErrorSpec {
  return {
    status,
    code,
    key: messageKeyOf(code),
    body: closed({ status: Type.Literal(code), ...extra }),
  };
}

/** 503 with the closed stage that failed, and `retry-after: 5`. */
function unavailable(stages: readonly string[]): ErrorSpec {
  const stage = stages.map((s) => Type.Literal(s));
  return refusal(503, "unavailable", {
    stage: stage.length === 1 ? (stage[0] as TSchema) : Type.Union(stage),
  });
}

// readGuardedBody: method and Origin, protocol, media type, cookie, then the body under limits.
const GUARD_ERRORS = [
  refusal(403, "forbidden"),
  refusal(426, "upgrade_required"),
  refusal(415, "unsupported_media_type"),
  refusal(401, "unauthenticated"),
  refusal(413, "too_large"),
  refusal(408, "timeout"),
  refusal(400, "bad_request"),
  refusal(422, "invalid"),
  refusal(404, "not_found"),
  refusal(409, "not_accepting"),
] as const;

export const open = defineRoute({
  id: "evidence.open.post",
  method: "POST",
  path: "/api/v1/evidence/open",
  inventory: "app/api/evidence/open/route.ts",
  access: "student",
  summary:
    "The caller's own work for one assignment and its current revision; `start: true` makes it. " +
    "Same Origin, `ductus-protocol: 1`; anyone but the student gets 404.",
  request: {
    contentType: "application/json",
    maxBodyBytes: 1024,
    body: closed({
      assignmentId: Type.String({
        pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
      }),
      start: Type.Optional(Type.Boolean()),
    }),
  },
  responses: [
    {
      status: 200,
      description: "opened",
      body: closed({
        status: Type.Literal("opened"),
        documentId: Type.String({ minLength: 1 }),
        evidenceProfileId: Text(120),
        ...WorkState,
        // SRV-7F (docs/contracts/document-schema-v3.md §7): the version of the work, which is
        // the schemaVersion of its revision 0, and the server's SHA-256 of that revision, at
        // every revision. The server always sends both; they are optional only so that a
        // client of an earlier minor stays valid, and a client that lacks them treats the
        // work as unconfirmed (no v3).
        schemaVersion: Type.Optional(
          Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]),
        ),
        revisionZeroHash: Type.Optional(Sha256),
        /** Exact JCS bytes of the snapshot of currentRevision. */
        document: Base64,
        // The receipt keys of the work's evidence domain; the route sends [] when the domain
        // has none, and the client then treats the work as unavailable (openedWorkFrom).
        receiptKeys: Type.Array(ReceiptKey),
        submitted: Type.Boolean(),
      }),
    },
  ],
  errors: [...GUARD_ERRORS, refusal(409, "not_started"), unavailable(["context"])],
});

const Accepted = Type.Union([Type.Literal("committed"), Type.Literal("duplicate")]);
/**
 * M3.6 (D-212): a repeated commit (same documentId and clientTransactionId, same segment) is
 * answered with the first answer's revision and `duplicate: true`, and writes no new row. The
 * key is present only on a duplicate; `status: "duplicate"` stays for existing clients.
 */
const DuplicateMark = Type.Optional(Type.Literal(true));

export const commit = defineRoute({
  id: "evidence.commit.post",
  method: "POST",
  path: "/api/v1/evidence/commit",
  inventory: "app/api/evidence/commit/route.ts",
  access: "student_owner",
  summary:
    "One evidence segment and the document after it. Same Origin, `ductus-protocol: 1` (signed " +
    "now, 200) or `2` (signed by the worker: 202 pending_signature, then the same request again).",
  request: {
    contentType: "application/json",
    maxBodyBytes: MAX_COMMIT_BODY_BYTES,
    body: closed({
      documentId: Type.String(),
      clientTransactionId: TransactionId,
      baseRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }),
      segments: Type.Array(Base64, { minItems: 1, maxItems: 1 }),
      document: Base64,
    }),
  },
  responses: [
    {
      status: 200,
      description: "stored and signed",
      body: closed({
        status: Accepted,
        duplicate: DuplicateMark,
        revision: Count,
        receipt: closed({ status: Type.Literal("signed"), signedReceipt: SignedReceipt }),
      }),
    },
    {
      status: 202,
      description: "stored, receipt pending_signature (protocol 2 only); not an acknowledgement",
      headers: ["retry-after"],
      body: closed({
        status: Accepted,
        duplicate: DuplicateMark,
        revision: Count,
        receipt: closed({ status: Type.Literal("pending_signature") }),
      }),
    },
  ],
  errors: [
    ...GUARD_ERRORS,
    refusal(409, "stale_base", WorkState),
    refusal(409, "chain_conflict", WorkState),
    refusal(409, "not_continuous", WorkState),
    refusal(409, "txid_reused"),
    refusal(422, "document_mismatch"),
    unavailable(["context", "storage", "repository", "signing"]),
  ],
});

// Port of Ductus 078c780 src/server/evidence/submission-route.ts and submission.ts
// (B-12): the same guards and {status: <code>} answers as open and commit.

/** A canonical lowercase UUID of any version (submission-receipt.ts CANONICAL_UUID). */
const Uuid = Type.String({
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
});
/** isSubmissionInstant: the database clock with exactly six fraction digits, in UTC. */
const Microsecond = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$",
});

/** SignedSubmissionReceiptV2 (Ductus src/domain/forensics/submission-receipt-v2.ts). */
export const SignedSubmissionReceipt = closed({
  payload: closed({
    receiptSchema: Type.Literal("ductus-submission-receipt-v2"),
    submissionId: Uuid,
    evidenceDomainId: UuidV4,
    principalId: UuidV4,
    assignmentId: Uuid,
    assignmentVersion: Positive,
    // isDocumentId of the receipt: 1 to 256 UTF-16 units, trimmed, no control
    // character and no lone surrogate.
    documentId: Type.String({
      minLength: 1,
      maxLength: 256,
      pattern:
        "^(?!\\s)(?:[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[^\\u0000-\\u001f\\u007f-\\u009f\\uD800-\\uDFFF])+(?<!\\s)$",
    }),
    evidencePackageId: Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,127}$" }),
    revision: Positive,
    artifactSha256: Sha256,
    evidenceHeadSegmentHash: Sha256,
    evidenceRecord: Type.Union([Type.Literal("continuous"), Type.Literal("with_gaps")]),
    requestedAt: Microsecond,
    dueAt: Microsecond,
    afterDeadline: Type.Boolean(),
    signedAt: Microsecond,
  }),
  payloadDigestSha256: Sha256,
  signature: closed({
    algorithm: Type.Literal("Ed25519"),
    keyId: Text(2048),
    keyVersion: Text(256),
    signatureEncoding: Type.Literal("raw"),
    signatureBase64Url: Type.String({ pattern: "^[A-Za-z0-9_-]{86}$" }),
  }),
});

export const submit = defineRoute({
  id: "submission.submit.post",
  method: "POST",
  path: "/api/v1/submission",
  inventory: "app/api/submission/route.ts",
  access: "student_owner",
  summary:
    "The student submits the revision they saw: exactly {documentId, revision}, at most 1 KiB; " +
    "no time, text of the work or hash comes from the client. Same Origin, `ductus-protocol: 1`. The " +
    "database clock at the click is the time; the revision is reconstructed and, only when it " +
    "matches, the submission is recorded and its signed receipt returned. The first click binds: " +
    "another revision later is 409 already_requested. Another student's or a missing work is " +
    "404. 503 carries the stage and `retry-after: 5`.",
  request: {
    contentType: "application/json",
    maxBodyBytes: 1024,
    body: closed({
      documentId: Type.String({ minLength: 1 }),
      // Revision 0 is a work with nothing saved: 409 blocked no_evidence while the
      // work has none either, else 409 stale_revision (app.request_submission).
      revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    }),
  },
  responses: [
    {
      status: 200,
      description: "submitted",
      body: closed({ status: Type.Literal("submitted"), receipt: SignedSubmissionReceipt }),
    },
  ],
  errors: [
    refusal(403, "forbidden"),
    refusal(426, "upgrade_required"),
    refusal(415, "unsupported_media_type"),
    refusal(401, "unauthenticated"),
    refusal(413, "too_large"),
    refusal(408, "timeout"),
    refusal(400, "bad_request"),
    refusal(422, "invalid"),
    refusal(404, "not_found"),
    refusal(409, "blocked", {
      reason: Type.Union(
        ["segment_unsigned", "record_mismatch", "record_discontinuous", "no_evidence"].map((r) =>
          Type.Literal(r),
        ),
      ),
    }),
    refusal(409, "stale_revision", { currentRevision: Count }),
    refusal(409, "already_requested", { revision: Positive }),
    refusal(409, "not_acknowledged"),
    refusal(409, "not_open"),
    unavailable([
      "context",
      "request",
      "record",
      "chain",
      "storage",
      "verification",
      "submission",
      "signing",
    ]),
  ],
});

// Port of Ductus src/server/evidence/replay-route.ts and
// src/application/evidence/replay-reader.ts at 333e163 (DAN-344, route R3;
// DAN-818): one page of the replay of a work, the exact stored bytes of its
// segments, the same JCS text for the owner and the teacher of its assignment
// (PRODUCT §5 rule 5). The server does not run the steps; the reader does
// (B-12 on the server is DAN-819). Same guards and {status: <code>} answers
// as open and commit (contract c.6912301853 on Ductus#1836).

/** Ductus MAX_REPLAY_PAGE_SEGMENTS: segments per page. */
export const MAX_REPLAY_PAGE_SEGMENTS = 256;

/** EvidenceChainHeadV2: the last listed segment and how many there are. */
const ReplayHead = closed({ segmentHash: Sha256, segmentCount: Positive });

export const replay = defineRoute({
  id: "evidence.replay.post",
  method: "POST",
  path: "/api/v1/evidence/replay",
  inventory: "app/api/evidence/replay/route.ts",
  access: "owner_or_course_teacher",
  summary:
    "One page of the replay of a work: the verified stored bytes of its segments in chain order, " +
    "as the JCS text of the page. The body is exactly {documentId, from: 0} for the first page " +
    "and {documentId, from, head} for every later one, with the head the first page reported; " +
    "any other shape is 422. Same Origin, `ductus-protocol: 1`. A work the caller may not read, " +
    "an id that cannot exist or a page past the end is 404. A record that no longer ends at " +
    "`head` is 409 record_changed (read again from the first page); a record that does not " +
    "verify is 503, never a partial page.",
  request: {
    contentType: "application/json",
    maxBodyBytes: 1024,
    // The first page has no head; every later page has the head the first one reported.
    body: Type.Union([
      closed({ documentId: Type.String(), from: Type.Literal(0) }),
      closed({ documentId: Type.String(), from: Positive, head: ReplayHead }),
    ]),
  },
  responses: [
    {
      status: 200,
      description: "one page, its JCS text unchanged",
      body: closed({
        replayFormat: Type.Literal("ductus-evidence-replay-v1"),
        segmentCount: Count,
        head: Type.Union([ReplayHead, Type.Null()]),
        from: Count,
        next: Type.Union([Positive, Type.Null()]),
        /** Only on the first page: the canonical document before the first change. */
        startDocument: Type.Union([Type.String(), Type.Null()]),
        /** Exact canonical segment texts, at least one unless the record is empty. */
        segments: Type.Array(Type.String(), { maxItems: MAX_REPLAY_PAGE_SEGMENTS }),
        /** Per chain break on this page: the checkpoint text the replay resumes from. */
        resumeDocuments: Type.Record(Type.String({ pattern: "^[0-9a-f]{64}$" }), Type.String(), {
          additionalProperties: false,
        }),
      }),
    },
  ],
  errors: [
    refusal(403, "forbidden"),
    refusal(426, "upgrade_required"),
    refusal(415, "unsupported_media_type"),
    refusal(401, "unauthenticated"),
    refusal(413, "too_large"),
    refusal(408, "timeout"),
    refusal(400, "bad_request"),
    refusal(422, "invalid"),
    refusal(404, "not_found"),
    refusal(409, "record_changed"),
    unavailable(["context", "storage"]),
  ],
});

export const evidenceRoutes = [open, commit, submit, replay] as const;
