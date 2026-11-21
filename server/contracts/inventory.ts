// Copy of the route inventory the server takes over: Ductus
// docs/backend/server-route-inventory.md at main d52a92c (DAN-714, 38 route.ts).
// A contract route outside this list, or a file here with neither a contract nor
// a place in PENDING, fails server/contracts/contracts.test.ts.
import type { Method } from "./schema/index.ts";

export const INVENTORY_SOURCE =
  "danielrisavi77-create/Ductus@d52a92c:docs/backend/server-route-inventory.md";

export const INVENTORY: Readonly<Record<string, readonly Method[]>> = {
  "app/api/[...path]/route.ts": ["GET", "POST", "PUT", "PATCH", "DELETE"],
  "app/api/auth/backchannel-logout/route.ts": ["POST"],
  "app/api/auth/callback/route.ts": ["GET"],
  "app/api/auth/login/route.ts": ["GET"],
  "app/api/auth/logout-all/route.ts": ["POST"],
  "app/api/auth/logout/route.ts": ["POST"],
  "app/api/comments/[action]/route.ts": ["POST"],
  "app/api/evidence/commit/route.ts": ["POST"],
  "app/api/evidence/open/route.ts": ["POST"],
  "app/api/evidence/replay/route.ts": ["POST"],
  "app/api/health/route.ts": ["GET"],
  "app/api/institution/assignments/[assignmentId]/acknowledgment/route.ts": ["POST"],
  "app/api/institution/assignments/[assignmentId]/students/[studentId]/work-language/route.ts": [
    "POST",
  ],
  "app/api/institution/assignments/[assignmentId]/versions/route.ts": ["POST"],
  "app/api/institution/assignments/[assignmentId]/work-language/route.ts": ["POST"],
  "app/api/institution/assignments/[assignmentId]/works/[documentId]/work-language/route.ts": [
    "POST",
  ],
  "app/api/institution/courses/[courseId]/assignments/route.ts": ["POST"],
  "app/api/institution/courses/[courseId]/enrollment-code/revocation/route.ts": ["POST"],
  "app/api/institution/courses/[courseId]/enrollment-code/route.ts": ["POST"],
  "app/api/institution/courses/[courseId]/students/[studentId]/removal/route.ts": ["POST"],
  "app/api/institution/courses/[courseId]/students/[studentId]/return-permission/route.ts": [
    "POST",
  ],
  "app/api/institution/courses/route.ts": ["POST"],
  "app/api/institution/enrollments/route.ts": ["POST"],
  "app/api/institution/teachers/[teacherId]/role-confirmation/route.ts": ["POST"],
  "app/api/institution/teachers/[teacherId]/role-revocation/route.ts": ["POST"],
  "app/api/live/[documentId]/route.ts": ["GET", "PUT"],
  "app/api/process-summary/route.ts": ["POST"],
  "app/api/profile/interface-locale/route.ts": ["GET", "POST"],
  "app/api/ready/route.ts": ["GET"],
  "app/api/revision-requests/[action]/route.ts": ["POST"],
  "app/api/status/route.ts": ["GET"],
  "app/api/submission/route.ts": ["POST"],
  "app/api/support/problem-report/route.ts": ["POST"],
  "app/api/teacher/assignments/[assignmentId]/submissions/route.ts": ["GET"],
  "app/api/teacher/courses/route.ts": ["GET"],
  "app/api/teacher/fast-path/route.ts": ["POST"],
  "app/api/teacher/mentorships/[mentorshipId]/route.ts": ["GET"],
  "app/api/teacher/mentorships/route.ts": ["GET"],
};

/**
 * Routes born on the server (DAN-803, Ductus#1836 c.6905207008 t. 0.2): Ductus
 * serves the data from a file that is not a route.ts, so the route has no row
 * in INVENTORY, which stays a copy of the 38 files. The key is the route.ts it
 * would be (pathOf gives its path), `source` the Ductus file of its shape.
 */
