export type { AppError, Result } from "./result.ts";
export * from "./json/index.ts";
export * from "./document/index.ts";
export * from "./collaboration/index.ts";
export * from "./forensics/index.ts";
export * from "./evidence/index.ts";
export * from "./settings/index.ts";
export * from "./jobs/index.ts";
export * from "./assignment/index.ts";
export * from "./profile/index.ts";
export * from "./sync/index.ts";
export * from "./support/index.ts";
export * from "./text/index.ts";
export * from "./assistant/index.ts";
export * from "./declaration/index.ts";
export * from "./export-snapshot/index.ts";
// Both document and evidence name a `SourceId` (Ductus keeps them in separate
// folders): the document's is the source of a citation, the evidence one the
// source of an evidence basis. The explicit exports settle which is which.
export type { SourceId } from "./document/index.ts";
export type { SourceId as EvidenceSourceId } from "./evidence/index.ts";
