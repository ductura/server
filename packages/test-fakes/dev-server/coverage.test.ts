import { describe, expect, it } from "vitest";

import { ROUTE_TABLE } from "../fake-server/index.ts";
import { errorCodes, type RouteId } from "./contract.ts";
import {
  createState,
  DEV_HANDLERS,
  EMPTY_DOCUMENT,
  IDS,
  type AccountKey,
  type State,
} from "./index.ts";
import { contractProblems, evidenceSegment, send, signIn, type Sent } from "./testing.ts";

// Every route of the contract answers on the dev fake server, and the answer
// fits the contract. A route added to ROUTE_TABLE without a handler or without
// a scenario here fails this file.

type Step = Sent & { readonly path: string; readonly as?: AccountKey };
type Scenario = { readonly before?: readonly Step[]; readonly request: Step };

const ORIGIN = { origin: "http://127.0.0.1:4010", "sec-fetch-site": "same-origin" };
const EVIDENCE = { ...ORIGIN, "ductus-protocol": "1" };
const SEGMENT = evidenceSegment(createState());
const commit = (txid: string, baseRevision: number): Step => ({
  path: "/api/v1/evidence/commit",
  as: "student",
  headers: EVIDENCE,
  body: {
    documentId: IDS.document,
    clientTransactionId: txid,
    baseRevision,
    segments: [SEGMENT],
    document: EMPTY_DOCUMENT,
  },
});
const CREATE_CONSULTATION: Step = {
  path: `/api/v1/works/${IDS.document}/consultation-records`,
  as: "nastavnik",
  headers: ORIGIN,
  body: {
    heldOn: "2026-11-18",
    revision: 1,
    topic: "Izmišljena struktura rada",
    agreement: "Dodati zaključak.",
  },
};
const ANCHOR = {
  nodeId: "0a000000-0000-4000-8000-000000000001",
  quote: "Izmišljeno",
  prefix: "",
  suffix: "",
  startHint: 0,
  endHint: 10,
};
const LIVE = { nodes: [], schemaVersion: 1 };
const livePut: Step = {
  path: `/api/v1/live/${IDS.document}`,
  as: "student",
  method: "PUT",
  headers: { ...ORIGIN, "if-none-match": "*" },
  body: LIVE,
};
const createRequest: Step = {
  path: "/api/v1/revision-requests/create",
  as: "nastavnik",
  headers: ORIGIN,
  body: {
    anchor: ANCHOR,
    documentId: IDS.document,
    instruction: "Izmišljena uputa.",
    requestedRevision: 0,
  },
};
const SETTING = {
  level: "personal",
  course: null,
  key: "notifications.email",
  value: false,
  locked: false,
  min: null,
  max: null,
};
const REPORT = {
  appVersion: "1.4.0",
  browser: { family: "firefox", major: 140 },
  category: "technical",
  description: "Izmišljeni opis.",
  route: null,
  syncState: null,
};
const VERSION = {
  expectedVersion: 1,
  title: "Izmišljeni naslov",
  instructions: "Izmišljene upute.",
  workType: "seminar_paper",
  opensAt: "2026-10-01T06:00:00Z",
  dueAt: "2027-01-31T22:59:00Z",
  aiPolicy: "partially_allowed",
  aiPurposes: ["proofreading"],
  evidenceProfile: "basic",
  importAllowed: false,
  wordMin: 1500,
  wordMax: 2500,
};
const A = `/api/v1/institution/assignments/${IDS.assignment}`;
const C = `/api/v1/institution/courses/${IDS.course}`;
const STUDENT_ASSIGNMENT = `/api/v1/student/assignments/${IDS.assignment}`;
const CONSULTATION_SLOTS = `/api/v1/works/${IDS.document}/consultation-slots`;
const REQUEST_SLOT: Step = {
  path: CONSULTATION_SLOTS,
  as: "student",
  headers: ORIGIN,
  body: { startsAt: new Date(Date.now() + 86_400_000).toISOString() },
};
const NOTE: Step = {
  path: "/api/v1/student/submission-notes",
  as: "student",
  headers: ORIGIN,
  body: { assignmentId: IDS.assignment, text: "Izmišljena napomena." },
};

