import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AREA_IMPORTS } from "../scripts/lint-rules/index.ts";
import {
  checkFolders,
  listAreaFolders,
  readAreas,
  readCopiedFolders,
  readCallers,
  readImports,
  readTable,
} from "./server-map.ts";

const ROOT = resolve(import.meta.dirname, "..");
const MAP = readFileSync(join(ROOT, "docs", "server-map.md"), "utf8");

// The areas S-0.12 asks for. The map may not drop or add one silently.
const REQUIRED_AREAS = [
  "http",
  "traffic",
  "session",
  "external/srce-auth",
  "external/storage",
  "external/keys",
  "external/email",
  // SRV-1201 (Ductus ai-request-v1, M9.0-S2 step 1): the AI assistant port's adapter.
  "external/assistant",
  "database",
  "log",
  "metrics",
  "roles",
  "settings",
  "config",
  "legal",
  "backup",
  "deletion",
  "downloads",
  // PLAN.md §3 area, made by DAN-815 b1 (VS-1 narrow cut, evidence/commit).
  "evidence",
  // PLAN.md §3 area, made by DAN-851-1b (S-M-1, interface language).
  "profile",
  // PLAN.md §3 area, made by DAN-852-1 (S-M-2a, courses and enrolment codes).
  "institution",
  // PLAN.md §3 area, made by DAN-851-2b (S-M-2, problem report).
  "support",
  "source-lookup",
  // SRV-9B (Ductus#2028 c.7041664094, ✓ C-6): the public check of a receipt.
  "public-verification",
  // SRV-1502 (M3.2, B-9): the worker process, first its receipt signing.
  "worker",
  // SRV-1401 (DAN-296, M1.6): idle expiry of a session.
  "identity",
  "contracts",
  "domain",
  "test-server",
  // SRV-1512 (plan M7.9, R-07): checks across areas that are a condition of the build.
  "tests",
];

describe("readTable and readAreas", () => {
  const sample = [
    "## 1. Područja",
    "",
    "| Područje | Mapa | Stanje |",
    "|---|---|---|",
    "| http | `server/http` | planirano |",
    "| log | `server/logs` | postoji |",
    "| roles | `server/roles` | gotovo |",
    "| http | `server/http` | postoji |",
    "",
    "## 2. Dopušteni uvozi",
    "",
    "| Područje | Smije uvoziti |",
    "|---|---|",
    "| domain | — |",
    "| log | `settings`, `metrics` |",
    "| log | `settings` |",
    "| metrics | settings |",
  ].join("\n");

  it("reads only the first table after the heading, without header", () => {
    expect(readTable(sample, "## 2. Dopušteni uvozi")).toEqual([
      ["domain", "—"],
      ["log", "`settings`, `metrics`"],
      ["log", "`settings`"],
      ["metrics", "settings"],
    ]);
    expect(readTable(sample, "## 9. Nema")).toEqual([]);
  });

  it("reports a wrong folder, an unknown status and a duplicate", () => {
    const { areas, problems } = readAreas(sample);
    expect(areas.map((a) => a.key)).toEqual(["http", "http"]);
    expect(problems).toEqual([
      "log: folder must be `server/log`",
      'roles: unknown status "gotovo"',
      "http: listed twice",
    ]);
  });

  it("reads import targets, reports a duplicate and a cell without backticks", () => {
    const { imports, problems } = readImports(sample);
    expect([...imports]).toEqual([
      ["domain", []],
      ["log", ["settings", "metrics"]],
    ]);
    expect(problems).toEqual(["log: listed twice", "metrics: write targets in backticks or —"]);
  });
});

describe("readCallers", () => {
  it("reads backticked names from the callers column", () => {
    const md = [
      "## 1. Područja",
      "| Područje | Mapa | Svrha | Tko ga zove | Podaci | Stanje |",
      "|---|---|---|---|---|---|",
      "| log | `server/log` | Zapisi | `http`, `sesion` | Baza zapisa | planirano |",
      "| roles | `server/roles` | Uloge | samo testovi | — | planirano |",
    ].join("\n");
    expect([...readCallers(md)]).toEqual([
      ["log", ["http", "sesion"]],
      ["roles", []],
    ]);
  });
});

describe("checkFolders", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("finds missing, unmarked and unmapped folders", () => {
    dir = mkdtempSync(join(tmpdir(), "server-map-"));
    for (const path of [
      "server/contracts",
      "server/http",
      "server/stray",
      "server/external/email",
    ]) {
      mkdirSync(join(dir, path), { recursive: true });
    }
    const folders = listAreaFolders(dir);
    expect(folders).toEqual(["contracts", "external/email", "http", "stray"]);
    const areas = [
      { key: "contracts", dir: "server/contracts", status: "postoji" },
      { key: "http", dir: "server/http", status: "planirano" },
      { key: "log", dir: "server/log", status: "postoji" },
      { key: "external/email", dir: "server/external/email", status: "postoji" },
    ] as const;
    expect(checkFolders([...areas], folders)).toEqual([
      "server/http exists: mark it postoji",
      "server/log is marked postoji but is missing",
      "server/stray is not in docs/server-map.md",
    ]);
  });
});

