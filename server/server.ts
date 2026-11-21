// The one entry point of the server (S-1B-a, DAN-775), built into
// dist/server.js by `pnpm build` (scripts/build). Read top to bottom it is the overview: the environment check, the
// databases, the layers, the areas whose routes are mounted, the start and the
// place for shutdown. It may import only http, settings and config
// (docs/server-map.md §2); it never opens a database connection itself.
import {
  appOrigin,
  environmentProblems,
  listenAddress,
  listenProblems,
  originProblems,
  SERVER_VERSION,
  shutdownGraceMs,
  shutdownProblems,
} from "./config/index.ts";
import {
  type AreaWithRoutes,
  createAuthRoutes,
  createClientContextRoute,
  createDownloadsManifestRoute,
  createDatabases,
  createEvidenceCommitRouteFor,
  createInstitutionCourseRoutesFor,
  createInternalInstitutionRoutes,
  createMeRouteFor,
  createStudentAssignmentWorkRouteFor,
  createStudentSubmissionRoutesFor,
  createStudentNoticeRouteFor,
  createStudentNotesRoutesFor,
  createTextCheckConfigRoute,
  createTeacherWorkingCriteriaRoutesFor,
  createSourceProofRoutesFor,
  createWorkSourceRoutesFor,
  createAttachmentRoutesFor,
  createWorkVersionsRouteFor,
  createConsultationSlotRoutesFor,
  createSourceLookupRouteFor,
  createPublicVerificationRouteFor,
  createTeacherReadRoutesFor,
  createTeacherRosterRoutesFor,
  createDeadlineExtensionRoutesFor,
  createMerlinRosterRoutesFor,
  createMerlinPackageRoutesFor,
  createAssistantRoutesFor,
  createTeacherMentorshipRequestRoutesFor,
  createInstitutionAssignmentRoutesFor,
  createAssignmentCurrentVersionRouteFor,
  createInstitutionGroupRoutesFor,
  createAdminCourseRouteFor,
  createInterfaceLocaleRoutesFor,
  createProblemReportRouteFor,
  createLiveRoutesFor,
  createCollaborationCommentsRouteFor,
  createWorkMessagesRoutesFor,
  createConsultationRecordRoutesFor,
  createWorkMilestonesRoutesFor,
  createAcknowledgmentRouteFor,
  createWebAuthnRoutesFor,
  createEvidenceOpenRoute,
  createEvidenceReplayRouteFor,
  createSubmissionRouteFor,
  createProcessSummaryRouteFor,
  createProcessSummaryDetailsRouteFor,
  createTeacherFastPathRouteFor,
  createSettingsReadRoutes,
  createSettingsValuesPutRoute,
  evidenceIngestDependencies,
  createLayers,
  createMetricsSampling,
  createShutdownCoordinator,
  createHealthRoute,
  installShutdown,
  parseTrustedProxies,
  routesOf,
  serverShutdownHooks,
  startServer,
} from "./http/index.ts";
import {
  institutionsProblems,
  metricsIntervalMs,
  metricsIntervalProblems,
  testModeProblems,
} from "./settings/index.ts";

// 1. Environment. A bad value stops the start before anything listens; the
//    line names the variable, never its value. TRUSTED_PROXIES (addresses and
//    CIDR ranges) is optional; unset, X-Forwarded-For is never read. The
//    institutions file built into the server must pass its schema (DAN-911).
//    DUCTURA_MODE=test never starts in production (S-1H.7, DAN-938-1).
const TRUSTED_PROXIES = parseTrustedProxies(process.env.TRUSTED_PROXIES);
const problems = [
  ...environmentProblems(process.env),
  ...listenProblems(process.env),
  ...shutdownProblems(process.env),
  ...originProblems(process.env),
  ...metricsIntervalProblems(process.env),
  ...institutionsProblems(),
  ...testModeProblems(process.env),
  ...(TRUSTED_PROXIES === null
    ? ["TRUSTED_PROXIES is not a list of addresses and CIDR ranges"]
    : []),
];

// 2. Databases. Building the registry opens nothing: server/database connects
//    on first use, one pool per database (main, logs, legal; S-1F-a), so a
//    database that is down fails only its own calls.
// 3. Layers, in the order of docs/server-map.md §3, steps 2 to 8: client IP,
//    IP rules, rate limit, traffic record, security headers, origin check,
//    operator policy. The order is fixed in http (PIPELINE_STEPS); step 5 is
//    empty until wave 5, step 4 limits requests (DAN-814), and without an
//    operator list and a second-factor port step 8 keeps operator paths closed
//    (DAN-842-1, DAN-1092-1). Without APP_ORIGIN every state-changing request gets 403.
// One origin for the pipeline's check and for WebAuthn's client data and rpId
// (DAN-840-3f1), so the two can never differ.
const APP_ORIGIN = appOrigin(process.env);
const LAYERS = createLayers({
  expectedOrigin: APP_ORIGIN,
  trustedProxies: TRUSTED_PROXIES ?? [],
});

