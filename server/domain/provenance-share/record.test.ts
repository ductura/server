// docs/contracts/provenance-share-v1.md §3, §6 and vector §9.5.
import { describe, expect, it } from "vitest";

import { revisionZeroDocument } from "../document/index.ts";
import { canonicalizeJcs } from "../forensics/index.ts";

import {
  buildProvenanceRecordV1,
  isProvenanceRecordV1,
  parseProvenanceRecordV1Bytes,
  provenanceRecordJcs,
  provenanceRecordSha256,
  type ProvenanceRecordV1,
} from "./record.ts";
import { computeProvenanceShare } from "./share.ts";

const VECTOR_JCS =
  '{"aiMatch":{"minMatchCodePoints":60,"normalization":"ductura-match-norm-v1","notice":"not_authorship_evidence","spans":[{"blockId":"00000000-0000-4000-8000-000000000000","from":46,"to":109},{"blockId":"b4b4b4b4-0000-4000-8000-000000000004","from":1,"to":76}]},"computedAt":"2026-11-21T10:15:00.000000Z","documentId":"7d6c5b4a-3f2e-4a1b-9c8d-7e6f5a4b3c2d","provenanceSchema":"ductura-provenance-share-v1","revision":11,"share":{"categories":[{"category":"written","codePoints":195,"percent":53},{"category":"ai_transferred","codePoints":64,"percent":18},{"category":"pasted","codePoints":63,"percent":17},{"category":"imported","codePoints":34,"percent":9},{"category":"unattributed","codePoints":9,"percent":3}],"notice":"not_authorship_evidence","totalCodePoints":365,"unit":"code_point"},"submissionId":"3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a"}';
const VECTOR_SHA256 = "5210c1ad1f0c0899dde1a79f4c33b733572dd306ffe26b376eb348e5bf3d8073";

const encode = (text: string) => new TextEncoder().encode(text);
const vector = () => JSON.parse(VECTOR_JCS) as ProvenanceRecordV1;

describe("vector §9.5", () => {
  it("builds the record of the contract, 844 bytes, with its recordSha256", async () => {
    const { readFileSync } = await import("node:fs");
    const fixture = JSON.parse(
      readFileSync(new URL("./testdata/vector-9-1.json", import.meta.url), "utf8"),
    ) as { events: { source: string; steps: unknown }[]; submittedDocument: unknown };
    const share = computeProvenanceShare({
      initialDocument: revisionZeroDocument(),
      events: fixture.events,
      submittedDocument: fixture.submittedDocument,
    });
    if (!share.ok) throw new Error(share.reason);
    const record = buildProvenanceRecordV1({
      submissionId: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
      documentId: "7d6c5b4a-3f2e-4a1b-9c8d-7e6f5a4b3c2d",
      revision: 11,
      share: share.share,
      aiMatch: {
        normalization: "ductura-match-norm-v1",
        minMatchCodePoints: 60,
        spans: [
          { blockId: "00000000-0000-4000-8000-000000000000", from: 46, to: 109 },
          { blockId: "b4b4b4b4-0000-4000-8000-000000000004", from: 1, to: 76 },
        ],
        notice: "not_authorship_evidence",
      },
      computedAt: "2026-11-21T10:15:00.000000Z",
    });
    expect(record).not.toBeNull();
    const jcs = provenanceRecordJcs(record!);
    expect(jcs).toBe(VECTOR_JCS);
    expect(encode(jcs).byteLength).toBe(844);
    expect(provenanceRecordSha256(record!)).toBe(VECTOR_SHA256);
  });

  it("reads the vector bytes back", () => {
    const record = parseProvenanceRecordV1Bytes(encode(VECTOR_JCS));
    expect(record).not.toBeNull();
    expect(provenanceRecordSha256(record!)).toBe(VECTOR_SHA256);
  });
});

