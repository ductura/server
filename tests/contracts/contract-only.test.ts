// "Ugovoreno, nije implementirano" (DAN-803, Ductus#1836 c.6905207008 t. 0.1):
// a route in CONTRACT_ONLY has a contract that clients build against on the
// fake server, and no handler on this server. A handler mounted for it while
// it is still listed fails here, so the list cannot claim a route is unserved
// when it is served. A cross-area test (docs/server-map.md §2), as
// tests/contracts/evidence-domain.test.ts; outside server/http on purpose.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CONTRACT_ONLY, ROUTES } from "../../server/contracts/index.ts";
import type {
  ActorReader,
  SettingsWriter,
  WebAuthnCredentials,
} from "../../server/database/index.ts";
import {
  AREA_NAMES,
  createInstitutionCourseRoutesFor,
  createInterfaceLocaleRoutesFor,
  createDownloadsManifestRoute,
  createProblemReportRouteFor,
  createInstitutionAssignmentRoutesFor,
  createAssignmentCurrentVersionRouteFor,
  createInstitutionGroupRoutesFor,
  createAdminCourseRouteFor,
  createTeacherReadRoutesFor,
  createLiveRoutesFor,
  createAcknowledgmentRouteFor,
  createSettingsReadRoutes,
  createSettingsValuesPutRoute,
  createStudentAssignmentWorkRouteFor,
  createStudentSubmissionRoutesFor,
  createStudentNotesRoutesFor,
  createSubmissionRouteFor,
  createProcessSummaryRouteFor,
  createWebAuthnRoutesFor,
  REFUSING_SIGNER,
  routesOf,
  STORAGE_NOT_CONFIGURED,
} from "../../server/http/index.ts";

// The operations of DAN-803 (c.6905207008, tables of PR1 to PR6), frozen: the
// task may add only these to CONTRACT_ONLY, and each of them that has a
// contract and no handler must be there. After the task the list only shrinks.
// (`submission.submit.post`: the table's `submission.post` has no name part,
// which checkRoute refuses.)
/**
 * The course routes of DAN-852, mounted by the entry point since 852-5a, and
 * the student, version and work language routes on the same front
 * (Ductus#2028, w1119o).
 */
const INSTITUTION_COURSE_ROUTES = [
  "institution.courses.post",
  "institution.enrollment-code.post",
  "institution.enrollment-code-revocation.post",
  "institution.student-removal.post",
  "institution.student-return.post",
  "institution.work-language.post",
  "institution.student-work-language.post",
  "institution.work-work-language.post",
] as const;

/** The teacher's reads (Ductus#2028, w1119o), in the order of their factory. */
const TEACHER_READ_ROUTES = [
  "teacher.courses.get",
  "teacher.access.get",
  "teacher.mentorships.get",
  "teacher.mentorship.get",
  "teacher.submissions.get",
  "teacher.assignment-submissions.post",
] as const;

export const DAN_803: readonly string[] = [
  "student.assignments.get",
  "support.problem-report.post",
  ...["live.document.get", "live.document.put", "collaboration.comments.post"],
  ...["collaboration.revision-requests.post", "projection.process-summary.post"],
  ...["institution.enrollments.post", "institution.acknowledgment.post"],
  ...["institution.work-language.post", "institution.student-work-language.post"],
  "institution.work-work-language.post",
  ...["teacher.courses.get", "teacher.submissions.get", "teacher.mentorships.get"],
  ...["teacher.mentorship.get", "teacher.fast-path.post", "institution.courses.post"],
  ...["institution.course-assignments.post", "institution.enrollment-code.post"],
  ...["institution.enrollment-code-revocation.post", "institution.student-removal.post"],
  ...["institution.student-return.post", "institution.assignment-versions.post"],
  ...["institution.role-confirmation.post", "institution.role-revocation.post"],
  "submission.submit.post",
];

// The operations of DAN-806 (settings, Ductus#1836 c.6906291102), frozen the
// same way: contract now, handlers in S-1J-g.
export const DAN_806: readonly string[] = [
  "settings.catalogue.get",
  "settings.values.get",
  "settings.values.put",
];

