// Evidence and submission routes of the dev fake server.
import { createHash, randomUUID } from "node:crypto";

import {
  canonicalizeJcs,
  EVIDENCE_RECEIPT_SCHEMA_V2,
  EVIDENCE_SEGMENT_SCHEMA_V4,
  isEvidenceSegment,
  isReceiptClientTransactionId,
} from "../../../server/domain/index.ts";
import { FAKE_DOMAIN, minute, type SignedReceipt } from "./receipt-signer.ts";
import type { Handlers } from "./server.ts";
import {
  EMPTY_DOCUMENT,
  readerOf,
  recordOpening,
  type Account,
  type State,
  type Work,
} from "./state.ts";

const PROFILE = "lazni-profil";
const sha256 = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
/** An instant in the receipt form: UTC with exactly six fraction digits. */
const microsecond = (iso: string): string => `${new Date(iso).toISOString().slice(0, 23)}000Z`;
/** Segments per replay page (MAX_REPLAY_PAGE_SEGMENTS of the contract). */
export const REPLAY_PAGE = 256;
const UNSIGNED_SUBMISSION = {
  algorithm: "Ed25519",
  keyId: "lazni-kljuc-nepotpisano",
  keyVersion: "0",
  signatureEncoding: "raw",
  signatureBase64Url: "A".repeat(86),
} as const;

function parseSegment(bytes: Buffer) {
  try {
    const segment: unknown = JSON.parse(bytes.toString("utf8"));
    return isEvidenceSegment(segment) &&
      segment.evidenceSchema !== EVIDENCE_SEGMENT_SCHEMA_V4 &&
      bytes.equals(Buffer.from(canonicalizeJcs(segment)))
      ? segment
      : null;
  } catch {
    return null;
  }
}

const receiptId = (documentId: string, revision: number): string =>
  `lazna-potvrda-${documentId}-${revision}`;

function ownWork(state: State, account: Account | null, documentId: string): Work | undefined {
  return state.works.find((w) => w.documentId === documentId && w.studentId === account?.id);
}

/** The work state a 409 sends back so the author can reconcile. */
const workState = (work: Work) => ({
  currentRevision: work.revision,
  documentHash: sha256(Buffer.from(work.document, "base64")),
  headSegmentHash: work.segments.length === 0 ? null : sha256(work.segments.at(-1) ?? ""),
  lastSequenceTo: work.lastSequenceTo,
});

