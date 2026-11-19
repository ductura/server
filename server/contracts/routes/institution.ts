import { Type } from "@sinclair/typebox";

import { closed, defineRoute, error } from "../schema/index.ts";

import { MUTATION_GUARD } from "./shared.ts";
import { Name } from "./teacher.ts";

// Literal port of Ductus 078c780: src/server/institution/create-course.ts,
// assignment-version-route.ts with create-assignment.ts (the content of a
// version), enrollment-code-route.ts, enrollment-code-revocation-route.ts,
// student-removal-route.ts, student-return-route.ts and the two teacher role
// routes, all in front of mutation-route.ts. Who may do what is the decision
// of the SECURITY DEFINER RPC behind each; the caller comes only from the
// session. The handlers are server/http/institution-courses.ts and, for an
// assignment version, server/http/institution-assignments.ts (SRV-14); the
// two teacher role routes have none yet (CONTRACT_ONLY).

/** A UUID in any case (mutation-route.ts UUID /i). */
const Uuid = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});
const END = "(?![\\s\\S])";
const MAX_VERSION = 2_147_483_647;
/**
 * One code point as Array.from counts it: a surrogate pair, a lone surrogate
 * or any other unit. The three are disjoint, so a long string never
 * backtracks between them.
 */
const codePoint = (excluded: string) =>
  `(?:[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|[^\\uD800-\\uDBFF${excluded}])`;
const AiPolicy = Type.Union([
  Type.Literal("prohibited"),
  Type.Literal("partially_allowed"),
  Type.Literal("encouraged"),
]);

/**
 * The refusals of every route in front of readJsonMutation: the guard, the
 * session's shape, a malformed path id or body (422), the content type, the
 * body frame, JSON, and rpcErrorResponse (401, 403, else 503).
 */
const MUTATION_ERRORS = [
  ...MUTATION_GUARD,
  error(401, "unauthorized"),
  error(422, "invalid_input"),
  error(415, "unsupported_media_type"),
  error(400, "invalid_json"),
  error(403, "forbidden"),
  error(503, "unavailable"),
] as const;

/**
 * Exactly {} (readEmptyMutation). maxProperties says it: closed({}) compiles to
 * [].includes(key), which TypeScript types as never.
 */
const EMPTY_BODY = {
  contentType: "application/json",
  maxBodyBytes: 64,
  body: Type.Object({}, { maxProperties: 0 }),
} as const;

export const coursesPost = defineRoute({
  id: "institution.courses.post",
  method: "POST",
  path: "/api/v1/institution/courses",
  inventory: "app/api/institution/courses/route.ts",
  access: "teacher",
  summary:
    "A teacher creates a course in their institution: exactly {name, academicYear, aiPolicy}, at most 2 KiB, sent as application/json (only the media type before any parameter is judged). The name is 1 to 160 UTF-16 units with no space at either end; the academic year is two consecutive years such as 2026/2027. The same course sent again answers its id, never a second course.",
  request: {
    contentType: "application/json",
    maxBodyBytes: 2048,
    body: closed({
      name: Type.String({
        minLength: 1,
        maxLength: 160,
        pattern: `^(?!\\s)[\\s\\S]*(?<!\\s)${END}`,
      }),
      academicYear: Type.String({ pattern: `^[0-9]{4}/[0-9]{4}${END}` }),
      aiPolicy: AiPolicy,
    }),
  },
  responses: [{ status: 200, description: "the course", body: closed({ id: Uuid }) }],
  errors: [
    ...MUTATION_GUARD,
    error(401, "unauthorized"),
    error(415, "unsupported_media_type"),
    error(400, "invalid_json"),
    error(422, "invalid_input"),
    error(403, "forbidden"),
    error(409, "conflict"),
    error(503, "unavailable"),
  ],
});

/** A word bound of institution.is_word_range, or null for none. */
const WordBound = Type.Union([Type.Integer({ minimum: 1, maximum: 1_000_000 }), Type.Null()]);
/** ISO_INSTANT of create-assignment.ts; the calendar and the UTC years 1000 to 9999 are the server's. */
const Instant = Type.String({
  pattern: `^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?(?:Z|[+-](?:(?:0\\d|1[0-3]):[0-5]\\d|14:00))${END}`,
});