// The operations of DAN-840-1 (WebAuthn, Ductus#1836 c.6934850911: contract
// now, handlers in 840-3), frozen the same way.
export const DAN_840: readonly string[] = [
  "auth.webauthn-challenge.post",
  "auth.webauthn-registration.post",
  "auth.webauthn-assertion.post",
];

// The operations of DAN-903 (teacher reads, Ductus#1836 c.6947962506 and
// c.6948165042: contract now, handlers later), frozen the same way.
export const DAN_903: readonly string[] = [
  "teacher.assignment-submissions.post",
  "teacher.access.get",
];

// The operations of DAN-904 (the student's access log, Ductus#1836
// c.6948327193: contract now, handler later), frozen the same way.
export const DAN_904: readonly string[] = ["student.access-log.get"];

// The operation of DAN-989-1 (the student's work state, Ductus#1836
// c.6956258999: contract now, handler in 989-2), frozen the same way.
export const DAN_989: readonly string[] = ["student.assignment-work.get"];

// The operation of DAN-931 (the download manifest, Ductus#1836 c.6960799782:
// contract now, handler in DAN-932), frozen the same way.
export const DAN_931: readonly string[] = ["downloads.manifest.get"];

// The operations of SRV-02 (the student's contracts of wave 2, Ductus#2028
// c.7008147932: contract now, handlers in SRV-10), frozen the same way.
export const SRV_02: readonly string[] = ["student.enrollments.post", "student.notice-read.post"];

// The operations of SRV-03 (the administrator's course and the groups of wave
// 4, Ductus#2028 c.7008147932: contract now, handlers in SRV-12 and SRV-15).
export const SRV_03: readonly string[] = [
  "institution.admin-courses.post",
  "institution.course-groups.get",
  "institution.course-groups.post",
  "institution.course-group-teachers.post",
];

// The operations of UGOVORI-API (every /api/v1 contract ahead of its handler,
// Ductus#2028 c.7023902063; scope c.7022752457), frozen the same way.
export const UGOVORI_API: readonly string[] = [
  "student.notice.get",
  "institution.assignment.get",
  "institution.enrollment-code-state.get",
];

// SRV-19 defines the wire shapes ahead of the handlers in SRV-22 (mounted) and SRV-24.
const SRV_19 = [
  "student.submission.get",
  "student.assignment-requirements.get",
  "student.submission-notes.get",
  "student.submission-notes.post",
];

// SRV-9B (✓ C-6, Ductus#2028 c.7041664094): the public check of a receipt,
// contract and service now, the route in the next part.
const SRV_9B = ["public.verification.post"];
const SRV_9C = ["student.receipt-pdf.get", "teacher.receipt-pdf.get"] as const;

/** Every route a task has put on the list; nothing else may be there. */
const FROZEN: readonly string[] = [
  ...[...DAN_803, ...DAN_806, ...DAN_840, ...DAN_903, ...DAN_904],
  ...[...DAN_989, ...DAN_931, ...SRV_02, ...SRV_03, ...UGOVORI_API, ...SRV_19, ...SRV_9B],
  ...SRV_9C,
];

