// SRV-1512 (plan M7.9, R-07): the display-equality test. The text of one
// revision as the API sends it, as the export snapshot (SRV-1309) freezes it
// and as the DOCX export prints it must be the same, and a deliberate
// difference in any of them must fail. CI runs this folder as its own step of
// the job "Provjere i testovi" (`pnpm test:equality`).
//
// The expectation is read here, independently of the export model, from the
// stored revision and the snapshot's capability map: a node kind the map marks
// `omitted` must leave no text in the DOCX, and a kind it marks `exported` or
// `degraded` must print its text in the form written down below. A kind with
// no written form is a difference too, so a writer that starts printing tables
// or footnotes fails until its form is written down here. Everything lives in
// this one test file: the invented work holds Croatian, English and German
// text, which server code outside tests may not (local/no-hardcoded-text).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  canonicalizeJcs,
  freezeExportSnapshot,
  textBlocksOf,
  validateVersionedDocument,
  verifyVersionedDocumentSnapshot,
  type CanonicalDocumentV4,
  type DocumentNodeV4,
  type ExportCapability,
  type ExportSnapshot,
  type ExportSnapshotInput,
  type InlineNodeV4,
  type NodeId,
} from "../../domain/index.ts";
import { buildExportModel, renderDocx, type ExportLabels } from "../../downloads/index.ts";

