import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Value } from "@sinclair/typebox/value";
import { createSoftwareAuthenticator } from "@ductura/test-fakes/fido2";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createOpenSession } from "../../server/database/index.ts";
import {
  AREA_NAMES,
  createAcknowledgmentRouteFor,
  createAdminCourseRouteFor,
  createAssignmentCurrentVersionRouteFor,
  createAttachmentRoutesFor,
  createAuthRoutes,
  createClientContextRoute,
  createCollaborationCommentsRouteFor,
  createConsultationRecordRoutesFor,
  createConsultationSlotRoutesFor,
  createWorkMilestonesRoutesFor,
  createDatabases,
  createDownloadsManifestRoute,
  createEvidenceCommitRouteFor,
  createEvidenceOpenRoute,
  createEvidenceReplayRouteFor,
  createSubmissionRouteFor,
  createProcessSummaryRouteFor,
  createProcessSummaryDetailsRouteFor,
  createTeacherFastPathRouteFor,
  createWorkMessagesRoutesFor,
  createWorkVersionsRouteFor,
  createStudentAssignmentWorkRouteFor,
  createStudentNotesRoutesFor,
  createStudentSubmissionRoutesFor,
  createStudentNoticeRouteFor,
  createHealthRoute,
  createInstitutionAssignmentRoutesFor,
  createInstitutionCourseRoutesFor,
  createInstitutionGroupRoutesFor,
  createInterfaceLocaleRoutesFor,
  createInternalInstitutionRoutes,
  createLiveRoutesFor,
  createLayers,
  createMeRouteFor,
  createProblemReportRouteFor,
  createSettingsReadRoutes,
  createSettingsValuesPutRoute,
  createSourceLookupRouteFor,
  createPublicVerificationRouteFor,
  createTeacherReadRoutesFor,
  createTeacherRosterRoutesFor,
  createDeadlineExtensionRoutesFor,
  createMerlinRosterRoutesFor,
  createMerlinPackageRoutesFor,
  createAssistantRoutesFor,
  createTeacherMentorshipRequestRoutesFor,
  createWebAuthnRoutesFor,
  createSourceProofRoutesFor,
  createWorkSourceRoutesFor,
  createTextCheckConfigRoute,
  createTeacherWorkingCriteriaRoutesFor,
  evidenceIngestDependencies,
  INTERNAL_PATH_PREFIX,
  type Running,
  routesOf,
  startServer,
} from "../../server/http/index.ts";
import { newSessionToken } from "../../server/session/index.ts";

// S-1D-d, DAN-829-2: after POST /api/v1/auth/logout the old session cookie is
// 401 on every mounted route whose contract has a 401, over real HTTP, the real
// pipeline and router, and the real closeSession of the main database (the
// routes are built as server/server.ts builds them). The two sign-outs have no
// 401 (they are idempotent): there the old cookie closes nothing. Every person,
// token and password is random and synthetic; the auth login lives only here.
const ADMIN_URL =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const AUTH_LOGIN = "it_logout_old_cookie_auth";
const ORIGIN = "https://ductura.example.invalid";
const ROOT = join(import.meta.dirname, "../..");
const ENV = {
  NODE_ENV: "test",
  DUCTUS_AUTH_PROVIDER: "fake-oidc",
  OIDC_ISSUER: "http://127.0.0.1:9",
  OIDC_CLIENT_ID: "ductus-local",
  OIDC_CLIENT_SECRET: "ductus-local-only",
  OIDC_REDIRECT_URI: `${ORIGIN}/api/v1/auth/callback`,
};
const password = randomBytes(24).toString("hex");
const suffix = randomBytes(4).toString("hex");
const institution = randomUUID();
const homeOrg = `it-loc-${suffix}.ductus.test`;
const issuer = `https://issuer-loc-${suffix}.test`;

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const databases = createDatabases();
let auth: pg.Pool;
let server: Running;

// The answer of each route that needs a session to a complete, valid request
// with a live session, so 426, 415 and 422 can never hide the outcome. Both
// 404s are reached only with a live actor (the functions check it first).
// `method` is POST unless given; `old` is the 401 body each contract gives.
const EVIDENCE_401 = { status: "unauthenticated" };
/** A valid document whose JSON.stringify is its JCS form (the vector of a first write). */
const LIVE_DOCUMENT: unknown = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../server/contracts/vectors/live.document.put.json"),
      "utf8",
    ),
  ) as { vectors: { name: string; request: { body: unknown } }[] }
).vectors.find((v) => v.name === "first-write")!.request.body;
/** A course that does not exist: a non-teacher is refused as for any course (C-23). */
const COURSE = randomUUID();
/** A student and an assignment that do not exist either (C-23). */
const STUDENT = randomUUID();
const ASSIGNMENT = randomUUID();
const WORK_SOURCE = {
  id: "00000000-0000-4000-8000-00000000c0a1",
  type: "book",
  authors: [{ kind: "person", family: "Izmišljeni", given: "Autor" }],
  year: 2019,
  title: "Izmišljena knjiga o kućnom kompostiranju",
  place: "Izmišljeni grad",
  publisher: "Izmišljena naklada",
};

