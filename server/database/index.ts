import type pg from "pg";

import { createBackchannelLogout, type BackchannelLogout } from "./backchannel-logout.ts";
import { createActorReader, type ActorReader } from "./current-actor.ts";
import { assertNoParameterLogging, withLogCheck } from "./log-settings.ts";
import {
  createInstitutionProvisioning,
  type InstitutionProvisioning,
} from "./institution-provisioning.ts";
import { createOpenSession, type OpenSession } from "./open-session.ts";
import { createMyAccessLogReader, type MyAccessLogReader } from "./my-access-log.ts";
import { createWorkOpener, type WorkOpener } from "./open-work.ts";
import { createRegistry, type HealthReport, type Registry } from "./registry.ts";
import { createWithActor, type WithActor } from "./with-actor.ts";

export { createConsultationSlotStore } from "./consultation-slots/index.ts";
export type {
  BackchannelLogout,
  BackchannelLogoutInput,
  BackchannelLogoutResult,
} from "./backchannel-logout.ts";
export type { ActorReader, CurrentActor, CurrentActorWithInstitution } from "./current-actor.ts";
export type { OpenSession, OpenSessionInput, OpenSessionResult } from "./open-session.ts";
export type {
  InstitutionProvisioning,
  InstitutionProvisionInput,
  InstitutionProvisionOutcome,
  InstitutionSeats,
  ProvisionedInstitution,
} from "./institution-provisioning.ts";
export type { MyAccount, MyAccountReader, MyAccountResult, MyAccountRole } from "./my-account.ts";
export type {
  CommitContextReader,
  EvidenceCommitContext,
  EvidenceCommitContextResult,
  EvidenceCommitState,
} from "./commit-context.ts";
export type {
  EvidenceCommitFault,
  EvidenceCommitInput,
  EvidenceCommitOutcome,
  EvidenceCommitSigning,
  EvidenceCommitter,
  ReceiptSigner,
} from "./commit-evidence.ts";
export type { OpenedWork, OpenWorkResult, ReceiptKey, WorkOpener } from "./open-work.ts";
export type { DocumentSchemaVersion, WorkVersion } from "./evidence-work-version.ts";
export type { InterfaceLocaleStore } from "./interface-locale.ts";
export {
  createProblemReportStore,
  PROBLEM_REPORT_DATABASE_ERROR,
  PROBLEM_REPORT_ERRORS,
  PROBLEM_REPORT_INVALID,
  PROBLEM_REPORT_PARAMETERS,
  PROBLEM_REPORT_ROW_MALFORMED,
  PROBLEM_REPORT_TOO_MANY,
  PROBLEM_REPORT_UNAUTHENTICATED,
} from "./problem-report.ts";
export type { ProblemReportStore } from "./problem-report.ts";
export type {
  CourseCreateOutcome,
  CourseInput,
  EnrollmentCodeIssueOutcome,
  EnrollmentCodeRevokeOutcome,
  InstitutionCourses,
} from "./institution-courses.ts";
export type {
  InstitutionMembers,
  StudentRemovalOutcome,
  StudentReturnOutcome,
} from "./institution-members.ts";
export type {
  AssignmentSubmission,
  AssignmentSubmissionsOutcome,
  AssignmentSubmissionsReader,
} from "./assignment-submissions.ts";
export type {
  NoticeAcknowledgmentOutcome,
  NoticeAcknowledgments,
} from "./notice-acknowledgment.ts";
export type { LivePublishOutcome, LiveReadOutcome, LiveStates } from "./live-state.ts";
export type {
  MentoredWork,
  MentoredWorkOutcome,
  MentoredWorksOutcome,
  MentoredWorksReader,
} from "./mentored-works.ts";
export type {
  AssignmentWorkLanguageOutcome,
  WorkLanguageOutcome,
  WorkLanguages,
} from "./work-language.ts";
export type { Enrollment, InstitutionEnrollment } from "./institution-enrollment.ts";
export type {
  AccessLogCursor,
  AccessLogEntry,
  AccessLogRole,
  AccessLogSurface,
  MyAccessLogPage,
  MyAccessLogReader,
} from "./my-access-log.ts";
export type {
  AttachReceiptSignatureCommand,
  AttachReceiptSignatureOutcome,
  PendingBacklogRead,
  PendingBacklogRow,
  PendingReceiptQueue,
  PendingReceiptRow,
  PendingReceiptsRead,
  PendingReceiptStore,
  ReceiptKeysRead,
} from "./pending-receipt-signing.ts";
export type {
  ReplayCheckpointsResult,
  ReplayHead,
  ReplaySource,
  ReplaySourceResult,
} from "./replay-source.ts";
export type {
  SettingsWriteOutcome,
  SettingsWriter,
  SettingWriteBound,
  SettingWriteInput,
  SettingWriteLevel,
  SettingWriteValue,
} from "./settings-writer.ts";
export type {
  WebAuthnAddOutcome,
  WebAuthnCredential,
  WebAuthnCredentials,
  WebAuthnListOutcome,
  WebAuthnUseOutcome,
} from "./webauthn-credentials.ts";
export type { ActorTransaction, WithActor } from "./with-actor.ts";
export { connectLockClient } from "./migration-lock.ts";
export type { DatabaseHealth, DatabaseName, HealthReport } from "./registry.ts";
export { DATABASE_HEALTH_WORDS, handleConnectionErrors } from "./registry.ts";
// The factories over a pool the caller owns: the tests in tests/db build them
// over logins of their own, as Ductus tests/integration imported them from the
// modules of src/server/db. Another folder reaches this folder only through
// this file (docs/CODE_STYLE.md 6).
export { createBackchannelLogout } from "./backchannel-logout.ts";
export { createActorReader } from "./current-actor.ts";
export { createOpenSession } from "./open-session.ts";
export { createInstitutionProvisioning } from "./institution-provisioning.ts";
export { createMyAccountReader, MY_ACCOUNT_ROLES } from "./my-account.ts";
export { createInstitutionAssignments } from "./institution-assignments.ts";
export { createInstitutionGroups } from "./institution-groups.ts";
export { createAdminCourses } from "./admin-courses.ts";
export type { AdminCourseInput, AdminCourseOutcome, AdminCourses } from "./admin-courses.ts";
export type {
  CourseGroup,
  CourseGroupsOutcome,
  CourseGroupTeacher,
  GroupCreateOutcome,
  GroupTeacherOutcome,
  InstitutionGroups,
} from "./institution-groups.ts";
export type {
  AssignmentContent,
  AssignmentCreateOutcome,
  AssignmentPublishOutcome,
  InstitutionAssignments,
} from "./institution-assignments.ts";
export {
  createTeacherAccessReader,
  createTeacherCoursesReader,
  teacherCoursesOf,
} from "./teacher-reads.ts";
export type {
  TeacherAccessReader,
  TeacherAccessResult,
  TeacherAssignment,
  TeacherCourse,
  TeacherCoursesReader,
  TeacherCoursesResult,
} from "./teacher-reads.ts";
export { createCommitContextReader } from "./commit-context.ts";
export { createEvidenceCommitter } from "./commit-evidence.ts";
export {
  createWorkOpener,
  OPEN_WORK_DATABASE_ERROR,
  OPEN_WORK_ERRORS,
  OPEN_WORK_NOT_ACCEPTING,
  OPEN_WORK_NOT_CONFIGURED,
  OPEN_WORK_NOT_FOUND,
  OPEN_WORK_NOT_STARTED,
  OPEN_WORK_ROW_MALFORMED,
  OPEN_WORK_UNAUTHENTICATED,
} from "./open-work.ts";
export {
  ACCESS_LOG_PAGE,
  createMyAccessLogReader,
  MY_ACCESS_LOG_DATABASE_ERROR,
  MY_ACCESS_LOG_ERRORS,
  MY_ACCESS_LOG_NOT_FOUND,
  MY_ACCESS_LOG_ROW_MALFORMED,
  MY_ACCESS_LOG_UNAUTHENTICATED,
} from "./my-access-log.ts";
export {
  createMyAssignmentWorkReader,
  MY_ASSIGNMENT_WORK_DATABASE_ERROR,
  MY_ASSIGNMENT_WORK_ERRORS,
  MY_ASSIGNMENT_WORK_ROW_MALFORMED,
  MY_ASSIGNMENT_WORK_UNAUTHENTICATED,
} from "./my-assignment-work.ts";
export type { AssignmentWork, MyAssignmentWorkReader, WorkState } from "./my-assignment-work.ts";
export {
  createMySubmissionStateReader,
  MY_SUBMISSION_STATE_DATABASE_ERROR,
  MY_SUBMISSION_STATE_ERRORS,
  MY_SUBMISSION_STATE_NOT_FOUND,
  MY_SUBMISSION_STATE_ROW_MALFORMED,
  MY_SUBMISSION_STATE_UNAUTHENTICATED,
} from "./my-submission-state.ts";
export type {
  MySubmissionStateReader,
  StoredSubmissionState,
  StoredWordRange,
} from "./my-submission-state.ts";
export {
  createStudentNoticeReader,
  STUDENT_NOTICE_DATABASE_ERROR,
  STUDENT_NOTICE_ERRORS,
  STUDENT_NOTICE_NOT_FOUND,
  STUDENT_NOTICE_ROW_MALFORMED,
  STUDENT_NOTICE_UNAUTHENTICATED,
  type StoredNotice,
  type StudentNoticeReader,
} from "./student-notice.ts";
export {
  createInterfaceLocaleStore,
  INTERFACE_LOCALE_DATABASE_ERROR,
  INTERFACE_LOCALE_ERRORS,
  INTERFACE_LOCALE_INVALID,
  INTERFACE_LOCALE_ROW_MALFORMED,
  INTERFACE_LOCALE_UNAUTHENTICATED,
} from "./interface-locale.ts";
// The worker's read of the pending receipts, over the worker's own login;
// only the worker process builds it (D-71, D-102).
export { createPendingReceiptQueue } from "./pending-receipt-queue.ts";
// The worker's read of a domain's receipt keys (820b-2a), same login and owner.
export { readReceiptKeys } from "./receipt-keys.ts";
// The worker's receipt store: the key read and the attach of a signature
// (820b-2b-2), same login and owner.
export { createPendingReceiptStore } from "./pending-receipt-store.ts";
// The worker's read of the segment object a pending receipt names (SRV-1502).
export {
  createPendingReceiptObjectSource,
  type PendingReceiptObject,
  type PendingReceiptObjectRead,
  type PendingReceiptObjectSource,
} from "./receipts/index.ts";
export { createReplaySource } from "./replay-source.ts";
export { createSettingsWriter } from "./settings-writer.ts";
export {
  readSettingsValues,
  readTextCheckConfig,
  settingsCatalogue,
  type TextCheckConfig,
} from "./settings/index.ts";
export {
  createWorkSources,
  isWorkSourceDoi,
  isWorkSourceIsbn,
  type WorkSource,
  type WorkSourceInput,
  type WorkSourceList,
  type WorkSourceRemove,
  type WorkSourceRequirement,
  type WorkSourceSave,
  type WorkSources,
} from "./work-sources/index.ts";
export {
  createSourceProofs,
  isSourceProofJpeg,
  SOURCE_PROOF_MAX_BYTES,
  type SourceProof,
  type SourceProofs,
} from "./source-proofs/index.ts";
export {
  createWorkAttachments,
  isWorkAttachmentMediaType,
  WORK_ATTACHMENT_MAX_BYTES,
  WORK_ATTACHMENT_MEDIA_TYPES,
  type WorkAttachment,
  type WorkAttachmentAdd,
  type WorkAttachmentInput,
  type WorkAttachmentList,
  type WorkAttachmentMediaType,
  type WorkAttachmentRead,
  type WorkAttachmentRecord,
  type WorkAttachments,
} from "./work-attachments/index.ts";
export {
  createDeadlineExtensions,
  type DeadlineExtension,
  type DeadlineExtensionAdd,
  type DeadlineExtensionInput,
  type DeadlineExtensionList,
  type DeadlineExtensions,
} from "./deadline-extensions/index.ts";
export {
  createSubmittedWorksReader,
  type SubmittedWorkSource,
  type SubmittedWorksOutcome,
  type SubmittedWorksReader,
} from "./submitted-works/index.ts";
export {
  createMerlinPackages,
  type MerlinPackageDownload,
  type MerlinPackageRead,
  type MerlinPackageRequest,
  type MerlinPackages,
  type MerlinPackageState,
  type MerlinPackageStatus,
  type MerlinPackageWrite,
} from "./merlin-packages/index.ts";
export {
  createWorkVersionsReader,
  WORK_VERSIONS_PAGE_SIZE,
  type WorkVersionsItem,
  type WorkVersionsPage,
  type WorkVersionsReader,
} from "./work-versions/index.ts";
export {
  createConsultationRecords,
  isCalendarDate,
  recordsOf,
  type AddAnswer,
  type Addition,
  type ConsultationRecord,
  type ConsultationRecords,
  type CreateAnswer,
  type ListAnswer,
  type RecordInput,
} from "./consultation-records/index.ts";
export { createWorkMilestones } from "./work-milestones/index.ts";
export { createWebAuthnCredentials } from "./webauthn-credentials.ts";
export { createInstitutionCourses } from "./institution-courses.ts";
export { createInstitutionMembers } from "./institution-members.ts";
export { createWorkLanguages } from "./work-language.ts";
export { createAssignmentSubmissionsReader } from "./assignment-submissions.ts";
export { createMentoredWorksReader } from "./mentored-works.ts";
export { createLiveStates } from "./live-state.ts";
export { createNoticeAcknowledgments } from "./notice-acknowledgment.ts";
export {
  createInstitutionEnrollment,
  ENROLLMENT_DATABASE_ERROR,
  ENROLLMENT_ERRORS,
  ENROLLMENT_EXPIRED_CODE,
  ENROLLMENT_FORBIDDEN,
  ENROLLMENT_REFUSED,
  ENROLLMENT_ROW_MALFORMED,
  ENROLLMENT_TOO_MANY_ATTEMPTS,
  ENROLLMENT_UNAUTHENTICATED,
} from "./institution-enrollment.ts";
export { createStudentAssignmentsReader } from "./student-assignments.ts";
export type {
  StudentAssignmentRow,
  StudentAssignmentsRead,
  StudentAssignmentsReader,
} from "./student-assignments.ts";
export { createStudentNoticeRead } from "./student-notice-read.ts";
export type { NoticeReadOutcome, StudentNoticeRead } from "./student-notice-read.ts";
export { createTeacherNotes, TEMPLATE_KINDS } from "./teacher-notes.ts";
export {
  createTeacherWorkingCriteria,
  WORKING_CRITERIA,
  type Assessment as WorkingCriterionAssessment,
  type TeacherWorkingCriteria,
  type WorkingCriterion,
  type WorkingCriterionId,
} from "./teacher-working-criteria/index.ts";
export type { CommentTemplate, TeacherNote, TeacherNotes, TemplateKind } from "./teacher-notes.ts";
export { createWithActor, leadingKeyword } from "./with-actor.ts";
export { findRefusedLabels, MIGRATION, readRule, report } from "./plain-label-check.ts";
// A registry over an environment of the caller's own, for tests/db; in the
// server only this file makes one (registry-boundary.test.ts).
export { createRegistry, POOLS, type Registry } from "./registry.ts";