// Routes the entry point mounts itself, over a database the areas cannot be
// given (DAN-826-2b): the exact call server/server.ts must hold, and the
// route id its factory gives. A call with another writer, or one commented
// out, is not a mount.
const NO_WRITER: SettingsWriter = { setValue: () => Promise.reject(new Error("no writer")) };
const NO_ACTOR = { withActor: () => Promise.reject(new Error("no database")) };
const NO_READER = {} as ActorReader;
const NO_WEBAUTHN = { ...NO_ACTOR, webauthnCredentials: {} as WebAuthnCredentials };
const ENTRY_MOUNTED: readonly { call: string; ids: string[]; routes: () => string[] }[] = [
  {
    call: "createStudentAssignmentWorkRouteFor(databases.main)",
    ids: ["student.assignment-work.get"],
    routes: () => [createStudentAssignmentWorkRouteFor(NO_ACTOR).contract.id],
  },
  {
    call: "createStudentNotesRoutesFor(databases.main)",
    ids: ["student.submission-notes.get", "student.submission-notes.post"],
    routes: () => createStudentNotesRoutesFor(NO_ACTOR).map((route) => route.contract.id),
  },
  {
    call: "createSettingsValuesPutRoute({ writer: databases.main.settingsWriter })",
    ids: ["settings.values.put"],
    routes: () => [createSettingsValuesPutRoute({ writer: NO_WRITER }).contract.id],
  },
  {
    call: "createSettingsReadRoutes(databases.main)",
    ids: ["settings.catalogue.get", "settings.values.get"],
    routes: () =>
      createSettingsReadRoutes({ ...NO_ACTOR, actorReader: NO_READER }).map(
        (route) => route.contract.id,
      ),
  },
  {
    call: "createInterfaceLocaleRoutesFor(databases.main)",
    ids: ["profile.interface-locale.get", "profile.interface-locale.post"],
    routes: () => createInterfaceLocaleRoutesFor(NO_ACTOR).map((route) => route.contract.id),
  },
  {
    // DAN-932: the download manifest over the release configuration built in.
    call: "createDownloadsManifestRoute()",
    ids: ["downloads.manifest.get"],
    routes: () => [createDownloadsManifestRoute().contract.id],
  },
  {
    // DAN-851-2d2a: the problem report over the main database.
    call: "createProblemReportRouteFor(databases.main)",
    ids: ["support.problem-report.post"],
    routes: () => [createProblemReportRouteFor(NO_ACTOR).contract.id],
  },
  {
    // DAN-852-5a: the three course routes over the main database.
    call: "createInstitutionCourseRoutesFor(databases.main)",
    ids: [...INSTITUTION_COURSE_ROUTES],
    routes: () => createInstitutionCourseRoutesFor(NO_ACTOR).map((route) => route.contract.id),
  },
  {
    // SRV-14: a course's new assignment and an assignment's next version.
    call: "createInstitutionAssignmentRoutesFor(databases.main)",
    ids: ["institution.course-assignments.post", "institution.assignment-versions.post"],
    routes: () => createInstitutionAssignmentRoutesFor(NO_ACTOR).map((route) => route.contract.id),
  },
  {
    call: "createAssignmentCurrentVersionRouteFor(databases.main)",
    ids: ["institution.assignment.get"],
    routes: () => [createAssignmentCurrentVersionRouteFor(NO_ACTOR).contract.id],
  },
  {
    // SRV-12: the administrator's course over the main database.
    call: "createAdminCourseRouteFor(databases.main)",
    ids: ["institution.admin-courses.post"],
    routes: () => [createAdminCourseRouteFor(NO_ACTOR).contract.id],
  },
  {
    // SRV-15: a course's seminar groups and their teachers.
    call: "createInstitutionGroupRoutesFor(databases.main)",
    ids: [
      "institution.course-groups.get",
      "institution.course-groups.post",
      "institution.course-group-teachers.post",
    ],
    routes: () => createInstitutionGroupRoutesFor(NO_ACTOR).map((route) => route.contract.id),
  },
  {
    // SRV-13: the teacher's courses and access over the main database.
    call: "createTeacherReadRoutesFor(databases.main)",
    ids: [...TEACHER_READ_ROUTES],
    routes: () => createTeacherReadRoutesFor(NO_ACTOR).map((route) => route.contract.id),
  },
  {
    // Ductus#2028 (w1119o): the live view over the main database.
    call: "createLiveRoutesFor(databases.main)",
    ids: ["live.document.get", "live.document.put"],
    routes: () =>
      createLiveRoutesFor({ ...NO_ACTOR, actorReader: NO_READER }).map(
        (route) => route.contract.id,
      ),
  },
  {
    call: "createAcknowledgmentRouteFor(databases.main)",
    ids: ["institution.acknowledgment.post"],
    routes: () => [createAcknowledgmentRouteFor(NO_ACTOR).contract.id],
  },
  {
    // SRV-18: a student's submission over the process's signer and storage.
    call: "createSubmissionRouteFor(databases.main, evidenceDeps)",
    ids: ["submission.submit.post"],
    routes: () => [
      createSubmissionRouteFor(
        { ...NO_ACTOR, actorReader: {} as ActorReader },
        { signer: REFUSING_SIGNER, payloads: STORAGE_NOT_CONFIGURED },
      ).contract.id,
    ],
  },
  {
    // SRV-23: the process summary over the process's storage and the thresholds of the environment.
    call: "createProcessSummaryRouteFor(databases.main, evidenceDeps, process.env)",
    ids: ["projection.process-summary.post"],
    routes: () => [
      createProcessSummaryRouteFor(NO_ACTOR, { payloads: STORAGE_NOT_CONFIGURED }, {}).contract.id,
    ],
  },
  {
    // SRV-22: the student's submission state and word range over the main database.
    call: "...createStudentSubmissionRoutesFor(databases.main)",
    ids: ["student.submission.get", "student.assignment-requirements.get"],
    routes: () => createStudentSubmissionRoutesFor(NO_ACTOR).map((route) => route.contract.id),
  },
  {
    // DAN-840-3f1: over the same origin as the pipeline (server.ts APP_ORIGIN).
    call: "createWebAuthnRoutesFor(databases.main, APP_ORIGIN)",
    ids: [
      "auth.webauthn-challenge.post",
      "auth.webauthn-registration.post",
      "auth.webauthn-assertion.post",
    ],
    routes: () => createWebAuthnRoutesFor(NO_WEBAUTHN, null).map((route) => route.contract.id),
  },
];
const ENTRY_TEXT = readFileSync(new URL("../../server/server.ts", import.meta.url), "utf8");