const SESSION_ROUTES = {
  "evidence.open.post": {
    path: "/api/v1/evidence/open",
    body: () => ({ assignmentId: randomUUID() }),
    live: 404,
  },
  "evidence.commit.post": { path: "/api/v1/evidence/commit", body: () => ({}), live: 422 },
  "evidence.replay.post": {
    path: "/api/v1/evidence/replay",
    body: () => ({ documentId: randomUUID(), from: 0 }),
    live: 404,
  },
  "collaboration.comments.post": {
    path: "/api/v1/comments/list",
    body: () => ({ documentId: randomUUID() }),
    live: 403,
  },
  // SRV-1105: a work it may not read is 404 for the list and for both writes.
  "work.consultation-records.get": {
    method: "GET",
    path: `/api/v1/works/${randomUUID()}/consultation-records`,
    body: () => undefined,
    live: 404,
  },
  "work.consultation-records.post": {
    path: `/api/v1/works/${randomUUID()}/consultation-records`,
    body: () => ({ heldOn: "2026-11-18", revision: 1, topic: "Tema", agreement: "" }),
    live: 404,
  },
  "work.consultation-additions.post": {
    path: `/api/v1/works/${randomUUID()}/consultation-records/${randomUUID()}/additions`,
    body: () => ({ text: "Dopuna." }),
    live: 404,
  },
  // SRV-1106: a work it may not read is 404 for the conversation and for a message.
  "work.messages.get": {
    method: "GET",
    path: `/api/v1/works/${randomUUID()}/messages`,
    body: () => undefined,
    live: 404,
  },
  "work.messages.post": {
    path: `/api/v1/works/${randomUUID()}/messages`,
    body: () => ({ text: "Izmišljena poruka." }),
    live: 404,
  },
  // SRV-18: a live session naming a work it does not own gets 404 and submits nothing.
  "submission.submit.post": {
    path: "/api/v1/submission",
    body: () => ({ documentId: randomUUID(), revision: 1 }),
    live: 404,
  },
  // SRV-23: a live session naming a work it may not read gets 404 and logs nothing.
  "projection.process-summary.post": {
    path: "/api/v1/process-summary",
    body: () => ({ documentId: randomUUID() }),
    live: 404,
  },
  // SRV-9D: the details of a work it may not read are 404 too.
  "projection.process-summary-details.post": {
    path: "/api/v1/process-summary/details",
    body: () => ({ documentId: randomUUID() }),
    live: 404,
  },
  // SRV-8E: an assignment the caller does not teach is the same empty list.
  "teacher.fast-path.post": {
    path: "/api/v1/teacher/fast-path",
    body: () => ({ assignmentId: randomUUID() }),
    live: 200,
  },
  // SRV-9A: the versions of a work it may not read are 404, as a missing work.
  "work.versions.get": {
    method: "GET",
    path: `/api/v1/works/${randomUUID()}/versions`,
    body: () => undefined,
    live: 404,
  },
  "work.consultation-slots.get": {
    method: "GET",
    path: `/api/v1/works/${randomUUID()}/consultation-slots`,
    body: () => undefined,
    live: 403,
  },
  "work.consultation-slots.post": {
    path: `/api/v1/works/${randomUUID()}/consultation-slots`,
    body: () => ({ startsAt: new Date(Date.now() + 86_400_000).toISOString() }),
    live: 403,
  },
  "work.consultation-slots.patch": {
    method: "PATCH",
    path: `/api/v1/works/${randomUUID()}/consultation-slots/${randomUUID()}`,
    body: () => ({ action: "confirm" }),
    live: 403,
  },
  "student.assignment-work.get": {
    method: "GET",
    path: "/api/v1/student/assignment-work",
    body: () => undefined,
    live: 200,
  },
  "student.submission-notes.get": {
    method: "GET",
    path: `/api/v1/student/assignments/${ASSIGNMENT}/submission-notes`,
    body: () => undefined,
    live: 404,
  },
  "student.submission-notes.post": {
    path: "/api/v1/student/submission-notes",
    body: () => ({ assignmentId: ASSIGNMENT, text: "Izmišljena napomena o radu." }),
    live: 404,
  },
  // SRV-1101: the same for the text check configuration.
  // SRV-1102: the proofs of a source; a live session that is no student of the work gets 404.
  // SRV-10C: the attachments of a work; a live session that is no party to the work gets 404.
  "work.attachments.post": {
    method: "POST",
    path: `/api/v1/student/assignments/${ASSIGNMENT}/attachments`,
    body: () => ({
      imageBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY2BgYGAAAAAFAAGKM+MAAAAAAElFTkSuQmCC",
    }),
    live: 404,
  },
  "work.attachments.get": {
    method: "GET",
    path: `/api/v1/work-attachments/${randomUUID()}`,
    body: () => undefined,
    live: 404,
  },
  "work.milestones.get": {
    method: "GET",
    path: `/api/v1/works/${randomUUID()}/milestones`,
    body: () => undefined,
    live: 404,
  },
  "work.milestones.patch": {
    method: "PATCH",
    path: `/api/v1/works/${randomUUID()}/milestones/${randomUUID()}`,
    body: () => ({ dueAt: "2026-12-02T12:00:00.000Z" }),
    live: 404,
  },
  "student.source-proofs.get": {
    method: "GET",
    path: `/api/v1/student/assignments/${ASSIGNMENT}/sources/${WORK_SOURCE.id}/proofs`,
    body: () => undefined,
    live: 404,
  },
  "student.source-proofs.post": {
    path: `/api/v1/student/assignments/${ASSIGNMENT}/sources/${WORK_SOURCE.id}/proofs`,
    body: () => undefined,
    // A valid form, so the answer comes from the database and not from the input check.
    form: () => {
      const form = new FormData();
      form.append("page", "14");
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
      form.append("image", new Blob([jpeg], { type: "image/jpeg" }), "isjecak.jpg");
      return form;
    },
    live: 404,
  },
  "student.source-proof-image.get": {
    method: "GET",
    path: `/api/v1/student/assignments/${ASSIGNMENT}/sources/${WORK_SOURCE.id}/proofs/${WORK_SOURCE.id}/image`,
    body: () => undefined,
    live: 404,
  },
  "student.text-check-config.get": {
    method: "GET",
    path: `/api/v1/student/assignments/${ASSIGNMENT}/text-check-config`,
    body: () => undefined,
    live: 404,
  },
  // SRV-1107: a live session that teaches no such work gets 404 on each criteria route.
  "teacher.working-criteria.get": {
    method: "GET",
    path: "/api/v1/teacher/works/izmisljeni-rad-0001/working-criteria",
    body: () => undefined,
    live: 404,
  },
  "teacher.working-criterion.put": {
    method: "PUT",
    path: "/api/v1/teacher/works/izmisljeni-rad-0001/working-criteria/sources",
    body: () => ({ assessment: 1, note: null }),
    live: 404,
  },
  // SRV-7C: a live session that is no student of the work gets 404 on each source route.
  "student.work-sources.get": {
    method: "GET",
    path: `/api/v1/student/assignments/${ASSIGNMENT}/sources`,
    body: () => undefined,
    live: 404,
  },
  "student.work-sources.put": {
    method: "PUT",
    path: `/api/v1/student/assignments/${ASSIGNMENT}/sources/${WORK_SOURCE.id}`,
    body: () => ({ record: WORK_SOURCE }),
    live: 404,
  },
  "student.work-sources.delete": {
    method: "DELETE",
    path: `/api/v1/student/assignments/${ASSIGNMENT}/sources/${WORK_SOURCE.id}`,
    body: () => undefined,
    live: 404,
  },
  // SRV-22: a live session naming an assignment it is no student of gets 404.
  "student.submission.get": {
    method: "GET",
    path: `/api/v1/student/assignments/${randomUUID()}/submission`,
    body: () => undefined,
    live: 404,
  },
  // SRV-30: a live session that reads no work of that student gets 404 (ZD403).
  "teacher.submission-receipt.get": {
    method: "GET",
    path: `/api/v1/teacher/assignments/${randomUUID()}/students/${randomUUID()}/submission`,
    body: () => undefined,
    live: 404,
  },
  // SRV-NG: a live session naming an assignment it is no student of gets 404.
  "student.notice.get": {
    method: "GET",
    path: `/api/v1/student/assignments/${randomUUID()}/notice`,
    body: () => undefined,
    live: 404,
  },
  "student.assignment-requirements.get": {
    method: "GET",
    path: `/api/v1/student/assignments/${randomUUID()}/requirements`,
    body: () => undefined,
    live: 404,
  },
  // DAN-826-2b: a live session that is not a network engineer gets 404 and
  // writes nothing, so the accounts of this file keep no settings row.
  "settings.values.put": {
    method: "PUT",
    path: "/api/v1/settings/values",
    body: () => ({
      level: "network_security",
      course: null,
      key: "network.session_idle_minutes",
      value: 60,
      locked: false,
      min: null,
      max: null,
    }),
    live: 404,
  },
  "settings.catalogue.get": {
    method: "GET",
    path: "/api/v1/settings/catalogue",
    body: () => undefined,
    live: 200,
  },
  "settings.values.get": {
    method: "GET",
    path: "/api/v1/settings/values?level=personal",
    body: () => undefined,
    live: 200,
  },
  // DAN-851-1d2: the interface language. A live POST saves `en` for the
  // account; the old cookie's POST sends `hr`, which must never land.
  "profile.interface-locale.get": {
    method: "GET",
    path: "/api/v1/profile/interface-locale",
    body: () => undefined,
    live: 200,
  },
  "profile.interface-locale.post": {
    path: "/api/v1/profile/interface-locale",
    body: () => ({ locale: "en" }),
    live: 200,
  },
  // Ductus#2028 c.6993786629 §3.3: the signed-in account; it only reads.
  "profile.me.get": {
    method: "GET",
    path: "/api/v1/me",
    body: () => undefined,
    live: 200,
  },
  // DAN-851-2d2a: the problem report. The body is its JCS form (keys in
  // order), which the service asks for; a live report is 201 and stored.
  "support.problem-report.post": {
    path: "/api/v1/support/problem-report",
    body: () => ({
      appVersion: "1.4.0",
      browser: { family: "firefox", major: 140 },
      category: "technical",
      description: "Izmišljeni opis: gumb za spremanje ne reagira.",
      route: "/zadaci",
      syncState: "SYNCED",
    }),
    live: 201,
  },
  // DAN-852-5a: the course routes. The accounts here hold no teacher role and
  // no course, so a live session is 403 forbidden from each RPC and writes nothing.
  "institution.courses.post": {
    path: "/api/v1/institution/courses",
    body: () => ({ name: "Izmišljeni kolegij", academicYear: "2026/2027", aiPolicy: "encouraged" }),
    live: 403,
  },
  "institution.enrollment-code.post": {
    path: `/api/v1/institution/courses/${COURSE}/enrollment-code`,
    body: () => ({ validUntil: "2099-12-31T23:59:59Z" }),
    live: 403,
  },
  "institution.enrollment-code-revocation.post": {
    path: `/api/v1/institution/courses/${COURSE}/enrollment-code/revocation`,
    body: () => ({}),
    live: 403,
  },
  // Ductus#2028 (w1119o): the student and version routes on the same front.
  // The account teaches no course or assignment: each RPC refuses with 403.
  "institution.student-removal.post": {
    path: `/api/v1/institution/courses/${COURSE}/students/${STUDENT}/removal`,
    body: () => ({}),
    live: 403,
  },
  "institution.student-return.post": {
    path: `/api/v1/institution/courses/${COURSE}/students/${STUDENT}/return-permission`,
    body: () => ({}),
    live: 403,
  },
  // The work language routes: the account teaches no assignment, so 403.
  "institution.work-language.post": {
    path: `/api/v1/institution/assignments/${ASSIGNMENT}/work-language`,
    body: () => ({ expectedVersion: 1, language: "en" }),
    live: 403,
  },
  "institution.student-work-language.post": {
    path: `/api/v1/institution/assignments/${ASSIGNMENT}/students/${STUDENT}/work-language`,
    body: () => ({ language: "en" }),
    live: 403,
  },
  "institution.work-work-language.post": {
    path: `/api/v1/institution/assignments/${ASSIGNMENT}/works/izmisljeni-rad/work-language`,
    body: () => ({ language: null }),
    live: 403,
  },
  // The account mentors no work and has no visible submissions.
  "teacher.mentorships.get": {
    method: "GET",
    path: "/api/v1/teacher/mentorships",
    body: () => undefined,
    live: 200,
  },
  "teacher.mentorship.get": {
    method: "GET",
    path: `/api/v1/teacher/mentorships/${ASSIGNMENT}`,
    body: () => undefined,
    live: 404,
  },
  "teacher.submissions.get": {
    method: "GET",
    path: `/api/v1/teacher/assignments/${ASSIGNMENT}/submissions`,
    body: () => undefined,
    live: 200,
  },
  "teacher.course-students.get": {
    method: "GET",
    path: `/api/v1/teacher/courses/${ASSIGNMENT}/students`,
    body: () => undefined,
    live: 200,
  },
  "teacher.assignment-overview.get": {
    method: "GET",
    path: `/api/v1/teacher/assignments/${ASSIGNMENT}/overview`,
    body: () => undefined,
    live: 200,
  },
  // SRV-1108: a live session that teaches no such assignment gets 404.
  "teacher.deadline-extensions.get": {
    method: "GET",
    path: `/api/v1/teacher/assignments/${randomUUID()}/deadline-extensions`,
    body: () => undefined,
    live: 404,
  },
  "teacher.deadline-extension.post": {
    path: `/api/v1/teacher/assignments/${randomUUID()}/deadline-extensions`,
    body: () => ({ scope: "all", dueAt: "2030-01-01T12:00:00.000Z", reasonId: "all" }),
    live: 404,
  },
  // SRV-1109: a live session that teaches no such assignment gets 404.
  "teacher.merlin-roster.get": {
    method: "GET",
    path: `/api/v1/teacher/assignments/${randomUUID()}/merlin/roster`,
    body: () => undefined,
    live: 404,
  },
  "teacher.merlin-roster-csv.get": {
    method: "GET",
    path: `/api/v1/teacher/assignments/${randomUUID()}/merlin/csv`,
    body: () => undefined,
    live: 404,
  },
  // SRV-1110: a live session that teaches no such assignment gets 404.
  "teacher.merlin-packages.post": {
    path: `/api/v1/teacher/assignments/${randomUUID()}/merlin/packages`,
    body: () => ({ requestKey: randomUUID() }),
    live: 404,
  },
  "teacher.merlin-package.get": {
    method: "GET",
    path: `/api/v1/teacher/assignments/${randomUUID()}/merlin/packages/${randomUUID()}`,
    body: () => undefined,
    live: 404,
  },
  "teacher.merlin-package-download.get": {
    method: "GET",
    path: `/api/v1/teacher/assignments/${randomUUID()}/merlin/packages/${randomUUID()}/download`,
    body: () => undefined,
    live: 404,
  },
  // SRV-1204: no provider in production, so a live session reads ai_disabled
  // (200) and a conversation nobody owns 404.
  "student.assistant-request.post": {
    path: "/api/v1/student/assistant/requests",
    headers: { "idempotency-key": randomUUID() },
    body: () => ({
      assignmentId: randomUUID(),
      conversationId: null,
      purposeCatalogVersion: 1,
      purposeKey: "proofreading",
      paragraph: "Izmišljeni odlomak.",
    }),
    live: 200,
  },
  "student.assistant-conversation.get": {
    method: "GET",
    path: `/api/v1/student/assistant/conversations/${randomUUID()}`,
    body: () => undefined,
    live: 404,
  },
  "teacher.assignment-submissions.post": {
    path: "/api/v1/teacher/assignment-submissions",
    body: () => ({ assignmentIds: [ASSIGNMENT] }),
    live: 200,
  },
  "teacher.mentorship-requests.get": {
    method: "GET",
    path: "/api/v1/teacher/mentorship-requests",
    body: () => undefined,
    live: 200,
  },
  "teacher.mentorship-request-decision.post": {
    path: "/api/v1/teacher/mentorship-requests/decision",
    body: () => ({ requestId: ASSIGNMENT, decision: "approve" }),
    live: 403,
  },
  // Ductus#2028 (w1119o): the live view of a work the account does not own
  // or teach is the same 404 as a missing one. GET carries the protocol, PUT
  // the precondition of a first write and the exact JCS bytes of a document.
  "live.document.get": {
    method: "GET",
    path: "/api/v1/live/izmisljeni-rad-uzivo",
    body: () => undefined,
    headers: { "ductus-protocol": "1" },
    live: 404,
  },
  "live.document.put": {
    method: "PUT",
    path: "/api/v1/live/izmisljeni-rad-uzivo",
    body: () => LIVE_DOCUMENT,
    headers: { "if-none-match": "*" },
    live: 404,
  },
  // Ductus#2028 (w1119o): the notice of an assignment the account is not
  // enrolled in is refused by acknowledge_notice (403) and nothing is recorded.
  "institution.acknowledgment.post": {
    path: `/api/v1/institution/assignments/${ASSIGNMENT}/acknowledgment`,
    body: () => ({ versionNo: 1, fingerprint: "0".repeat(64) }),
    live: 403,
  },
  // DAN-840-3f1: WebAuthn. A live challenge is 200; a registration without a
  // challenge is 400 (the ceremony refuses it); an assertion of a key the
  // account does not hold is 403. The old cookie's registration carries a
  // valid ceremony (T1), so its 401 comes from the database, not the check.
  "auth.webauthn-challenge.post": {
    path: "/api/v1/auth/webauthn/challenge",
    body: () => ({ purpose: "assertion" }),
    live: 200,
  },
  "auth.webauthn-registration.post": {
    path: "/api/v1/auth/webauthn/registration",
    body: () => ({ clientDataJSON: "AA", authenticatorData: "AA", credentialId: "AA" }),
    live: 400,
  },
  "auth.webauthn-assertion.post": {
    path: "/api/v1/auth/webauthn/assertion",
    body: () => ({
      clientDataJSON: "AA",
      authenticatorData: "AA",
      credentialId: "AA",
      signature: "AA",
    }),
    live: 403,
  },
  // SRV-13: the teacher's reads. An account without the teacher role reads
  // 404 from list_teacher_courses and "denied" from the access check.
  "teacher.courses.get": {
    method: "GET",
    path: "/api/v1/teacher/courses",
    body: () => undefined,
    live: 404,
  },
  "teacher.access.get": {
    method: "GET",
    path: "/api/v1/teacher/access",
    body: () => undefined,
    live: 200,
  },
  // SRV-14: a new assignment and a next version; no role and no course, so
  // a live session is 403 from each RPC and writes nothing.
  "institution.course-assignments.post": {
    path: `/api/v1/institution/courses/${COURSE}/assignments`,
    body: () => ({
      requestKey: randomUUID(),
      ...{
        title: "Izmišljeni zadatak",
        instructions: "Izmišljene upute.",
        workType: "essay",
        opensAt: "2026-11-01T08:00:00+01:00",
        dueAt: "2027-02-28T23:59:00+01:00",
        aiPolicy: "encouraged",
        aiPurposes: [],
        evidenceProfile: "basic",
        importAllowed: false,
        wordMin: null,
        wordMax: null,
      },
    }),
    live: 403,
  },
  "sources.lookup.post": {
    path: "/api/v1/sources/lookup",
    body: () => ({ kind: "doi", identifier: "10.99999/izmisljeni" }),
    live: 503,
  },
  "institution.assignment.get": {
    method: "GET",
    path: `/api/v1/institution/assignments/${ASSIGNMENT}`,
    body: () => undefined,
    live: 404,
  },
  "institution.assignment-versions.post": {
    path: `/api/v1/institution/assignments/${COURSE}/versions`,
    body: () => ({
      expectedVersion: 1,
      ...{
        title: "Izmišljeni zadatak",
        instructions: "Izmišljene upute.",
        workType: "essay",
        opensAt: "2026-11-01T08:00:00+01:00",
        dueAt: "2027-02-28T23:59:00+01:00",
        aiPolicy: "encouraged",
        aiPurposes: [],
        evidenceProfile: "basic",
        importAllowed: false,
        wordMin: null,
        wordMax: null,
      },
    }),
    live: 403,
  },
  // SRV-15: the seminar groups; not a teacher of any course, so 403.
  "institution.course-groups.post": {
    path: `/api/v1/institution/courses/${COURSE}/groups`,
    body: () => ({ name: "Izmišljena grupa" }),
    live: 403,
  },
  "institution.course-group-teachers.post": {
    path: `/api/v1/institution/groups/${COURSE}/teachers`,
    body: () => ({ teacherId: randomUUID() }),
    live: 403,
  },
  // Not of the course team nor an administrator: 403 from course_groups.
  "institution.course-groups.get": {
    method: "GET",
    path: `/api/v1/institution/courses/${COURSE}/groups`,
    body: () => undefined,
    live: 403,
  },
  // SRV-12: the administrator's course; not an administrator, so 403.
  "institution.admin-courses.post": {
    path: "/api/v1/institution/admin/courses",
    body: () => ({
      name: "Izmišljeni kolegij",
      academicYear: "2026/2027",
      aiPolicy: "encouraged",
      holderId: randomUUID(),
      groups: [],
    }),
    live: 403,
  },
} as const;
type SessionRouteId = keyof typeof SESSION_ROUTES;
const SESSION_IDS = Object.keys(SESSION_ROUTES) as SessionRouteId[];

