import { Type } from "@sinclair/typebox";

import { closed, defineRoute, error } from "../schema/index.ts";

import { MUTATION_GUARD } from "./shared.ts";

// SRV-1204 (Val 12 / M9.0-S2, Ductus#2052; step 4 of Ductus
// docs/contracts/ai-request-v1.md): the AI assistant proxy. A student sends one
// paragraph for one purpose of an assignment with an Idempotency-Key header;
// the server picks the provider and the model from its versioned
// configuration, never from the request (P7), reserves the budget, and calls
// the provider only for a request in state sent. Every answer after the body
// was accepted carries one code of the closed set "Ishodi" in `outcome`. A
// server without a provider configuration (production today, Q-10) answers
// ai_disabled. Database: schema assistant (20261122110000).

/** Lowercase UUID. */
const Uuid = Type.String({
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
});
const AnyCaseUuid = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});
/** Date.toISOString of a finite instant. */
const Instant = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });
const literals = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));

/** Largest request body in bytes (MAX_REQUEST_BODY_BYTES of server/domain/assistant). */
export const ASSISTANT_REQUEST_MAX_BODY_BYTES = 64 * 1024;

/** The outcomes of a request the body of which was accepted (contract, "Ishodi"). */
export const ASSISTANT_ANSWER_OUTCOMES = [
  "idempotency_conflict",
  "forbidden",
  "ai_disabled",
  "purpose_not_allowed",
  "budget_exceeded",
  "in_progress",
  "request_outcome_unknown",
  "provider_failed",
] as const;

const Completed = closed({
  outcome: Type.Literal("completed"),
  requestId: Uuid,
  conversationId: Uuid,
  response: closed({ id: Uuid, text: Type.String({ minLength: 1 }) }),
});
const WithoutResponse = closed({
  outcome: literals(ASSISTANT_ANSWER_OUTCOMES),
  /** Null when no request row exists (ai_disabled before the database, forbidden, conflict). */
  requestId: Type.Union([Uuid, Type.Null()]),
  conversationId: Type.Union([Uuid, Type.Null()]),
});

export const ASSISTANT_REQUEST_BODY = closed({
  assignmentId: AnyCaseUuid,
  conversationId: Type.Union([AnyCaseUuid, Type.Null()]),
  purposeCatalogVersion: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
  purposeKey: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
  paragraph: Type.String({ minLength: 1 }),
});

export const studentAssistantRequestPost = defineRoute({
  id: "student.assistant-request.post",
  method: "POST",
  path: "/api/v1/student/assistant/requests",
  inventory: "app/api/student/assistant/requests/route.ts",
  access: "student_enrolled",
  summary:
    "A student of the assignment asks the AI assistant about one paragraph for one purpose. The Idempotency-Key header holds a UUID per account: the same key with the same request answers what is already there and never calls the provider again; with another request it answers idempotency_conflict. The provider and the model come from the server's versioned configuration and are never taken from the request; after a provider failure no other provider is tried. 200 always carries outcome from the closed set: completed with the response, or idempotency_conflict, forbidden (a foreign and an unknown assignment or conversation alike), ai_disabled, purpose_not_allowed, budget_exceeded, in_progress, request_outcome_unknown or provider_failed. A body outside the contract is 422 invalid_input (outcome invalid_request of the contract); a missing, repeated or malformed key is 428 precondition_required (outcome invalid_idempotency_key). Neither leaves a row, so the key stays free.",
  request: {
    contentType: "application/json",
    maxBodyBytes: ASSISTANT_REQUEST_MAX_BODY_BYTES,
    body: ASSISTANT_REQUEST_BODY,
  },
  responses: [
    {
      status: 200,
      description: "the outcome of the request",
      body: Type.Union([Completed, WithoutResponse]),
      headers: ["cache-control"],
    },
  ],
  errors: [
    ...MUTATION_GUARD,
    error(401, "unauthorized"),
    error(415, "unsupported_media_type"),
    error(428, "precondition_required"),
    error(422, "invalid_input"),
    error(503, "unavailable"),
  ],
});

const Message = closed({
  seq: Type.Integer({ minimum: 1 }),
  id: Uuid,
  requestId: Uuid,
  role: literals(["student_paragraph", "provider_response"]),
  content: Type.String(),
  contentSha256: Sha256,
  createdAt: Instant,
  requestState: literals([
    "rejected",
    "reserved",
    "sent",
    "completed",
    "provider_failed",
    "outcome_unknown",
    "settled",
  ]),
});

export const studentAssistantConversationGet = defineRoute({
  id: "student.assistant-conversation.get",
  method: "GET",
  path: "/api/v1/student/assistant/conversations/{conversationId}",
  inventory: "app/api/student/assistant/conversations/[conversationId]/route.ts",
  access: "student_owner",
  summary:
    "The student's own AI assistant conversation, messages by seq, each with the state of its request: a paragraph stays when its request ended without a response. Nobody else reads it, the teacher included. A foreign, unknown or malformed conversation id returns 404.",
  request: { params: closed({ conversationId: Type.String({ minLength: 1 }) }) },
  responses: [
    {
      status: 200,
      description: "the messages, oldest first",
      body: closed({ conversationId: Uuid, messages: Type.Array(Message) }),
      headers: ["cache-control"],
    },
  ],
  errors: [error(401, "unauthorized"), error(404, "not_found"), error(503, "unavailable")],
});

export const assistantRoutes = [
  studentAssistantRequestPost,
  studentAssistantConversationGet,
] as const;
