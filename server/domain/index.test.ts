// S-0.19 (DAN-732), acceptance: server/domain imports nothing outside itself
// (docs/server-map.md §2, `domain` → —). Every relative import and every file a
// test opens through `new URL(..., import.meta.url)` resolves inside this
// folder; package imports are only node:crypto in code and, in tests, the test
// runner, fast-check and the file system. The one code file that reads files is
// golden-vectors/load.ts, the vector loader that only tests call. Imports are
// read with the TypeScript preprocessor, not a regular expression, and paths
// are compared with path.relative, so the check holds on Windows too. This
// file itself is skipped: it alone imports the compiler and runs git.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.dirname(SELF);
const CODE_PACKAGES = new Set(["node:crypto"]);
const TEST_PACKAGES = new Set([
  ...CODE_PACKAGES,
  "node:fs",
  "node:path",
  "node:url",
  "vitest",
  "fast-check",
  "@fast-check/vitest",
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const LOADER = path.join(ROOT, "forensics", "golden-vectors", "load.ts");
// Test data outside the folder that copied Ductus tests read, never code:
// the forbidden-terms dictionary (Ductus docs/PRODUCT.md §5) and the revision
// text cases shared with tests/db/ductus/revision-input-agreement.
const TEST_FILES_OUTSIDE = new Set(
  ["scripts/forbidden-terms/terms.ts", "tests/unit/revision-text-cases.ts"].map((file) =>
    path.resolve(ROOT, "..", "..", file),
  ),
);
const URL_REF = /new URL\(\s*["'`]([^"'`$]+)["'`]\s*,\s*import\.meta\.url\s*\)/g;

function inside(file: string, spec: string): boolean {
  const relative = path.relative(ROOT, path.resolve(path.dirname(file), spec));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

const FILES = sources(ROOT).filter((file) => file !== SELF);

describe("server/domain imports nothing outside itself", () => {
  it("finds the ported folders", () => {
    const folders = new Set(
      FILES.map((file) => path.relative(ROOT, path.dirname(file)).split(path.sep)[0]),
    );
    expect([...folders].sort()).toEqual([
      "",
      "assignment",
      "assistant",
      "citation",
      "collaboration",
      "course-team",
      "declaration",
      "document",
      "evidence",
      "forensics",
      "jobs",
      "json",
      "notice",
      "ops",
      "privacy",
      "profile",
      "projection",
      "provenance-share",
      "settings",
      "support",
      "sync",
      "text",
      "time",
    ]);
  });

  it.each(FILES.map((file) => [path.relative(ROOT, file), file]))("%s", (name, file) => {
    const text = readFileSync(file, "utf8");
    const allowed = file.endsWith(".test.ts") || file === LOADER ? TEST_PACKAGES : CODE_PACKAGES;
    const specs = ts.preProcessFile(text, true, true).importedFiles.map((ref) => ref.fileName);
    for (const spec of specs) {
      if (spec.startsWith(".")) {
        const testData =
          file.endsWith(".test.ts") &&
          TEST_FILES_OUTSIDE.has(path.resolve(path.dirname(file), spec));
        expect(testData || inside(file, spec), spec).toBe(true);
      } else expect(allowed.has(spec), spec).toBe(true);
    }
    for (const [, spec] of text.matchAll(URL_REF)) {
      if (spec !== undefined) expect(inside(file, spec), spec).toBe(true);
    }
  });

  it("reads imports, not strings that look like them", () => {
    const text =
      'import { a } from "./a.ts";\nconst b = Buffer.from("../../x", "hex");\nexport * from "../b/index.ts";';
    expect(ts.preProcessFile(text, true, true).importedFiles.map((ref) => ref.fileName)).toEqual([
      "./a.ts",
      "../b/index.ts",
    ]);
  });

  it("rejects an import that leaves the folder", () => {
    const file = path.join(ROOT, "forensics", "jcs.ts");
    expect(inside(file, "../../log/index.ts")).toBe(false);
    expect(inside(file, "../document/index.ts")).toBe(true);
  });
});

describe("golden vectors keep LF on every platform", () => {
  const dir = path.join(ROOT, "forensics", "golden-vectors");
  // Git paths use "/" on every OS; the folder is listed with node:fs.
  const files = readdirSync(dir)
    .sort()
    .map((name) => ["server", "domain", "forensics", "golden-vectors", name].join("/"));
  const repo = path.resolve(ROOT, "..", "..");

  it("lists the vectors, the loader and the docs excerpt", () => {
    expect(files.map((file) => file.split("/").pop())).toEqual([
      "README.md",
      "ductus-docs.txt",
      "evidence-v2.json",
      "evidence-v3.json",
      "evidence-v4.json",
      "format-reservation.json",
      "index.ts",
      "load.ts",
    ]);
  });

  it("git checks every file out as text with eol=lf", () => {
    const out = execFileSync("git", ["check-attr", "text", "eol", "--", ...files], {
      cwd: repo,
      encoding: "utf8",
    });
    for (const file of files) {
      expect(out, file).toContain(`${file}: text: set\n`);
      expect(out, file).toContain(`${file}: eol: lf\n`);
    }
  });

  it("no file holds a carriage return", () => {
    for (const file of files)
      expect(readFileSync(path.join(repo, file)).includes(0x0d), file).toBe(false);
  });

  it("checks the declaration form fixture out with eol=lf too (SRV-1210)", () => {
    const file = "server/domain/declaration/testdata/test-izjava.v1.json";
    const out = execFileSync("git", ["check-attr", "text", "eol", "--", file], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(out).toContain(`${file}: eol: lf
`);
    expect(readFileSync(path.join(repo, file)).includes(0x0d)).toBe(false);
  });
});