/** The route factories server/server.ts calls in its `routes` list, in order. */
const FACTORIES = [
  "createHealthRoute",
  "createClientContextRoute",
  "createEvidenceOpenRoute",
  "createStudentAssignmentWorkRouteFor",
  "createStudentNotesRoutesFor",
  "createWorkSourceRoutesFor",
  "createSourceProofRoutesFor",
  "createTextCheckConfigRoute",
  "createTeacherWorkingCriteriaRoutesFor",
  "createSourceLookupRouteFor",
  "createPublicVerificationRouteFor",
  "createDownloadsManifestRoute",
  "createSettingsValuesPutRoute",
  "createSettingsReadRoutes",
  "createInterfaceLocaleRoutesFor",
  "createProblemReportRouteFor",
  "createInstitutionCourseRoutesFor",
  "createInstitutionAssignmentRoutesFor",
  "createAssignmentCurrentVersionRouteFor",
  "createInstitutionGroupRoutesFor",
  "createAdminCourseRouteFor",
  "createLiveRoutesFor",
  "createCollaborationCommentsRouteFor",
  "createWorkMessagesRoutesFor",
  "createConsultationRecordRoutesFor",
  "createWorkMilestonesRoutesFor",
  "createAcknowledgmentRouteFor",
  "createWebAuthnRoutesFor",
  "createEvidenceCommitRouteFor",
  "createEvidenceReplayRouteFor",
  "createWorkVersionsRouteFor",
  "createConsultationSlotRoutesFor",
  "createAttachmentRoutesFor",
  "createSubmissionRouteFor",
  "createProcessSummaryRouteFor",
  "createProcessSummaryDetailsRouteFor",
  "createTeacherFastPathRouteFor",
  "createStudentSubmissionRoutesFor",
  "createStudentNoticeRouteFor",
  "createMeRouteFor",
  "createTeacherReadRoutesFor",
  "createTeacherRosterRoutesFor",
  "createDeadlineExtensionRoutesFor",
  "createMerlinRosterRoutesFor",
  "createMerlinPackageRoutesFor",
  "createAssistantRoutesFor",
  "createTeacherMentorshipRequestRoutesFor",
  "createInternalInstitutionRoutes",
  "createAuthRoutes",
  "routesOf",
];
const evidenceDeps = evidenceIngestDependencies(ENV, ROOT);
const MOUNTED = [
  createHealthRoute({ health: databases.health, serverVersion: "0.1.0" }),
  createClientContextRoute(),
  createEvidenceOpenRoute(databases.main),
  createStudentAssignmentWorkRouteFor(databases.main),
  ...createStudentNotesRoutesFor(databases.main),
  ...createWorkSourceRoutesFor(databases.main),
  ...createSourceProofRoutesFor(databases.main),
  createTextCheckConfigRoute(databases.main),
  ...createTeacherWorkingCriteriaRoutesFor(databases.main),
  createSourceLookupRouteFor(databases.main, ENV),
  createPublicVerificationRouteFor(databases.main),
  createDownloadsManifestRoute(),
  createSettingsValuesPutRoute({ writer: databases.main.settingsWriter }),
  ...createSettingsReadRoutes(databases.main),
  ...createInterfaceLocaleRoutesFor(databases.main),
  createProblemReportRouteFor(databases.main),
  ...createInstitutionCourseRoutesFor(databases.main),
  ...createInstitutionAssignmentRoutesFor(databases.main),
  createAssignmentCurrentVersionRouteFor(databases.main),
  ...createInstitutionGroupRoutesFor(databases.main),
  createAdminCourseRouteFor(databases.main),
  ...createLiveRoutesFor(databases.main),
  createCollaborationCommentsRouteFor(databases.main),
  ...createWorkMessagesRoutesFor(databases.main),
  ...createConsultationRecordRoutesFor(databases.main),
  ...createWorkMilestonesRoutesFor(databases.main),
  createAcknowledgmentRouteFor(databases.main),
  ...createWebAuthnRoutesFor(databases.main, ORIGIN),
  createEvidenceCommitRouteFor(databases.main, evidenceDeps),
  createEvidenceReplayRouteFor(databases.main, evidenceDeps),
  createWorkVersionsRouteFor(databases.main),
  ...createConsultationSlotRoutesFor(databases.main),
  ...createAttachmentRoutesFor(databases.main, ENV, ROOT),
  createSubmissionRouteFor(databases.main, evidenceDeps),
  createProcessSummaryRouteFor(databases.main, evidenceDeps, ENV),
  createProcessSummaryDetailsRouteFor(databases.main, evidenceDeps, ENV),
  createTeacherFastPathRouteFor(databases.main, evidenceDeps, ENV),
  ...createStudentSubmissionRoutesFor(databases.main),
  createStudentNoticeRouteFor(databases.main),
  createMeRouteFor(databases.main),
  ...createTeacherReadRoutesFor(databases.main),
  ...createTeacherRosterRoutesFor(databases.main),
  ...createDeadlineExtensionRoutesFor(databases.main),
  ...createMerlinRosterRoutesFor(databases.main),
  ...createMerlinPackageRoutesFor(databases.main),
  ...createAssistantRoutesFor(databases.main),
  ...createTeacherMentorshipRequestRoutesFor(databases.main),
  ...createInternalInstitutionRoutes({ env: ENV }),
  ...createAuthRoutes(ENV),
  ...routesOf(AREA_NAMES),
];

