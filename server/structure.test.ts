import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAreas } from "./server-map.ts";
import { checkAreaFiles, checkReadmeTemplate, readmeHeadings } from "./structure.ts";

const ROOT = resolve(import.meta.dirname, "..");
const { areas } = readAreas(readFileSync(join(ROOT, "docs", "server-map.md"), "utf8"));
const EXISTING = areas.filter((a) => a.status === "postoji").map((a) => a.key);

// Areas whose README follows the template. Older READMEs move to it when a
// task changes them (docs/CODE_STYLE.md §10, "Prelazno").
const TEMPLATE_AREAS = [
  "contracts",
  "traffic",
  "metrics",
  "settings",
  "external/email",
  "external/srce-auth",
  "test-server",
  "roles",
  "legal",
  "backup",
  "deletion",
  "downloads",
  "evidence",
  "profile",
  "institution",
  "support",
  "public-verification",
  "assistant",
  "database",
  "session",
  "domain",
];

const HEADINGS = readmeHeadings(ROOT);
const TEMPLATE = HEADINGS.map((h) => `${h}\n\nTekst.\n`).join("\n");

describe("area structure in this repo", () => {
  it("reads the five template headings from docs/CODE_STYLE.md §10", () => {
    expect(HEADINGS).toEqual([
      "## Što radi",
      "## Tko ga zove",
      "## Koje podatke dira",
      "## Što izvozi",
      "## Što ne smije uvoziti",
    ]);
  });

  it("reads existing areas from the map", () => {
    expect(EXISTING).toEqual(expect.arrayContaining(TEMPLATE_AREAS));
  });

  it("every existing area has index.ts and README.md", () => {
    expect(EXISTING.flatMap((key) => checkAreaFiles(ROOT, key))).toEqual([]);
  });

  it("template areas have every README heading", () => {
    expect(TEMPLATE_AREAS.flatMap((key) => checkReadmeTemplate(ROOT, key, HEADINGS))).toEqual([]);
  });
});

describe("checkAreaFiles and checkReadmeTemplate on a fixture", () => {
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function fixture(files: Record<string, string>): string {
    root = mkdtempSync(join(tmpdir(), "structure-"));
    const dir = join(root, "server", "invented");
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return root;
  }

  it("accepts a complete area", () => {
    const r = fixture({ "index.ts": "export {};\n", "README.md": TEMPLATE });
    expect(checkAreaFiles(r, "invented")).toEqual([]);
    expect(checkReadmeTemplate(r, "invented", HEADINGS)).toEqual([]);
  });

  it("fails an area without README.md", () => {
    const r = fixture({ "index.ts": "export {};\n" });
    expect(checkAreaFiles(r, "invented")).toEqual(["server/invented: missing README.md"]);
  });

  it("fails an area without index.ts", () => {
    const r = fixture({ "README.md": TEMPLATE });
    expect(checkAreaFiles(r, "invented")).toEqual(["server/invented: missing index.ts"]);
  });

  it("fails a missing area folder on both files", () => {
    const r = fixture({});
    expect(checkAreaFiles(r, "absent")).toEqual([
      "server/absent: missing index.ts",
      "server/absent: missing README.md",
    ]);
  });

  it("fails a README without a template heading", () => {
    const r = fixture({
      "index.ts": "export {};\n",
      "README.md": TEMPLATE.replace("## Tko ga zove\n", "## Tko ga poziva\n"),
    });
    expect(checkReadmeTemplate(r, "invented", HEADINGS)).toEqual([
      'server/invented/README.md: missing "## Tko ga zove"',
    ]);
  });

  it("reads the template headings from a CRLF checkout (review FAIL c.6894724569)", () => {
    const r = fixture({});
    const doc = readFileSync(join(ROOT, "docs", "CODE_STYLE.md"), "utf8").replace(
      /\r?\n/gu,
      "\r\n",
    );
    mkdirSync(join(r, "docs"), { recursive: true });
    writeFileSync(join(r, "docs", "CODE_STYLE.md"), doc);
    expect(readmeHeadings(r)).toEqual(HEADINGS);
  });

  it("fails a README check that has no headings to check", () => {
    const r = fixture({ "index.ts": "export {};\n", "README.md": TEMPLATE });
    expect(checkReadmeTemplate(r, "invented", [])).toEqual([
      "server/invented/README.md: no template headings to check",
    ]);
  });

  it("does not take a heading of a lower level", () => {
    const r = fixture({
      "index.ts": "export {};\n",
      "README.md": TEMPLATE.replace("## Što izvozi", "### Što izvozi"),
    });
    expect(checkReadmeTemplate(r, "invented", HEADINGS)).toEqual([
      'server/invented/README.md: missing "## Što izvozi"',
    ]);
  });
});
