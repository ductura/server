// Public interface of server/http, the only composition root; only the entry
// point (server/server.ts) and test-server import it (docs/server-map.md §2).
export { createAuthRoutes } from "./auth.ts";
export { createStudentNotesRoutesFor } from "./student-notes.ts";
export { createWorkSourceRoutesFor } from "./work-sources/index.ts";
export { createSourceProofRoutesFor } from "./source-proofs/index.ts";
export { createCollaborationCommentsRouteFor } from "./collaboration-comments/index.ts";
export { createConsultationSlotRoutesFor } from "./consultation-slots/index.ts";
export {
  createConsultationRecordRoutes,
  createConsultationRecordRoutesFor,
} from "./consultation-records/index.ts";
export { createAttachmentRoutesFor } from "./attachments/index.ts";
export { createWorkMilestonesRoutesFor } from "./work-milestones/index.ts";
export { createTextCheckConfigRoute } from "./text-check-config/index.ts";
export { createTeacherWorkingCriteriaRoutesFor } from "./teacher-working-criteria/index.ts";
export {
  createDeadlineExtensionRoutes,
  createDeadlineExtensionRoutesFor,
} from "./deadline-extensions/index.ts";
export { createMerlinRosterRoutes, createMerlinRosterRoutesFor } from "./merlin-roster/index.ts";
export {
  createMerlinPackageRoutes,
  createMerlinPackageRoutesFor,
} from "./merlin-packages/index.ts";
export { createAssistantRoutes, createAssistantRoutesFor } from "./assistant/index.ts";
export { createSourceLookupRouteFor } from "./source-lookup.ts";
export { createPublicVerificationRouteFor } from "./public-verification.ts";
export {
  CLIENT_CONTEXT_MAX_BYTES,
  createClientContextRoute,
  parseClientContext,
  type ClientContext,
  type ClientContextOptions,
} from "./client-context.ts";
export { createDownloadsManifestRoute } from "./downloads-manifest.ts";
export {
  finishLogin,
  LOGIN_COOKIE_NAME,
  logout,
  logoutAll,
  startLogin,
  type AuthDeps,
} from "./auth-flow.ts";
export { AREA_NAMES, routesOf, type AreaWithRoutes } from "./areas.ts";
export { createDatabases, type Databases } from "./databases.ts";
export {
  catalogErrorFor,
  catalogErrorOf,
  createServerErrorReporter,
  ERROR_CATALOG,
  reportServerError,
  SERVER_ERROR_CLASSES,
  SESSION_EXPIRED,
  type CatalogError,
  type ServerErrorClass,
  type ServerErrorRecord,
  type ServerErrorReporter,
  type ServerErrorSite,
} from "./error-catalog.ts";
export {
  createEvidenceCommitRouteFor,
  createEvidenceReplayRouteFor,
  evidenceIngestDependencies,
  type EvidenceIngestDependencies,
  REFUSING_SIGNER,
  STORAGE_NOT_CONFIGURED,
} from "./evidence-deps.ts";
export {
  COMMIT_TIMEOUT_MS,
  createEvidenceCommitRoute,
  type EvidenceCommitOptions,
} from "./evidence-commit.ts";
export {
  createEvidenceOpenRoute,
  OPEN_MAX_BYTES,
  OPEN_PROTOCOLS,
  OPEN_TIMEOUT_MS,
  type EvidenceOpenOptions,
} from "./evidence-open.ts";
export {
  createEvidenceReplayRoute,
  parseReplayRequest,
  REPLAY_MAX_BYTES,
  REPLAY_PROTOCOLS,
  REPLAY_TIMEOUT_MS,
  replayAnswer,
  type EvidenceReplayOptions,
} from "./evidence-replay.ts";
export {
  parseClosedObject,
  readEvidenceBody,
  sendEvidenceAnswer,
  type EvidenceAnswer,
  type GuardedBody,
} from "./evidence-request.ts";
export { evidenceSession, type EvidenceRefusal, type EvidenceSession } from "./evidence-session.ts";
export { CHECK_DEADLINE_MS, createHealthRoute, type HealthState } from "./health.ts";
export {
  createInstitutionCourseRoutes,
  createInstitutionCourseRoutesFor,
  INSTITUTION_BODY_TIMEOUT_MS,
  type InstitutionCourseRouteOptions,
} from "./institution-courses.ts";
export {
  ACKNOWLEDGMENT_BODY_TIMEOUT_MS,
  type AcknowledgmentRouteOptions,
  createAcknowledgmentRoute,
  createAcknowledgmentRouteFor,
} from "./acknowledgment.ts";
export {
  createLiveRoutes,
  createLiveRoutesFor,
  LIVE_BODY_TIMEOUT_MS,
  LIVE_STATE_HEADER,
  type LiveRouteOptions,
} from "./live.ts";
export {
  createSubmissionRoute,
  createSubmissionRouteFor,
  SUBMISSION_MAX_BYTES,
  SUBMISSION_TIMEOUT_MS,
  submissionAnswer,
  type SubmissionOutcome,
  type SubmissionRouteOptions,
  type SubmitWork,
} from "./submission.ts";
export {
  createProcessSummaryDetailsRouteFor,
  createProcessSummaryRoute,
  createProcessSummaryRouteFor,
  parseProcessSummaryBody,
  PROCESS_SUMMARY_TIMEOUT_MS,
  type ProcessSummaryRouteOptions,
  type ReadProcessSummary,
} from "./process-summary.ts";
export {
  createTeacherFastPathRoute,
  createTeacherFastPathRouteFor,
  parseTeacherFastPathBody,
  TEACHER_FAST_PATH_TIMEOUT_MS,
  type ReadTeacherFastPath,
  type TeacherFastPathRouteOptions,
} from "./teacher-fast-path.ts";
export {
  declaredLengthRefusal,
  readBodyWithLimit,
  type LimitedBodyResult,
} from "./mutation-request.ts";
export {
  knownError,
  problemOf,
  sendHtmlProblem,
  sendDeclaredResponse,
  sendProblem,
  sendRouteRefusal,
  type Problem,
} from "./problem.ts";
export {
  createReadyCheck,
  READY_TIMEOUT_MS,
  type ReadyCapability,
  type ReadyCapabilityName,
  type ReadyCheckOptions,
  type ReadyProbe,
  type ReadyReport,
  type ReadyStatus,
} from "./ready.ts";
export { createReadyRoute, type ReadyRouteOptions } from "./ready-route.ts";
export { REQUEST_ID_HEADER, requestIdOf } from "./request-id.ts";
export { parseJson } from "./request-json.ts";
export { refuse } from "./security-headers.ts";
export {
  enforceSecurityHeaders,
  guardIdleSessions,
  PRODUCTION_SECURITY,
  type SecurityMode,
} from "./security/index.ts";
export {
  createRouter,
  routePath,
  type Handler,
  type Route,
  type Router,
  sendJson,
} from "./router.ts";
export {
  createLayers,
  createPipeline,
  PIPELINE_STEPS,
  type App,
  type Layer,
  type Layers,
  type Step,
} from "./pipeline.ts";
export {
  createOperatorDenialLog,
  OPERATOR_DENIAL_REASONS,
  operatorDenialRecord,
  type OperatorDenialLog,
  type OperatorDenialReason,
} from "./operator-denial-log.ts";
export {
  NO_OPERATORS,
  NO_SECOND_FACTOR,
  type OperatorList,
  operatorPolicyLayer,
  type SecondFactor,
} from "./operator-policy-layer.ts";
export { clientIpOf, parseTrustedProxies, type TrustedProxies } from "../traffic/index.ts";
export {
  createSettingsValuesPutRoute,
  SETTINGS_PUT_MAX_BYTES,
  SETTINGS_PUT_TIMEOUT_MS,
  type SettingsValuesPutOptions,
} from "./settings-values.ts";
export { createSettingsReadRoutes } from "./settings/index.ts";
export {
  createInterfaceLocaleRoutes,
  createInterfaceLocaleRoutesFor,
  INTERFACE_LOCALE_MAX_BYTES,
  INTERFACE_LOCALE_TIMEOUT_MS,
  type InterfaceLocaleRouteOptions,
} from "./profile-interface-locale.ts";
export { createMeRoute, createMeRouteFor } from "./profile-me.ts";
export { createStudentAssignmentWorkRouteFor } from "./student-assignment-work.ts";
export { createAdminCourseRoute, createAdminCourseRouteFor } from "./admin-courses.ts";
export {
  createInstitutionGroupRoutes,
  createInstitutionGroupRoutesFor,
} from "./institution-groups.ts";
export {
  createInstitutionAssignmentRoutes,
  createInstitutionAssignmentRoutesFor,
} from "./institution-assignments.ts";
export { createAssignmentCurrentVersionRouteFor } from "./assignment-current-version.ts";
export {
  createTeacherAccessRoute,
  createTeacherCoursesRoute,
  createTeacherReadRoutes,
  createTeacherReadRoutesFor,
  MAX_ASSIGNMENT_IDS,
  parseAssignmentIdsBody,
  type TeacherReadOptions,
} from "./teacher-reads.ts";
export { createTeacherRosterRoutesFor } from "./teacher-roster.ts";
export { createTeacherMentorshipRequestRoutesFor } from "./teacher-mentorship-requests.ts";
export {
  createStudentAssignmentsRoute,
  createStudentAssignmentsRouteFor,
} from "./student-assignments.ts";
export {
  createStudentWriteRoutes,
  createStudentWriteRoutesFor,
  STUDENT_WRITE_TIMEOUT_MS,
} from "./student-writes.ts";
export {
  createStudentAccessLogRoute,
  createStudentAccessLogRouteFor,
} from "./student-access-log.ts";
export { createWorkVersionsRoute, createWorkVersionsRouteFor } from "./work-versions.ts";
export {
  createWorkMessagesGetRoute,
  createWorkMessagesPostRoute,
  createWorkMessagesRoutesFor,
} from "./work-messages/index.ts";
export {
  createStudentSubmissionRoutes,
  createStudentSubmissionRoutesFor,
} from "./student-submission.ts";
export { createStudentNoticeRoute, createStudentNoticeRouteFor } from "./student-notice.ts";
export {
  bearerMatches,
  checkProvisionBody,
  createInternalInstitutionRoutes,
  INTERNAL_INSTITUTION_GET,
  INTERNAL_INSTITUTIONS_POST,
  INTERNAL_PATH_PREFIX,
  provisioningToken,
  PROVISIONING_MAX_BODY_BYTES,
  PROVISIONING_TOKEN_MIN_LENGTH,
  PROVISIONING_TOKEN_VARIABLE,
} from "./internal-institutions.ts";
export type { InternalInstitutionRouteOptions } from "./internal-institutions.ts";
export {
  createProblemReportRoute,
  createProblemReportRouteFor,
  PROBLEM_REPORT_MAX_BYTES,
  PROBLEM_REPORT_TIMEOUT_MS,
  type ProblemReportFault,
  type ProblemReportFaultRecord,
  type ProblemReportRouteOptions,
} from "./support-problem-report.ts";
export {
  createWebAuthnRoutes,
  createWebAuthnRoutesFor,
  decodeBase64url,
  WEBAUTHN_BODY_TIMEOUT_MS,
  WEBAUTHN_CHALLENGE_MAX_BYTES,
  WEBAUTHN_TIMEOUT_MS,
  type WebAuthnRouteOptions,
  WEBAUTHN_FAULTS,
  type WebAuthnFault,
  type WebAuthnFaultRecord,
  webauthnRpId,
} from "./webauthn.ts";
export { startServer, type Running, type StartOptions } from "./start.ts";
export {
  createMetricsSampling,
  type MetricsSampling,
  type MetricsSamplingOptions,
  serverShutdownHooks,
} from "./metrics-sampling.ts";
export {
  createShutdownCoordinator,
  FLUSH_LOGS,
  installShutdown,
  SHUTDOWN_GRACE_MS,
  type ShutdownCoordinator,
  type ShutdownHook,
} from "./shutdown.ts";
export { createStatementRoutesFor } from "./statement/index.ts";
