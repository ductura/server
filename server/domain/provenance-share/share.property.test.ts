// docs/contracts/provenance-share-v1.md §1.3 and §1.4, properties over random
// chains: the invariant (code points per block add up to the block's text),
// percents that add up to exactly 100 for T > 0, 0 % for a category with no
// code points, and the same bytes for the same chain. The chain is built from
// a model kept apart from the module: blocks as lists of code points, each
// with the category of the event that put it in. Text is invented.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { revisionZeroDocument } from "../document/index.ts";
import { canonicalizeJcs } from "../forensics/index.ts";

import { SHARE_CATEGORIES, type ShareCategory } from "./constants.ts";
import { computeProvenanceShare, type ShareEvent } from "./share.ts";

const SOURCES: readonly [string, ShareCategory][] = [
  ["editor", "written"],
  ["composition", "written"],
  ["keyless-input", "written"],
  ["ai-transfer", "ai_transferred"],
  ["paste", "pasted"],
  ["drop", "pasted"],
  ["import", "imported"],
  ["unattributed", "unattributed"],
  ["cut", "unattributed"],
];
const ALPHABET = ["a", "č", "Ž", " ", "🌱", "1", ".", "đ"];
const HASH = "0".repeat(64);
const FIRST_ID = "00000000-0000-4000-8000-000000000000";

type Char = { text: string; category: ShareCategory };
type Block = { id: string; chars: Char[] };

const units = (chars: readonly Char[]) => chars.reduce((sum, char) => sum + char.text.length, 0);

/** Position of the start of block `index` and of offset `offset` (in code points) inside it. */
function position(blocks: readonly Block[], index: number, offset: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += units(blocks[i]!.chars) + 2;
  return pos + 1 + units(blocks[index]!.chars.slice(0, offset));
}

type Op =
  | { kind: "insert"; source: number; block: number; at: number; text: string[] }
  | { kind: "delete"; source: number; block: number; at: number; length: number }
  | { kind: "split"; source: number; block: number; at: number }
  | { kind: "join"; source: number; block: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant("insert" as const),
      source: fc.nat(),
      block: fc.nat(),
      at: fc.nat(),
      text: fc.array(fc.constantFrom(...ALPHABET), { minLength: 1, maxLength: 12 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("delete" as const),
      source: fc.nat(),
      block: fc.nat(),
      at: fc.nat(),
      length: fc.integer({ min: 1, max: 8 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("split" as const),
      source: fc.nat(),
      block: fc.nat(),
      at: fc.nat(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("join" as const), source: fc.nat(), block: fc.nat() }),
  },
);

/** Runs the ops on the model and writes the event of each one that changes something. */
function chain(ops: readonly Op[]): { events: ShareEvent[]; blocks: Block[] } {
  const blocks: Block[] = [{ id: FIRST_ID, chars: [] }];
  const events: ShareEvent[] = [];
  let ids = 0;
  for (const item of ops) {
    const [source, category] = SOURCES[item.source % SOURCES.length]!;
    const index = item.block % blocks.length;
    const block = blocks[index]!;
    if (item.kind === "insert") {
      const at = item.at % (block.chars.length + 1);
      const pos = position(blocks, index, at);
      const text = item.text.join("");
      events.push({
        source,
        steps: [
          { stepType: "replace", from: pos, to: pos, slice: { content: [{ type: "text", text }] } },
        ],
      });
      block.chars.splice(at, 0, ...item.text.map((char) => ({ text: char, category })));
    } else if (item.kind === "delete") {
      if (block.chars.length === 0) continue;
      const at = item.at % block.chars.length;
      const length = Math.min(item.length, block.chars.length - at);
      const from = position(blocks, index, at);
      const to = position(blocks, index, at + length);
      events.push({ source, steps: [{ stepType: "replace", from, to, removedSha256: HASH }] });
      block.chars.splice(at, length);
    } else if (item.kind === "split") {
      const at = item.at % (block.chars.length + 1);
      const pos = position(blocks, index, at);
      ids += 1;
      const id = `${ids.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
      events.push({
        source,
        steps: [
          {
            stepType: "replace",
            from: pos,
            to: pos,
            structure: true,
            slice: {
              content: [
                { type: "paragraph", attrs: { nodeId: block.id } },
                { type: "paragraph", attrs: { nodeId: null } },
              ],
              openStart: 1,
              openEnd: 1,
            },
          },
          { stepType: "attr", attr: "nodeId", pos: pos + 1, value: id },
        ],
      });
      blocks.splice(index + 1, 0, { id, chars: block.chars.splice(at) });
    } else {
      if (index + 1 >= blocks.length) continue;
      const close = position(blocks, index + 1, 0) - 2;
      events.push({
        source,
        steps: [{ stepType: "replace", from: close, to: close + 2, structure: true }],
      });
      block.chars.push(...blocks[index + 1]!.chars);
      blocks.splice(index + 1, 1);
    }
  }
  return { events, blocks };
}

function documentOf(blocks: readonly Block[]): unknown {
  return {
    schemaVersion: 1,
    nodes: blocks.map((block) => {
      const text = block.chars.map((char) => char.text).join("");
      return {
        type: "paragraph",
        id: block.id,
        children: text === "" ? [] : [{ type: "text", text, marks: [] }],
      };
    }),
  };
}

describe("computeProvenanceShare over random chains", () => {
  it("counts every code point once, in the category of the event that put it in", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
        const { events, blocks } = chain(ops);
        const input = {
          initialDocument: revisionZeroDocument(),
          events,
          submittedDocument: documentOf(blocks),
        };
        const result = computeProvenanceShare(input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const expected = SHARE_CATEGORIES.map(
          (category) =>
            blocks.flatMap((block) => block.chars).filter((char) => char.category === category)
              .length,
        );
        expect(result.share.categories.map((item) => item.codePoints)).toEqual(expected);
        const total = expected.reduce((sum, count) => sum + count, 0);
        expect(result.share.totalCodePoints).toBe(total);
        const percents = result.share.categories.map((item) => item.percent);
        expect(percents.reduce((sum, percent) => sum + percent, 0)).toBe(total > 0 ? 100 : 0);
        result.share.categories.forEach((item) => {
          if (item.codePoints === 0) expect(item.percent).toBe(0);
          expect(Number.isInteger(item.percent)).toBe(true);
        });
        // The same chain gives the same bytes.
        expect(canonicalizeJcs(computeProvenanceShare(structuredClone(input)))).toBe(
          canonicalizeJcs(result),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("gives no share when the submitted document differs from the chain", () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 30 }), fc.nat(), (ops, pick) => {
        const { events, blocks } = chain(ops);
        const target = blocks[pick % blocks.length]!;
        target.chars.push({ text: "x", category: "written" });
        const result = computeProvenanceShare({
          initialDocument: revisionZeroDocument(),
          events,
          submittedDocument: documentOf(blocks),
        });
        expect(result).toEqual({ ok: false, reason: "invariant_failed" });
      }),
      { numRuns: 150 },
    );
  });
});
