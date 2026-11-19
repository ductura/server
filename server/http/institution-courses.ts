// POST /api/v1/institution/courses, …/{courseId}/enrollment-code and its
// revocation (DAN-852-4a, 4b; contracts Ductus#1836 c.6947710352,
// c.6949068519). Port of the HTTP edge of Ductus create-course.ts,
// enrollment-code-route.ts, enrollment-code-revocation-route.ts and the
// shared front readJsonMutation and readEmptyMutation (mutation-route.ts)
// at 078c780, over the institution service (server/institution). Changes:
// the token is liveSessionToken, as profile-interface-locale.ts; origin is
// pipeline step 7; a byte order mark stays a character (readJsonMutation,
// where create-course.ts stripped it); an accepted answer counts as session
// activity after it is written and a failure of the touch is swallowed, as
// the profile route (Ductus counted awaited it). Who may do what is the RPC's.
// The same front serves student-removal-route.ts and student-return-route.ts
// (Ductus 078c780): path ids in the contract's order and an empty body. The
// assignment version route is institution-assignments.ts (SRV-14).
import type { IncomingMessage, ServerResponse } from "node:http";

import { ROUTES, workIdFromPath } from "../contracts/index.ts";
import {
  createInstitutionCourses,
  createInstitutionMembers,
  type InstitutionCourses,
  type InstitutionMembers,
} from "../database/index.ts";
import { createInstitutionService } from "../institution/index.ts";
import { liveSessionTokenFromCookie, recordActivity } from "../session/index.ts";

import type { Databases } from "./databases.ts";
import { reportServerError } from "./error-catalog.ts";
import { readBodyWithLimit } from "./mutation-request.ts";
import { sendProblem } from "./problem.ts";
import { requestIdOf } from "./request-id.ts";
import { parseJson } from "./request-json.ts";
import { type Route, sendJson } from "./router.ts";
import { refuse } from "./security-headers.ts";

export const INSTITUTION_BODY_TIMEOUT_MS = 5_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type InstitutionCourseRouteOptions = {
  readonly courses: InstitutionCourses;
  readonly members: InstitutionMembers;
  /** Session activity for an accepted answer (session/recordActivity). */
  readonly recordActivity: (token: string) => Promise<unknown>;
  /** For tests: a shorter body deadline. */
  readonly timeoutMs?: number;
};

/** The refusals of each route's closed outcomes; anything else is 503 unavailable. */
type Refusal = readonly [number, string];
type Refusals = ReadonlyMap<string, Refusal>;
const UNAUTHORIZED: [string, Refusal] = ["unauthenticated", [401, "unauthorized"]];
const FORBIDDEN: [string, Refusal] = ["forbidden", [403, "forbidden"]];
const INVALID = [422, "invalid_input"] as const;
const COURSE_REFUSALS: Refusals = new Map<string, Refusal>([
  UNAUTHORIZED,
  FORBIDDEN,
  ["conflict", [409, "conflict"]],
  ["invalid", INVALID],
  ["invalid_input", INVALID],
]);
const CODE_REFUSALS: Refusals = new Map<string, Refusal>([
  UNAUTHORIZED,
  FORBIDDEN,
  ["invalid", INVALID],
  ["invalid_input", INVALID],
]);
const REVOKE_REFUSALS: Refusals = new Map<string, Refusal>([UNAUTHORIZED, FORBIDDEN]);

/**
 * A path segment decoded exactly once, through the one decoder of the
 * contracts (workIdFromPath: every UUID is a valid work id). Broken encoding
 * or a control character is "", which is never a UUID.
 */
export const decodeOnce = (segment: string | undefined): string =>
  workIdFromPath(segment ?? "") ?? "";

/** Ductus readEmptyMutation: a non-null object, not an array, with no own enumerable key. */
const isEmptyObject = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 0;

type Input = { readonly token: string; readonly value: unknown };

/**
 * Ductus readJsonMutation after the origin: the session token (401), every
 * path id a UUID (422), Content-Type exactly once of media type
 * application/json (415), the body under the limit and deadline, then strict
 * UTF-8 JSON (400). Refusals before the whole body was read close the
 * connection. Null when it already answered.
 */
export async function readInstitutionJson(
  request: IncomingMessage,
  response: ServerResponse,
  ids: readonly string[],
  maxBytes: number,
  timeoutMs: number,
): Promise<Input | null> {
  const refused = (status: number, code: string): null => {
    refuse(response, status, code);
    return null;
  };
  const token = liveSessionTokenFromCookie(request.headers.cookie);
  if (token === undefined) return refused(401, "unauthorized");
  if (!ids.every((id) => UUID.test(id))) return refused(422, "invalid_input");
  const types = request.headersDistinct["content-type"];
  if (types?.length !== 1 || types[0]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return refused(415, "unsupported_media_type");
  }
  const body = await readBodyWithLimit(request, maxBytes, timeoutMs);
  if (!body.ok) return refused(body.status, body.reason);
  const json = parseJson(body.bytes);
  if (json.ok) return { token, value: json.value };
  sendProblem(response, 400, "invalid_json");
  return null;
}