let accounts = 0;
/** A fresh account (at most five live sessions each) and `count` of its sessions. */
async function signIn(count: number): Promise<string[]> {
  accounts += 1;
  const tokens: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { token, tokenHash } = newSessionToken();
    const opened = await createOpenSession(auth)({
      issuer,
      subject: `sub-loc-${accounts}`,
      uniqueId: `osoba${accounts}@${homeOrg}`,
      homeOrg,
      teacherEligible: false,
      tokenHash,
    });
    if (!opened.ok) throw new Error(`openSession refused: ${opened.reason}`);
    tokens.push(token);
  }
  return tokens;
}

function post(
  path: string,
  token: string,
  body?: unknown,
  method = "POST",
  extra: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    cookie: `__Host-ductus_session=${token}`,
    ...extra,
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers["ductus-protocol"] = "1";
  }
  return fetch(`http://127.0.0.1:${server.port}${path}`, {
    method,
    headers,
    redirect: "manual",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const call = (id: SessionRouteId, token: string, body?: unknown) => {
  const route: {
    path: string;
    body: () => unknown;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    form?: () => FormData;
  } = SESSION_ROUTES[id];
  // A multipart route (SRV-1102): fetch writes the form and its content type.
  if (route.form !== undefined)
    return fetch(`http://127.0.0.1:${server.port}${route.path}`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        cookie: `__Host-ductus_session=${token}`,
      },
      body: route.form(),
    });
  return post(route.path, token, body ?? route.body(), route.method, route.headers);
};