/** The text of an entry point without its comments. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");

/** The ids of ENTRY_MOUNTED whose exact call is in the entry text. */
export function entryMounted(entry: string): string[] {
  const text = code(entry);
  return ENTRY_MOUNTED.filter((row) => text.includes(row.call)).flatMap((row) => row.ids);
}

const mounted = (): string[] => [
  ...routesOf(AREA_NAMES).map((route) => route.contract.id),
  ...entryMounted(ENTRY_TEXT),
];

/** Every problem of a CONTRACT_ONLY list against the routes and the mounted ids. */
export function contractOnlyProblems(
  list: readonly string[],
  routeIds: readonly string[],
  mountedIds: readonly string[],
): string[] {
  const problems: string[] = [];
  if (new Set(list).size !== list.length) problems.push("duplicate id");
  for (const id of list) {
    if (!FROZEN.includes(id)) problems.push(`${id}: not a contract-only route of a task`);
    if (!routeIds.includes(id)) problems.push(`${id}: no contract`);
    if (mountedIds.includes(id)) problems.push(`${id}: mounted`);
  }
  for (const id of FROZEN)
    if (routeIds.includes(id) && !mountedIds.includes(id) && !list.includes(id))
      problems.push(`${id}: contract without a handler, not in CONTRACT_ONLY`);
  return problems;
}