let appWithActor: WithActor | undefined;
let authOpenSession: OpenSession | undefined;
let authBackchannelLogout: BackchannelLogout | undefined;
let authInstitutionProvisioning: InstitutionProvisioning | undefined;

// Limits of the web process pool. Every wait has an end, so a stuck request
// fails instead of holding a connection or a caller for good.

/**
 * Connections of one web process. Stated instead of left to the driver
 * default: the database has a fixed number of connections, shared with the
 * worker and the migrator, and a request holds one only for its transaction.
 */
export const APP_POOL_MAX = 10;

/**
 * Longest wait for a connection, from the pool or for a new one. The driver
 * default is to wait forever, which turns an exhausted pool, or a withActor
 * nested inside another, into a request that never answers. Five seconds
 * rides out a burst and still fails well before a browser gives up.
 */
export const APP_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Longest single statement, enforced by the server. Requests run short
 * statements; one that takes this long is a lock wait or a runaway query and
 * must not keep its connection. Long work belongs to the worker.
 */
export const APP_STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Longest pause between statements inside a transaction, enforced by the
 * server, which then closes the connection. It bounds how long a stalled
 * request can keep locks and a pool slot. It is longer than the connection
 * timeout, so a nested withActor fails on its own wait first, with the
 * clearer error.
 */
