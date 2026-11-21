// docs/contracts/provenance-share-v1.md §10, "arhitektura" (P-A): the module
// imports no adapter, network, server/external/** or assistant code, and calls
// no model. Its production files reach only document, forensics and json in
// server/domain, through their index.ts, and node:crypto.
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as share from "./index.ts";

const DIR = new URL("./", import.meta.url);
const CODE = readdirSync(DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
const ALLOWED = new Set([
  "../document/index.ts",
  "../forensics/index.ts",
  "../json/index.ts",
  "node:crypto",
]);

function imports(text: string): string[] {
  return [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gms)].map((m) => m[1]!);
}

describe("server/domain/provenance-share boundaries", () => {
  it("finds its code files", () => {
    expect(CODE.sort()).toEqual([
      "categories.ts",
      "constants.ts",
      "index.ts",
      "record.ts",
      "rounding.ts",
      "share.ts",
      "token-document.ts",
    ]);
  });

  it.each(CODE)(
    "%s imports only its own files, document, forensics, json and node:crypto",
    (name) => {
      const text = readFileSync(new URL(name, DIR), "utf8");
      for (const spec of imports(text)) {
        const own = /^\.\/[a-z-]+\.ts$/.test(spec);
        expect(own || ALLOWED.has(spec), `${name}: ${spec}`).toBe(true);
      }
      expect(text).not.toMatch(/\bimport\s*\(/);
      expect(text).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|require)\s*\(/);
      expect(text).not.toMatch(/assistant|external\//);
    },
  );

  it("exports the computation and the record, and nothing that names a model", () => {
    expect(typeof share.computeProvenanceShare).toBe("function");
    expect(typeof share.parseProvenanceRecordV1Bytes).toBe("function");
    expect(Object.keys(share).filter((key) => /model|score|risk|detect/i.test(key))).toEqual([]);
  });
});