describe("CONTRACT_ONLY", () => {
  const ids = ROUTES.map((route) => route.id);

  it("is exactly the DAN-803, DAN-806, DAN-840, DAN-903, DAN-904, DAN-989 and DAN-931 routes with a contract and no handler", () => {
    expect(new Set(DAN_803).size).toBe(27);
    expect(new Set(DAN_806).size).toBe(3);
    expect(new Set(DAN_840).size).toBe(3);
    expect(DAN_806.filter((id) => DAN_803.includes(id))).toEqual([]);
    expect(DAN_840.filter((id) => DAN_803.includes(id) || DAN_806.includes(id))).toEqual([]);
    expect(contractOnlyProblems(CONTRACT_ONLY, ids, mounted())).toEqual([]);
  });

  // Fixed inputs, not the live ROUTES, so these stay true as DAN-803 adds routes.
  const routeIds = ["auth.login.get", "student.assignments.get", "teacher.courses.get"];

  it("refuses a route outside both tasks, a route without contract, a duplicate and a mounted one", () => {
    expect(
      contractOnlyProblems(
        ["teacher.courses.get", "auth.login.get", "live.document.get", "teacher.courses.get"],
        routeIds,
        ["teacher.courses.get", "student.assignments.get"],
      ),
    ).toEqual([
      "duplicate id",
      "teacher.courses.get: mounted",
      "auth.login.get: not a contract-only route of a task",
      "live.document.get: no contract",
      "teacher.courses.get: mounted",
    ]);
  });

  it("refuses a DAN-803 or DAN-806 contract left out of the list", () => {
    expect(contractOnlyProblems([], [...routeIds, "settings.values.put"], [])).toEqual([
      "student.assignments.get: contract without a handler, not in CONTRACT_ONLY",
      "teacher.courses.get: contract without a handler, not in CONTRACT_ONLY",
      "settings.values.put: contract without a handler, not in CONTRACT_ONLY",
    ]);
    expect(
      contractOnlyProblems(["student.assignments.get", "teacher.courses.get"], routeIds, []),
    ).toEqual([]);
    const withoutSettings = CONTRACT_ONLY.filter((id) => !DAN_806.includes(id));
    // Compared as sets: the problems follow the order of FROZEN, in which the
    // work language routes come before the course routes.
    expect(contractOnlyProblems(withoutSettings, ids, []).sort()).toEqual(
      // With nothing mounted, the WebAuthn routes (mounted since 840-3f1), the
      // problem report (851-2d2a), the course routes (852-5a), the download
      // manifest (DAN-932), the teacher's reads (SRV-13) and the assignment
      // routes (SRV-14), group routes (SRV-15), student work state (SRV-AWG)
      // and submission (SRV-18), process summary (SRV-23) and submission state and
      // requirements (SRV-22) are missing too.
      [
        ...["support.problem-report.post", "projection.process-summary.post"],
        ...TEACHER_READ_ROUTES,
        ...INSTITUTION_COURSE_ROUTES,
        "institution.course-assignments.post",
        "institution.assignment-versions.post",
        "submission.submit.post",
        ...[...DAN_806, ...DAN_840, ...DAN_989, ...DAN_931],
        ...["institution.admin-courses.post", "institution.course-groups.get"],
        ...["institution.course-groups.post", "institution.course-group-teachers.post"],
        "institution.assignment.get",
        ...["student.submission.get", "student.assignment-requirements.get"],
        "student.submission-notes.get",
        "student.submission-notes.post",
        "live.document.get",
        "live.document.put",
        "institution.acknowledgment.post",
      ]
        .map((id) => `${id}: contract without a handler, not in CONTRACT_ONLY`)
        .sort(),
    );
  });

  it("refuses a DAN-806 route that is mounted", () => {
    for (const id of DAN_806) {
      expect(contractOnlyProblems([...CONTRACT_ONLY, id], ids, mounted())).toEqual([
        `${id}: mounted`,
      ]);
    }
  });
});