/** The content of an assignment version (create-assignment.ts parseAssignmentInput). */
const ASSIGNMENT_CONTENT = {
  title: Type.String({ pattern: `^(?:${codePoint("\\u0000")}){1,200}${END}` }),
  instructions: Type.String({ pattern: `^(?:${codePoint("\\u0000")}){0,20000}${END}` }),
  workType: Type.Union(
    [
      "short_paper",
      "essay",
      "seminar_paper",
      "bachelor_thesis",
      "master_thesis",
      "specialist_thesis",
      "doctoral_thesis",
    ].map((type) => Type.Literal(type)),
  ),
  opensAt: Instant,
  dueAt: Instant,
  aiPolicy: AiPolicy,
  aiPurposes: Type.Array(
    Type.Union(
      ["formatting", "proofreading", "literature_search", "transcription", "translation"].map(
        (purpose) => Type.Literal(purpose),
      ),
    ),
    // Repeated purposes are the server's 422: TypeBox checks uniqueItems with a hash the
    // generated validator does not carry.
    { maxItems: 5 },
  ),
  evidenceProfile: Type.Union([Type.Literal("basic"), Type.Literal("extended")]),
  importAllowed: Type.Boolean(),
  wordMin: WordBound,
  wordMax: WordBound,
};

export const assignmentVersionsPost = defineRoute({
  id: "institution.assignment-versions.post",
  method: "POST",
  path: "/api/v1/institution/assignments/{assignmentId}/versions",
  inventory: "app/api/institution/assignments/[assignmentId]/versions/route.ts",
  access: "course_teacher",
  summary:
    "A teacher of the assignment publishes its next version against the version they saw: {expectedVersion} and the whole content, both word bounds named (null drops one), at most 90 000 bytes. A tightening of the rules, an AI purpose under a prohibited policy, wordMin above wordMax or an impossible date is 422; a stale version is 409 version_conflict, and of two requests with the same version one writes.",
  request: {
    params: closed({ assignmentId: Uuid }),
    contentType: "application/json",
    maxBodyBytes: 90_000,
    body: closed({
      expectedVersion: Type.Integer({ minimum: 1, maximum: MAX_VERSION }),
      ...ASSIGNMENT_CONTENT,
    }),
  },
  responses: [
    {
      status: 201,
      description: "published",
      body: closed({
        assignmentId: Type.String({
          pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        }),
        versionNo: Type.Integer({ minimum: 2, maximum: MAX_VERSION }),
      }),
    },
  ],
  errors: [...MUTATION_ERRORS, error(409, "version_conflict")],
});

export const enrollmentCodePost = defineRoute({
  id: "institution.enrollment-code.post",
  method: "POST",
  path: "/api/v1/institution/courses/{courseId}/enrollment-code",
  inventory: "app/api/institution/courses/[courseId]/enrollment-code/route.ts",
  access: "course_teacher",
  summary:
    "A teacher of the course issues its enrolment code, valid until {validUntil}, replacing any earlier one; at most 1 KiB. The instant keeps its offset and fraction as sent; an impossible date or one the database refuses is 422.",
  request: {
    params: closed({ courseId: Uuid }),
    contentType: "application/json",
    maxBodyBytes: 1024,
    body: closed({
      validUntil: Type.String({
        pattern: `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:\\d{2})${END}`,
      }),
    }),
  },
  responses: [
    {
      status: 200,
      description: "the code",
      body: closed({ code: Type.String({ pattern: "^[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$" }) }),
    },
  ],
  errors: [...MUTATION_ERRORS],
});

export const enrollmentCodeRevocationPost = defineRoute({
  id: "institution.enrollment-code-revocation.post",
  method: "POST",
  path: "/api/v1/institution/courses/{courseId}/enrollment-code/revocation",
  inventory: "app/api/institution/courses/[courseId]/enrollment-code/revocation/route.ts",
  access: "course_teacher",
  summary:
    "A teacher of the course revokes its enrolment code. The body is exactly {}; revoked is false when there was no code to revoke.",
  request: { params: closed({ courseId: Uuid }), ...EMPTY_BODY },
  responses: [
    { status: 200, description: "revoked or not", body: closed({ revoked: Type.Boolean() }) },
  ],
  errors: [...MUTATION_ERRORS],
});

export const studentRemovalPost = defineRoute({
  id: "institution.student-removal.post",
  method: "POST",
  path: "/api/v1/institution/courses/{courseId}/students/{studentId}/removal",
  inventory: "app/api/institution/courses/[courseId]/students/[studentId]/removal/route.ts",
  access: "course_teacher",
  summary:
    "A teacher of the course ends one student's membership. The body is exactly {}; removed is false when that user holds no open student membership there.",
  request: { params: closed({ courseId: Uuid, studentId: Uuid }), ...EMPTY_BODY },
  responses: [
    { status: 200, description: "removed or not", body: closed({ removed: Type.Boolean() }) },
  ],
  errors: [...MUTATION_ERRORS],
});