export const APP_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10_000;

/**
 * Longest wait for the answer to one statement, enforced by the driver. The
 * two limits above are the server's, and a server that is frozen or behind a
 * dead network enforces nothing: without this the request waits until the
 * operating system gives the connection up. It is longer than the statement
 * limit, so a server that still answers cancels the statement itself, with
 * the clearer error and a connection that stays usable. When this limit does
 * end a wait, the ROLLBACK that follows waits once more and the connection
 * is dropped. A COMMIT that ends this way may still have been applied, as
 * with any connection lost during COMMIT.
 */
export const APP_QUERY_TIMEOUT_MS = 20_000;

/** The pool settings without the pool: tests apply them to a pool of their own. */
export function appPoolConfig(connectionString: string): pg.PoolConfig {
  return {
    connectionString,
    max: APP_POOL_MAX,
    connectionTimeoutMillis: APP_CONNECTION_TIMEOUT_MS,
    query_timeout: APP_QUERY_TIMEOUT_MS,
    // Startup parameters of the connection, not SET statements.
    statement_timeout: APP_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: APP_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  };
}

// Every pool of this process comes from one registry (S-1F-a, DAN-783),
// over process.env as it is at each first use. Each pool is named in its
// application_name, so an operator sees which pool holds a connection.
const registry: Registry = createRegistry(process.env, {
  settings: (connectionString, name) => ({
    ...appPoolConfig(connectionString),
    application_name: `ductura-${name}`,
  }),
});

