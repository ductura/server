import type { ShareCategory } from "./constants.ts";

/**
 * A document of format `ductus-edit-steps-v1` or `-v3` as a flat run of
 * ProseMirror tokens, with the category of every character (§1.3).
 *
 * The documents of these formats are one level of text blocks, so the content
 * of the ProseMirror document is a flat sequence: the start of a block, its
 * characters (one UTF-16 unit each) and inline atoms (a citation, a footnote,
 * a cross reference: one position each), the end of the block. A position of
 * ProseMirror is the index of a token in that sequence. A `replace` step that
 * ProseMirror applies exactly (it never wraps or fills) is then a splice of
 * the token sequence, and a `replaceAround` step a splice with the gap moved
 * into the slice; nothing else changes the tokens.
 *
 * Characters stay in runs of one category, so a long typed text is one run
 * and a step costs about the number of runs, not of characters. A cursor
 * keeps the last position found, since edits are local.
 *
 * This model never decides whether a step is allowed: the caller replays the
 * chain with the editor's own replayer first. Every check here only stops a
 * step this model cannot apply, and the result is compared with the submitted
 * document at the end (`share.ts`).
 */

export type TextRun = { kind: "text"; text: string; category: ShareCategory };
export type Run =
  { kind: "open"; id: string | null } | { kind: "close" } | { kind: "atom" } | TextRun;

/** Thrown when a step cannot be applied to the model. */
export class ShareStepRefused extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`provenance share step refused: ${code}`);
    this.code = code;
    this.name = "ShareStepRefused";
  }
}

export function refuseStep(code: string): never {
  throw new ShareStepRefused(code);
}

export function runSize(run: Run): number {
  return run.kind === "text" ? run.text.length : 1;
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** Two text runs of one category become one. */
function mergeable(a: Run | undefined, b: Run | undefined): boolean {
  return a?.kind === "text" && b?.kind === "text" && a.category === b.category;
}

export class TokenDocument {
  readonly runs: Run[];
  #size: number;
  // Index of a run and the position where it starts; always valid.
  #cursorIndex = 0;
  #cursorStart = 0;

  constructor(runs: Run[]) {
    this.runs = runs.filter((run) => runSize(run) > 0);
    this.#size = this.runs.reduce((sum, run) => sum + runSize(run), 0);
  }

  get size(): number {
    return this.#size;
  }

  #checkPosition(pos: number): void {
    if (!Number.isSafeInteger(pos) || pos < 0 || pos > this.#size) {
      refuseStep("position_outside_document");
    }
  }

  /**
   * Makes `pos` a boundary between runs and returns the index of the run that
   * starts there (`runs.length` at the end). A text run is divided, never
   * between the two halves of a surrogate pair.
   */
  #boundary(pos: number): number {
    this.#checkPosition(pos);
    let index = this.#cursorIndex;
    let start = this.#cursorStart;
    while (start > pos) {
      index -= 1;
      start -= runSize(this.runs[index]!);
    }
    while (index < this.runs.length && start + runSize(this.runs[index]!) <= pos) {
      start += runSize(this.runs[index]!);
      index += 1;
    }
    this.#cursorIndex = index;
    this.#cursorStart = start;
    if (start === pos || index === this.runs.length) {
      return index;
    }
    const run = this.runs[index]!;
    if (run.kind !== "text") {
      return refuseStep("position_inside_token");
    }
    const offset = pos - start;
    if (isHigh(run.text.charCodeAt(offset - 1)) && isLow(run.text.charCodeAt(offset))) {
      refuseStep("position_splits_surrogate_pair");
    }
    this.runs.splice(
      index,
      1,
      { kind: "text", text: run.text.slice(0, offset), category: run.category },
      { kind: "text", text: run.text.slice(offset), category: run.category },
    );
    this.#cursorIndex = index + 1;
    this.#cursorStart = pos;
    return index + 1;
  }

  /** Copies of the runs in `from..to`, which stay in the document. */
  slice(from: number, to: number): Run[] {
    if (to < from) refuseStep("invalid_range");
    const start = this.#boundary(from);
    const end = this.#boundary(to);
    return this.runs.slice(start, end);
  }

  /** Replaces the tokens in `from..to` with `inserted`. */
  replace(from: number, to: number, inserted: readonly Run[]): void {
    if (to < from) refuseStep("invalid_range");
    const start = this.#boundary(from);
    const end = this.#boundary(to);
    const added = inserted.filter((run) => runSize(run) > 0);
    const removed = this.runs.splice(start, end - start, ...added);
    this.#size +=
      added.reduce((sum, run) => sum + runSize(run), 0) -
      removed.reduce((sum, run) => sum + runSize(run), 0);
    this.#cursorIndex = start;
    this.#cursorStart = from;
    this.#merge(start + added.length);
    this.#merge(start);
  }

  /** Joins the runs at `index - 1` and `index` when they are text of one category. */
  #merge(index: number): void {
    const before = this.runs[index - 1];
    const after = this.runs[index];
    if (!mergeable(before, after)) return;
    const merged = before as TextRun;
    this.runs.splice(index - 1, 2, {
      kind: "text",
      text: merged.text + (after as TextRun).text,
      category: merged.category,
    });
    if (this.#cursorIndex >= index) {
      // The cursor stood on the second run or after it.
      if (this.#cursorIndex === index) this.#cursorStart -= merged.text.length;
      this.#cursorIndex -= 1;
    }
  }

  /** Gives the start of the block at `pos` the node id `value`. */
  setBlockId(pos: number, value: string): void {
    if (pos >= this.#size) refuseStep("position_outside_document");
    const index = this.#boundary(pos);
    const run = this.runs[index];
    if (run?.kind !== "open") {
      refuseStep("attr_not_on_block");
    }
    this.runs[index] = { kind: "open", id: value };
  }

  /** Checks that `from..to` lies in the document, for a step that changes no token. */
  checkRange(from: number, to: number): void {
    this.#checkPosition(from);
    this.#checkPosition(to);
    if (to < from) refuseStep("invalid_range");
  }
}

/**
 * Splits `runs` at token offset `offset`, for the `insert` of a
 * `replaceAround` step. Atoms and block boundaries are never divided.
 */
export function splitRuns(runs: readonly Run[], offset: number): [Run[], Run[]] {
  let start = 0;
  for (let index = 0; index < runs.length; index++) {
    if (start === offset) return [runs.slice(0, index), runs.slice(index)];
    const run = runs[index]!;
    const size = runSize(run);
    if (offset < start + size) {
      if (run.kind !== "text") refuseStep("insert_inside_token");
      const cut = offset - start;
      return [
        [
          ...runs.slice(0, index),
          { kind: "text", text: run.text.slice(0, cut), category: run.category },
        ],
        [
          { kind: "text", text: run.text.slice(cut), category: run.category },
          ...runs.slice(index + 1),
        ],
      ];
    }
    start += size;
  }
  if (start === offset) return [runs.slice(), []];
  return refuseStep("insert_outside_slice");
}
