import {
  parseEditSteps,
  validateVersionedDocument,
  type EditStepSliceV3,
  type EditStepV3,
} from "../document/index.ts";
import { evidenceTransactionFormatOfWork } from "../forensics/index.ts";
import { isPlainObject } from "../json/index.ts";

import { categoryOfSource } from "./categories.ts";
import { SHARE_CATEGORIES, SHARE_NOTICE, SHARE_UNIT, type ShareCategory } from "./constants.ts";
import { sharePercents } from "./rounding.ts";
import { ShareStepRefused, splitRuns, TokenDocument, type Run } from "./token-document.ts";

/**
 * Share of the submitted text by recorded events (Ustav v1.6 C-6 (a);
 * docs/contracts/provenance-share-v1.md §1). Pure and deterministic: no
 * network, model, clock or I/O, and nothing is read from the content, rhythm,
 * time or style of the text (P-A, D-54). The category of a code point is the
 * category of the source of the event that inserted it, for as long as it
 * stays in the document.
 */

/** One event of the chain, in chain order: its source and its raw steps. */
export type ShareEvent = { readonly source: unknown; readonly steps: unknown };

export type ShareInput = {
  /** Revision 0 of the work: one block with no text (D-98). */
  readonly initialDocument: unknown;
  /** Every event from revision 0 to the submitted revision, in chain order. */
  readonly events: readonly ShareEvent[];
  /** The canonical document of the submitted revision, from the reconstruction. */
  readonly submittedDocument: unknown;
};

export type ShareCategoryCount = {
  category: ShareCategory;
  codePoints: number;
  percent: number;
};

/** `share` of the record (§3.1). */
export type ProvenanceShare = {
  unit: typeof SHARE_UNIT;
  totalCodePoints: number;
  categories: ShareCategoryCount[];
  notice: typeof SHARE_NOTICE;
};

/**
 * Why no share was computed. Internal only: the route shows `failed` with no
 * reason (§5).
 */
export type ShareFailure =
  | "invalid_document"
  | "unknown_source"
  | "unsupported_format"
  | "invalid_steps"
  | "step_failed"
  | "invariant_failed";

export type ShareResult =
  { ok: true; share: ProvenanceShare } | { ok: false; reason: ShareFailure };

type InlineChild = { type: string; text?: unknown };
type FlatBlock = { id: string; children: readonly InlineChild[] };

/**
 * The text blocks of a document of version 1 to 3, in document order. Each is
 * one top-level node; its text is the text of its text nodes, and an inline
 * atom (citation, footnote, cross reference) has no characters. That is the
 * text `textBlocksOf` gives without a citation rendering (§1.1).
 */
function flatBlocks(document: unknown): FlatBlock[] | "v4" | null {
  const outcome = validateVersionedDocument(document);
  if (!outcome.ok) return null;
  if (outcome.doc.schemaVersion === 4) return "v4";
  return (outcome.doc.nodes as readonly { id: string; children: InlineChild[] }[]).map((node) => ({
    id: node.id,
    children: node.children,
  }));
}

/** The parts of one block: text joined, an atom as `null`. */
type Part = string | null;

function partsOfChildren(children: readonly InlineChild[]): Part[] {
  const parts: Part[] = [];
  for (const child of children) {
    if (child.type === "text" && typeof child.text === "string") {
      const last = parts.length - 1;
      if (last >= 0 && typeof parts[last] === "string") parts[last] += child.text;
      else parts.push(child.text);
    } else parts.push(null);
  }
  return parts;
}

function initialRuns(blocks: readonly FlatBlock[]): Run[] | null {
  const runs: Run[] = [];
  for (const block of blocks) {
    // Revision 0 has no text, so every character comes from an event.
    if (block.children.length > 0) return null;
    runs.push({ kind: "open", id: block.id }, { kind: "close" });
  }
  return runs;
}

function inlineRuns(
  content: readonly { type: string; text?: string }[],
  category: ShareCategory,
): Run[] {
  return content.map((item) =>
    item.type === "text" ? { kind: "text", text: item.text ?? "", category } : { kind: "atom" },
  );
}

/** The tokens a slice inserts: an open side drops that side's block boundary. */
function sliceRuns(slice: EditStepSliceV3, category: ShareCategory): Run[] {
  const first = slice.content[0];
  if (first === undefined) return [];
  if (!("attrs" in first)) {
    return inlineRuns(slice.content as { type: string; text?: string }[], category);
  }
  const blocks = slice.content as Extract<EditStepSliceV3["content"][number], { attrs: unknown }>[];
  const runs: Run[] = [];
  blocks.forEach((block, i) => {
    if (!(i === 0 && slice.openStart === 1)) runs.push({ kind: "open", id: block.attrs.nodeId });
    runs.push(...inlineRuns(block.content ?? [], category));
    if (!(i === blocks.length - 1 && slice.openEnd === 1)) runs.push({ kind: "close" });
  });
  return runs;
}

