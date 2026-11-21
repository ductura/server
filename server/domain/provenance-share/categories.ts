import type { ShareCategory } from "./constants.ts";

/**
 * The category of every evidence source of formats v2 to v4 (§1.2). The set
 * is closed: a source missing here, including a reserved one or one a later
 * format adds, has no category, and the share of a chain that holds it is
 * `failed`, never a silent category.
 *
 * - `keyless-input` is text typed into Ductura's editor; the category does not
 *   claim it was typed on keys ([OC6-2]).
 * - `paste` is `pasted` with or without `pasteOrigin`: an observed paste and
 *   an observed transfer are different facts (D-44).
 * - `cut` puts no text in on its own; any text it does insert has no positive
 *   attribution (D-54).
 */
const CATEGORY_OF_SOURCE: ReadonlyMap<string, ShareCategory> = new Map<string, ShareCategory>([
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
]);

/** The category of an evidence source, or `null` for a source without one. */
export function categoryOfSource(source: unknown): ShareCategory | null {
  return typeof source === "string" ? (CATEGORY_OF_SOURCE.get(source) ?? null) : null;
}