/**
 * What a route answers, always built here from named fields: a 200 body, or
 * the status of a refusal, never the outcome object itself, so no field an
 * outcome carries (body, code, ok …) can choose the answer (QA on #259).
 */
type Answer =
  | { readonly ok: true; readonly body: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly status: unknown };
/** A refusal of this outcome's own status; a non-string status matches no refusal (503). */
const refused = (outcome: { readonly status: unknown }): Answer => ({
  ok: false,
  status: outcome.status,
});
/** The path ids in the order of the contract's params (courseId, studentId …). */
type Run = (token: string, value: unknown, ids: readonly string[]) => Promise<Answer>;

/**
 * The institution course routes over the service (852-4a, 4b): the course,
 * its enrolment code and the code's revocation. A 200 body is built here from
 * named fields only, so no other field of an outcome ever leaves.
 */
export function createInstitutionCourseRoutes(options: InstitutionCourseRouteOptions): Route[] {
  const service = createInstitutionService({ courses: options.courses, members: options.members });
  const timeoutMs = options.timeoutMs ?? INSTITUTION_BODY_TIMEOUT_MS;

  const route = (id: string, refusals: Refusals, run: Run, empty = false): Route => {
    const contract = ROUTES.find((found) => found.id === id)!;
    const names = Object.keys(contract.request.params?.properties ?? {});
    return {
      contract,
      async handle(request, response, params) {
        const ids = names.map((name) => decodeOnce(params?.[name]));
        const maxBytes = contract.request.maxBodyBytes ?? 64;
        const input = await readInstitutionJson(request, response, ids, maxBytes, timeoutMs);
        if (input === null) return;
        if (empty && !isEmptyObject(input.value)) return sendProblem(response, ...INVALID);
        try {
          const answer = await run(input.token, input.value, ids);
          if (!answer.ok) {
            const known =
              typeof answer.status === "string" ? refusals.get(answer.status) : undefined;
            const [status, code] = known ?? [503, "unavailable"];
            return sendProblem(response, status, code);
          }
          sendJson(response, 200, answer.body);
        } catch (error) {
          reportServerError("route", error, requestIdOf(response), contract.id);
          return sendProblem(response, 503, "unavailable");
        }
        // Only an accepted answer counts, once written; a failure costs only the touch.
        void options.recordActivity(input.token).catch(() => undefined);
      },
    };
  };

  return [
    route("institution.courses.post", COURSE_REFUSALS, async (token, value) => {
      const outcome = await service.createCourse(token, value);
      return outcome.status === "created"
        ? { ok: true, body: { id: outcome.id } }
        : refused(outcome);
    }),
    route("institution.enrollment-code.post", CODE_REFUSALS, async (token, value, [courseId]) => {
      const outcome = await service.issueEnrollmentCode(token, courseId!, value);
      return outcome.status === "issued"
        ? { ok: true, body: { code: outcome.code } }
        : refused(outcome);
    }),
    route(
      "institution.enrollment-code-revocation.post",
      REVOKE_REFUSALS,
      async (token, _value, [courseId]) => {
        const outcome = await service.revokeEnrollmentCode(token, courseId!);
        return outcome.status === "revoked"
          ? { ok: true, body: { revoked: outcome.revoked } }
          : refused(outcome);
      },
      true,
    ),
    route(
      "institution.student-removal.post",
      REVOKE_REFUSALS,
      async (token, _value, [courseId, studentId]) => {
        const outcome = await service.removeStudent(token, courseId!, studentId!);
        return outcome.status === "removed"
          ? { ok: true, body: { removed: outcome.removed } }
          : refused(outcome);
      },
      true,
    ),
    route(
      "institution.student-return.post",
      REVOKE_REFUSALS,
      async (token, _value, [courseId, studentId]) => {
        const outcome = await service.allowStudentReturn(token, courseId!, studentId!);
        return outcome.status === "allowed"
          ? { ok: true, body: { allowed: outcome.allowed } }
          : refused(outcome);
      },
      true,
    ),
  ];
}

/**
 * The routes over the main database (DAN-852-5a): the port and the activity
 * touch both run on main's application withActor, so an answer and its touch
 * never reach another pool. server/server.ts mounts them.
 */
export function createInstitutionCourseRoutesFor(
  main: Pick<Databases["main"], "withActor">,
): Route[] {
  return createInstitutionCourseRoutes({
    courses: createInstitutionCourses(main.withActor),
    members: createInstitutionMembers(main.withActor),
    recordActivity: (token) => recordActivity(token, main.withActor),
  });
}