// ---------------------------------------------------------------------------
// The invented work: no real student, course or text. Footnotes, a table and
// passages in English and German (`lang`), with a cross reference, an inline
// and a block formula, a box, a code block and a page break around them.

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}` as NodeId;

const FOOTNOTE_TEXTS = [
  "Izmišljena bilješka: podaci su smišljeni za test.",
  "Druga izmišljena bilješka o kvartu Sjeverni brijeg.",
] as const;
const FOREIGN = {
  en: "Home composting turns kitchen scraps into soil.",
  de: "Kompost ist schwarzes Gold für den Stadtgarten.",
} as const;
const TABLE_CELL = "Sjeverni brijeg (izmišljeni kvart)";

const INVENTED_WORK: CanonicalDocumentV4 = {
  schemaVersion: 4,
  nodes: [
    {
      type: "heading",
      id: id(1),
      level: 1,
      children: [{ type: "text", text: "Kućno kompostiranje u Izmišljenom Gradu", marks: [] }],
    },
    {
      type: "paragraph",
      id: id(2),
      children: [
        { type: "text", text: "Kompostiranje smanjuje otpad kućanstva", marks: [] },
        { type: "footnote", text: FOOTNOTE_TEXTS[0] },
        { type: "text", text: " i štedi novac (vidi ", marks: ["italic"] },
        { type: "crossReference", targetId: id(9) },
        { type: "text", text: ").", marks: [] },
      ],
    },
    {
      type: "quote",
      id: id(3),
      children: [
        { type: "text", text: FOREIGN.en, marks: [{ type: "lang", lang: "en" }] },
        { type: "footnote", text: FOOTNOTE_TEXTS[1] },
      ],
    },
    {
      type: "bulletItem",
      id: id(4),
      children: [
        { type: "text", text: "Njemački izvor kaže: ", marks: [] },
        { type: "text", text: FOREIGN.de, marks: ["bold", { type: "lang", lang: "de" }] },
      ],
    },
    {
      type: "table",
      id: id(5),
      rows: [
        ["Kvart", "Kompostera"],
        [TABLE_CELL, "41"],
        ["Južna obala (izmišljeni kvart)", "17"],
      ],
      header: true,
      stripes: false,
      landscape: false,
      title: "Komposteri po izmišljenim kvartovima",
      source: "izmišljeni podaci za test",
    },
    {
      type: "paragraph",
      id: id(6),
      children: [
        { type: "text", text: "Omjer ugljika i dušika ", marks: [] },
        { type: "inlineFormula", tex: "C:N \\approx 30" },
        { type: "text", text: " drži hrpu toplom.", marks: [] },
      ],
    },
    { type: "formula", id: id(7), tex: "V = a \\cdot b \\cdot h" },
    {
      type: "box",
      id: id(8),
      kind: "definition",
      children: [
        {
          type: "paragraph",
          id: id(10),
          children: [{ type: "text", text: "Kompost je razgrađena organska tvar.", marks: [] }],
        },
      ],
    },
    {
      type: "heading",
      id: id(9),
      level: 2,
      children: [{ type: "text", text: "Postupak", marks: [] }],
    },
    {
      type: "codeBlock",
      id: id(11),
      language: "python",
      caption: "Izmišljeni brojač",
      children: [{ type: "text", text: "slojevi = 3\nprint(slojevi)", marks: [] }],
    },
    { type: "pageBreak", id: id(12) },
    {
      type: "paragraph",
      id: id(13),
      children: [{ type: "text", text: "Zaključak: čšžđć ČŠŽĐĆ ostaju isti.", marks: [] }],
    },
  ],
  sources: [],
  cover: { study: "Izmišljeni studij urbane ekologije", place: "Izmišljeni Grad", date: "2026." },
};

const SNAPSHOT_INPUT: ExportSnapshotInput = {
  document: INVENTED_WORK,
  versionId: "demo-revizija-7",
  kind: "submitted",
  pageSetup: { widthTwips: 11906, heightTwips: 16838, marginTwips: 1418 },
  cover: {
    institution: "Demo fakultet",
    unit: "Demo odsjek",
    workType: "Seminarski rad",
    student: "demo-student",
    mentor: "demo-teacher",
    study: "Izmišljeni studij urbane ekologije",
    place: "Izmišljeni Grad",
    date: "2026.",
  },
  expiresAt: "2030-01-02T00:00:00.000Z",
};

/** Export words; in production they come from the message catalogue (locales/merlin.ts). */
const LABELS: ExportLabels = {
  listing: "Ispis",
  boxes: {
    definition: "Definicija",
    theorem: "Teorem",
    lemma: "Lema",
    corollary: "Korolar",
    example: "Primjer",
    remark: "Napomena",
    proof: "Dokaz",
  },
};

// ---------------------------------------------------------------------------
// Reading the DOCX back: the stored ZIP entries, then the paragraphs and runs
// of word/document.xml. Only the markup the export writer emits is known;
// anything else is reported instead of skipped, so no element hides text.

type DocxRun = { readonly text: string; readonly lang?: string };
type DocxParagraph = {
  readonly style?: string;
  readonly pageBreak: boolean;
  readonly runs: readonly DocxRun[];
};

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const DOCUMENT_PART = "word/document.xml";

/** The entries of a ZIP with stored (uncompressed) entries, each checked against its CRC-32. */
function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, Uint8Array>();
  const locals: { name: string; crc: number; size: number; offset: number }[] = [];
  let at = 0;
  while (at + 4 <= bytes.length && view.getUint32(at, true) === LOCAL_HEADER) {
    if (view.getUint16(at + 8, true) !== 0) throw new Error("docx: compressed entry");
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const nameStart = at + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    if (data.length !== size) throw new Error(`docx: ${name} is cut short`);
    if (crc32(data) >>> 0 !== crc) throw new Error(`docx: ${name} fails its CRC-32`);
    if (entries.has(name)) throw new Error(`docx: ${name} twice`);
    entries.set(name, data);
    locals.push({ name, crc, size, offset: at });
    at = dataStart + size;
  }
  // The central directory names each local entry in order, then the end record
  // points at it and closes the file: without them no archive reader opens it.
  const centralStart = at;
  for (const entry of locals) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_HEADER)
      throw new Error(`docx: no central directory entry for ${entry.name}`);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (
      name !== entry.name ||
      view.getUint32(at + 16, true) !== entry.crc ||
      view.getUint32(at + 24, true) !== entry.size ||
      view.getUint32(at + 42, true) !== entry.offset
    )
      throw new Error(`docx: central directory entry for ${entry.name} does not match`);
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (
    at + 22 !== bytes.length ||
    view.getUint32(at, true) !== END_RECORD ||
    view.getUint16(at + 8, true) !== locals.length ||
    view.getUint16(at + 10, true) !== locals.length ||
    view.getUint32(at + 12, true) !== at - centralStart ||
    view.getUint32(at + 16, true) !== centralStart
  )
    throw new Error("docx: no valid end of central directory record");
  return entries;
}

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) =>
    name === "amp" ? "&" : name === "lt" ? "<" : name === "gt" ? ">" : name === "quot" ? '"' : "'",
  );
}

// Run content the writer emits; everything else is an unknown element.
const RUN_PART =
  /<w:t xml:space="preserve">([^<]*)<\/w:t>|<w:br\/>|<w:tab\/>|<w:br w:type="page"\/>/gy;

function runOf(inner: string): { run: DocxRun; pageBreak: boolean } {
  const props = /^<w:rPr>(.*?)<\/w:rPr>/s.exec(inner);
  const lang = props ? /<w:lang w:val="([^"]*)"\/>/.exec(props[1] ?? "")?.[1] : undefined;
  const content = inner.slice(props ? props[0].length : 0);
  let text = "";
  let pageBreak = false;
  RUN_PART.lastIndex = 0;
  let match: RegExpExecArray | null;
  let end = 0;
  while ((match = RUN_PART.exec(content)) !== null) {
    const part = match[0];
    if (match[1] !== undefined) text += unescapeXml(match[1]);
    else if (part === "<w:br/>") text += "\n";
    else if (part === "<w:tab/>") text += "\t";
    else pageBreak = true;
    end = RUN_PART.lastIndex;
  }
  if (end !== content.length) throw new Error(`docx: unknown run content ${content.slice(end)}`);
  return { run: { text, ...(lang === undefined ? {} : { lang: unescapeXml(lang) }) }, pageBreak };
}

/** The paragraphs of word/document.xml, in order, with their runs. */
function docxParagraphs(docx: Uint8Array): DocxParagraph[] {
  const part = readStoredZip(docx).get(DOCUMENT_PART);
  if (part === undefined) throw new Error(`docx: no ${DOCUMENT_PART}`);
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(part);
  const body = /<w:body>(.*)<w:sectPr>/s.exec(xml)?.[1];
  if (body === undefined) throw new Error("docx: no body");
  const paragraphs: DocxParagraph[] = [];
  const paragraph = /<w:p>(.*?)<\/w:p>/gsy;
  let match: RegExpExecArray | null;
  let end = 0;
  while ((match = paragraph.exec(body)) !== null) {
    const inner = match[1] ?? "";
    const style = /^<w:pPr>.*?<w:pStyle w:val="([^"]*)"\/>.*?<\/w:pPr>/s.exec(inner)?.[1];
    const content = inner
      .replace(/^<w:pPr>.*?<\/w:pPr>/s, "")
      .replace(/<\/?w:hyperlink[^>]*>/g, "");
    const runs: DocxRun[] = [];
    let pageBreak = false;
    const run = /<w:r>(.*?)<\/w:r>/gsy;
    let runMatch: RegExpExecArray | null;
    let runEnd = 0;
    while ((runMatch = run.exec(content)) !== null) {
      const read = runOf(runMatch[1] ?? "");
      if (read.pageBreak) pageBreak = true;
      if (read.run.text !== "" || !read.pageBreak) runs.push(read.run);
      runEnd = run.lastIndex;
    }
    if (runEnd !== content.length)
      throw new Error(`docx: unknown paragraph content ${content.slice(runEnd)}`);
    paragraphs.push({ ...(style === undefined ? {} : { style }), pageBreak, runs });
    end = paragraph.lastIndex;
  }
  if (end !== body.length) throw new Error(`docx: unknown body content ${body.slice(end)}`);
  return paragraphs;
}

// ---------------------------------------------------------------------------
// The comparison of the three channels.

/** One text block as the API sends it (`blocks` of `teacher.fast-path.post`). */
type ApiBlock = { readonly kind: string; readonly text: string };

type DisplayChannels = {
  /** The JCS bytes of the revision as the database keeps it. */
  readonly stored: Uint8Array;
  /** The text blocks the API sends for that revision. */
  readonly api: readonly ApiBlock[];
  readonly snapshot: ExportSnapshot;
  readonly docx: Uint8Array;
};

type Expected =
  | {
      readonly at: string;
      readonly style?: string;
      readonly prefix?: RegExp;
      readonly runs: readonly DocxRun[];
    }
  | { readonly at: string; readonly decoration: true }
  /** A code caption: a derived "<label> <n>." and then the author's caption text. */
  | { readonly at: string; readonly caption: string }
  | { readonly at: string; readonly pageBreak: true }
  | { readonly at: string; readonly formula: string };

type Reading = { expected: Expected[]; omittedTexts: string[]; problems: string[] };

const TEXT_BLOCKS = new Set(["heading", "paragraph", "bulletItem", "quote", "codeBlock"]);

/** Body text blocks of contract v4 §11: a box gives its paragraphs, atoms of a block none. */
type BodyBlock = ApiBlock & { readonly node: string };

function bodyBlocks(doc: CanonicalDocumentV4): BodyBlock[] {
  const nodes = doc.nodes.flatMap((node): DocumentNodeV4[] =>
    node.type === "box" ? node.children : TEXT_BLOCKS.has(node.type) ? [node] : [],
  );
  return nodes.map((node) => ({
    kind: node.type === "heading" ? "heading" : "paragraph",
    node: node.type,
    // An inline atom adds no characters to the body text (contract v3 §8, v4 §11).
    text: ("children" in node ? (node.children as readonly InlineNodeV4[]) : [])
      .map((child) => (child.type === "text" ? child.text : ""))
      .join(""),
  }));
}

function capabilityOf(snapshot: ExportSnapshot, type: string): ExportCapability | undefined {
  return (snapshot.capabilityMap as Readonly<Record<string, ExportCapability | undefined>>)[type];
}

function readInline(
  children: readonly InlineNodeV4[],
  at: string,
  snapshot: ExportSnapshot,
  reading: Reading,
): DocxRun[] {
  const runs: DocxRun[] = [];
  children.forEach((child, i) => {
    const where = `${at} inline ${i} (${child.type})`;
    const capability = capabilityOf(snapshot, child.type);
    if (capability === undefined) reading.problems.push(`${where}: no capability in the snapshot`);
    else if (capability === "omitted") {
      if (child.type === "footnote") reading.omittedTexts.push(child.text);
      if (child.type === "inlineFormula") reading.omittedTexts.push(child.tex);
    } else if (child.type === "text") {
      const lang = child.marks.find((mark) => typeof mark !== "string" && mark.type === "lang");
      runs.push({ text: child.text, ...(lang && "lang" in lang ? { lang: lang.lang } : {}) });
    } else if (child.type === "inlineFormula") runs.push({ text: child.tex });
    else reading.problems.push(`${where}: marked ${capability}, but no DOCX form is written down`);
  });
  return runs;
}

function inlineTexts(children: readonly InlineNodeV4[]): string[] {
  return children.flatMap((child) =>
    child.type === "text" ? [child.text] : child.type === "footnote" ? [child.text] : [],
  );
}

function omittedTextsOf(node: DocumentNodeV4): string[] {
  switch (node.type) {
    case "table":
      return [...node.rows.flat(), node.title ?? "", node.source ?? ""];
    case "image":
      return [node.title ?? "", node.source ?? ""];
    case "formula":
      return [node.tex];
    case "box":
      return node.children.flatMap((paragraph) => inlineTexts(paragraph.children));
    case "codeBlock":
    case "heading":
    case "paragraph":
    case "bulletItem":
    case "quote":
      return inlineTexts(node.children);
    default:
      return [];
  }
}

function readBlock(node: DocumentNodeV4, at: string, snapshot: ExportSnapshot, reading: Reading) {
  const capability = capabilityOf(snapshot, node.type);
  if (capability === undefined) {
    reading.problems.push(`${at}: no capability in the snapshot`);
    return;
  }
  if (capability === "omitted") {
    reading.omittedTexts.push(...omittedTextsOf(node));
    return;
  }
  const push = (expected: Expected) => reading.expected.push(expected);
  switch (node.type) {
    case "heading":
      push({
        at,
        style: `Heading${node.level}`,
        prefix: /^\d+(?:\.\d+)* $/u,
        runs: readInline(node.children, at, snapshot, reading),
      });
      return;
    case "paragraph":
    case "quote":
      push({ at, runs: readInline(node.children, at, snapshot, reading) });
      return;
    case "bulletItem":
      push({ at, prefix: /^• $/u, runs: readInline(node.children, at, snapshot, reading) });
      return;
    case "box":
      push({ at: `${at} label`, decoration: true });
      node.children.forEach((paragraph, i) =>
        push({
          at: `${at} paragraph ${i}`,
          runs: readInline(paragraph.children, at, snapshot, reading),
        }),
      );
      return;
    case "codeBlock":
      node.children
        .map((child) => child.text)
        .join("")
        .split("\n")
        .forEach((line, i) => push({ at: `${at} line ${i}`, runs: [{ text: line }] }));
      push({ at: `${at} caption`, caption: node.caption ?? "" });
      return;
    case "formula":
      push({ at, formula: node.tex });
      return;
    case "pageBreak":
      push({ at, pageBreak: true });
      return;
    default:
      reading.problems.push(`${at}: marked ${capability}, but no DOCX form is written down`);
  }
}

function coverOf(snapshot: ExportSnapshot): Expected[] {
  const { cover } = snapshot;
  const firstTitle = snapshot.document.nodes.find(
    (node) => node.type === "heading" && node.level === 1,
  );
  const title =
    firstTitle?.type === "heading" ? firstTitle.children.map((child) => child.text).join("") : "";
  const lines = [
    cover.institution,
    cover.unit,
    cover.study ?? "",
    "",
    title,
    cover.workType,
    "",
    cover.student,
    cover.mentor,
    "",
    [cover.place, cover.date].filter(Boolean).join(", "),
  ];
  return [
    ...lines.map((text, i): Expected => ({
      at: `cover line ${i}`,
      ...(i === 4 ? { style: "Title" } : {}),
      runs: [{ text }],
    })),
    { at: "cover page break", pageBreak: true },
  ];
}

const sameRun = (a: DocxRun | undefined, b: DocxRun | undefined): boolean =>
  a !== undefined && b !== undefined && a.text === b.text && a.lang === b.lang;

/** A block formula prints as its TeX, a tab and its number in brackets (degraded). */
function formulaLine(tex: string, text: string): boolean {
  return text.startsWith(`${tex}\t(`) && /^\d+\)$/u.test(text.slice(tex.length + 2));
}

/** "<label> <n>." alone, or followed by a space and exactly the author's caption. */
function captionLine(caption: string, text: string): boolean {
  const label = caption === "" ? text : text.slice(0, -(caption.length + 1));
  return (caption === "" || text.endsWith(` ${caption}`)) && /^\S(?:.*\S)? \d+\.$/u.test(label);
}

const show = (runs: readonly DocxRun[]): string => JSON.stringify(runs);

function matchParagraph(expected: Expected, actual: DocxParagraph): string | undefined {
  const textRuns = actual.runs.filter((run) => run.text !== "" || actual.runs.length === 1);
  if ("pageBreak" in expected)
    return actual.pageBreak && textRuns.every((run) => run.text === "")
      ? undefined
      : `${expected.at}: expected a page break, DOCX has ${show(actual.runs)}`;
  if (actual.pageBreak) return `${expected.at}: unexpected page break in DOCX`;
  if ("decoration" in expected)
    return actual.runs.length === 1 && actual.runs[0]!.text !== ""
      ? undefined
      : `${expected.at}: expected one label run, DOCX has ${show(actual.runs)}`;
  if ("caption" in expected)
    return actual.style === "Caption" &&
      actual.runs.length === 1 &&
      captionLine(expected.caption, actual.runs[0]!.text)
      ? undefined
      : `${expected.at}: expected caption ${JSON.stringify(expected.caption)}, DOCX has ${show(actual.runs)}`;
  if ("formula" in expected)
    return actual.runs.length === 1 && formulaLine(expected.formula, actual.runs[0]!.text)
      ? undefined
      : `${expected.at}: expected formula ${JSON.stringify(expected.formula)}, DOCX has ${show(actual.runs)}`;
  if (expected.style !== undefined && actual.style !== expected.style)
    return `${expected.at}: expected style ${expected.style}, DOCX has ${actual.style ?? "none"}`;
  let runs = actual.runs;
  if (expected.prefix !== undefined) {
    if (!expected.prefix.test(runs[0]?.text ?? ""))
      return `${expected.at}: missing ${String(expected.prefix)} before the text, DOCX has ${show(runs)}`;
    runs = runs.slice(1);
  }
  const equal =
    runs.length === expected.runs.length && runs.every((run, i) => sameRun(run, expected.runs[i]));
  return equal
    ? undefined
    : `${expected.at}: expected ${show(expected.runs)}, DOCX has ${show(runs)}`;
}

function compareBlocks(name: string, actual: readonly ApiBlock[], expected: readonly BodyBlock[]) {
  const problems: string[] = [];
  if (actual.length !== expected.length)
    problems.push(`${name}: ${actual.length} text blocks, the revision has ${expected.length}`);
  expected.forEach((want, i) => {
    const got = actual[i];
    if (got === undefined) return;
    // The API may still send a bullet item or quote as a paragraph (F-150 point 1).
    const kinds =
      want.node === "bulletItem" || want.node === "quote" ? [want.node, "paragraph"] : [want.kind];
    if (!kinds.includes(got.kind))
      problems.push(`${name} block ${i}: kind ${got.kind}, expected ${want.kind}`);
    if (got.text !== want.text)
      problems.push(
        `${name} block ${i}: ${JSON.stringify(got.text)}, expected ${JSON.stringify(want.text)}`,
      );
  });
  return problems;
}

/** Every difference between the channels; empty when all three show the same text. */
async function compareDisplayChannels(channels: DisplayChannels): Promise<string[]> {
  const { snapshot } = channels;
  const problems: string[] = [];

  const stored = await verifyVersionedDocumentSnapshot(channels.stored);
  if (!stored.ok || stored.document.schemaVersion !== 4) return ["stored: not a valid v4 revision"];
  const revision = stored.document as CanonicalDocumentV4;

  // The snapshot: its hash, its own JSON and the revision it was frozen from.
  const { canonicalJson, sha256, ...payload } = snapshot;
  if (createHash("sha256").update(canonicalJson, "utf8").digest("hex") !== sha256)
    problems.push("snapshot: sha256 does not match canonicalJson");
  if (canonicalizeJcs(payload) !== canonicalJson)
    problems.push("snapshot: fields differ from its canonicalJson");
  if (canonicalizeJcs(snapshot.document) !== canonicalizeJcs(revision))
    problems.push("snapshot: document differs from the stored revision");

  const expectedBlocks = bodyBlocks(revision);
  problems.push(...compareBlocks("api", channels.api, expectedBlocks));
  problems.push(
    ...compareBlocks(
      "snapshot",
      bodyBlocks(snapshot.document as CanonicalDocumentV4),
      expectedBlocks,
    ),
  );

  const reading: Reading = { expected: coverOf(snapshot), omittedTexts: [], problems: [] };
  snapshot.document.nodes.forEach((node, i) =>
    readBlock(node as DocumentNodeV4, `node ${i} (${node.type})`, snapshot, reading),
  );
  problems.push(...reading.problems.map((problem) => `docx ${problem}`));

  let paragraphs: DocxParagraph[];
  try {
    paragraphs = docxParagraphs(channels.docx);
  } catch (error) {
    return [...problems, `docx: ${error instanceof Error ? error.message : "unreadable"}`];
  }
  if (paragraphs.length !== reading.expected.length)
    problems.push(`docx: ${paragraphs.length} paragraphs, expected ${reading.expected.length}`);
  reading.expected.forEach((expected, i) => {
    const actual = paragraphs[i];
    const problem =
      actual === undefined ? `${expected.at}: missing in DOCX` : matchParagraph(expected, actual);
    if (problem !== undefined) problems.push(`docx ${problem}`);
  });

  // Text the snapshot declares omitted must not reach the DOCX in any form.
  const printed = paragraphs.map((p) => p.runs.map((run) => run.text).join("")).join("\n");
  for (const text of new Set(reading.omittedTexts)) {
    if (text.trim() !== "" && printed.includes(text))
      problems.push(`docx: prints ${JSON.stringify(text)}, which the snapshot marks omitted`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Tests.

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

type Model = ReturnType<typeof buildExportModel>;

function docxOf(snapshot: ExportSnapshot, edit: (model: Model) => Model = (m) => m): Uint8Array {
  const model = buildExportModel(snapshot.document as CanonicalDocumentV4, LABELS);
  return renderDocx(edit(model), snapshot.cover, snapshot.pageSetup);
}

/** The three channels of one revision, built the way production builds each. */
async function channels(over: Partial<DisplayChannels> = {}): Promise<DisplayChannels> {
  const stored = new TextEncoder().encode(canonicalizeJcs(INVENTED_WORK));
  const verified = await verifyVersionedDocumentSnapshot(stored);
  if (!verified.ok) throw new Error("the invented work is not a valid revision");
  // As the fast-path route builds `blocks` (server/teacher/fast-path.ts), sent as JSON.
  const api = JSON.parse(JSON.stringify(textBlocksOf(verified.document as never))) as ApiBlock[];
  const snapshot = freezeExportSnapshot(SNAPSHOT_INPUT);
  return { stored, api, snapshot, docx: docxOf(snapshot), ...over };
}

/** A copy of the model with the paragraph whose text starts with `start` changed. */
function editParagraph(
  model: Model,
  start: string,
  edit: (runs: Model["blocks"]) => unknown,
): Model {
  const blocks = model.blocks.map((block) => {
    if (
      !("runs" in block) ||
      !block.runs
        .map((r) => r.text)
        .join("")
        .startsWith(start)
    )
      return block;
    return { ...block, runs: edit([block]) } as typeof block;
  });
  return { ...model, blocks };
}

function runsOf(blocks: Model["blocks"]) {
  const block = blocks[0]!;
  return "runs" in block ? block.runs : [];
}

describe("the invented work (SRV-1512 acceptance 3 and 4)", () => {
  it("is a valid v4 revision with footnotes, a table and passages in English and German", () => {
    expect(validateVersionedDocument(INVENTED_WORK).ok).toBe(true);
    const json = JSON.stringify(INVENTED_WORK);
    for (const text of [...FOOTNOTE_TEXTS, TABLE_CELL, FOREIGN.en, FOREIGN.de])
      expect(json).toContain(JSON.stringify(text).slice(1, -1));
    expect(json).toContain('"lang":"en"');
    expect(json).toContain('"lang":"de"');
    expect(json).toContain('"type":"table"');
  });

  it("names only invented people, places and data", () => {
    const text = JSON.stringify([INVENTED_WORK, SNAPSHOT_INPUT]);
    expect(text).toMatch(/demo-student/u);
    expect(text).not.toMatch(/@(?!.*\.invalid)/u);
  });
});

describe("display equality of API, export snapshot and DOCX (R-07)", () => {
  it("shows the same text in all three channels", async () => {
    expect(await compareDisplayChannels(await channels())).toEqual([]);
  });

  it("prints the foreign passages in the DOCX with their language", async () => {
    const { docx } = await channels();
    const runs = docxParagraphs(docx).flatMap((p) => p.runs);
    expect(runs).toContainEqual({ text: FOREIGN.en, lang: "en" });
    expect(runs).toContainEqual({ text: FOREIGN.de, lang: "de" });
  });

  it("keeps footnotes and the table out of every channel, as the snapshot declares", async () => {
    const { api, snapshot, docx } = await channels();
    expect(snapshot.capabilityMap.footnote).toBe("omitted");
    expect(snapshot.capabilityMap.table).toBe("omitted");
    const printed = JSON.stringify([api, docxParagraphs(docx)]);
    for (const text of [...FOOTNOTE_TEXTS, TABLE_CELL]) expect(printed).not.toContain(text);
  });
});

describe("a deliberate difference fails the check (SRV-1512 acceptance 2)", () => {
  it("in the API: one changed letter", async () => {
    const good = await channels();
    const api = good.api.map((b, i) =>
      i === 1 ? { ...b, text: b.text.replace("otpad", "otpat") } : b,
    );
    expect(await compareDisplayChannels({ ...good, api })).toEqual([
      expect.stringMatching(/^api block 1: /u),
    ]);
  });

  it("in the API: a missing block or the foreign passage dropped", async () => {
    const good = await channels();
    expect(await compareDisplayChannels({ ...good, api: good.api.slice(0, -1) })).toContain(
      `api: ${good.api.length - 1} text blocks, the revision has ${good.api.length}`,
    );
    const api = good.api.map((b) => ({ ...b, text: b.text.replace(FOREIGN.en, "") }));
    expect(await compareDisplayChannels({ ...good, api })).not.toEqual([]);
  });

  it("in the snapshot: frozen from another revision", async () => {
    const other = structuredClone(INVENTED_WORK);
    other.nodes[3] = {
      ...other.nodes[3]!,
      children: [{ type: "text", text: "Drugi tekst", marks: [] }],
    } as never;
    const snapshot = freezeExportSnapshot({ ...SNAPSHOT_INPUT, document: other });
    const problems = await compareDisplayChannels(
      await channels({ snapshot, docx: docxOf(snapshot) }),
    );
    expect(problems).toContain("snapshot: document differs from the stored revision");
    expect(problems).toContainEqual(expect.stringMatching(/^snapshot block 3: /u));
  });

  it("in the snapshot: fields or hash that do not match its canonical JSON", async () => {
    const good = await channels();
    const capabilityMap = { ...good.snapshot.capabilityMap, table: "exported" as const };
    const claimed = { ...good.snapshot, capabilityMap } as ExportSnapshot;
    expect(await compareDisplayChannels({ ...good, snapshot: claimed })).toEqual([
      "snapshot: fields differ from its canonicalJson",
      "docx node 4 (table): marked exported, but no DOCX form is written down",
    ]);
    const hashed = { ...good.snapshot, sha256: "0".repeat(64) } as ExportSnapshot;
    expect(await compareDisplayChannels({ ...good, snapshot: hashed })).toEqual([
      "snapshot: sha256 does not match canonicalJson",
    ]);
  });

  it("in the DOCX: a changed letter, a lost run or a lost language", async () => {
    const good = await channels();
    const changed = docxOf(good.snapshot, (m) =>
      editParagraph(m, "Kompostiranje", (b) =>
        runsOf(b).map((r, i) => (i === 0 ? { ...r, text: r.text.replace("otpad", "otpat") } : r)),
      ),
    );
    expect(await compareDisplayChannels({ ...good, docx: changed })).toEqual([
      expect.stringMatching(/^docx node 1 \(paragraph\): expected /u),
    ]);
    const lost = docxOf(good.snapshot, (m) =>
      editParagraph(m, "Omjer", (b) => runsOf(b).slice(0, 1)),
    );
    expect(await compareDisplayChannels({ ...good, docx: lost })).toEqual([
      expect.stringMatching(/^docx node 5 \(paragraph\): expected /u),
    ]);
    const noLanguage = docxOf(good.snapshot, (m) =>
      editParagraph(m, FOREIGN.en, (b) => runsOf(b).map(({ language: _, ...r }) => r)),
    );
    expect(await compareDisplayChannels({ ...good, docx: noLanguage })).toEqual([
      expect.stringMatching(/^docx node 2 \(quote\): expected .*"lang":"en"/u),
    ]);
  });

  it("in the DOCX: a footnote or table cell printed although the snapshot omits it", async () => {
    const good = await channels();
    const extra = (text: string) =>
      docxOf(good.snapshot, (m) => ({
        ...m,
        blocks: [
          ...m.blocks,
          {
            kind: "paragraph",
            runs: [{ text, bold: false, italic: false, superscript: false, subscript: false }],
          },
        ],
      }));
    for (const text of [FOOTNOTE_TEXTS[0], TABLE_CELL]) {
      expect(await compareDisplayChannels({ ...good, docx: extra(text) })).toContain(
        `docx: prints ${JSON.stringify(text)}, which the snapshot marks omitted`,
      );
    }
  });

  it("in the DOCX: the author's code caption lost or changed", async () => {
    const good = await channels();
    for (const caption of ["Ispis 1.", "Ispis 1. Izmišljeni broj"]) {
      const docx = docxOf(good.snapshot, (m) => ({
        ...m,
        blocks: m.blocks.map((b) => (b.kind === "code" ? { ...b, caption } : b)),
      }));
      expect(await compareDisplayChannels({ ...good, docx })).toEqual([
        expect.stringMatching(/^docx node 9 \(codeBlock\) caption: expected caption /u),
      ]);
    }
  });

  it("in the DOCX bytes: an archive cut before its central directory", async () => {
    const good = await channels();
    const central = Buffer.from(good.docx).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThan(0);
    expect(await compareDisplayChannels({ ...good, docx: good.docx.slice(0, central) })).toEqual([
      expect.stringMatching(/^docx: docx: no central directory entry for /u),
    ]);
    const noEnd = good.docx.slice(0, good.docx.length - 22);
    expect(await compareDisplayChannels({ ...good, docx: noEnd })).toEqual([
      "docx: docx: no valid end of central directory record",
    ]);
  });

  it("in the DOCX bytes: a flipped byte fails the container check", async () => {
    const good = await channels();
    const docx = new Uint8Array(good.docx);
    const at = Buffer.from(docx).indexOf("Postupak");
    docx[at] = "p".charCodeAt(0);
    expect(await compareDisplayChannels({ ...good, docx })).toEqual([
      "docx: docx: word/document.xml fails its CRC-32",
    ]);
  });
});

describe("the check is required in CI (SRV-1512 acceptance 1)", () => {
  it("runs as its own step of the job Provjere i testovi, over this folder", () => {
    const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const checks = workflow.slice(
      workflow.indexOf("\n  checks:\n"),
      workflow.indexOf("\n  database:\n"),
    );
    expect(checks).toContain(
      "      - name: Test jednakosti prikaza (R-07)\n        run: pnpm test:equality\n",
    );
    expect(workflow).toMatch(/needs: \[scope, checks, database\]/u);
    const scripts = (
      JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["test:equality"]).toBe("vitest run --project unit server/tests/equality");
  });
});