describe("copied folders", () => {
  it("reads the copied-folder table and lets only those folders stay unmapped", () => {
    const md = [
      "### Kopirane mape izvan karte",
      "",
      "| Mapa | Sadržaj |",
      "|---|---|",
      "| `server/copied` | x |",
      "| `server/http` | y |",
      "| `server/gone` | z |",
    ].join("\n");
    const copied = readCopiedFolders(md);
    expect(copied).toEqual(["copied", "http", "gone"]);
    const areas = [{ key: "http", dir: "server/http", status: "postoji" }] as const;
    expect(checkFolders([...areas], ["copied", "http", "stray"], copied)).toEqual([
      "server/http is an area: take it off the copied folders",
      "server/gone is listed as copied but is missing",
      "server/stray is not in docs/server-map.md",
    ]);
  });
});

describe("docs/server-map.md", () => {
  const { areas, problems } = readAreas(MAP);
  const keys = areas.map((a) => a.key);
  const { imports, problems: importProblems } = readImports(MAP);
  const importers = (target: string): string[] =>
    [...imports].filter(([, targets]) => targets.includes(target)).map(([area]) => area);

  it("lists exactly the required areas, each row well formed", () => {
    expect(problems).toEqual([]);
    expect([...keys].sort()).toEqual([...REQUIRED_AREAS].sort());
  });

  // Planned folders are only a list until S-1A-a creates them: this checks the
  // folders marked postoji, and that no folder exists unmapped or still planned.
  it("matches the folders under server/", () => {
    expect(areas.filter((a) => a.status === "postoji").length).toBeGreaterThan(0);
    expect(checkFolders(areas, listAreaFolders(ROOT), readCopiedFolders(MAP))).toEqual([]);
  });

  it("has an import row for every area, naming only known areas", () => {
    expect(importProblems).toEqual([]);
    expect([...imports.keys()].sort()).toEqual([...keys].sort());
    for (const [area, targets] of imports) {
      for (const target of targets) {
        expect(keys, `${area} imports ${target}`).toContain(target);
        expect(target, `${area} imports itself`).not.toBe(area);
      }
    }
  });

  it("keeps the inward direction of imports", () => {
    expect(imports.get("domain")).toEqual([]);
    expect(imports.get("contracts")).toEqual([]);
    expect(importers("http")).toEqual(["test-server"]);
    expect(importers("test-server")).toEqual([]);
    // Adapters reach only the shared infrastructure; storage and keys may also
    // use domain (Ductus#87 c.6884683623), still inward, as database does.
    // The assistant adapter implements the port type held in domain the same
    // way (SRV-1201, ai-request-v1 "Port i sintetički adapter").
    const infrastructure = ["settings", "log", "metrics"];
    const mayUseDomain = ["external/storage", "external/keys", "external/assistant"];
    for (const area of keys.filter((k) => k.startsWith("external/"))) {
      const allowed = mayUseDomain.includes(area) ? [...infrastructure, "domain"] : infrastructure;
      expect(
        imports.get(area)?.filter((t) => !allowed.includes(t)),
        `${area} imports`,
      ).toEqual([]);
    }
  });

  it("lets only storage, keys and the assistant among the adapters import domain", () => {
    expect(imports.get("external/storage")).toContain("domain");
    expect(imports.get("external/keys")).toContain("domain");
    expect(imports.get("external/srce-auth")).not.toContain("domain");
    expect(imports.get("external/email")).not.toContain("domain");
    expect(
      importers("domain")
        .filter((a) => a.startsWith("external/"))
        .sort(),
    ).toEqual(["external/assistant", "external/keys", "external/storage"]);
  });

  it("names as callers exactly the areas that may import each area", () => {
    for (const [area, callers] of readCallers(MAP)) {
      expect(
        callers.filter((c) => c !== "server.ts" && !keys.includes(c)),
        `${area}`,
      ).toEqual([]);
      const named = callers.filter((c) => keys.includes(c)).sort();
      expect(named, `callers of ${area}`).toEqual(importers(area).sort());
    }
  });
});

// S-1A-b (DAN-769): local/area-boundary lets through only the edges of
// AREA_IMPORTS. The table equals §2 of the map and has no cycle, so no cycle
// between areas can exist in the code (PLAN §3, rule 5).
function findCycle(graph: Readonly<Record<string, readonly string[]>>): string[] {
  const state = new Map<string, "open" | "done">();
  const visit = (node: string, trail: string[]): string[] => {
    if (state.get(node) === "done") return [];
    if (state.get(node) === "open") return [...trail.slice(trail.indexOf(node)), node];
    state.set(node, "open");
    for (const next of graph[node] ?? []) {
      const cycle = visit(next, [...trail, node]);
      if (cycle.length > 0) return cycle;
    }
    state.set(node, "done");
    return [];
  };
  for (const node of Object.keys(graph)) {
    const cycle = visit(node, []);
    if (cycle.length > 0) return cycle;
  }
  return [];
}

describe("the import table of local/area-boundary", () => {
  it("equals docs/server-map.md §2", () => {
    const { imports } = readImports(MAP);
    expect(
      Object.fromEntries(Object.entries(AREA_IMPORTS).map(([a, t]) => [a, [...t].sort()])),
    ).toEqual(Object.fromEntries([...imports].map(([a, t]) => [a, [...t].sort()])));
  });

  it("has no cycle", () => {
    expect(findCycle(AREA_IMPORTS)).toEqual([]);
  });

  it("finds a cycle when one edge would close it", () => {
    const log = [...(AREA_IMPORTS["log"] ?? []), "database"];
    expect(findCycle({ ...AREA_IMPORTS, log })).toEqual(["log", "database", "log"]);
    expect(findCycle({ a: ["a"] })).toEqual(["a", "a"]);
  });
});
