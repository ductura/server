// Public interface of server/domain/provenance-share; other folders import only this file.
export * from "./constants.ts";
export { categoryOfSource } from "./categories.ts";
export { sharePercents } from "./rounding.ts";
export {
  computeProvenanceShare,
  type ProvenanceShare,
  type ShareCategoryCount,
  type ShareEvent,
  type ShareFailure,
  type ShareInput,
  type ShareResult,
} from "./share.ts";
export {
  buildProvenanceRecordV1,
  isAiMatch,
  isProvenanceRecordV1,
  isProvenanceShare,
  parseProvenanceRecordV1Bytes,
  provenanceRecordJcs,
  provenanceRecordSha256,
  type AiMatch,
  type AiMatchSpan,
  type ProvenanceRecordFields,
  type ProvenanceRecordV1,
} from "./record.ts";
