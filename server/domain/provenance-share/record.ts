import { createHash } from "node:crypto";

import { isNodeId } from "../document/index.ts";
import { canonicalizeJcs, jcsUtf8Bytes } from "../forensics/index.ts";
import { isPlainObject } from "../json/index.ts";

import {
  MATCH_NORMALIZATION,
  PROVENANCE_RECORD_SCHEMA_V1,
  SHARE_CATEGORIES,
  SHARE_NOTICE,
  SHARE_UNIT,
} from "./constants.ts";
import { sharePercents } from "./rounding.ts";
import type { ProvenanceShare } from "./share.ts";

/**
 * The record `ductura-provenance-share-v1` (docs/contracts/provenance-share-v1.md
 * §3): one JCS object with a closed set of keys at every level. It holds no
 * name, course, institution or text of the work. `recordSha256` is the
 * SHA-256 of its JCS bytes and is stored next to it, never in it.
 */

/** One mark of `aiMatch` (§3.2): a range of code points of one block, `to` exclusive. */
export type AiMatchSpan = { blockId: string; from: number; to: number };

/** `aiMatch` of the record (§3.2). The match itself is computed elsewhere (SRV-1222). */
export type AiMatch = {
  normalization: typeof MATCH_NORMALIZATION;
  minMatchCodePoints: number;
  spans: AiMatchSpan[];
  notice: typeof SHARE_NOTICE;
};

export type ProvenanceRecordV1 = {
  provenanceSchema: typeof PROVENANCE_RECORD_SCHEMA_V1;
  submissionId: string;
  documentId: string;
  revision: number;
  share: ProvenanceShare;
  aiMatch: AiMatch;
  computedAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMPUTED_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;

/** Exactly these own keys, no more and no fewer. */
function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isCount(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

/** Canonical UTC time with six decimals that names a real moment (§3). */
function isComputedAt(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = COMPUTED_AT.exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const time = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    time.getUTCFullYear() === year &&
    time.getUTCMonth() === month - 1 &&
    time.getUTCDate() === day &&
    time.getUTCHours() === hour &&
    time.getUTCMinutes() === minute &&
    time.getUTCSeconds() === second
  );
}

/** `share` (§3.1): five categories in the fixed order, percents exactly from §1.4. */
export function isProvenanceShare(value: unknown): value is ProvenanceShare {
  if (
    !isPlainObject(value) ||
    !hasKeys(value, ["unit", "totalCodePoints", "categories", "notice"])
  ) {
    return false;
  }
  if (value.unit !== SHARE_UNIT || value.notice !== SHARE_NOTICE) return false;
  if (!isCount(value.totalCodePoints, 0) || !Array.isArray(value.categories)) return false;
  const categories: unknown[] = value.categories;
  if (categories.length !== SHARE_CATEGORIES.length) return false;
  const counts: number[] = [];
  for (let i = 0; i < categories.length; i++) {
    const item = categories[i];
    if (!isPlainObject(item) || !hasKeys(item, ["category", "codePoints", "percent"])) return false;
    if (item.category !== SHARE_CATEGORIES[i] || !isCount(item.codePoints, 0)) return false;
    if (!isCount(item.percent, 0) || item.percent > 100) return false;
    counts.push(item.codePoints);
  }
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(total) || total !== value.totalCodePoints) return false;
  const percents = sharePercents(counts);
  return categories.every((item, i) => (item as { percent: number }).percent === percents[i]);
}

/**
 * `aiMatch` (§3.2). The spans of one block stand together, ordered by `from`,
 * and neither overlap nor touch. The order of the blocks and their lengths
 * need the submitted revision, so they are the match's to keep.
 */
export function isAiMatch(value: unknown): value is AiMatch {
  if (
    !isPlainObject(value) ||
    !hasKeys(value, ["normalization", "minMatchCodePoints", "spans", "notice"])
  ) {
    return false;
  }
  if (value.normalization !== MATCH_NORMALIZATION || value.notice !== SHARE_NOTICE) return false;
  if (!isCount(value.minMatchCodePoints, 1) || !Array.isArray(value.spans)) return false;
  const seen = new Set<string>();
  let previous: AiMatchSpan | null = null;
  for (const span of value.spans as unknown[]) {
    if (!isPlainObject(span) || !hasKeys(span, ["blockId", "from", "to"])) return false;
    const { blockId, from, to } = span;
    if (!isNodeId(blockId) || !isCount(from, 0) || !isCount(to, 1) || to <= from) return false;
    if (previous !== null && previous.blockId === blockId) {
      if (from <= previous.to) return false;
    } else {
      if (seen.has(blockId)) return false;
      seen.add(blockId);
    }
    previous = { blockId, from, to };
  }
  return true;
}

/** The whole record (§3), closed at every level. */
export function isProvenanceRecordV1(value: unknown): value is ProvenanceRecordV1 {
  return (
    isPlainObject(value) &&
    hasKeys(value, [
      "provenanceSchema",
      "submissionId",
      "documentId",
      "revision",
      "share",
      "aiMatch",
      "computedAt",
    ]) &&
    value.provenanceSchema === PROVENANCE_RECORD_SCHEMA_V1 &&
    typeof value.submissionId === "string" &&
    UUID.test(value.submissionId) &&
    typeof value.documentId === "string" &&
    UUID.test(value.documentId) &&
    isCount(value.revision, 1) &&
    isProvenanceShare(value.share) &&
    isAiMatch(value.aiMatch) &&
    isComputedAt(value.computedAt)
  );
}

/** The fields the server puts in a record; `provenanceSchema` is fixed. */
export type ProvenanceRecordFields = Omit<ProvenanceRecordV1, "provenanceSchema">;

/** Builds the record, or `null` when any field breaks §3. */
export function buildProvenanceRecordV1(fields: ProvenanceRecordFields): ProvenanceRecordV1 | null {
  const record = { provenanceSchema: PROVENANCE_RECORD_SCHEMA_V1, ...fields };
  return isProvenanceRecordV1(record) ? record : null;
}

/** RFC 8785 text of the record. */
export function provenanceRecordJcs(record: ProvenanceRecordV1): string {
  return canonicalizeJcs(record);
}

/** `recordSha256`: SHA-256 of the JCS bytes, 64 lowercase hex characters. */
export function provenanceRecordSha256(record: ProvenanceRecordV1): string {
  return createHash("sha256").update(provenanceRecordJcs(record), "utf8").digest("hex");
}

/**
 * Reads stored record bytes. They must be exactly the UTF-8 bytes of the JCS
 * of the value they hold: that refuses bytes that are not UTF-8 (a lenient
 * decoding never gives the same bytes back), a byte order mark, a duplicate
 * key that `JSON.parse` would merge and any form that is not canonical.
 * Anything else gives `null`.
 */
export function parseProvenanceRecordV1Bytes(bytes: Uint8Array): ProvenanceRecordV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    const canonical = jcsUtf8Bytes(value);
    if (canonical.byteLength !== bytes.byteLength) return null;
    if (!canonical.every((byte, i) => byte === bytes[i])) return null;
  } catch {
    return null;
  }
  return isProvenanceRecordV1(value) ? value : null;
}
