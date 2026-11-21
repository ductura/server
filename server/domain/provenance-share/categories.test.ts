// docs/contracts/provenance-share-v1.md §1.2: every source of the closed set has exactly one category.
import { describe, expect, it } from "vitest";

import { EVIDENCE_SOURCES_V4, RESERVED_EVIDENCE_SOURCES } from "../forensics/index.ts";

import { categoryOfSource } from "./categories.ts";
import { SHARE_CATEGORIES } from "./constants.ts";

describe("categoryOfSource (§1.2)", () => {
  it("gives every source of formats v2 to v4 one category from the closed set", () => {
    for (const source of EVIDENCE_SOURCES_V4) {
      expect(SHARE_CATEGORIES, source).toContain(categoryOfSource(source));
    }
  });

  it.each([
    ["editor", "written"],
    ["composition", "written"],
    ["keyless-input", "written"],
    ["system-replacement", "written"],
    ["citation-form", "written"],
    ["ai-transfer", "ai_transferred"],
    ["paste", "pasted"],
    ["drop", "pasted"],
    ["import", "imported"],
    ["unattributed", "unattributed"],
    ["cut", "unattributed"],
  ])("%s is %s", (source, category) => {
    expect(categoryOfSource(source)).toBe(category);
  });

  it("gives no category to a reserved, unknown or non-text source", () => {
    for (const source of [...RESERVED_EVIDENCE_SOURCES, "assistant", "", "Editor", null, 1]) {
      expect(categoryOfSource(source)).toBeNull();
    }
    expect(categoryOfSource("__proto__")).toBeNull();
    expect(categoryOfSource("constructor")).toBeNull();
  });

  it("has as many sources as the v4 set: a new source needs a contract change", () => {
    const known = EVIDENCE_SOURCES_V4.filter((source) => categoryOfSource(source) !== null);
    expect(known).toHaveLength(EVIDENCE_SOURCES_V4.length);
    expect(EVIDENCE_SOURCES_V4).toHaveLength(11);
  });
});