// APP_DATABASE_URL is the login of the web process: a member of ductus_app,
// provisioned per environment (docs/BACKEND.md 3, rule 2). There is no
// default, so a process without it has no database access at all.
function connect(pool: pg.Pool): WithActor {
  // The session token is a bind parameter: no transaction runs on a database
  // that would write it to its log (log-settings.ts).
  return withLogCheck(() => assertNoParameterLogging(pool), createWithActor(pool));
}

/**
 * The single way to the database for application code (docs/BACKEND.md 4.3).
 * The pool is not exported and ESLint keeps the driver inside this directory.
 */
export const withActor: WithActor = async (token, fn) => {
  // Asked on every call, so that after closePools nothing reaches the pool.
  const pool = registry.pool("main");
  appWithActor ??= connect(pool);
  return appWithActor(token, fn);
};

/**
 * Reads the actor of a session token over the application withActor, in
 * camelCase; server/session receives it as a port (docs/server-map.md 2).
 * Nothing connects until the first call, as with withActor.
 */
export const actorReader: ActorReader = createActorReader(withActor);

/** Opens the student's work over the application withActor (evidence/open, DAN-811). */
export const workOpener: WorkOpener = createWorkOpener(withActor);

/** The student's own access log over the application withActor, main database only (DAN-859-1). */
export const myAccessLogReader: MyAccessLogReader = createMyAccessLogReader(withActor);

