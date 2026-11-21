/**
 * Closed values and limits of `ductura-provenance-share-v1`
 * (docs/contracts/provenance-share-v1.md §1.2, §3 and §7).
 */

/** `provenanceSchema` of the record (§3, [OC6-6]). */
export const PROVENANCE_RECORD_SCHEMA_V1 = "ductura-provenance-share-v1" as const;

/** The unit of the share: one Unicode code point of the submitted text (§1.1). */
export const SHARE_UNIT = "code_point" as const;

/**
 * The share categories, in their fixed order (§1.2, [OC6-2]). The order is the
 * order of `share.categories` and the last tie-break of the rounding (§1.4).
 */
export const SHARE_CATEGORIES = [
  "written",
  "ai_transferred",
  "pasted",
  "imported",
  "unattributed",
] as const;

export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

/**
 * The notice every percent and every mark carries (P-B, §6). A record without
 * it, or with another value, is refused. The interface text is a catalogue
 * key ([OC6-1]); this is only the closed value in the record.
 */
export const SHARE_NOTICE = "not_authorship_evidence" as const;

/** `aiMatch.normalization` of a v1 record (§2.2); a change is a new value. */
export const MATCH_NORMALIZATION = "ductura-match-norm-v1" as const;

/**
 * How many times the worker may compute the record of one submission before
 * the state is `failed` (§4). Proposed value; the worker that uses it comes
 * with the storage step.
 */
export const MAX_SHARE_ATTEMPTS = 3;