export const studentReturnPost = defineRoute({
  id: "institution.student-return.post",
  method: "POST",
  path: "/api/v1/institution/courses/{courseId}/students/{studentId}/return-permission",
  inventory:
    "app/api/institution/courses/[courseId]/students/[studentId]/return-permission/route.ts",
  access: "course_teacher",
  summary:
    "A teacher of the course lets one removed student enrol again; the student still needs a valid code. The body is exactly {}; allowed is false when nothing was blocking that student there.",
  request: { params: closed({ courseId: Uuid, studentId: Uuid }), ...EMPTY_BODY },
  responses: [
    { status: 200, description: "allowed or not", body: closed({ allowed: Type.Boolean() }) },
  ],
  errors: [...MUTATION_ERRORS],
});

export const roleConfirmationPost = defineRoute({
  id: "institution.role-confirmation.post",
  method: "POST",
  path: "/api/v1/institution/teachers/{teacherId}/role-confirmation",
  inventory: "app/api/institution/teachers/[teacherId]/role-confirmation/route.ts",
  access: "institution_admin",
  summary:
    "An administrator of the institution confirms one candidate as a teacher. The body is exactly {}. A caller who is not an administrator is 403; for an administrator every candidate that cannot be confirmed (themself, another institution's, a missing one, one whose last login gave no right) is the same 404.",
  request: { params: closed({ teacherId: Uuid }), ...EMPTY_BODY },
  responses: [
    { status: 200, description: "confirmed", body: closed({ confirmed: Type.Literal(true) }) },
  ],
  errors: [...MUTATION_ERRORS, error(404, "not_found")],
});

export const roleRevocationPost = defineRoute({
  id: "institution.role-revocation.post",
  method: "POST",
  path: "/api/v1/institution/teachers/{teacherId}/role-revocation",
  inventory: "app/api/institution/teachers/[teacherId]/role-revocation/route.ts",
  access: "institution_admin",
  summary:
    "An administrator of the institution ends one person's confirmed teacher role. The body is exactly {}; revoked is false when that person holds no active confirmed teacher role in the caller's institution, so another institution's person looks the same as a missing one.",
  request: { params: closed({ teacherId: Uuid }), ...EMPTY_BODY },
  responses: [
    { status: 200, description: "revoked or not", body: closed({ revoked: Type.Boolean() }) },
  ],
  errors: [...MUTATION_ERRORS],
});

// SRV-03 (Ductus#2028 c.7008147932, wave 4): the administrator creates a
// course with its holder and groups (A-7), the course team keeps its seminar
// groups (C-7), and a teacher of the course creates an assignment (the
// contract of the PENDING course-assignments route). The two course routes
// are new routes, not a change of institution.courses.post: who may call it
// and its body are part of API v1 (server/contracts/breaking.ts). Who may do
// what is the decision of the SECURITY DEFINER RPC behind each; the caller
// comes only from the session. No handler yet (CONTRACT_ONLY).

