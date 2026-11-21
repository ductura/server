import { describe, expect, expectTypeOf, it } from "vitest";
import * as area from "./index.ts";
import type { DownloadsManifest, DownloadsService } from "./index.ts";
import type { Result } from "../domain/index.ts";

describe("server/downloads public interface", () => {
  it("exports the empty routes and schemas, the manifest service and its errors, and the Merlin roster and package, and the DOCX export", () => {
    expect(Object.keys(area).sort()).toEqual([
      "DOWNLOADS_ERRORS",
      "DOWNLOADS_RELEASES_INVALID",
      "DOWNLOADS_RELEASES_ORDER",
      "DOWNLOADS_RELEASES_UNREADABLE",
      "DOWNLOADS_ROUTES",
      "DOWNLOADS_SCHEMAS",
      "MERLIN_PACKAGE_CSV",
      "MERLIN_PACKAGE_FINGERPRINTS",
      "buildExportModel",
      "buildMerlinPackageZip",
      "createDownloadsService",
      "createMerlinPackageService",
      "createMerlinRosterReader",
      "merlinRosterCsv",
      "renderDocx",
      "renderReceiptPdf",
    ]);
    expect(area.DOWNLOADS_ROUTES).toEqual([]);
    expect(area.DOWNLOADS_SCHEMAS).toEqual({});
  });

  it("has a service that answers the manifest as a result", () => {
    expectTypeOf<DownloadsService["manifest"]>().returns.toEqualTypeOf<Result<DownloadsManifest>>();
  });
});
