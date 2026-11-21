// POST /api/v1/student/assistant/requests (student.assistant-request.post) and
// GET /api/v1/student/assistant/conversations/{conversationId}
// (student.assistant-conversation.get), SRV-1204 (Val 12 / M9.0-S2,
// Ductus#2052): step 4 of Ductus docs/contracts/ai-request-v1.md, the AI
// proxy as the real caller of the assistant RPCs and of the provider port.
//
// Flow of one request: the parser of SRV-1201 (body and Idempotency-Key, no
// row on a refusal), then begin_request, then the instructions in code for the
// purpose of the assignment version in force, then mark_sent (commit), then
// the port only for a request in state sent (R2), then complete_request,
// fail_request or mark_outcome_unknown. The key is the canonical UUID of the
// header, per account from the session (R3): the database keys it on the
// actor. The provider and the model come from the one versioned configuration
// handed in, never from the request, and nothing is retried with another
// provider (P7). Every answer is a code of the closed set "Ishodi".
//
// The port input carries only the five fields of buildPortInput: no student,
// work, institution, assignment, conversation or request id, and no other text
// of the work (G8, G9, S3). The production composition has no adapter and no
// configuration, so the route answers ai_disabled before the database (P1,
// Q-10); the synthetic adapter exists only in the test composition.
import { Value } from "@sinclair/typebox/value";

import { ROUTES } from "../../contracts/index.ts";
import {
  createAssistantRequests,
  createStudentNoticeReader,
  STUDENT_NOTICE_NOT_FOUND,
  STUDENT_NOTICE_UNAUTHENTICATED,
  type AssistantRefusal,
  type AssistantRejectReason,
  type AssistantRequests,
  type AssistantRequestState,
  type WithActor,
} from "../../database/index.ts";
import {
  AI_POLICIES,
  buildPortInput,
  checkResponse,
  composeInstructions,
  parseAssistantRequest,
  PURPOSE_CATALOG_VERSIONS,
  type AiPolicy,
  type AssignmentRules,
  type AssistantPort,
  type AssistantPortOutcome,
  type AssistantRequest,
  type PurposeCatalogVersion,
} from "../../external/assistant/index.ts";
import { liveSessionTokenFromCookie } from "../../session/index.ts";

import {
  readBodyWithLimit,
  refuse,
  reportServerError,
  requestIdOf,
  sendJson,
  sendProblem,
  type Route,
} from "../index.ts";

import type { AssistantProviderConfig } from "./config.ts";

export {
  CONFIG_VERSION_PATTERN,
  parseAssistantProviderConfig,
  type AssistantProviderConfig,
} from "./config.ts";

const BODY_TIMEOUT_MS = 5_000;
/** The longest answer the port may give, in code points; the server's choice. */
export const MAX_RESPONSE_CODE_POINTS = 8_000;
/** How long the route waits for the port before the outcome is unknown. */
export const PORT_TIMEOUT_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The rules of the assignment version in force, read for the student. */
export type AssignmentRulesReader = (
  token: string,
  assignmentId: string,
) => Promise<
  | { readonly status: "ok"; readonly rules: AssignmentRules }
  | { readonly status: "unauthenticated" | "not_found" | "unavailable" }
>;

/** The provider side: absent in production (ai_disabled). */
export type AssistantProvider = {
  readonly config: AssistantProviderConfig;
  readonly port: AssistantPort;
};

export type AssistantRouteDeps = {
  readonly requests: AssistantRequests;
  readonly rules: AssignmentRulesReader;
  readonly provider: AssistantProvider | null;
  readonly portTimeoutMs?: number;
};

type Outcome =
  | "idempotency_conflict"
  | "forbidden"
  | "ai_disabled"
  | "purpose_not_allowed"
  | "budget_exceeded"
  | "in_progress"
  | "request_outcome_unknown"
  | "provider_failed";

type Answer =
  | {
      readonly outcome: "completed";
      readonly requestId: string;
      readonly conversationId: string;
      readonly response: { readonly id: string; readonly text: string };
    }
  | {
      readonly outcome: Outcome;
      readonly requestId: string | null;
      readonly conversationId: string | null;
    };

