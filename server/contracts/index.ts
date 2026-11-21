import {
  attachmentRoutes,
  assistantRoutes,
  authRoutes,
  clientRoutes,
  collaborationRoutes,
  consultationSlotRoutes,
  downloadsRoutes,
  enrollmentRoutes,
  ERROR_CATALOG_DATA,
  evidenceRoutes,
  FALLBACK,
  institutionRoutes,
  liveRoutes,
  INTERNAL,
  METHOD_NOT_ALLOWED,
  platformRoutes,
  profileRoutes,
  projectionRoutes,
  publicVerificationPost,
  publicVerificationRoutes,
  receiptPdfRoutes,
  SHARED_ERROR_HEADERS,
  SHARED_ERRORS,
  settingsRoutes,
  sourceLookupPost,
  studentRoutes,
  studentSourcesRoutes,
  sourceProofsRoutes,
  textCheckConfigRoutes,
  deadlineExtensionRoutes,
  merlinRosterRoutes,
  merlinPackageRoutes,
  supportRoutes,
  teacherRoutes,
  teacherWorkingCriteriaRoutes,
  TOO_MANY_REQUESTS,
  versionsRoutes,
  workMessagesRoutes,
  workMilestonesRoutes,
  consultationRecordsRoutes,
  webauthnRoutes,
} from "./routes/index.ts";
import type { ErrorSpec, RouteContract } from "./schema/index.ts";

export { breakingChanges } from "./breaking.ts";
export { API_VERSION, MIN_CLIENT_VERSION } from "./version.ts";
export { WorkMilestoneDueInput, WorkMilestoneId, workMilestonesRoutes } from "./routes/index.ts";
export { SourceProof, WORKING_CRITERION_IDS, WorkSourceRecord } from "./routes/index.ts";

export {
  ERROR_CATALOG_DATA,
  FALLBACK,
  INTERNAL,
  METHOD_NOT_ALLOWED,
  SHARED_ERROR_HEADERS,
  SHARED_ERRORS,
  TOO_MANY_REQUESTS,
};
export { SIGN_IN_FAILURE, type SignInFailureCode } from "./routes/index.ts";
export { publicVerificationPost, sourceLookupPost };
export { workAttachmentGet, workAttachmentPost } from "./routes/index.ts";
export {
  CLIENT_APP_VERSION_PATTERN,
  CLIENT_CONTEXT_VALUES,
  MAX_COMMIT_BODY_BYTES,
} from "./routes/index.ts";
export { checkInventory } from "./check.ts";
export {
  CONTRACT_ONLY,
  INVENTORY,
  INVENTORY_SOURCE,
  PENDING,
  SERVER_SOURCES,
} from "./inventory.ts";
export * from "./schema/index.ts";
export {
  checkVectors,
  VectorFileSchema,
  type SchemaCheck,
  type Vector,
  type VectorFile,
} from "./vectors.ts";
export { isWorkId, WORK_ID_MAX, workIdFromPath } from "./work-id.ts";

/** Every route of /api/v1 with a contract. */
export const ROUTES: readonly RouteContract[] = [
  ...platformRoutes,
  ...clientRoutes,
  ...authRoutes,
  ...webauthnRoutes,
  ...profileRoutes,
  ...evidenceRoutes,
  ...studentRoutes,
  ...studentSourcesRoutes,
  ...attachmentRoutes,
  ...sourceProofsRoutes,
  ...textCheckConfigRoutes,
  ...teacherWorkingCriteriaRoutes,
  ...deadlineExtensionRoutes,
  ...merlinRosterRoutes,
  ...merlinPackageRoutes,
  ...supportRoutes,
  ...projectionRoutes,
  ...collaborationRoutes,
  ...consultationSlotRoutes,
  ...assistantRoutes,
  ...liveRoutes,
  ...enrollmentRoutes,
  ...institutionRoutes,
  ...teacherRoutes,
  ...settingsRoutes,
  ...downloadsRoutes,
  ...receiptPdfRoutes,
  sourceLookupPost,
  ...publicVerificationRoutes,
  ...versionsRoutes,
  ...workMessagesRoutes,
  ...consultationRecordsRoutes,
  ...workMilestonesRoutes,
];

/**
 * Every error the server may answer (S-1L.3, DAN-789): the errors of each
 * route, the shared ones, the fallback and 405. server/http answers only
 * these, and each key has a text in locales/hr.ts (server/http/problem.test.ts).
 */
export const SERVER_ERRORS: readonly ErrorSpec[] = Object.freeze([
  ...ROUTES.flatMap((route) => route.errors),
  ...SHARED_ERRORS,
  FALLBACK.error,
  METHOD_NOT_ALLOWED.error,
]);