describe("closed keys at every level (§3)", () => {
  type Edit = (record: Record<string, unknown> & ProvenanceRecordV1) => void;
  const levels: [string, (r: ProvenanceRecordV1) => Record<string, unknown>][] = [
    ["record", (r) => r as unknown as Record<string, unknown>],
    ["share", (r) => r.share as unknown as Record<string, unknown>],
    ["share.categories[2]", (r) => r.share.categories[2] as unknown as Record<string, unknown>],
    ["aiMatch", (r) => r.aiMatch as unknown as Record<string, unknown>],
    ["aiMatch.spans[1]", (r) => r.aiMatch.spans[1] as unknown as Record<string, unknown>],
  ];

  it.each(levels)("refuses an unknown key on %s", (_, at) => {
    const record = vector();
    at(record).extra = 1;
    expect(isProvenanceRecordV1(record)).toBe(false);
  });

  it.each(levels)("refuses a missing key on %s", (_, at) => {
    const record = vector();
    const target = at(record);
    delete target[Object.keys(target)[0]!];
    expect(isProvenanceRecordV1(record)).toBe(false);
  });

  it.each(levels)("refuses a duplicate key on %s in the bytes", (_, at) => {
    const record = vector();
    const target = at(record);
    const key = Object.keys(target)[0]!;
    const json = JSON.stringify(target[key]);
    // Insert the same key once more at the start of that object.
    const text = provenanceRecordJcs(record);
    const object = canonicalizeJcs(target);
    const doubled = `{"${key}":${json},${object.slice(1)}`;
    expect(text).toContain(object);
    expect(parseProvenanceRecordV1Bytes(encode(text.replace(object, doubled)))).toBeNull();
  });

  it("refuses a __proto__ key", () => {
    const text = VECTOR_JCS.replace('{"aiMatch"', '{"__proto__":{},"aiMatch"');
    expect(parseProvenanceRecordV1Bytes(encode(text))).toBeNull();
  });

  const refused: [string, Edit][] = [
    ["share without notice", (r) => delete (r.share as Partial<typeof r.share>).notice],
    ["share with another notice", (r) => ((r.share as { notice: string }).notice = "proof")],
    ["aiMatch without notice", (r) => delete (r.aiMatch as Partial<typeof r.aiMatch>).notice],
    ["aiMatch with another notice", (r) => ((r.aiMatch as { notice: string }).notice = "")],
    [
      "another schema",
      (r) => ((r as { provenanceSchema: string }).provenanceSchema = "ductus-provenance-share-v1"),
    ],
    ["revision 0", (r) => (r.revision = 0)],
    ["a fractional revision", (r) => (r.revision = 1.5)],
    ["an uppercase submissionId", (r) => (r.submissionId = r.submissionId.toUpperCase())],
    ["a documentId that is no UUID", (r) => (r.documentId = "doc-1")],
    ["computedAt with five decimals", (r) => (r.computedAt = "2026-11-21T10:15:00.00000Z")],
    ["computedAt on 30 February", (r) => (r.computedAt = "2026-02-30T10:15:00.000000Z")],
    ["computedAt with an offset", (r) => (r.computedAt = "2026-11-21T10:15:00.000000+01:00")],
    ["another unit", (r) => ((r.share as { unit: string }).unit = "utf16")],
    ["categories out of order", (r) => r.share.categories.reverse()],
    ["four categories", (r) => r.share.categories.pop()],
    ["a total that is not the sum", (r) => (r.share.totalCodePoints = 366)],
    [
      "a percent that is not from §1.4",
      (r) => {
        r.share.categories[0]!.percent = 52;
        r.share.categories[1]!.percent = 19;
      },
    ],
    ["a negative count", (r) => (r.share.categories[4]!.codePoints = -9)],
    [
      "another normalization",
      (r) => ((r.aiMatch as { normalization: string }).normalization = "nfc"),
    ],
    ["minMatchCodePoints 0", (r) => (r.aiMatch.minMatchCodePoints = 0)],
    ["an empty span", (r) => (r.aiMatch.spans[0]!.to = 46)],
    ["a span with to before from", (r) => (r.aiMatch.spans[0]!.to = 40)],
    ["a blockId that is no node id", (r) => (r.aiMatch.spans[0]!.blockId = "b1")],
    [
      "spans of one block that touch",
      (r) => {
        r.aiMatch.spans = [
          { blockId: r.aiMatch.spans[0]!.blockId, from: 0, to: 10 },
          { blockId: r.aiMatch.spans[0]!.blockId, from: 10, to: 20 },
        ];
      },
    ],
    [
      "spans of one block out of order",
      (r) => {
        r.aiMatch.spans = [
          { blockId: r.aiMatch.spans[0]!.blockId, from: 30, to: 40 },
          { blockId: r.aiMatch.spans[0]!.blockId, from: 0, to: 10 },
        ];
      },
    ],
    [
      "spans of one block apart",
      (r) => {
        const [a, b] = r.aiMatch.spans;
        r.aiMatch.spans = [a!, b!, { ...a!, from: 200, to: 260 }];
      },
    ],
  ];

  it.each(refused)("refuses %s", (_, edit) => {
    const record = vector() as Record<string, unknown> & ProvenanceRecordV1;
    edit(record);
    expect(isProvenanceRecordV1(record)).toBe(false);
    // The builder fixes provenanceSchema itself, so only the other fields reach it.
    if (record.provenanceSchema === "ductura-provenance-share-v1") {
      const fields: Partial<ProvenanceRecordV1> = { ...record };
      delete fields.provenanceSchema;
      expect(
        buildProvenanceRecordV1(fields as Omit<ProvenanceRecordV1, "provenanceSchema">),
      ).toBeNull();
    }
  });

  it("accepts spans of one block that are apart but ordered, and no spans", () => {
    const record = vector();
    const id = record.aiMatch.spans[0]!.blockId;
    record.aiMatch.spans = [
      { blockId: id, from: 0, to: 10 },
      { blockId: id, from: 11, to: 20 },
    ];
    expect(isProvenanceRecordV1(record)).toBe(true);
    record.aiMatch.spans = [];
    expect(isProvenanceRecordV1(record)).toBe(true);
  });
});

describe("only canonical bytes (§3)", () => {
  it.each([
    ["a trailing new line", `${VECTOR_JCS}\n`],
    ["a space", VECTOR_JCS.replace('"revision":11', '"revision": 11')],
    [
      "keys out of order",
      VECTOR_JCS.replace('{"aiMatch":', '{"revision":11,"aiMatch":').replace(',"revision":11', ""),
    ],
    ["a number written another way", VECTOR_JCS.replace('"revision":11', '"revision":11.0')],
    ["escaped text", VECTOR_JCS.replace('"unit":"code_point"', '"unit":"code\\u005fpoint"')],
  ])("refuses %s", (_, text) => {
    expect(parseProvenanceRecordV1Bytes(encode(text))).toBeNull();
  });

  it("refuses bytes that are not UTF-8 or not JSON", () => {
    expect(parseProvenanceRecordV1Bytes(new Uint8Array([0x7b, 0xff, 0x7d]))).toBeNull();
    expect(parseProvenanceRecordV1Bytes(encode("{"))).toBeNull();
    expect(parseProvenanceRecordV1Bytes(encode("null"))).toBeNull();
    expect(parseProvenanceRecordV1Bytes(encode(`﻿${VECTOR_JCS}`))).toBeNull();
  });
});