// 4. Areas whose routes are mounted. Every server/<area>/routes.ts is named
//    here (server/server.test.ts); test-server mounts its own.
const AREAS: readonly AreaWithRoutes[] = [
  "traffic",
  "metrics",
  "settings",
  "roles",
  "legal",
  "backup",
  "deletion",
  "downloads",
  "external/email",
];

async function main(): Promise<void> {
  if (problems.length > 0) {
    for (const problem of problems) console.error(`startup refused: ${problem}`);
    process.exitCode = 1;
    return;
  }
  const { host, port } = listenAddress(process.env);
  const databases = createDatabases();
  // One signer and one storage per process, shared by commit and replay.
  const evidenceDeps = evidenceIngestDependencies(process.env, process.cwd());
  const shutdown = createShutdownCoordinator({ graceMs: shutdownGraceMs(process.env) });
  const running = await startServer({
    host,
    port,
    databases,
    shutdown,
    layers: LAYERS,
    routes: [
      createHealthRoute({ health: databases.health, serverVersion: SERVER_VERSION }),
      // The preloader's environment (S-1M-b, D-300); no log writer is wired
      // into the process yet, so it is checked and answered, not recorded.
      createClientContextRoute(),
      createEvidenceOpenRoute(databases.main),
      createStudentAssignmentWorkRouteFor(databases.main),
      ...createStudentNotesRoutesFor(databases.main),
      ...createWorkSourceRoutesFor(databases.main),
      ...createSourceProofRoutesFor(databases.main),
      createTextCheckConfigRoute(databases.main),
      // The teacher's private working criteria of a work (SRV-1107, B-9).
      ...createTeacherWorkingCriteriaRoutesFor(databases.main),
      createSourceLookupRouteFor(databases.main, process.env),
      // The public check of a receipt (SRV-9B, C-6): no session read or issued (D-09).
      createPublicVerificationRouteFor(databases.main),
      // The desktop packages over the release configuration built in (S-1H.5-b, DAN-932).
      createDownloadsManifestRoute(),
      // Settings by level (S-1J-g, DAN-826; SRV-7E).
      createSettingsValuesPutRoute({ writer: databases.main.settingsWriter }),
      ...createSettingsReadRoutes(databases.main),
      // The interface language (S-M-1, DAN-851): GET and POST over the profile service.
      ...createInterfaceLocaleRoutesFor(databases.main),
      // The problem report (S-M-2, DAN-851): POST over the support service.
      createProblemReportRouteFor(databases.main),
      // Courses of an institution, the enrolment code and its revocation (S-M-2a, DAN-852).
      ...createInstitutionCourseRoutesFor(databases.main),
      // A course's new assignment and an assignment's next version (SRV-14, Ductus#2028).
      ...createInstitutionAssignmentRoutesFor(databases.main),
      createAssignmentCurrentVersionRouteFor(databases.main),
      // A course's seminar groups and their teachers (SRV-15, Ductus#2028).
      ...createInstitutionGroupRoutesFor(databases.main),
      // The administrator creates a course with its holder (SRV-12 over SRV-07, Ductus#2028).
      createAdminCourseRouteFor(databases.main),
      // The live view (B-LIVE): the owner publishes the last state of a work
      // with PUT, every reader gets the same bytes and ETag with GET.
      ...createLiveRoutesFor(databases.main),
      createCollaborationCommentsRouteFor(databases.main),
      // SRV-1106: the short messages next to a work, one conversation for its student and teachers.
      ...createWorkMessagesRoutesFor(databases.main),
      ...createConsultationRecordRoutesFor(databases.main),
      ...createWorkMilestonesRoutesFor(databases.main),
      // The student acknowledges the assignment notice shown by the browser (DAN-306).
      createAcknowledgmentRouteFor(databases.main),
      // WebAuthn as the second factor of operators, never a way to sign in (S-1E-g, DAN-840; D-09).
      ...createWebAuthnRoutesFor(databases.main, APP_ORIGIN),
      // B-8: the development signer only under NODE_ENV development or test;
      // storage only from EVIDENCE_STORAGE_DOMAINS (503 otherwise); protocol 2
      // only under DUCTUS_EVIDENCE_ASYNC_SIGNING=1 (DAN-821-3).
      createEvidenceCommitRouteFor(databases.main, evidenceDeps),
      // DAN-818: one replay page, read from the same storage as commit writes.
      createEvidenceReplayRouteFor(databases.main, evidenceDeps),
      // SRV-9A: the versions of a work, the same page for its owner and its teacher.
      createWorkVersionsRouteFor(databases.main),
      ...createConsultationSlotRoutesFor(databases.main),
      ...createAttachmentRoutesFor(databases.main, process.env, process.cwd()),
      // B-12 step 4b2 (SRV-18): a student's submission, over the same signer and
      // storage as commit; the time is the database's, never the client's.
      createSubmissionRouteFor(databases.main, evidenceDeps),
      // B-13 step 3 (SRV-23): the process summary of one work, the same bytes for
      // its owner and the teacher; the teacher's read writes the access log.
      createProcessSummaryRouteFor(databases.main, evidenceDeps, process.env),
      createProcessSummaryDetailsRouteFor(databases.main, evidenceDeps, process.env),
      // N-05 (SRV-8E): the teacher's fast path through the works of one assignment,
      // over the same storage and thresholds as the process summary.
      createTeacherFastPathRouteFor(databases.main, evidenceDeps, process.env),
      // SRV-22: the student's own submission state and word range of one
      // assignment, the receipt byte for byte as the submission bound it.
      ...createStudentSubmissionRoutesFor(databases.main),
      // SRV-NG: the notice of the current version for a student of the course (E-6).
      createStudentNoticeRouteFor(databases.main),
      // The signed-in account for the front of the institution (Ductus#2028 c.6993786629 §3.3).
      createMeRouteFor(databases.main),
      // The teacher's courses and access for the teacher shell (SRV-13, Ductus#2028).
      ...createTeacherReadRoutesFor(databases.main),
      ...createTeacherRosterRoutesFor(databases.main),
      // SRV-1108: the deadline extensions of an assignment for its teacher.
      ...createDeadlineExtensionRoutesFor(databases.main),
      // SRV-1109: the Merlin roster of an assignment and its CSV, for its teacher.
      ...createMerlinRosterRoutesFor(databases.main),
      // SRV-1110: the Merlin package of an assignment and its download, for its teacher.
      ...createMerlinPackageRoutesFor(databases.main),
      // SRV-1204: the AI assistant proxy; no provider in production, so ai_disabled.
      ...createAssistantRoutesFor(databases.main),
      ...createTeacherMentorshipRequestRoutesFor(databases.main),
      // Provisioning of an institution instance by Aplication_server, server
      // to server (§2): 404 unless DUCTURA_PROVISIONING_TOKEN is set.
      ...createInternalInstitutionRoutes({ env: process.env }),
      // Login over AAI@EduHr (S-1E-a; D-09: the fake provider only in development and test).
      ...createAuthRoutes(process.env),
      ...routesOf(AREAS),
    ],
  }).catch((error: unknown) => {
    // A system error has a code (EADDRINUSE, EACCES); anything else is a
    // programming error of the route table, whose message names no value.
    const { code, message } = error as { code?: string; message?: string };
    console.error(code === undefined ? `startup failed: ${message}` : `listen failed: ${code}`);
    process.exitCode = 1;
    return undefined;
  });
  if (running === undefined) return;

  // Metrics (S-1K.4-b, DAN-834-5a): every METRICS_INTERVAL_MS one round of
  // database_connections into metric_sample of the logs database; a failing
  // round is skipped and logged by its reason, never stopping the server.
  const metrics = createMetricsSampling({
    intervalMs: metricsIntervalMs(process.env),
    health: databases.health,
    store: databases.metricSamples,
  });
  metrics.start();

  // 5. Shutdown (S-1B-c). The first SIGTERM or SIGINT: stop accepting, finish
  //    the started requests, stop metrics (waiting for the round in progress),
  //    flush the logs, close the databases, exit 0;
  //    whatever is left at the deadline exits 1 (server/http/shutdown.ts).
  type Signal = "SIGTERM" | "SIGINT";
  const signals = {
    on: (signal: Signal, listener: () => void) => process.on(signal, listener),
    off: (signal: Signal, listener: () => void) => process.off(signal, listener),
  };
  installShutdown(signals, {
    coordinator: shutdown,
    listener: running,
    hooks: serverShutdownHooks({ metrics, databases }),
    exit: (code) => process.exit(code),
  });
  // Announced only once the signals are handled: a SIGTERM sent on this line
  // must reach installShutdown, not the default action that kills the process.
  console.log(JSON.stringify({ event: "server.listening", host, port: running.port }));
}

await main();