/** An HTTP failure that is not an outcome: 401 or 503. */
type Failure = { readonly failure: "unauthorized" | "unavailable" | "invalid_request" };

function contractOf(id: string) {
  const contract = ROUTES.find((route) => route.id === id);
  const body = contract?.responses.find((r) => r.status === 200)?.body;
  if (contract === undefined || body === undefined) throw new Error(`no contract ${id}`);
  return { contract, body };
}

/** A refusal of an RPC that is not an outcome of its own. */
function failureOf(refusal: AssistantRefusal): Failure {
  if (refusal.status === "unauthenticated") return { failure: "unauthorized" };
  if (refusal.status === "invalid") return { failure: "invalid_request" };
  return { failure: "unavailable" };
}

/** The outcome of a request found in a state the route does not drive further. */
function settledOutcome(state: AssistantRequestState, reason: AssistantRejectReason | null) {
  if (state === "rejected") return reason === null ? null : reason;
  if (state === "sent") return "in_progress";
  if (state === "outcome_unknown" || state === "settled") return "request_outcome_unknown";
  if (state === "provider_failed") return "provider_failed";
  return null;
}

/** The port outcome, or a timeout once the route has waited long enough. */
async function callPort(
  port: AssistantPort,
  input: Parameters<AssistantPort["complete"]>[0],
  timeoutMs: number,
): Promise<AssistantPortOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AssistantPortOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([
      // A port that throws, before or after returning its promise, is an abort.
      Promise.resolve()
        .then(() => port.complete(input))
        .catch((): AssistantPortOutcome => ({ kind: "aborted" })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const isCatalogVersion = (value: number): value is PurposeCatalogVersion =>
  (PURPOSE_CATALOG_VERSIONS as readonly number[]).includes(value);

/**
 * One request after the parser admitted it: the RPCs and the port, in the
 * order of the contract. Never throws for an expected refusal.
 */
async function run(
  deps: AssistantRouteDeps,
  provider: AssistantProvider,
  token: string,
  request: AssistantRequest,
): Promise<Answer | Failure> {
  const { requests } = deps;
  const { config, port } = provider;
  const begun = await requests.begin(token, {
    idempotencyKey: request.idempotencyKey,
    assignmentId: request.assignmentId,
    conversationId: request.conversationId,
    purposeCatalogVersion: request.purposeCatalogVersion,
    purposeKey: request.purposeKey,
    paragraph: request.paragraph,
    providerId: config.provider.providerId,
    modelId: config.provider.modelId,
    configVersion: config.configVersion,
  });
  if (begun.status !== "ok") {
    if (begun.status === "forbidden" || begun.status === "idempotency_conflict") {
      return { outcome: begun.status, requestId: null, conversationId: null };
    }
    return failureOf(begun);
  }
  const { requestId } = begun;
  const ids = { requestId, conversationId: begun.conversationId };
  if (begun.state === "completed") {
    if (begun.response === null || begun.conversationId === null) return { failure: "unavailable" };
    return {
      outcome: "completed",
      requestId,
      conversationId: begun.conversationId,
      response: begun.response,
    };
  }
  const known = settledOutcome(begun.state, begun.reason);
  if (known !== null) return { outcome: known, ...ids };
  // A replayed reservation belongs to an earlier call: its provider, model and
  // configuration are on the row, and the configuration here may have changed
  // since. It is never sent from here; the earlier call finishes it or the
  // sweep releases it, and a new attempt takes a new key (R5).
  if (begun.state === "reserved" && begun.replayed) return { outcome: "in_progress", ...ids };
  if (begun.state !== "reserved" || begun.conversationId === null) {
    return { failure: "unavailable" };
  }
  const conversationId = begun.conversationId;

  // The instructions come from code, for the purpose of the version in force.
  // Read before mark_sent: without them nothing is sent, and a transient
  // failure leaves the reservation to the sweep (or to a retry of the key).
  const rules = await deps.rules(token, request.assignmentId);
  if (rules.status === "unauthenticated") return { failure: "unauthorized" };
  if (rules.status === "unavailable") return { failure: "unavailable" };
  const composed =
    rules.status === "ok" && isCatalogVersion(request.purposeCatalogVersion)
      ? composeInstructions(rules.rules, { key: request.purposeKey }, request.purposeCatalogVersion)
      : null;

  const sent = await requests.markSent(token, requestId);
  if (sent.status !== "ok") {
    if (sent.status === "forbidden") return { outcome: "forbidden", ...ids };
    // Another call with the same key moved it first: it is that call's to finish.
    if (sent.status === "conflict") return { outcome: "in_progress", ...ids };
    return failureOf(sent);
  }
  if (sent.state === "rejected") {
    return { outcome: sent.reason === null ? "forbidden" : sent.reason, ...ids };
  }
  if (composed === null || !composed.ok) {
    // The database let it through where the rules in code did not: never call
    // the provider without the server's instructions.
    await requests.markOutcomeUnknown(token, requestId);
    return { outcome: "request_outcome_unknown", ...ids };
  }

  // Only now, after the commit of sent, the one call of the one provider (R2, P7).
  const outcome = await callPort(
    port,
    buildPortInput({
      instructions: composed.instructions,
      paragraph: request.paragraph,
      purposeKey: request.purposeKey,
      modelId: config.provider.modelId,
      maxResponseCodePoints: MAX_RESPONSE_CODE_POINTS,
    }),
    deps.portTimeoutMs ?? PORT_TIMEOUT_MS,
  );

  if (outcome.kind === "success") {
    const checked = checkResponse(outcome.text);
    if (!checked.ok || checked.text.trim() === "") {
      return finishFailed(requests, token, requestId, outcome.actualMicro, ids);
    }
    const done = await requests.complete(token, requestId, checked.text, outcome.actualMicro);
    if (done.status === "ok" && done.accepted && done.responseId !== null) {
      return {
        outcome: "completed",
        requestId,
        conversationId,
        response: { id: done.responseId, text: checked.text },
      };
    }
    if (done.status === "ok") return { outcome: "request_outcome_unknown", ...ids };
    if (done.status === "unauthenticated") return { failure: "unauthorized" };
    await requests.markOutcomeUnknown(token, requestId);
    return { outcome: "request_outcome_unknown", ...ids };
  }
  if (outcome.kind === "provider_error") {
    return finishFailed(requests, token, requestId, outcome.actualMicro ?? null, ids);
  }
  // Timeout or abort after sending: the cost stays reserved until the worker
  // settles it; a later answer is dropped (R7).
  await requests.markOutcomeUnknown(token, requestId);
  return { outcome: "request_outcome_unknown", ...ids };
}

async function finishFailed(
  requests: AssistantRequests,
  token: string,
  requestId: string,
  actualMicro: bigint | null,
  ids: { readonly requestId: string; readonly conversationId: string | null },
): Promise<Answer | Failure> {
  const failed = await requests.fail(token, requestId, actualMicro);
  if (failed.status === "ok") {
    return { outcome: failed.accepted ? "provider_failed" : "request_outcome_unknown", ...ids };
  }
  if (failed.status === "unauthenticated") return { failure: "unauthorized" };
  await requests.markOutcomeUnknown(token, requestId);
  return { outcome: "request_outcome_unknown", ...ids };
}

/** The one value of a header, or null when it is missing or repeated. */
function headerOnce(values: readonly string[] | undefined): string | null {
  return values !== undefined && values.length === 1 ? (values[0] ?? null) : null;
}

function requestRoute(deps: AssistantRouteDeps): Route {
  const { contract, body } = contractOf("student.assistant-request.post");
  return {
    contract,
    async handle(request, response) {
      const token = liveSessionTokenFromCookie(request.headers.cookie);
      if (token === undefined) return refuse(response, 401, "unauthorized");
      const types = request.headersDistinct["content-type"];
      if (
        types?.length !== 1 ||
        types[0]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      ) {
        return refuse(response, 415, "unsupported_media_type");
      }
      const raw = await readBodyWithLimit(request, contract.request.maxBodyBytes!, BODY_TIMEOUT_MS);
      if (!raw.ok) return refuse(response, raw.status, raw.reason);
      const keys = request.headersDistinct["idempotency-key"];
      const parsed = parseAssistantRequest({
        body: raw.bytes,
        // A repeated header is no key at all.
        idempotencyKey: keys === undefined ? null : (headerOnce(keys) ?? "repeated"),
      });
      if (!parsed.ok) {
        return parsed.outcome === "invalid_idempotency_key"
          ? sendProblem(response, 428, "precondition_required")
          : sendProblem(response, 422, "invalid_input");
      }
      try {
        if (deps.provider === null) {
          // Off before any reservation (P1); the session must still stand.
          const live = await deps.rules(token, parsed.request.assignmentId);
          if (live.status === "unauthenticated") return sendProblem(response, 401, "unauthorized");
          if (live.status === "unavailable") return sendProblem(response, 503, "unavailable");
          return sendJson(response, 200, {
            outcome: "ai_disabled",
            requestId: null,
            conversationId: null,
          });
        }
        const answer = await run(deps, deps.provider, token, parsed.request);
        if ("failure" in answer) {
          if (answer.failure === "unauthorized") return sendProblem(response, 401, "unauthorized");
          if (answer.failure === "invalid_request")
            return sendProblem(response, 422, "invalid_input");
        } else if (Value.Check(body, answer)) {
          return sendJson(response, 200, answer);
        } else {
          reportServerError(
            "route",
            new Error("answer outside the contract"),
            requestIdOf(response),
            contract.id,
          );
        }
      } catch (error) {
        reportServerError("route", error, requestIdOf(response), contract.id);
      }
      return sendProblem(response, 503, "unavailable");
    },
  };
}

function conversationRoute(requests: AssistantRequests): Route {
  const { contract, body } = contractOf("student.assistant-conversation.get");
  return {
    contract,
    async handle(request, response, params) {
      const site = request.headersDistinct["sec-fetch-site"];
      if (site !== undefined && (site.length !== 1 || site[0] !== "same-origin")) {
        return sendProblem(response, 403, "forbidden");
      }
      const token = liveSessionTokenFromCookie(request.headers.cookie);
      if (token === undefined) return sendProblem(response, 401, "unauthorized");
      const conversationId = params?.conversationId ?? "";
      if (!UUID.test(conversationId)) return sendProblem(response, 404, "not_found");
      try {
        const id = conversationId.toLowerCase();
        const result = await requests.readConversation(token, id);
        if (result.status === "unauthenticated") return sendProblem(response, 401, "unauthorized");
        if (result.status === "forbidden") return sendProblem(response, 404, "not_found");
        if (result.status === "ok") {
          const answer = { conversationId: id, messages: result.messages };
          if (Value.Check(body, answer)) return sendJson(response, 200, answer);
          reportServerError(
            "route",
            new Error("answer outside the contract"),
            requestIdOf(response),
            contract.id,
          );
        }
      } catch (error) {
        reportServerError("route", error, requestIdOf(response), contract.id);
      }
      return sendProblem(response, 503, "unavailable");
    },
  };
}

/** The two routes over their dependencies: the request, then the conversation. */
export function createAssistantRoutes(deps: AssistantRouteDeps): Route[] {
  return [requestRoute(deps), conversationRoute(deps.requests)];
}

/** The rules of the current version from the student's notice (SRV-NG). */
export function assignmentRulesFrom(withActor: WithActor): AssignmentRulesReader {
  const reader = createStudentNoticeReader(withActor);
  return async (token, assignmentId) => {
    const read = await reader.read(token, assignmentId);
    if (!read.ok) {
      if (read.error === STUDENT_NOTICE_UNAUTHENTICATED) return { status: "unauthenticated" };
      if (read.error === STUDENT_NOTICE_NOT_FOUND) return { status: "not_found" };
      return { status: "unavailable" };
    }
    const { aiPolicy, aiPurposes } = read.value;
    if (!(AI_POLICIES as readonly string[]).includes(aiPolicy)) return { status: "unavailable" };
    return { status: "ok", rules: { aiPolicy: aiPolicy as AiPolicy, aiPurposes } };
  };
}

/**
 * The production routes over main's withActor. There is no provider adapter
 * and no provider configuration (OA-1, Q-10), so the request route answers
 * ai_disabled; the conversation route reads what the database holds.
 */
export function createAssistantRoutesFor(main: { withActor: WithActor }): Route[] {
  return createAssistantRoutes({
    requests: createAssistantRequests(main.withActor),
    rules: assignmentRulesFrom(main.withActor),
    provider: null,
  });
}