const LOCALE = "/api/v1/profile/interface-locale";
/** The saved interface language of a session's account, read as the admin. */
const savedLocale = async (token: string) =>
  (
    await admin.query<{ locale: string }>(
      `SELECT p.interface_locale AS locale FROM identity.user_preference p
         JOIN identity.session s ON s.user_id = p.user_id
        WHERE s.token_hash = sha256(convert_to($1, 'UTF8'))`,
      [token],
    )
  ).rows.map((row) => row.locale);

/** How many problem reports a session's account has stored, read as the admin. */
const storedReports = async (token: string) =>
  Number(
    (
      await admin.query<{ n: string }>(
        `SELECT count(*) AS n FROM identity.problem_report r
           JOIN identity.session s ON s.user_id = r.user_id
          WHERE s.token_hash = sha256(convert_to($1, 'UTF8'))`,
        [token],
      )
    ).rows[0]?.n,
  );

const sessionEnd = async (token: string) =>
  (
    await admin.query<{ reason: string | null; closedAt: Date | null }>(
      `SELECT close_reason AS reason, closed_at AS "closedAt" FROM identity.session
        WHERE token_hash = sha256(convert_to($1, 'UTF8'))`,
      [token],
    )
  ).rows[0];

async function expectLive(token: string): Promise<void> {
  for (const id of SESSION_IDS)
    expect([id, (await call(id, token)).status]).toEqual([id, SESSION_ROUTES[id].live]);
}