const WEBAUTHN_SOURCE = "danielrisavi77-create/Ductus@b36c82b:docs/DECISIONS.md#D-297";

const STUDENT_SUBMISSION_SOURCE = "danielrisavi77-create/Ductus#2028:issuecomment-7009405737";

export const SERVER_SOURCES: Readonly<
  Record<string, { readonly methods: readonly Method[]; readonly source: string }>
> = {
  "app/api/student/assistant/requests/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2052:issuecomment-7056107180",
  },
  "app/api/student/assistant/conversations/[conversationId]/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2052:issuecomment-7056107180",
  },
  "app/api/works/[documentId]/consultation-slots/route.ts": {
    methods: ["GET", "POST"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7044073682",
  },
  "app/api/works/[documentId]/consultation-slots/[slotId]/route.ts": {
    methods: ["PATCH"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7044073682",
  },
  "app/api/process-summary/details/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7041269693",
  },
  "app/api/student/assignments/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus@078c780:src/components/student/my-assignments-read.ts",
  },
  // DAN-806 (c.6906291102): Ductus has no settings route; the shape is D-298.
  "app/api/settings/catalogue/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus@078c780:docs/DECISIONS.md#D-298",
  },
  // DAN-846: Ductus has no client context route; the shape is D-300.
  "app/api/client-context/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus@333e163:docs/DECISIONS.md#D-300",
  },
  // DAN-840: Ductus has no WebAuthn route; the network engineer signs in with
  // AAI@EduHr and FIDO2 (D-297), the second factor of an AAI@EduHr session.
  "app/api/auth/webauthn/challenge/route.ts": { methods: ["POST"], source: WEBAUTHN_SOURCE },
  "app/api/auth/webauthn/registration/route.ts": { methods: ["POST"], source: WEBAUTHN_SOURCE },
  "app/api/auth/webauthn/assertion/route.ts": { methods: ["POST"], source: WEBAUTHN_SOURCE },
  // DAN-903-1: Ductus reads it in its teacher page, not in a route.
  "app/api/teacher/assignment-submissions/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus@4eaa776:src/server/evidence/assignment-submissions.ts",
  },
  // DAN-903-2: Ductus reads it in its teacher pages, not in a route.
  "app/api/teacher/access/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus@4eaa776:src/components/teacher/teacher-access.ts",
  },
  // DAN-904: Ductus reads it in its page app/rad/[assignmentId]/dnevnik-pristupa;
  // the route names the work by documentId, as the port server/database/my-access-log.ts.
  "app/api/student/works/[documentId]/access-log/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus@4eaa776:src/server/privacy/my-access-log-pages.ts",
  },
  // DAN-989-1: Ductus has no work state per assignment; the set of
  // assignments is that of my-assignments-read.ts.
  "app/api/student/assignment-work/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus@9c45857:src/components/student/my-assignments-read.ts",
  },
  // DAN-931: Ductus has no download route; the place is D-306 t. 1.
  "app/api/downloads/manifest/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus@9c45857:docs/DECISIONS.md#D-306",
  },
  "app/api/student/assignments/[assignmentId]/submission/pdf/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7041269693",
  },
  "app/api/teacher/assignments/[assignmentId]/submissions/[studentId]/pdf/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7041269693",
  },
  // Ductus#2028 c.6993786629 §3.3: Ductus reads the account in its pages; the
  // front of the institution asks for it after the AAI@EduHr login.
  "app/api/me/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-6993786629",
  },
  // SRV-02 (Ductus#2028 c.7008147932, A-2): the outcomes of enrolment told apart.
  "app/api/student/enrollments/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7008147932",
  },
  // SRV-02 (Ductus#2028 c.7008147932, PO-7): Ductus has no record of reading a notice.
  "app/api/student/assignments/[assignmentId]/notice-read/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7008147932",
  },
  "app/api/student/assignments/[assignmentId]/submission/route.ts": {
    methods: ["GET"],
    source: STUDENT_SUBMISSION_SOURCE,
  },
  "app/api/student/assignments/[assignmentId]/requirements/route.ts": {
    methods: ["GET"],
    source: STUDENT_SUBMISSION_SOURCE,
  },
  "app/api/student/assignments/[assignmentId]/submission-notes/route.ts": {
    methods: ["GET"],
    source: STUDENT_SUBMISSION_SOURCE,
  },
  "app/api/student/submission-notes/route.ts": {
    methods: ["POST"],
    source: STUDENT_SUBMISSION_SOURCE,
  },
  // SRV-7C (Ductus#2028, wave 7): the work's source list; Ductus has no such routes.
  "app/api/student/assignments/[assignmentId]/sources/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7037456743",
  },
  "app/api/student/assignments/[assignmentId]/sources/[sourceId]/route.ts": {
    methods: ["PUT", "DELETE"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7037456743",
  },
  // SRV-1102 (Ductus#2051, Val 11, E§3.4 proofs, B-8): excerpts attached to a source; Ductus has no such routes.
  "app/api/student/assignments/[assignmentId]/sources/[sourceId]/proofs/route.ts": {
    methods: ["GET", "POST"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7047672399",
  },
  "app/api/student/assignments/[assignmentId]/sources/[sourceId]/proofs/[proofId]/image/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7047672399",
  },
  // SRV-1101 (Val 11, C-12): the text checks and Lekta profile of the institution; Ductus has no such route.
  "app/api/student/assignments/[assignmentId]/text-check-config/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7043116568",
  },
  // SRV-1107 (Ductus#2051 c.7048423903, wave 11, B-9): the teacher's private working criteria; Ductus has no such route.
  "app/api/teacher/works/[documentId]/working-criteria/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7048423903",
  },
  "app/api/teacher/works/[documentId]/working-criteria/[criterionId]/route.ts": {
    methods: ["PUT"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7048423903",
  },
  // SRV-03 (Ductus#2028 c.7008147932, wave 4): Ductus has no administrator's
  // course and no group routes; the shapes are the plan's (A-7, C-7).
  "app/api/institution/admin/courses/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7008147932",
  },
  "app/api/institution/courses/[courseId]/groups/route.ts": {
    methods: ["GET", "POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7008147932",
  },
  "app/api/institution/groups/[groupId]/teachers/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7008147932",
  },
  // UGOVORI-API (Ductus#2028 c.7019543739, SRV-NG c.7019668458): Ductus reads
  // the notice in its page (readNotice), not in a route.
  "app/api/student/assignments/[assignmentId]/notice/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7019668458",
  },
  // UGOVORI-API (Ductus#2028 c.7020597404, SRV-AV): Ductus reads the current
  // version in its teacher page, not in a route.
  "app/api/institution/assignments/[assignmentId]/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7020597404",
  },
  // UGOVORI-API (Ductus#2028 c.7019844365): Ductus has no read of the code's state.
  "app/api/institution/courses/[courseId]/enrollment-code/state/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7019844365",
  },
  "app/api/settings/values/route.ts": {
    methods: ["GET", "PUT"],
    source: "danielrisavi77-create/Ductus@078c780:docs/DECISIONS.md#D-298",
  },
  "app/api/sources/lookup/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7036755565",
  },
  // SRV-9B (✓ C-6): Ductus has no public check of a receipt.
  "app/api/public/verification/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7041664094",
  },
  // SRV-9A (Ductus#2028 c.7041078855, wave 9): the versions of a work; Ductus has no such route.
  "app/api/works/[documentId]/versions/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7041078855",
  },
  // SRV-1106 (Val 11, Ductus#2051 c.7048423523; E§3.5 mentor2, PO-22): the messages of a work; Ductus has no such route.
  "app/api/works/[documentId]/messages/route.ts": {
    methods: ["GET", "POST"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7048423523",
  },
  "app/api/student/assignments/[assignmentId]/attachments/route.ts": {
    methods: ["POST"],
    source: "ductura/Institution_server#471",
  },
  "app/api/work-attachments/[attachmentId]/route.ts": {
    methods: ["GET"],
    source: "ductura/Institution_server#471",
  },
  // SRV-1105 (Ductus#2051, wave 11): the shared record of a consultation and its additions; Ductus has no such route.
  "app/api/works/[documentId]/milestones/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7044073172",
  },
  "app/api/works/[documentId]/milestones/[milestoneId]/route.ts": {
    methods: ["PATCH"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7044073172",
  },
  "app/api/works/[documentId]/consultation-records/route.ts": {
    methods: ["GET", "POST"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7047671233",
  },
  "app/api/works/[documentId]/consultation-records/[recordId]/additions/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7047671233",
  },
  // SRV-27 (Ductus#2028 c.7009405737, wave 5): teacher reads of students, overview, receipt and mentorship requests.
  "app/api/teacher/courses/[courseId]/students/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7009405737",
  },
  "app/api/teacher/assignments/[assignmentId]/overview/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7009405737",
  },
  "app/api/teacher/assignments/[assignmentId]/students/[studentId]/submission/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7009405737",
  },
  "app/api/teacher/mentorship-requests/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7009405737",
  },
  "app/api/teacher/mentorship-requests/decision/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7009405737",
  },
  // SRV-1108 (Val 11, N-13, C-15): deadline extensions; Ductus has no such route.
  "app/api/teacher/assignments/[assignmentId]/deadline-extensions/route.ts": {
    methods: ["GET", "POST"],
    source: "danielrisavi77-create/Ductus#2028:issuecomment-7009405737",
  },
  // SRV-1109 (Val 11, N-18, C-16, D-286): the Merlin roster and its CSV; Ductus has no such route.
  "app/api/teacher/assignments/[assignmentId]/merlin/roster/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7048729191",
  },
  "app/api/teacher/assignments/[assignmentId]/merlin/csv/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7048729191",
  },
  // SRV-1110 (Val 11, N-18, C-16, D4): the Merlin package and its download; Ductus has no such route.
  "app/api/teacher/assignments/[assignmentId]/merlin/packages/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7049370945",
  },
  "app/api/teacher/assignments/[assignmentId]/merlin/packages/[packageId]/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7049370945",
  },
  "app/api/student/assignments/[assignmentId]/declaration/route.ts": {
    methods: ["GET", "PUT"],
    source: "danielrisavi77-create/Ductus#2052:issuecomment-7060488877",
  },
  "app/api/student/assignments/[assignmentId]/declaration-attachments/route.ts": {
    methods: ["POST"],
    source: "danielrisavi77-create/Ductus#2052:issuecomment-7060488877",
  },
  "app/api/teacher/assignments/[assignmentId]/merlin/packages/[packageId]/download/route.ts": {
    methods: ["GET"],
    source: "danielrisavi77-create/Ductus#2051:issuecomment-7049370945",
  },
};

/**
 * Routes with a contract and no handler on this server yet ("ugovoreno, nije
 * implementirano"; DAN-803, c.6905207008 t. 0.1): clients build against the
 * fake server. This list may only shrink: an id leaves it when its handler is
 * mounted (tests/contracts/contract-only.test.ts).
 */
export const CONTRACT_ONLY: readonly string[] = [
  "student.assignments.get",
  "institution.enrollments.post",
  "institution.role-confirmation.post",
  "institution.role-revocation.post",
  "collaboration.revision-requests.post",
  "teacher.fast-path.post",
  "student.access-log.get",
  "student.notice-read.post",
  "student.enrollments.post",
  "institution.enrollment-code-state.get",
  "student.receipt-pdf.get",
  "teacher.receipt-pdf.get",
];

/**
 * Inventory files whose contracts follow in the next PR (DAN-736, part 2). This
 * list may only shrink: a file moves out of it when its contract lands.
 */
export const PENDING: readonly string[] = [];