/** institution.is_plain_label: 1 to 200 UTF-16 units, no space at either end. */
const Label = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength, pattern: `^(?!\\s)[\\s\\S]*(?<!\\s)${END}` });
/** A lowercase UUID, as PostgreSQL writes uuid. */
const LowerUuid = Type.String({
  pattern: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}${END}`,
});

export const adminCoursesPost = defineRoute({
  id: "institution.admin-courses.post",
  method: "POST",
  path: "/api/v1/institution/admin/courses",
  inventory: "app/api/institution/admin/courses/route.ts",
  access: "institution_admin",
  summary:
    "An administrator of the institution creates a course: exactly {name, academicYear, aiPolicy, holderId, groups}, at most 8 KiB, sent as application/json (charset utf-8 only). holderId is a confirmed teacher of the same institution, who becomes the course's holder and a teacher of it; groups are the names of its seminar groups (0 to 20, distinct, each 1 to 80 UTF-16 units with no space at either end). The name is 1 to 160 UTF-16 units with no space at either end; the academic year is two consecutive years such as 2026/2027. A teacher who is not an administrator is 403. The same course (institution, academic year, name) sent again with the same content answers its id; with other content it is 409 conflict.",
  request: {
    contentType: "application/json",
    maxBodyBytes: 8192,
    body: closed({
      name: Label(160),
      academicYear: Type.String({ pattern: `^[0-9]{4}/[0-9]{4}${END}` }),
      aiPolicy: AiPolicy,
      holderId: Uuid,
      groups: Type.Array(Label(80), { maxItems: 20 }),
    }),
  },
  responses: [
    {
      status: 200,
      description: "the course",
      body: closed({
        id: LowerUuid,
        groups: Type.Array(closed({ id: LowerUuid, name: Type.String({ minLength: 1 }) })),
      }),
    },
  ],
  errors: [...MUTATION_ERRORS, error(409, "conflict")],
});

const GroupTeacher = closed({ id: LowerUuid, givenName: Name, familyName: Name });

export const courseGroupsGet = defineRoute({
  id: "institution.course-groups.get",
  method: "GET",
  path: "/api/v1/institution/courses/{courseId}/groups",
  inventory: "app/api/institution/courses/[courseId]/groups/route.ts",
  access: "course_teacher",
  summary:
    "The seminar groups of a course, for a teacher of its team or an administrator of its institution: by name (hr collation), then id, each with its open teachers (by family and given name, hr collation, then id) and the number of its open students; no student is named. A malformed course id is 422. Another institution's course and an unknown one are the same 403 (C-23).",
  request: { params: closed({ courseId: Uuid }) },
  responses: [
    {
      status: 200,
      description: "the groups, possibly none",
      body: closed({
        groups: Type.Array(
          closed({
            id: LowerUuid,
            name: Type.String({ minLength: 1 }),
            teachers: Type.Array(GroupTeacher),
            students: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          }),
        ),
      }),
    },
  ],
  errors: [
    error(401, "unauthorized"),
    error(422, "invalid_input"),
    error(403, "forbidden"),
    error(503, "unavailable"),
  ],
});

export const courseGroupsPost = defineRoute({
  id: "institution.course-groups.post",
  method: "POST",
  path: "/api/v1/institution/courses/{courseId}/groups",
  inventory: "app/api/institution/courses/[courseId]/groups/route.ts",
  access: "course_teacher",
  summary:
    "The holder, a collaborator of the course team (C-7) or an administrator of the institution adds a seminar group: exactly {name}, 1 to 80 UTF-16 units with no space at either end, at most 1 KiB. A group of the same name answers its id; nothing is made twice. A student is 403.",
  request: {
    params: closed({ courseId: Uuid }),
    contentType: "application/json",
    maxBodyBytes: 1024,
    body: closed({ name: Label(80) }),
  },
  responses: [{ status: 200, description: "the group", body: closed({ id: LowerUuid }) }],
  errors: [...MUTATION_ERRORS],
});

export const courseGroupTeachersPost = defineRoute({
  id: "institution.course-group-teachers.post",
  method: "POST",
  path: "/api/v1/institution/groups/{groupId}/teachers",
  inventory: "app/api/institution/groups/[groupId]/teachers/route.ts",
  access: "course_teacher",
  summary:
    "A teacher of the course team or an administrator of the institution assigns a confirmed teacher of the institution to a seminar group: exactly {teacherId}, at most 1 KiB. The teacher joins the course team through the group. assigned is false when they already teach the group. A teacher who is not confirmed is 422.",
  request: {
    params: closed({ groupId: Uuid }),
    contentType: "application/json",
    maxBodyBytes: 1024,
    body: closed({ teacherId: Uuid }),
  },
  responses: [
    {
      status: 200,
      description: "assigned now or before",
      body: closed({ assigned: Type.Boolean() }),
    },
  ],
  errors: [...MUTATION_ERRORS],
});

export const courseAssignmentsPost = defineRoute({
  id: "institution.course-assignments.post",
  method: "POST",
  path: "/api/v1/institution/courses/{courseId}/assignments",
  inventory: "app/api/institution/courses/[courseId]/assignments/route.ts",
  access: "course_teacher",
  summary:
    "A teacher of the course creates and publishes an assignment (version 1) with its rules on AI tools (aiPolicy and aiPurposes, A-14): {requestKey} and the whole content, at most 90 000 bytes, sent as application/json (charset utf-8 only). requestKey is a UUID the client makes once per form, in the body so the generated client sends it. The same key with the same content answers the same id; with other content it is 409 conflict. A malformed course id or key, a tightening the course forbids, an AI purpose under a prohibited policy, wordMin above wordMax or an impossible date is 422. Publishing sends nothing to anyone (C-17): students see it in student.assignments.get.",
  request: {
    params: closed({ courseId: Uuid }),
    contentType: "application/json",
    maxBodyBytes: 90_000,
    body: closed({ requestKey: Uuid, ...ASSIGNMENT_CONTENT }),
  },
  responses: [{ status: 201, description: "created", body: closed({ id: LowerUuid }) }],
  errors: [...MUTATION_ERRORS, error(409, "conflict")],
});

export const institutionRoutes = [
  coursesPost,
  assignmentVersionsPost,
  enrollmentCodePost,
  enrollmentCodeRevocationPost,
  studentRemovalPost,
  studentReturnPost,
  roleConfirmationPost,
  roleRevocationPost,
  adminCoursesPost,
  courseGroupsGet,
  courseGroupsPost,
  courseGroupTeachersPost,
  courseAssignmentsPost,
] as const;