describe("routes the entry point mounts itself", () => {
  it("server.ts mounts the settings PUT, the interface language and WebAuthn over the main database", () => {
    expect(entryMounted(ENTRY_TEXT)).toEqual([
      "student.assignment-work.get",
      "student.submission-notes.get",
      "student.submission-notes.post",
      "settings.values.put",
      "settings.catalogue.get",
      "settings.values.get",
      "profile.interface-locale.get",
      "profile.interface-locale.post",
      "downloads.manifest.get",
      "support.problem-report.post",
      ...INSTITUTION_COURSE_ROUTES,
      "institution.course-assignments.post",
      "institution.assignment-versions.post",
      "institution.assignment.get",
      "institution.admin-courses.post",
      "institution.course-groups.get",
      "institution.course-groups.post",
      "institution.course-group-teachers.post",
      ...TEACHER_READ_ROUTES,
      "live.document.get",
      "live.document.put",
      "institution.acknowledgment.post",
      "submission.submit.post",
      "projection.process-summary.post",
      "student.submission.get",
      "student.assignment-requirements.get",
      "auth.webauthn-challenge.post",
      "auth.webauthn-registration.post",
      "auth.webauthn-assertion.post",
    ]);
    expect(mounted()).toContain("settings.values.put");
    expect(mounted()).toContain("profile.interface-locale.get");
    expect(mounted()).toContain("profile.interface-locale.post");
    expect(mounted()).toContain("support.problem-report.post");
    expect(CONTRACT_ONLY).not.toContain("support.problem-report.post");
    expect(mounted()).toContain("downloads.manifest.get");
    expect(CONTRACT_ONLY).not.toContain("downloads.manifest.get");
    for (const id of [...INSTITUTION_COURSE_ROUTES, ...TEACHER_READ_ROUTES]) {
      expect(mounted()).toContain(id);
      expect(CONTRACT_ONLY).not.toContain(id);
    }
  });

  it("the course routes commented out, over another database or with no argument are not a mount", () => {
    const call = "createInstitutionCourseRoutesFor(databases.main)";
    for (const entry of [
      `// ...${call},`,
      `/* ...${call}, */`,
      "",
      "...createInstitutionCourseRoutesFor(databases.admin),",
      "...createInstitutionCourseRoutesFor(fakeMain),",
      "...createInstitutionCourseRoutesFor(),",
    ]) {
      expect(entryMounted(entry)).toEqual([]);
    }
    expect(entryMounted(`routes: [\n  ...${call},\n]`)).toEqual([...INSTITUTION_COURSE_ROUTES]);
  });

  it("the problem report commented out, over another database or with no argument is not a mount", () => {
    const call = "createProblemReportRouteFor(databases.main)";
    for (const entry of [
      `// ${call},`,
      `/* ${call}, */`,
      "",
      "createProblemReportRouteFor(databases.admin),",
      "createProblemReportRouteFor(fakeMain),",
      "createProblemReportRouteFor(),",
    ]) {
      expect(entryMounted(entry)).toEqual([]);
    }
    expect(entryMounted(`routes: [\n  ${call},\n]`)).toEqual(["support.problem-report.post"]);
  });

  it("the download manifest commented out or over another configuration is not a mount", () => {
    const call = "createDownloadsManifestRoute()";
    for (const entry of [
      `// ${call},`,
      `/* ${call}, */`,
      "",
      "createDownloadsManifestRoute(() => releases),",
      "createDownloadsManifestRoute(undefined),",
    ]) {
      expect(entryMounted(entry)).toEqual([]);
    }
    expect(entryMounted(`routes: [\n  ${call},\n]`)).toEqual(["downloads.manifest.get"]);
  });

  it("each factory gives the route ids of its row", () => {
    for (const row of ENTRY_MOUNTED) expect(row.routes()).toEqual(row.ids);
  });

  it("a call commented out, removed or given another writer is not a mount", () => {
    const call = "createSettingsValuesPutRoute({ writer: databases.main.settingsWriter })";
    for (const entry of [
      `// ${call},`,
      `/* ${call}, */`,
      "",
      "createSettingsValuesPutRoute({ writer: fakeWriter }),",
      "createSettingsValuesPutRoute(),",
    ]) {
      expect(entryMounted(entry)).toEqual([]);
    }
    expect(entryMounted(`routes: [\n  ${call},\n]`)).toEqual(["settings.values.put"]);
  });

  it("WebAuthn commented out, over another database or another origin is not a mount", () => {
    const call = "createWebAuthnRoutesFor(databases.main, APP_ORIGIN)";
    for (const entry of [
      `// ...${call},`,
      `/* ...${call}, */`,
      "",
      "...createWebAuthnRoutesFor(fakeMain, APP_ORIGIN),",
      "...createWebAuthnRoutesFor(databases.main, null),",
      "...createWebAuthnRoutesFor(databases.main, appOrigin(process.env)),",
    ]) {
      expect(entryMounted(entry)).toEqual([]);
    }
  });

  it("server.ts reads APP_ORIGIN once and gives it to the pipeline and to WebAuthn", () => {
    const text = code(ENTRY_TEXT);
    expect(text.match(/\bappOrigin\(/gu)).toHaveLength(1);
    expect(text).toContain("const APP_ORIGIN = appOrigin(process.env);");
    expect(text).toContain("expectedOrigin: APP_ORIGIN");
    expect(text).toContain("createWebAuthnRoutesFor(databases.main, APP_ORIGIN)");
  });

  it("the interface language commented out or over another database is not a mount", () => {
    const call = "createInterfaceLocaleRoutesFor(databases.main)";
    for (const entry of [
      `// ...${call},`,
      `/* ...${call}, */`,
      "",
      "...createInterfaceLocaleRoutesFor(databases.admin),",
      "...createInterfaceLocaleRoutesFor(fakeMain),",
      "...createInterfaceLocaleRoutesFor(),",
    ]) {
      expect(entryMounted(entry)).toEqual([]);
    }
    expect(entryMounted(`routes: [\n  ...${call},\n]`)).toEqual([
      "profile.interface-locale.get",
      "profile.interface-locale.post",
    ]);
  });
});
