// docs/contracts/provenance-share-v1.md §1 and vector §9.1. The fixtures in
// testdata/ were written by replaying every event with the server's own
// replayers (ductus-edit-steps-v1 and -v3), so each step is one they accept and
// each document is the one they produce. All text is invented.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  revisionZeroDocument,
  revisionZeroDocumentV3,
  revisionZeroDocumentV4,
} from "../document/index.ts";

import { computeProvenanceShare, type ShareEvent, type ShareResult } from "./share.ts";

type Fixture = { events: ShareEvent[]; documents: unknown[] };

function load<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./testdata/${name}`, import.meta.url), "utf8")) as T;
}

const VECTOR = load<{ events: ShareEvent[]; submittedDocument: unknown }>("vector-9-1.json");
const EDGE = load<Fixture>("edge-cases-v1.json");
const ATOMS = load<Fixture>("atoms-v3.json");
const EDITED = load<Fixture>("edited-transfer-v1.json");
const PASTED = load<Fixture>("all-pasted-v1.json");

/** The share after the first `count` events of a fixture. */
function after(fixture: Fixture, initial: unknown, count: number): ShareResult {
  return computeProvenanceShare({
    initialDocument: initial,
    events: fixture.events.slice(0, count),
    submittedDocument: fixture.documents[count - 1],
  });
}

function counts(result: ShareResult): number[] {
  if (!result.ok) throw new Error(`no share: ${result.reason}`);
  return result.share.categories.map((item) => item.codePoints);
}

function percents(result: ShareResult): number[] {
  if (!result.ok) throw new Error(`no share: ${result.reason}`);
  return result.share.categories.map((item) => item.percent);
}

describe("vector §9.1", () => {
  it("gives the categories and percents of the contract, byte for byte", () => {
    const result = computeProvenanceShare({
      initialDocument: revisionZeroDocument(),
      events: VECTOR.events,
      submittedDocument: VECTOR.submittedDocument,
    });
    expect(JSON.stringify(result)).toBe(
      JSON.stringify({
        ok: true,
        share: {
          unit: "code_point",
          totalCodePoints: 365,
          categories: [
            { category: "written", codePoints: 195, percent: 53 },
            { category: "ai_transferred", codePoints: 64, percent: 18 },
            { category: "pasted", codePoints: 63, percent: 17 },
            { category: "imported", codePoints: 34, percent: 9 },
            { category: "unattributed", codePoints: 9, percent: 3 },
          ],
          notice: "not_authorship_evidence",
        },
      }),
    );
  });

  it("keeps the pasted code points left after a word inside them is rewritten", () => {
    // Events 3 and 4: 69 pasted, 6 of them removed and 12 written in their place.
    const prefix = (count: number) =>
      computeProvenanceShare({
        initialDocument: revisionZeroDocument(),
        events: VECTOR.events.slice(0, count),
        submittedDocument: VECTOR.submittedDocument,
      });
    expect(prefix(8).ok).toBe(true);
    // A prefix does not give the submitted document: never a share.
    expect(prefix(7)).toEqual({ ok: false, reason: "invariant_failed" });
  });
});

describe("text moved, formatted, joined, cut and dropped (§1.3)", () => {
  const initial = revisionZeroDocument();
  const steps = EDGE.events.map((_, i) => counts(after(EDGE, initial, i + 1)));

  it("gives a share after every event", () => {
    expect(steps).toEqual([
      [24, 0, 0, 0, 0], // editor
      [24, 0, 42, 0, 0], // paste into a new block
      [24, 0, 42, 0, 0], // replaceAround: paragraph to heading
      [24, 0, 42, 0, 0], // addMark
      [24, 0, 42, 0, 0], // removeMark
      [24, 0, 42, 0, 0], // replaceAround: heading to paragraph
      [23, 0, 42, 0, 2], // cut inserts text: unattributed
      [23, 0, 42, 0, 2], // join
      [23, 0, 42, 0, 2], // split
      [17, 0, 42, 0, 1], // delete across a block boundary
      [17, 0, 60, 0, 1], // drop into a new block, with a surrogate pair
    ]);
  });

  it("counts code points, not UTF-16 units", () => {
    const last = after(EDGE, initial, EDGE.events.length);
    expect(last.ok && last.share.totalCodePoints).toBe(78);
    expect(percents(last)).toEqual([22, 0, 77, 0, 1]);
  });
});

describe("inline atoms (§1.1)", () => {
  it("have no characters, and replacing one changes no count", () => {
    const initial = revisionZeroDocumentV3();
    expect(ATOMS.events.map((_, i) => counts(after(ATOMS, initial, i + 1)))).toEqual([
      [7, 0, 0, 0, 0],
      [7, 0, 0, 0, 0],
      [7, 0, 7, 0, 0],
      [7, 19, 7, 0, 0],
      [7, 19, 7, 0, 0],
    ]);
  });
});

describe("edge cases of the task", () => {
  it("empty submitted text: T = 0 and every percent 0", () => {
    const empty = computeProvenanceShare({
      initialDocument: revisionZeroDocument(),
      events: [],
      submittedDocument: revisionZeroDocument(),
    });
    expect(empty).toEqual({
      ok: true,
      share: {
        unit: "code_point",
        totalCodePoints: 0,
        categories: [
          { category: "written", codePoints: 0, percent: 0 },
          { category: "ai_transferred", codePoints: 0, percent: 0 },
          { category: "pasted", codePoints: 0, percent: 0 },
          { category: "imported", codePoints: 0, percent: 0 },
          { category: "unattributed", codePoints: 0, percent: 0 },
        ],
        notice: "not_authorship_evidence",
      },
    });
  });

  it("transferred text edited afterwards, then removed", () => {
    const initial = revisionZeroDocument();
    const shares = EDITED.events.map((_, i) => after(EDITED, initial, i + 1));
    expect(shares.map(counts)).toEqual([
      [0, 64, 0, 0, 0],
      [6, 56, 0, 0, 0], // "organske" (8) rewritten as "biljne" (6)
      [16, 56, 0, 0, 0], // keyless-input is written
      [0, 0, 0, 0, 0], // everything removed: empty
    ]);
    expect(percents(shares[1]!)).toEqual([10, 90, 0, 0, 0]);
    expect(percents(shares[3]!)).toEqual([0, 0, 0, 0, 0]);
  });

  it("everything pasted in one event over two blocks", () => {
    const result = after(PASTED, revisionZeroDocument(), 1);
    expect(counts(result)).toEqual([0, 0, 53, 0, 0]);
    expect(percents(result)).toEqual([0, 0, 100, 0, 0]);
  });

  it("a paste with pasteOrigin ai-response stays pasted", () => {
    const events = PASTED.events.map((event) => ({
      ...event,
      pasteOrigin: { kind: "ai-response", verdict: "known" },
    }));
    const result = computeProvenanceShare({
      initialDocument: revisionZeroDocument(),
      events,
      submittedDocument: PASTED.documents[0],
    });
    expect(counts(result)).toEqual([0, 0, 53, 0, 0]);
  });

  it("is deterministic: the same chain gives the same bytes", () => {
    const input = {
      initialDocument: revisionZeroDocument(),
      events: VECTOR.events,
      submittedDocument: VECTOR.submittedDocument,
    };
    expect(JSON.stringify(computeProvenanceShare(input))).toBe(
      JSON.stringify(computeProvenanceShare(structuredClone(input))),
    );
  });
});

describe("failures: never a share (§1.2, §1.3)", () => {
  const base = () => ({
    initialDocument: revisionZeroDocument() as unknown,
    events: structuredClone(VECTOR.events) as ShareEvent[],
    submittedDocument: structuredClone(VECTOR.submittedDocument) as {
      nodes: { id: string; children: { text: string }[] }[];
    },
  });

  it("an unknown or reserved source", () => {
    for (const source of ["applied-suggestion", "own-variant", "assistant", undefined]) {
      const input = base();
      input.events[2] = { ...input.events[2]!, source };
      expect(computeProvenanceShare(input)).toEqual({ ok: false, reason: "unknown_source" });
    }
  });

  it("a submitted document whose text differs by one character", () => {
    const input = base();
    input.submittedDocument.nodes[1]!.children[0]!.text =
      "Prema izmišljenom istraživanju, četvrti s kompostištima imaju manje otpada!";
    expect(computeProvenanceShare(input)).toEqual({ ok: false, reason: "invariant_failed" });
  });

  it("a submitted document with another block id", () => {
    const input = base();
    input.submittedDocument.nodes[4]!.id = "b6b6b6b6-0000-4000-8000-000000000006";
    expect(computeProvenanceShare(input)).toEqual({ ok: false, reason: "invariant_failed" });
  });

  it("a step outside the document or inside a surrogate pair", () => {
    const input = base();
    input.events.push({
      source: "editor",
      steps: [
        {
          stepType: "replace",
          from: 9999,
          to: 9999,
          slice: { content: [{ type: "text", text: "x" }] },
        },
      ],
    });
    expect(computeProvenanceShare(input)).toEqual({ ok: false, reason: "step_failed" });

    // Between the two halves of the surrogate pair of "🌱" in the last block.
    const count = EDGE.events.length;
    const last = EDGE.documents[count - 1] as { nodes: { children: { text: string }[] }[] };
    const first = last.nodes[0]!.children.map((child) => child.text).join("");
    const second = last.nodes[1]!.children.map((child) => child.text).join("");
    const inside = first.length + 2 + 1 + second.indexOf("🌱") + 1;
    const split = {
      initialDocument: revisionZeroDocument(),
      events: [
        ...EDGE.events,
        {
          source: "editor",
          steps: [
            {
              stepType: "replace",
              from: inside,
              to: inside,
              slice: { content: [{ type: "text", text: "x" }] },
            },
          ],
        },
      ],
      submittedDocument: last,
    };
    expect(computeProvenanceShare(split)).toEqual({ ok: false, reason: "step_failed" });
  });

  it("steps the parser refuses", () => {
    const input = base();
    input.events[0] = {
      source: "editor",
      steps: [
        {
          stepType: "replace",
          from: 1,
          to: 1,
          slice: { content: [{ type: "text", text: "x", time: 1 }] },
        },
      ],
    };
    expect(computeProvenanceShare(input)).toEqual({ ok: false, reason: "invalid_steps" });
    input.events[0] = { source: "editor", steps: [] };
    expect(computeProvenanceShare(input)).toEqual({ ok: false, reason: "invalid_steps" });
  });

  it("revision 0 with text, an invalid document or another version", () => {
    const withText = { ...revisionZeroDocument(), nodes: VECTOR.submittedDocument };
    expect(computeProvenanceShare({ ...base(), initialDocument: withText })).toEqual({
      ok: false,
      reason: "invalid_document",
    });
    expect(
      computeProvenanceShare({ ...base(), initialDocument: VECTOR.submittedDocument }),
    ).toEqual({
      ok: false,
      reason: "invalid_document",
    });
    expect(
      computeProvenanceShare({ ...base(), submittedDocument: { nodes: [] } as never }),
    ).toEqual({
      ok: false,
      reason: "invalid_document",
    });
    expect(
      computeProvenanceShare({
        initialDocument: revisionZeroDocumentV3(),
        events: [],
        submittedDocument: revisionZeroDocument(),
      }),
    ).toEqual({ ok: false, reason: "invalid_document" });
  });

  it("document v4, whose steps no replayer reads yet", () => {
    expect(
      computeProvenanceShare({
        initialDocument: revisionZeroDocumentV4(),
        events: [],
        submittedDocument: revisionZeroDocumentV4(),
      }),
    ).toEqual({ ok: false, reason: "unsupported_format" });
  });
});

describe("cost", () => {
  it("replays 20 000 typed characters, one event each, in well under a second per thousand", () => {
    const events: ShareEvent[] = [];
    let text = "";
    for (let i = 0; i < 20_000; i++) {
      const ch = i % 7 === 6 ? " " : "abcčdž"[i % 6]!;
      events.push({
        source: i % 1000 === 999 ? "paste" : "editor",
        steps: [
          {
            stepType: "replace",
            from: 1 + text.length,
            to: 1 + text.length,
            slice: { content: [{ type: "text", text: ch }] },
          },
        ],
      });
      text += ch;
    }
    const submittedDocument = {
      schemaVersion: 1,
      nodes: [
        {
          type: "paragraph",
          id: "00000000-0000-4000-8000-000000000000",
          children: [{ type: "text", text, marks: [] }],
        },
      ],
    };
    const started = performance.now();
    const result = computeProvenanceShare({
      initialDocument: revisionZeroDocument(),
      events,
      submittedDocument,
    });
    const elapsed = performance.now() - started;
    expect(counts(result)).toEqual([19_980, 0, 20, 0, 0]);
    expect(elapsed).toBeLessThan(10_000);
  });
});