const WORK_SOURCE = {
  id: "00000000-0000-4000-8000-00000000c0a1",
  type: "book",
  authors: [{ kind: "person", family: "Izmišljeni", given: "Autor" }],
  year: 2019,
  title: "Izmišljena knjiga o kućnom kompostiranju",
  place: "Izmišljeni grad",
  publisher: "Izmišljena naklada",
};

const SAVE_SOURCE: Step = {
  path: `${STUDENT_ASSIGNMENT}/sources/${WORK_SOURCE.id}`,
  as: "student",
  method: "PUT",
  headers: ORIGIN,
  body: { record: WORK_SOURCE },
};

// SRV-1102: an invented JPEG excerpt in a multipart form.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const BOUNDARY = "izmisljena-granica";
const PROOF_FORM = Buffer.concat([
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="page"\r\n\r\n14\r\n`),
  Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="image"; filename="isjecak.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
  ),
  JPEG,
  Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
]);
const PROOFS = `${STUDENT_ASSIGNMENT}/sources/${WORK_SOURCE.id}/proofs`;
const ADD_PROOF: Step = {
  path: PROOFS,
  as: "student",
  method: "POST",
  headers: { ...ORIGIN, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  raw: PROOF_FORM,
};

const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString(
  "base64",
);
const ADD_ATTACHMENT: Step = {
  path: `${STUDENT_ASSIGNMENT}/attachments`,
  as: "student",
  headers: ORIGIN,
  body: { imageBase64: PNG_BASE64 },
};

const SUBMIT: Step = {
  path: "/api/v1/submission",
  as: "student",
  headers: EVIDENCE,
  body: { documentId: IDS.document, revision: 1 },
};
const SUBMIT_STEPS = [commit("izmisljena-transakcija-1", 0), SUBMIT];

const SCENARIOS: Record<RouteId, Scenario> = {
  "student.declaration.get": {
    request: { path: `/api/v1/student/assignments/${IDS.assignment}/declaration`, as: "student" },
  },
  "student.declaration.put": {
    before: [commit("c0000000-0000-4000-8000-000000000197", 0)],
    request: {
      path: `/api/v1/student/assignments/${IDS.assignment}/declaration`,
      as: "student",
      method: "PUT",
      headers: ORIGIN,
      body: {
        baseVersion: 0,
        revision: 1,
        form: { formId: "test-izjava", formVersion: 1, formSha256: "a".repeat(64) },
        ownWork: { confirmed: false },
        humanHelp: { received: false, entries: [] },
        ai: { use: null, declaredTools: [], attachments: [], externalAttachmentIds: [] },
        confirm: false,
      },
    },
  },
  "student.declaration-attachments.post": {
    request: {
      path: `/api/v1/student/assignments/${IDS.assignment}/declaration-attachments`,
      as: "student",
      method: "POST",
      headers: { ...ORIGIN, "content-type": "text/plain" },
      raw: "Izmišljeni ispis",
    },
  },
  "student.assistant-request.post": {
    request: {
      path: "/api/v1/student/assistant/requests",
      as: "student",
      headers: { ...ORIGIN, "idempotency-key": "5f0c3a9e-2b7d-4c1e-9a6f-0d8e7b4c2a11" },
      body: {
        assignmentId: IDS.assignment,
        conversationId: null,
        purposeCatalogVersion: 1,
        purposeKey: "proofreading",
        paragraph: "Izmišljeni odlomak o vodenim mlinovima.",
      },
    },
  },
  "student.assistant-conversation.get": {
    request: {
      path: "/api/v1/student/assistant/conversations/00000000-0000-4000-8000-0000000000c1",
      as: "student",
    },
  },
  "work.consultation-slots.get": {
    before: [REQUEST_SLOT],
    request: { path: CONSULTATION_SLOTS, as: "nastavnik" },
  },
  "work.consultation-slots.post": { request: REQUEST_SLOT },
  "work.consultation-slots.patch": {
    before: [REQUEST_SLOT],
    request: {
      path: `${CONSULTATION_SLOTS}/c0200000-0000-4000-8000-000000000001`,
      as: "nastavnik",
      method: "PATCH",
      headers: ORIGIN,
      body: { action: "confirm" },
    },
  },
  "auth.backchannel-logout.post": {
    request: {
      path: "/api/v1/auth/backchannel-logout",
      body: "logout_token=izmisljeni",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    },
  },
  "auth.callback.get": { request: { path: "/api/v1/auth/callback" } },
  "auth.login.get": { request: { path: "/api/v1/auth/login" } },
  "auth.logout-all.post": {
    request: { path: "/api/v1/auth/logout-all", as: "student", method: "POST" },
  },
  "auth.logout.post": { request: { path: "/api/v1/auth/logout", as: "student", method: "POST" } },
  "auth.webauthn-assertion.post": {
    request: {
      path: "/api/v1/auth/webauthn/assertion",
      as: "student",
      body: { authenticatorData: "AA", clientDataJSON: "AA", credentialId: "AA", signature: "AA" },
    },
  },
  "auth.webauthn-challenge.post": {
    request: {
      path: "/api/v1/auth/webauthn/challenge",
      as: "student",
      body: { purpose: "registration" },
    },
  },
  "auth.webauthn-registration.post": {
    request: {
      path: "/api/v1/auth/webauthn/registration",
      as: "student",
      body: { authenticatorData: "AA", clientDataJSON: "AA", credentialId: "AA" },
    },
  },
  "public.verification.post": {
    request: {
      path: "/api/v1/public/verification",
      body: {
        submissionId: "00000000-0000-4000-8000-00000000c0de",
        artifactSha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      },
    },
  },
  "client.context.post": {
    request: {
      path: "/api/v1/client-context",
      body: {
        app: "web",
        appVersion: "1.0.0",
        browser: "firefox",
        device: "desktop",
        os: "linux",
        screen: "expanded",
      },
    },
  },
  "collaboration.comments.post": {
    before: [
      {
        path: "/api/v1/comments/create",
        as: "nastavnik",
        body: { anchor: ANCHOR, body: "Izmišljeni komentar.", documentId: IDS.document },
      },
    ],
    request: { path: "/api/v1/comments/list", as: "student", body: { documentId: IDS.document } },
  },
  "collaboration.revision-requests.post": {
    before: [createRequest],
    request: {
      path: "/api/v1/revision-requests/list",
      as: "student",
      body: { documentId: IDS.document },
    },
  },
  "downloads.manifest.get": { request: { path: "/api/v1/downloads/manifest" } },
  "evidence.commit.post": { request: commit("izmisljena-transakcija-1", 0) },
  "evidence.open.post": {
    request: {
      path: "/api/v1/evidence/open",
      as: "student",
      headers: EVIDENCE,
      body: { assignmentId: IDS.assignment },
    },
  },
  "evidence.replay.post": {
    before: [commit("izmisljena-transakcija-1", 0)],
    request: {
      path: "/api/v1/evidence/replay",
      as: "nastavnik",
      headers: EVIDENCE,
      body: { documentId: IDS.document, from: 0 },
    },
  },
  "institution.assignment.get": { request: { path: A, as: "nastavnik" } },
  "institution.enrollment-code-state.get": {
    request: {
      path: `${C}/enrollment-code/state`,
      as: "nastavnik",
    },
  },
  "institution.acknowledgment.post": {
    request: {
      path: `${A}/acknowledgment`,
      as: "student",
      body: { versionNo: 1, fingerprint: "0".repeat(64) },
    },
  },
  "institution.assignment-versions.post": {
    request: { path: `${A}/versions`, as: "nastavnik", body: VERSION },
  },
  "institution.admin-courses.post": {
    request: {
      path: "/api/v1/institution/admin/courses",
      as: "administrator",
      body: {
        name: "Izmišljeni kolegij administratorice",
        academicYear: "2026/2027",
        aiPolicy: "prohibited",
        holderId: IDS.teacher2,
        groups: ["Grupa A"],
      },
    },
  },
  "institution.course-assignments.post": {
    request: {
      path: `${C}/assignments`,
      as: "nastavnik",
      body: (({ expectedVersion: _v, ...content }) => ({
        requestKey: "b15e6f70-8192-4da4-8eb5-f60718293a05",
        ...content,
      }))(VERSION),
    },
  },
  "institution.course-group-teachers.post": {
    request: {
      path: `/api/v1/institution/groups/${IDS.groupA}/teachers`,
      as: "nastavnik",
      body: { teacherId: IDS.teacher2 },
    },
  },
  "institution.course-groups.get": { request: { path: `${C}/groups`, as: "nastavnik" } },
  "institution.course-groups.post": {
    request: { path: `${C}/groups`, as: "nastavnik", body: { name: "Grupa C" } },
  },
  "institution.courses.post": {
    request: {
      path: "/api/v1/institution/courses",
      as: "nastavnik",
      body: { name: "Izmišljeni kolegij", academicYear: "2026/2027", aiPolicy: "encouraged" },
    },
  },
  "institution.enrollment-code-revocation.post": {
    request: { path: `${C}/enrollment-code/revocation`, as: "nastavnik", body: {} },
  },
  "institution.enrollment-code.post": {
    request: {
      path: `${C}/enrollment-code`,
      as: "nastavnik",
      body: { validUntil: "2027-06-30T21:59:00Z" },
    },
  },
  "institution.enrollments.post": {
    request: {
      path: "/api/v1/institution/enrollments",
      as: "student-2",
      body: { code: "UPIS2026DEMO" },
    },
  },
  "institution.role-confirmation.post": {
    request: {
      path: `/api/v1/institution/teachers/${IDS.noRole}/role-confirmation`,
      as: "administrator",
      body: {},
    },
  },
  "institution.role-revocation.post": {
    request: {
      path: `/api/v1/institution/teachers/${IDS.teacher2}/role-revocation`,
      as: "administrator",
      body: {},
    },
  },
  "institution.student-removal.post": {
    request: { path: `${C}/students/${IDS.student}/removal`, as: "nastavnik", body: {} },
  },
  "institution.student-return.post": {
    request: { path: `${C}/students/${IDS.student}/return-permission`, as: "nastavnik", body: {} },
  },
  "institution.student-work-language.post": {
    request: {
      path: `${A}/students/${IDS.student}/work-language`,
      as: "nastavnik",
      body: { language: "en" },
    },
  },
  "institution.work-language.post": {
    request: {
      path: `${A}/work-language`,
      as: "nastavnik",
      body: { expectedVersion: 1, language: "en" },
    },
  },
  "institution.work-work-language.post": {
    request: {
      path: `${A}/works/${IDS.document}/work-language`,
      as: "nastavnik",
      body: { language: null },
    },
  },
  "live.document.get": {
    before: [livePut],
    request: {
      path: `/api/v1/live/${IDS.document}`,
      as: "nastavnik",
      headers: { "ductus-protocol": "1" },
    },
  },
  "live.document.put": { request: livePut },
  "platform.health.get": { request: { path: "/api/v1/health" } },
  "platform.ready.get": { request: { path: "/api/v1/ready" } },
  "platform.status.get": { request: { path: "/api/v1/status" } },
  "profile.interface-locale.get": {
    request: { path: "/api/v1/profile/interface-locale", as: "student" },
  },
  "profile.interface-locale.post": {
    request: { path: "/api/v1/profile/interface-locale", as: "student", body: { locale: "en" } },
  },
  "profile.me.get": { request: { path: "/api/v1/me", as: "administrator" } },
  "projection.process-summary.post": {
    request: {
      path: "/api/v1/process-summary",
      as: "nastavnik",
      body: { documentId: IDS.document },
    },
  },
  "projection.process-summary-details.post": {
    request: {
      path: "/api/v1/process-summary/details",
      as: "nastavnik",
      body: { documentId: IDS.document },
    },
  },
  "settings.catalogue.get": { request: { path: "/api/v1/settings/catalogue", as: "student" } },
  "settings.values.get": {
    request: {
      path: "/api/v1/settings/values",
      as: "nastavnik",
      query: `?level=course&course=${IDS.course}`,
    },
  },
  "settings.values.put": {
    request: { path: "/api/v1/settings/values", as: "student", method: "PUT", body: SETTING },
  },
  "sources.lookup.post": {
    request: {
      path: "/api/v1/sources/lookup",
      as: "student",
      body: { kind: "doi", identifier: "10.99999/izmisljeni" },
    },
  },
  "student.access-log.get": {
    request: { path: `/api/v1/student/works/${IDS.document}/access-log`, as: "student" },
  },
  "student.assignment-requirements.get": {
    request: { path: `${STUDENT_ASSIGNMENT}/requirements`, as: "student" },
  },
  "student.assignment-work.get": {
    request: { path: "/api/v1/student/assignment-work", as: "student" },
  },
  "student.assignments.get": { request: { path: "/api/v1/student/assignments", as: "student" } },
  "student.enrollments.post": {
    request: {
      path: "/api/v1/student/enrollments",
      as: "student-2",
      body: { code: "UPIS2026DEMO" },
    },
  },
  "student.notice.get": {
    request: { path: `${A.replace("/institution/", "/student/")}/notice`, as: "student" },
  },
  "student.notice-read.post": {
    request: {
      path: `${A.replace("/institution/", "/student/")}/notice-read`,
      as: "student",
      body: { versionNo: 1 },
    },
  },
  "student.submission.get": {
    request: { path: `${STUDENT_ASSIGNMENT}/submission`, as: "student" },
  },
  "student.receipt-pdf.get": {
    before: SUBMIT_STEPS,
    request: { path: `${STUDENT_ASSIGNMENT}/submission/pdf`, as: "student" },
  },
  "student.submission-notes.get": {
    before: [NOTE],
    request: { path: `${STUDENT_ASSIGNMENT}/submission-notes`, as: "student" },
  },
  "student.submission-notes.post": { request: NOTE },
  "student.text-check-config.get": {
    request: { path: `${STUDENT_ASSIGNMENT}/text-check-config`, as: "student" },
  },
  "work.attachments.post": { request: ADD_ATTACHMENT },
  "work.attachments.get": {
    before: [ADD_ATTACHMENT],
    request: {
      path: "/api/v1/work-attachments/00000000-0000-4000-8000-a00000000001",
      as: "student",
    },
  },
  "student.source-proofs.get": {
    before: [SAVE_SOURCE, ADD_PROOF],
    request: { path: PROOFS, as: "student" },
  },
  "student.source-proofs.post": { before: [SAVE_SOURCE], request: ADD_PROOF },
  "student.source-proof-image.get": {
    before: [SAVE_SOURCE, ADD_PROOF],
    request: { path: `${PROOFS}/00000000-0000-4000-8000-d00000000001/image`, as: "student" },
  },
  "student.work-sources.get": {
    request: { path: `${STUDENT_ASSIGNMENT}/sources`, as: "student" },
  },
  "student.work-sources.put": { request: SAVE_SOURCE },
  "student.work-sources.delete": {
    before: [SAVE_SOURCE],
    request: {
      path: `${STUDENT_ASSIGNMENT}/sources/${WORK_SOURCE.id}`,
      as: "student",
      method: "DELETE",
      headers: ORIGIN,
    },
  },
  "submission.submit.post": {
    before: [commit("izmisljena-transakcija-1", 0)],
    request: SUBMIT,
  },
  "support.problem-report.post": {
    request: { path: "/api/v1/support/problem-report", as: "student", body: REPORT },
  },
  "teacher.access.get": { request: { path: "/api/v1/teacher/access", as: "nastavnik" } },
  "work.milestones.get": {
    request: { path: `/api/v1/works/${IDS.document}/milestones`, as: "student" },
  },
  "work.milestones.patch": {
    request: {
      method: "PATCH",
      path: `/api/v1/works/${IDS.document}/milestones/${IDS.milestone}`,
      as: "nastavnik",
      headers: ORIGIN,
      body: { dueAt: "2026-12-03T15:30:00Z" },
    },
  },
  "work.consultation-records.get": {
    before: [commit("izmisljena-transakcija-1", 0), CREATE_CONSULTATION],
    request: { path: `/api/v1/works/${IDS.document}/consultation-records`, as: "student" },
  },
  "work.consultation-records.post": {
    before: [commit("izmisljena-transakcija-1", 0)],
    request: { ...CREATE_CONSULTATION, as: "nastavnik" },
  },
  "work.consultation-additions.post": {
    before: [commit("izmisljena-transakcija-1", 0), CREATE_CONSULTATION],
    request: {
      path: `/api/v1/works/${IDS.document}/consultation-records/000000c0-0000-4000-8000-000000000001/additions`,
      as: "nastavnik",
      headers: ORIGIN,
      body: { text: "Izmišljena dopuna." },
    },
  },
  "work.versions.get": {
    before: [commit("izmisljena-transakcija-1", 0)],
    request: { path: `/api/v1/works/${IDS.document}/versions`, as: "nastavnik" },
  },
  "work.messages.get": {
    before: [
      {
        path: `/api/v1/works/${IDS.document}/messages`,
        as: "student",
        body: { text: "Izmišljena poruka." },
      },
    ],
    request: { path: `/api/v1/works/${IDS.document}/messages`, as: "nastavnik" },
  },
  "work.messages.post": {
    request: {
      path: `/api/v1/works/${IDS.document}/messages`,
      as: "student",
      body: { text: "Izmišljena poruka." },
    },
  },
  "teacher.assignment-submissions.post": {
    request: {
      path: "/api/v1/teacher/assignment-submissions",
      as: "nastavnik",
      body: { assignmentIds: [IDS.assignment] },
    },
  },
  "teacher.courses.get": { request: { path: "/api/v1/teacher/courses", as: "nastavnik-2" } },
  "teacher.fast-path.post": {
    request: {
      path: "/api/v1/teacher/fast-path",
      as: "nastavnik",
      body: { assignmentId: IDS.assignment },
    },
  },
  "teacher.working-criteria.get": {
    request: { path: `/api/v1/teacher/works/${IDS.document}/working-criteria`, as: "nastavnik" },
  },
  "teacher.working-criterion.put": {
    request: {
      path: `/api/v1/teacher/works/${IDS.document}/working-criteria/sources`,
      as: "nastavnik",
      method: "PUT",
      headers: ORIGIN,
      body: { assessment: 1, note: "Izmišljena napomena." },
    },
  },
  "teacher.mentorship.get": {
    request: { path: `/api/v1/teacher/mentorships/${IDS.mentorship}`, as: "nastavnik" },
  },
  "teacher.mentorships.get": { request: { path: "/api/v1/teacher/mentorships", as: "nastavnik" } },
  "teacher.submissions.get": {
    before: SUBMIT_STEPS,
    request: { path: `/api/v1/teacher/assignments/${IDS.assignment}/submissions`, as: "nastavnik" },
  },
  "teacher.receipt-pdf.get": {
    before: SUBMIT_STEPS,
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/submissions/${IDS.student}/pdf`,
      as: "nastavnik",
    },
  },
  "teacher.course-students.get": {
    request: { path: `/api/v1/teacher/courses/${IDS.course}/students`, as: "nastavnik" },
  },
  "teacher.assignment-overview.get": {
    before: SUBMIT_STEPS,
    request: { path: `/api/v1/teacher/assignments/${IDS.assignment}/overview`, as: "nastavnik" },
  },
  "teacher.submission-receipt.get": {
    before: SUBMIT_STEPS,
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/students/${IDS.student}/submission`,
      as: "nastavnik",
    },
  },
  "teacher.mentorship-requests.get": {
    request: { path: "/api/v1/teacher/mentorship-requests", as: "nastavnik" },
  },
  "teacher.mentorship-request-decision.post": {
    request: {
      path: "/api/v1/teacher/mentorship-requests/decision",
      as: "nastavnik",
      body: { requestId: IDS.mentorship, decision: "approve" },
    },
  },
  "teacher.deadline-extensions.get": {
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/deadline-extensions`,
      as: "nastavnik",
      method: "GET",
    },
  },
  "teacher.deadline-extension.post": {
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/deadline-extensions`,
      as: "nastavnik",
      body: { scope: "all", dueAt: "2030-01-01T12:00:00.000Z", reasonId: "all" },
    },
  },
  "teacher.merlin-roster.get": {
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/merlin/roster`,
      as: "nastavnik",
      method: "GET",
    },
  },
  "teacher.merlin-roster-csv.get": {
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/merlin/csv`,
      as: "nastavnik",
      method: "GET",
    },
  },
  "teacher.merlin-packages.post": {
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/merlin/packages`,
      as: "nastavnik",
      body: { requestKey: "4b1e2c3d-0000-4000-8000-00000000aaa1" },
    },
  },
  "teacher.merlin-package.get": {
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/merlin/packages/00000000-0000-4000-8000-0000000000b1`,
      as: "nastavnik",
      method: "GET",
    },
  },
  "teacher.merlin-package-download.get": {
    request: {
      path: `/api/v1/teacher/assignments/${IDS.assignment}/merlin/packages/00000000-0000-4000-8000-0000000000b1/download`,
      as: "nastavnik",
      method: "GET",
    },
  },
};

async function run(state: State, step: Step) {
  const session = step.as === undefined ? {} : await signIn(state, step.as);
  const raw = typeof step.body === "string";
  return send(state, step.path, {
    ...step,
    ...(raw ? { body: undefined, raw: step.body as string } : {}),
    method: step.method ?? (step.body === undefined ? ROUTE_TABLE[routeOf(step)].method : "POST"),
    headers: { ...session, ...step.headers },
  });
}

function routeOf(step: Step): RouteId {
  const found = (Object.keys(ROUTE_TABLE) as RouteId[]).find((id) => {
    const pattern = new RegExp("^" + ROUTE_TABLE[id].path.replace(/\{\w+\}/g, "[^/]+") + "$");
    return pattern.test(step.path);
  });
  return found ?? "platform.health.get";
}

const ROUTES = Object.keys(ROUTE_TABLE) as RouteId[];

describe("dev fake server covers the whole contract", () => {
  it("refuses a work source whose record lacks its fields, and stores nothing", async () => {
    const state = createState();
    const step = { ...SAVE_SOURCE, body: { record: { id: WORK_SOURCE.id } } };
    expect((await run(state, step)).status).toBe(422);
    const read = SCENARIOS["student.work-sources.get"].request;
    expect(JSON.parse((await run(state, read)).body)).toEqual({ sources: [] });
  });

  it("takes a note with the CR LF line breaks of a form and drops the proofs of a removed source", async () => {
    const state = createState();
    expect((await run(state, SAVE_SOURCE)).status).toBe(200);
    const note = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="note"\r\n\r\nprvi\r\ndrugi\r\n`,
    );
    const added = await run(state, { ...ADD_PROOF, raw: Buffer.concat([note, PROOF_FORM]) });
    expect(added.status).toBe(201);
    expect(JSON.parse(added.body)).toMatchObject({ page: "14", note: "prvi\ndrugi" });
    const remove: Step = {
      path: SAVE_SOURCE.path,
      as: "student",
      method: "DELETE",
      headers: ORIGIN,
    };
    expect((await run(state, remove)).status).toBe(204);
    expect(state.sourceProofs).toEqual([]);
    expect((await run(state, SAVE_SOURCE)).status).toBe(200);
    const read = await run(state, { path: PROOFS, as: "student" });
    expect(JSON.parse(read.body)).toEqual({ proofs: [] });
  });

  it("never gives a new proof the id of one that still exists after a source is removed", async () => {
    const state = createState();
    const other = { ...WORK_SOURCE, id: "00000000-0000-4000-8000-00000000c0a2" };
    const saveOther: Step = {
      ...SAVE_SOURCE,
      path: `${STUDENT_ASSIGNMENT}/sources/${other.id}`,
      body: { record: other },
    };
    const addOther: Step = {
      ...ADD_PROOF,
      path: `${STUDENT_ASSIGNMENT}/sources/${other.id}/proofs`,
    };
    for (const step of [SAVE_SOURCE, saveOther, ADD_PROOF, addOther])
      expect((await run(state, step)).status).toBeLessThan(300);
    const remove: Step = {
      path: SAVE_SOURCE.path,
      as: "student",
      method: "DELETE",
      headers: ORIGIN,
    };
    expect((await run(state, remove)).status).toBe(204);
    expect((await run(state, addOther)).status).toBe(201);
    const ids = state.sourceProofs.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a handler and a scenario for every route of ROUTE_TABLE, and nothing else", () => {
    expect(Object.keys(DEV_HANDLERS).sort()).toEqual([...ROUTES].sort());
    expect(ROUTES.filter((route) => typeof DEV_HANDLERS[route] !== "function")).toEqual([]);
    expect(Object.keys(SCENARIOS).sort()).toEqual([...ROUTES].sort());
  });

  it.each(ROUTES)("%s answers (not 501) and the answer fits the contract", async (route) => {
    const state = createState();
    const scenario = SCENARIOS[route];
    for (const step of scenario.before ?? [])
      expect((await run(state, step)).status).toBeLessThan(300);
    const answer = await run(state, scenario.request);
    expect(answer.status, answer.body).not.toBe(501);
    expect(answer.status, answer.body).toBeLessThan(400);
    expect(contractProblems(route, answer)).toEqual([]);
  });

  it.each(ROUTES)("%s answers every contract error it may be asked for", async (route) => {
    for (const code of errorCodes(route)) {
      const answer = await send(createState(), ROUTE_TABLE[route].path, {
        method: ROUTE_TABLE[route].method,
        headers: { "x-lazni-greska": code },
      });
      expect(contractProblems(route, answer, code), code).toEqual([]);
    }
  });
});

