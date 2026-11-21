// Public interface of server/downloads; other areas import only this file.
export { DOWNLOADS_ROUTES } from "./routes.ts";
export { DOWNLOADS_SCHEMAS } from "./schemas.ts";
export { renderReceiptPdf } from "./receipt-pdf/index.ts";
// SRV-1512: the display-equality test (server/tests) renders a DOCX from an export snapshot.
export { buildExportModel, renderDocx, type ExportLabels } from "./export/index.ts";
export {
  createMerlinRosterReader,
  merlinRosterCsv,
  type MerlinLabels,
  type MerlinRosterDeps,
  type MerlinRosterRead,
  type MerlinRosterReader,
  type MerlinRosterRow,
} from "./merlin/roster/index.ts";
export {
  buildMerlinPackageZip,
  createMerlinPackageService,
  MERLIN_PACKAGE_CSV,
  MERLIN_PACKAGE_FINGERPRINTS,
  type MerlinPackageAsk,
  type MerlinPackageService,
  type MerlinPackageServiceDeps,
} from "./merlin/packages/index.ts";
export {
  createDownloadsService,
  DOWNLOADS_ERRORS,
  DOWNLOADS_RELEASES_INVALID,
  DOWNLOADS_RELEASES_ORDER,
  DOWNLOADS_RELEASES_UNREADABLE,
  type DownloadsManifest,
  type DownloadsPackage,
  type DownloadsService,
} from "./service.ts";