async function expectSignedOut(answer: Response): Promise<void> {
  expect(answer.status).toBe(303);
  expect(answer.headers.getSetCookie()).toEqual([
    expect.stringMatching(/^__Host-ductus_session=;/u),
  ]);
}

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_auth', $1::text, $2::text) AS ddl",
    [AUTH_LOGIN, password],
  );
  await admin.query(ddl.rows[0]!.ddl);
  await admin.query(
    "INSERT INTO identity.institution (id, slug, aai_home_org) VALUES ($1, $2, $3)",
    [institution, `it-loc-${suffix}`, homeOrg],
  );
  await admin.query(
    "INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES ($1, $2)",
    [institution, issuer],
  );
  const url = new URL(ADMIN_URL);
  url.username = AUTH_LOGIN;
  url.password = password;
  auth = new pg.Pool({ connectionString: url.href, max: 2 });
  server = await startServer({
    host: "127.0.0.1",
    port: 0,
    layers: createLayers({ expectedOrigin: ORIGIN }),
    databases,
    routes: MOUNTED,
  });
});

afterAll(async () => {
  await server?.close();
  await databases.close();
  await auth?.end();
  // user_preference and problem_report refer to user_account, so they go first.
  for (const table of [
    "user_preference",
    "problem_report",
    "person_name",
    "teacher_eligibility",
    "session",
    "user_account",
  ]) {
    await admin.query(`DELETE FROM identity.${table} WHERE institution_id = $1`, [institution]);
  }
  await admin.query("DELETE FROM identity.institution_issuer WHERE institution_id = $1", [
    institution,
  ]);
  await admin.query("DELETE FROM identity.institution WHERE id = $1", [institution]);
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  await admin.end();
  vi.restoreAllMocks();
});