it("shares the changed milestone deadline and refuses changes after submission", async () => {
  const state = createState();
  const read = SCENARIOS["work.milestones.get"].request;
  const change = SCENARIOS["work.milestones.patch"].request;
  expect((await run(state, { ...read, as: "student-2" })).status).toBe(404);
  expect((await run(state, { ...change, as: "student" })).status).toBe(403);

  const updated = await run(state, change);
  expect(updated.status).toBe(200);
  expect(updated.json).toMatchObject({ id: IDS.milestone, dueAt: "2026-12-03T15:30:00.000Z" });
  for (const as of ["student", "nastavnik"] as const) {
    expect((await run(state, { ...read, as })).json).toEqual({ milestones: [updated.json] });
  }

  const submit = SCENARIOS["submission.submit.post"];
  for (const step of submit.before ?? []) expect((await run(state, step)).status).toBe(200);
  expect((await run(state, submit.request)).status).toBe(200);
  expect((await run(state, { ...change, body: { dueAt: "2026-12-04T12:00:00Z" } })).status).toBe(
    409,
  );
  expect((await run(state, read)).json).toEqual({ milestones: [updated.json] });
});

describe("student submission on the dev fake server", () => {
  it("reads the exact receipt returned by submission", async () => {
    const state = createState();
    const read = SCENARIOS["student.submission.get"].request;
    expect(JSON.parse((await run(state, read)).body)).toEqual({ state: "none" });
    const submit = SCENARIOS["submission.submit.post"];
    for (const step of submit.before ?? []) expect((await run(state, step)).status).toBe(200);
    const submitted = await run(state, submit.request);
    expect(submitted.status).toBe(200);
    const confirmed = await run(state, read);
    expect(confirmed.status).toBe(200);
    expect(JSON.parse(confirmed.body)).toEqual({
      state: "potvrdeno",
      receipt: JSON.parse(submitted.body).receipt,
    });
    expect((await run(state, { ...read, as: "student-2" })).status).toBe(404);
  });

  it("shows a recorded submission awaiting a receipt", async () => {
    const state = createState();
    const work = state.works[0]!;
    work.submittedAt = "2026-11-20T10:00:00.125Z";
    work.revision = 1;
    const answer = await run(state, SCENARIOS["student.submission.get"].request);
    expect(contractProblems("student.submission.get", answer)).toEqual([]);
    expect(JSON.parse(answer.body)).toEqual({
      state: "ceka",
      revision: 1,
      requestedAt: "2026-11-20T10:00:00.125000Z",
    });
  });

  it("keeps notes append-only and private to the student", async () => {
    const state = createState();
    const read = SCENARIOS["student.submission-notes.get"].request;
    expect(JSON.parse((await run(state, read)).body)).toEqual({ notes: [] });
    const other = await run(state, { ...NOTE, as: "student-2" });
    expect(other.status).toBe(404);
    const added = await run(state, NOTE);
    expect(added.status).toBe(201);
    expect(JSON.parse((await run(state, read)).body)).toEqual({ notes: [JSON.parse(added.body)] });
    expect((await run(state, { ...read, as: "student-2" })).status).toBe(404);
  });
});
