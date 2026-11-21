// POST /api/v1/evidence/commit (DAN-815, VS-1 narrow cut, step 3, part b2).
// Port of Ductus src/server/evidence/commit-route.ts at d52a92c3 (B-8 step
// 5, BACKEND 4.13 t. 1, 2, 4 and 8). The headers are checked before the body
// is read, and the live session before it too (the largest body of all,
// F-098). The envelope is a closed set of keys, the bytes travel as base64
// that must encode back to the same text, and every outcome goes on the wire
// through one closed mapping. Method is the router's and Origin pipeline
// step 7 (docs/vs1-rute.md).
import { ROUTES } from "../contracts/index.ts";
import type { ActorReader } from "../database/index.ts";
import {
  DUCTUS_ASYNC_COMMIT_PROTOCOL,
  DUCTUS_PROTOCOL_VERSION,
  type EvidenceCommitRequest,
  type EvidenceCommitRequestOutcome,
  type EvidenceService,
  MAX_COMMIT_REQUEST_BYTES,
} from "../evidence/index.ts";

import { reportServerError } from "./error-catalog.ts";
import {
  type EvidenceAnswer,
  parseClosedObject,
  readEvidenceBody,
  sendEvidenceAnswer,
} from "./evidence-request.ts";
import { requestIdOf } from "./request-id.ts";
import { type Route, sendJson } from "./router.ts";

const COMMIT_ID = "evidence.commit.post";
const found = ROUTES.find((route) => route.id === COMMIT_ID);
if (found === undefined) throw new Error(`no contract ${COMMIT_ID}`);
const contract = found;

export const COMMIT_TIMEOUT_MS = 60_000;
/** Seconds until a client asks again for a receipt the worker has not signed yet. */
const PENDING_RETRY_AFTER = "2";
const KEYS = ["documentId", "clientTransactionId", "baseRevision", "segments", "document"];
// Linear on purpose: the grouped pattern of Ductus backtracks in V8 and throws
// on a string of some 4.5 M characters, which the body limit still admits (a
// 500 instead of a closed answer). The encode-back check below still fixes
// the padding and the trailing bits.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type EvidenceCommitOptions = {
  readonly actorReader: ActorReader;
  readonly evidence: EvidenceService;
  /** Protocol 2, signed by the worker; only `true` turns it on (DUCTUS_EVIDENCE_ASYNC_SIGNING, DAN-821-3). */
  readonly asyncSigning?: boolean;
  /** For tests: a shorter body deadline. */
  readonly timeoutMs?: number;
};

/** Standard base64 with padding that encodes back to the same text, into a buffer of its own. */
function strictBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !BASE64.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? new Uint8Array(decoded) : null;
}

/** The envelope of 4.13 t. 2, or null for anything else (`gap` included). */
export function parseCommitEnvelope(bytes: Uint8Array): EvidenceCommitRequest | null {
  const body = parseClosedObject(bytes, KEYS);
  if (body === null) return null;
  const { documentId, clientTransactionId, baseRevision, segments, document } = body;
  if (
    typeof documentId !== "string" ||
    typeof clientTransactionId !== "string" ||
    typeof baseRevision !== "number" ||
    !Array.isArray(segments) ||
    segments.length !== 1
  ) {
    return null;
  }
  const segment = strictBase64(segments[0]);
  const snapshot = strictBase64(document);
  if (segment === null || snapshot === null) return null;
  return { documentId, clientTransactionId, baseRevision, segment, document: snapshot };
}

const refusal = (status: number, code: string): EvidenceAnswer => ({
  status,
  body: { status: code },
});

/** The closed mapping of 4.13 t. 4: a 200 or 202 body, or a refusal. */
export function commitAnswer(
  outcome: EvidenceCommitRequestOutcome,
): { readonly status: 200 | 202; readonly body: unknown } | EvidenceAnswer {
  switch (outcome.status) {
    case "committed":
    case "duplicate":
      return {
        status: 200,
        body: {
          status: outcome.status,
          ...(outcome.status === "duplicate" ? { duplicate: true } : {}),
          revision: outcome.revision,
          receipt: { status: "signed", signedReceipt: outcome.signedReceipt },
        },
      };
    case "committed_pending":
    case "duplicate_pending":
      return {
        status: 202,
        body: {
          status: outcome.status === "committed_pending" ? "committed" : "duplicate",
          ...(outcome.status === "duplicate_pending" ? { duplicate: true } : {}),
          revision: outcome.revision,
          receipt: { status: "pending_signature" },
        },
      };
    case "stale_base":
    case "chain_conflict":
    case "not_continuous":
      return { status: 409, body: { status: outcome.status, ...outcome.state } };
    case "txid_reused":
    case "not_accepting":
      return refusal(409, outcome.status);
    case "invalid":
    case "document_mismatch":
      return refusal(422, outcome.status);
    case "too_large":
      return refusal(413, "too_large");
    case "not_found":
      return refusal(404, "not_found");
    case "unauthenticated":
      return refusal(401, "unauthenticated");
    case "unavailable":
      return unavailable(outcome.stage);
    default:
      return unavailable("repository");
  }
}

function unavailable(stage: string): EvidenceAnswer {
  return { status: 503, body: { status: "unavailable", stage }, headers: { "retry-after": "5" } };
}

/** The commit route over the actor reader and the evidence service. */
export function createEvidenceCommitRoute(options: EvidenceCommitOptions): Route {
  const timeoutMs = options.timeoutMs ?? COMMIT_TIMEOUT_MS;
  const protocols =
    options.asyncSigning === true
      ? [DUCTUS_PROTOCOL_VERSION, DUCTUS_ASYNC_COMMIT_PROTOCOL]
      : [DUCTUS_PROTOCOL_VERSION];
  return {
    contract,
    async handle(request, response) {
      const refuse = (a: EvidenceAnswer) => sendEvidenceAnswer(response, contract, a);
      const read = await readEvidenceBody(request, options.actorReader, {
        protocols,
        maxBytes: MAX_COMMIT_REQUEST_BYTES,
        timeoutMs,
        live: true,
      });
      if (!read.ok) return refuse(read.answer);
      const envelope = parseCommitEnvelope(read.bytes);
      if (envelope === null) return refuse(refusal(422, "invalid"));
      const signing =
        request.headers["ductus-protocol"] === DUCTUS_ASYNC_COMMIT_PROTOCOL ? "deferred" : "inline";
      let outcome: EvidenceCommitRequestOutcome;
      try {
        outcome = await options.evidence.commit(read.token, envelope, signing);
      } catch (error) {
        // Only the class of the error: never its message, the request or a token.
        reportServerError("route", error, requestIdOf(response), contract.id);
        outcome = { status: "unavailable", stage: "repository", code: "prepare_failed" };
      }
      const answer = commitAnswer(outcome);
      if (answer.status === 200) return sendJson(response, 200, answer.body);
      if (answer.status === 202) {
        response.setHeader("retry-after", PENDING_RETRY_AFTER);
        return sendJson(response, 202, answer.body);
      }
      refuse(answer as EvidenceAnswer);
    },
  };
}