// AUTH_DATABASE_URL is the login of the login callback and of the
// back-channel logout route: a member of ductus_auth and nothing else
// (docs/BACKEND.md 4.3; ductus_auth_local in the local stack). Both are rare
// and each is one statement, so they share one small pool. Without the
// variable no session can be opened or closed this way.

/** Opens a session for a verified login; only the login callback calls it. */
export const openSession: OpenSession = async (input) => {
  const pool = registry.pool("auth");
  authOpenSession ??= createOpenSession(pool);
  return authOpenSession(input);
};

/**
 * Closes the sessions a verified logout token names (DAN-474); only the
 * back-channel logout route calls it.
 */
export const backchannelLogout: BackchannelLogout = async (input) => {
  const pool = registry.pool("auth");
  authBackchannelLogout ??= createBackchannelLogout(pool);
  return authBackchannelLogout(input);
};

/**
 * Provisioning of an institution instance (Ductus#2028 c.6993786629 §2) over
 * the same ductus_auth login: only the internal routes, called server to
 * server by Aplication_server, use it.
 */
function provisioningPort(): InstitutionProvisioning {
  // Asked on every call, so that after closePools nothing reaches the pool.
  const pool = registry.pool("auth");
  authInstitutionProvisioning ??= createInstitutionProvisioning(pool);
  return authInstitutionProvisioning;
}
export const institutionProvisioning: InstitutionProvisioning = {
  provision: async (input) => provisioningPort().provision(input),
  read: async (slug) => provisioningPort().read(slug),
};

/**
 * The metric_sample port of the metrics collector over the logs database
 * (LOGS_DATABASE_URL, a login of ductus_logs_writer; DAN-834-5a). The pool
 * opens on the first write; without the variable, or after closePools, the
 * write rejects and the collector skips the round as write_failed.
 */
export const metricSampleStore = Object.freeze({
  // async, so a missing variable or a closed registry rejects, never throws.
  query: async (text: string, values: unknown[]): Promise<unknown> =>
    registry.pool("logs").query(text, values),
});

/**
 * The state of each database (main, logs, legal), checked apart and at the
 * same time, in the words of CapabilityStatus; the input of readiness (S-1M-a).
 * A database without its variable is `nije_konfigurirano` and is not dialled.
 */
export function databaseHealth(): Promise<HealthReport> {
  return registry.health();
}

/**
 * Ends the pools this process opened, on shutdown (S-1B-c, DAN-778), after
 * every request is done, all of them even when one fails. A pool never opened
 * is not opened now, and no pool opens afterwards: withActor, openSession and
 * backchannelLogout then refuse.
 */
export async function closePools(): Promise<void> {
  await registry.close();
}
export {
  createWorkMessages,
  type WorkMessage,
  type WorkMessageCreated,
  type WorkMessageList,
  type WorkMessageRefusal,
  type WorkMessages,
} from "./work-messages/index.ts";
export {
  ASSISTANT_REQUEST_STATES,
  createAssistantRequests,
  sweepAndSettle,
  type AssistantMessage,
  type AssistantRefusal,
  type AssistantRejectReason,
  type AssistantRequestState,
  type AssistantRequests,
  type BeginRequestInput,
  type BegunRequest,
  type CostConfigInput,
  type WorkerQuery,
} from "./assistant/index.ts";