export const EVIDENCE_HANDLERS: Handlers = {
  "evidence.open.post": ({ state, account, body, now }) => {
    if (account === null) return { error: "unauthenticated" };
    const assignmentId = body.assignmentId.toLowerCase();
    const assignment = state.assignments.find((a) => a.id === assignmentId);
    const course = state.courses.find((c) => c.id === assignment?.courseId);
    if (assignment === undefined || !course?.studentIds.includes(account.id))
      return { error: "not_found" };
    let work = state.works.find(
      (w) => w.assignmentId === assignmentId && w.studentId === account.id,
    );
    if (work === undefined) {
      if (body.start !== true) return { error: "not_started" };
      // PRODUCT §5: the notice comes before the work.
      if (assignment.acknowledged.get(account.id)?.version !== assignment.version)
        return { error: "forbidden" };
      work = {
        documentId: randomUUID(),
        assignmentId,
        studentId: account.id,
        state: "in_progress",
        revision: 0,
        lastChangeAt: now.toISOString(),
        submittedAt: null,
        submissionReceipt: null,
        document: EMPTY_DOCUMENT,
        segments: [],
        lastSequenceTo: 0,
        transactions: new Map(),
        live: null,
      };
      state.works.push(work);
    }
    return {
      status: 200,
      body: {
        status: "opened",
        documentId: work.documentId,
        evidenceProfileId: PROFILE,
        ...workState(work),
        document: work.document,
        receiptKeys: [state.receiptSigner.key],
        submitted: work.state === "submitted",
      },
    };
  },
  "evidence.commit.post": ({ state, account, body, now, header }) => {
    const work = ownWork(state, account, body.documentId);
    if (work === undefined || account === null) return { error: "not_found" };
    if (work.state === "submitted") return { error: "not_accepting" };
    const done = work.transactions.get(body.clientTransactionId);
    if (done === undefined && body.baseRevision !== work.revision)
      return { error: "stale_base", body: { status: "stale_base", ...workState(work) } };
    const bytes = Buffer.from(body.segments[0] ?? "", "base64");
    const segmentHash = sha256(bytes);
    const documentHash = sha256(Buffer.from(body.document, "base64"));
    if (done !== undefined) {
      const { receipt, documentHash: savedDocumentHash } = done;
      if (
        receipt.payload.revision !== body.baseRevision + 1 ||
        receipt.payload.segmentHash !== segmentHash ||
        savedDocumentHash !== documentHash
      )
        return { error: "txid_reused" };
      return {
        status: 200,
        body: {
          status: "duplicate",
          duplicate: true,
          revision: receipt.payload.revision,
          receipt: { status: "signed", signedReceipt: receipt },
        },
      };
    }
    const segment = parseSegment(bytes);
    if (
      segment === null ||
      segment.documentId !== work.documentId ||
      segment.evidenceProfileId !== PROFILE ||
      !isReceiptClientTransactionId(body.clientTransactionId)
    )
      return { error: "invalid" };
    if (segment.finalDocumentHash !== documentHash) return { error: "document_mismatch" };
    const current = workState(work);
    if (segment.predecessorSegmentHash !== current.headSegmentHash)
      return { error: "chain_conflict", body: { status: "chain_conflict", ...current } };
    if (segment.sequenceFrom !== current.lastSequenceTo + 1)
      return { error: "not_continuous", body: { status: "not_continuous", ...current } };
    const revision = work.revision + 1;
    const payload: SignedReceipt["payload"] = {
      receiptSchema: EVIDENCE_RECEIPT_SCHEMA_V2,
      receiptId: receiptId(work.documentId, revision),
      evidencePackageId: `lazni-paket-${work.documentId}`,
      documentId: work.documentId,
      sessionId: segment.sessionId,
      segmentId: segment.segmentId,
      segmentHash,
      predecessorSegmentHash: segment.predecessorSegmentHash,
      previousReceiptId: revision > 1 ? receiptId(work.documentId, revision - 1) : null,
      evidenceSchema: segment.evidenceSchema,
      evidenceProfileId: segment.evidenceProfileId,
      sequenceFrom: segment.sequenceFrom,
      sequenceTo: segment.sequenceTo,
      eventCount: segment.events.length,
      payloadBytes: bytes.length,
      acceptedAt: minute(now),
      revision,
      clientTransactionId: body.clientTransactionId,
      evidenceDomainId: FAKE_DOMAIN,
      principalId: account.id,
    };
    const signedReceipt = state.receiptSigner.signReceipt(payload);
    work.segments.push(bytes.toString("utf8"));
    work.revision = revision;
    work.document = body.document;
    work.lastSequenceTo = segment.sequenceTo;
    work.lastChangeAt = now.toISOString();
    work.transactions.set(body.clientTransactionId, { receipt: signedReceipt, documentHash });

    if (header("ductus-protocol") === "2")
      return {
        status: 202,
        headers: { "retry-after": "2" },
        body: { status: "committed", revision, receipt: { status: "pending_signature" } },
      };
    return {
      status: 200,
      body: {
        status: "committed",
        revision,
        receipt: { status: "signed", signedReceipt },
      },
    };
  },
  "evidence.replay.post": ({ state, account, body, now }) => {
    const work = state.works.find((w) => w.documentId === body.documentId);
    const reader = readerOf(state, work, account);
    if (work === undefined || reader === null || account === null) return { error: "not_found" };
    const head =
      work.segments.length === 0
        ? null
        : { segmentHash: sha256(work.segments.at(-1) ?? ""), segmentCount: work.segments.length };
    if ("head" in body && body.head.segmentHash !== head?.segmentHash)
      return { error: "record_changed" };
    if (reader === "teacher")
      recordOpening(
        state,
        { documentId: work.documentId, readerId: account.id, role: "teacher", surface: "replay" },
        now,
      );
    return {
      status: 200,
      body: {
        replayFormat: "ductus-evidence-replay-v1",
        segmentCount: work.segments.length,
        head,
        from: body.from,
        next: body.from + REPLAY_PAGE < work.segments.length ? body.from + REPLAY_PAGE : null,
        startDocument:
          head === null ? null : Buffer.from(EMPTY_DOCUMENT, "base64").toString("utf8"),
        segments: work.segments.slice(body.from, body.from + REPLAY_PAGE),
        resumeDocuments: {},
      },
    };
  },
  "submission.submit.post": ({ state, account, body, now }) => {
    const work = ownWork(state, account, body.documentId);
    const assignment = state.assignments.find((a) => a.id === work?.assignmentId);
    if (work === undefined || assignment === undefined || account === null)
      return { error: "not_found" };
    if (work.submittedAt !== null)
      return {
        error: "already_requested",
        body: { status: "already_requested", revision: work.revision },
      };
    if (assignment.acknowledged.get(account.id)?.version !== assignment.version)
      return { error: "not_acknowledged" };
    if (now.toISOString() < assignment.content.opensAt) return { error: "not_open" };
    if (body.revision !== work.revision)
      return {
        error: "stale_revision",
        body: { status: "stale_revision", currentRevision: work.revision },
      };
    if (work.segments.length === 0)
      return { error: "blocked", body: { status: "blocked", reason: "no_evidence" } };
    const requestedAt = now.toISOString();
    work.state = "submitted";
    work.submittedAt = requestedAt;
    // After the submission the live view serves the submitted revision's bytes.
    work.live = {
      json: Buffer.from(work.document, "base64").toString("utf8"),
      token: randomUUID(),
    };
    const payload = {
      receiptSchema: "ductus-submission-receipt-v2",
      submissionId: randomUUID(),
      evidenceDomainId: FAKE_DOMAIN,
      principalId: account.id,
      assignmentId: assignment.id,
      assignmentVersion: assignment.version,
      documentId: work.documentId,
      evidencePackageId: "lazni-paket",
      revision: work.revision,
      artifactSha256: sha256(Buffer.from(work.document, "base64")),
      evidenceHeadSegmentHash: sha256(work.segments.at(-1) ?? ""),
      evidenceRecord: "continuous",
      requestedAt: microsecond(requestedAt),
      dueAt: microsecond(assignment.content.dueAt),
      afterDeadline: requestedAt > assignment.content.dueAt,
      signedAt: microsecond(requestedAt),
    } as const;
    const receipt = {
      payload,
      payloadDigestSha256: sha256(canonicalizeJcs(payload)),
      signature: UNSIGNED_SUBMISSION,
    };
    work.submissionReceipt = receipt;
    return { status: 200, body: { status: "submitted", receipt } };
  },
};