function applyStep(document: TokenDocument, step: EditStepV3, category: ShareCategory): void {
  switch (step.stepType) {
    case "replace":
      document.replace(step.from, step.to, step.slice ? sliceRuns(step.slice, category) : []);
      return;
    case "replaceAround": {
      // The gap keeps its runs, so text that is only moved keeps its category.
      const gap = document.slice(step.gapFrom, step.gapTo);
      const [before, after] = splitRuns(sliceRuns(step.slice, category), step.insert);
      document.replace(step.from, step.to, [...before, ...gap, ...after]);
      return;
    }
    case "addMark":
    case "removeMark":
      document.checkRange(step.from, step.to);
      return;
    case "attr":
      document.setBlockId(step.pos, step.value);
      return;
    case "sourceSet":
    case "sourceRemove":
      return;
  }
}

function codePointLength(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    // A high surrogate followed by a low one is one code point.
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    length += 1;
  }
  return length;
}

/** The tokens as blocks: id, parts and code points per category. */
type CountedBlock = { id: string | null; parts: Part[]; counts: number[] };

function countedBlocks(runs: readonly Run[]): CountedBlock[] | null {
  const blocks: CountedBlock[] = [];
  let open: CountedBlock | null = null;
  for (const run of runs) {
    if (run.kind === "open") {
      if (open !== null) return null;
      open = { id: run.id, parts: [], counts: SHARE_CATEGORIES.map(() => 0) };
    } else if (run.kind === "close") {
      if (open === null) return null;
      blocks.push(open);
      open = null;
    } else if (open === null) {
      return null;
    } else if (run.kind === "atom") {
      open.parts.push(null);
    } else {
      const last = open.parts.length - 1;
      if (last >= 0 && typeof open.parts[last] === "string") open.parts[last] += run.text;
      else open.parts.push(run.text);
      const codePoints = codePointLength(run.text);
      const index = SHARE_CATEGORIES.indexOf(run.category);
      open.counts[index] = open.counts[index]! + codePoints;
    }
  }
  return open === null ? blocks : null;
}

function sameParts(a: readonly Part[], b: readonly Part[]): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}

/**
 * Computes the share of the submitted revision (§1.3, §1.4).
 *
 * Precondition: the caller has verified the evidence chain to the submitted
 * revision and replayed it with the editor's own replayer, which gave
 * `submittedDocument` (B-12). This function replays the same steps on its own
 * model of tokens, and the result must give exactly the blocks of
 * `submittedDocument`: the same ids, text and inline atoms, block by block,
 * with the code points of all categories in a block adding up to the length
 * of its text (the invariant of §1.3). Anything else is a failure, never a
 * share: an unknown source, a step this model cannot apply, a document of
 * version 4 (whose steps no replayer reads yet) or a mismatch at the end.
 */
export function computeProvenanceShare(input: ShareInput): ShareResult {
  const initial = flatBlocks(input.initialDocument);
  const submitted = flatBlocks(input.submittedDocument);
  // No replayer reads the steps of document v4 yet (SRV-10A), so neither can this.
  if (initial === "v4" || submitted === "v4") return { ok: false, reason: "unsupported_format" };
  if (initial === null || submitted === null || !isPlainObject(input.initialDocument)) {
    return { ok: false, reason: "invalid_document" };
  }
  const version = input.initialDocument.schemaVersion;
  if (
    !isPlainObject(input.submittedDocument) ||
    input.submittedDocument.schemaVersion !== version
  ) {
    return { ok: false, reason: "invalid_document" };
  }
  const runs = initialRuns(initial);
  if (runs === null) return { ok: false, reason: "invalid_document" };
  const format = evidenceTransactionFormatOfWork(version);

  const document = new TokenDocument(runs);
  for (const event of input.events) {
    const category = categoryOfSource(event.source);
    if (category === null) return { ok: false, reason: "unknown_source" };
    const parsed = parseEditSteps(format as unknown, event.steps);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: parsed.code === "unsupported_format" ? "unsupported_format" : "invalid_steps",
      };
    }
    try {
      for (const step of parsed.steps as EditStepV3[]) applyStep(document, step, category);
    } catch (error) {
      if (error instanceof ShareStepRefused) return { ok: false, reason: "step_failed" };
      throw error;
    }
  }

  const blocks = countedBlocks(document.runs);
  if (blocks === null || blocks.length !== submitted.length) {
    return { ok: false, reason: "invariant_failed" };
  }
  const totals = SHARE_CATEGORIES.map(() => 0);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const expected = submitted[i]!;
    const parts = partsOfChildren(expected.children);
    const length = parts.reduce<number>(
      (sum, part) => sum + (part === null ? 0 : codePointLength(part)),
      0,
    );
    const counted = block.counts.reduce((sum, count) => sum + count, 0);
    if (block.id !== expected.id || !sameParts(block.parts, parts) || counted !== length) {
      return { ok: false, reason: "invariant_failed" };
    }
    block.counts.forEach((count, k) => (totals[k] = totals[k]! + count));
  }

  const percents = sharePercents(totals);
  return {
    ok: true,
    share: {
      unit: SHARE_UNIT,
      totalCodePoints: totals.reduce((sum, count) => sum + count, 0),
      categories: SHARE_CATEGORIES.map((category, k) => ({
        category,
        codePoints: totals[k]!,
        percent: percents[k]!,
      })),
      notice: SHARE_NOTICE,
    },
  };
}