describe("the old session cookie after logout, over real PostgreSQL", () => {
  it("T5: the tested routes are every mounted route whose contract has a 401", () => {
    const entry = readFileSync(join(ROOT, "server/server.ts"), "utf8");
    const list = /\broutes:\s*\[([\s\S]*?)\n\s*\],/u.exec(entry)?.[1] ?? "";
    const code = list.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
    expect([...code.matchAll(/\b(create\w+|routesOf)\(/gu)].map((m) => m[1])).toEqual(FACTORIES);
    // The server-to-server routes of Aplication_server read no cookie: their
    // 401 is a missing or wrong bearer token, so an old cookie cannot reach them.
    const internal = (r: (typeof MOUNTED)[number]) =>
      r.contract.path.startsWith(INTERNAL_PATH_PREFIX);
    expect(MOUNTED.filter(internal).map((r) => r.contract.id)).toEqual([
      "internal.institutions.post",
      "internal.institution.get",
    ]);
    const with401 = MOUNTED.filter(
      (r) => !internal(r) && r.contract.errors.some((e) => e.status === 401),
    );
    expect(with401.map((r) => r.contract.id).sort()).toEqual([...SESSION_IDS].sort());
  });

  it("T0, T1: live before logout, then 401 of each route's contract with the old cookie", async () => {
    const [token = ""] = await signIn(1);
    await expectLive(token);
    // A registration ceremony of this session, signed before logout and sent after it.
    const issued = await post("/api/v1/auth/webauthn/challenge", token, {
      purpose: "registration",
    });
    const { challenge } = (await issued.json()) as { challenge: string };
    const made = createSoftwareAuthenticator({
      rpId: new URL(ORIGIN).hostname,
      origin: ORIGIN,
    }).register(Buffer.from(challenge, "base64url"));
    const registration = {
      clientDataJSON: made.clientDataJSON.toString("base64url"),
      authenticatorData: made.authenticatorData.toString("base64url"),
      credentialId: made.credentialId.toString("base64url"),
    };
    await expectSignedOut(await post("/api/v1/auth/logout", token));
    expect(await sessionEnd(token)).toMatchObject({ reason: "logout" });
    expect(await savedLocale(token)).toEqual(["en"]);
    expect(await storedReports(token)).toBe(1);
    for (const id of SESSION_IDS) {
      const answer = await call(
        id,
        token,
        id === "profile.interface-locale.post"
          ? { locale: "hr" }
          : id === "auth.webauthn-registration.post"
            ? registration
            : undefined,
      );
      const body: unknown = await answer.json();
      const old =
        id.startsWith("settings.") ||
        id.startsWith("profile.") ||
        id === "support.problem-report.post" ||
        id === "sources.lookup.post" ||
        id.startsWith("institution.") ||
        id.startsWith("teacher.") ||
        id.startsWith("live.") ||
        id.startsWith("collaboration.") ||
        id.startsWith("projection.") ||
        id.startsWith("student.") ||
        id.startsWith("work.") ||
        id.startsWith("auth.webauthn-")
          ? expect.objectContaining({ code: "unauthorized" })
          : EVIDENCE_401;
      expect([id, answer.status, body]).toEqual([id, 401, old]);
      const spec = MOUNTED.find((r) => r.contract.id === id)?.contract.errors.find(
        (e) => e.status === 401,
      );
      expect(Value.Check(spec?.body as never, body)).toBe(true);
    }
    expect(await savedLocale(token)).toEqual(["en"]);
    // The old cookie's report reached no row: still only the live one.
    expect(await storedReports(token)).toBe(1);
  });

  it("the interface language: POST en, then GET en for the same session; another gets null", async () => {
    const [token = ""] = await signIn(1);
    const [other = ""] = await signIn(1);
    const saved = await post(LOCALE, token, { locale: "en" });
    expect([saved.status, await saved.json()]).toEqual([200, { locale: "en" }]);
    const read = await post(LOCALE, token, undefined, "GET");
    expect([read.status, await read.json()]).toEqual([200, { locale: "en" }]);
    const elsewhere = await post(LOCALE, other, undefined, "GET");
    expect([elsewhere.status, await elsewhere.json()]).toEqual([200, { locale: null }]);
    expect(await savedLocale(other)).toEqual([]);
  });

  it("T2, T4: logout again with the old cookie changes nothing; the other session lives", async () => {
    const [old = "", other = ""] = await signIn(2);
    await expectSignedOut(await post("/api/v1/auth/logout", old));
    const before = await sessionEnd(old);
    await expectSignedOut(await post("/api/v1/auth/logout", old));
    expect(await sessionEnd(old)).toEqual(before);
    expect(await sessionEnd(other)).toMatchObject({ closedAt: null });
    await expectLive(other);
  });

  it("T3: logout-all with the old cookie signs no other device out", async () => {
    const [old = "", other = ""] = await signIn(2);
    await expectSignedOut(await post("/api/v1/auth/logout", old));
    await expectSignedOut(await post("/api/v1/auth/logout-all", old));
    expect(await sessionEnd(old)).toMatchObject({ reason: "logout" });
    expect(await sessionEnd(other)).toMatchObject({ closedAt: null, reason: null });
    await expectLive(other);
  });
});
