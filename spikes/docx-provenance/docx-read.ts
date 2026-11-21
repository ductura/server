// SRV-1802 (M8.1): reads provenance signals from a DOCX package. Pure function
// over bytes: no file system, no network, no code from the document is run.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { unzipSync } from "fflate";

/** Limits applied before any part is parsed (D-291 asks M8.0 for the real ones). */
export const LIMITS = {
  maxPackageBytes: 25 * 1024 * 1024,
  maxEntries: 500,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxPartBytes: 50 * 1024 * 1024,
} as const;

export type ReadFailure =
  | "not_zip"
  | "encrypted"
  | "too_large"
  | "too_many_entries"
  | "uncompressed_too_large"
  | "missing_document"
  | "unsafe_xml"
  | "invalid_xml";

export class DocxReadError extends Error {
  readonly code: ReadFailure;
  constructor(code: ReadFailure, message: string) {
    super(message);
    this.code = code;
  }
}

export type Paragraph = { style: string | null; heading: number | null; text: string };
export type TrackedChange = {
  kind: "insert" | "delete";
  author: string | null;
  date: string | null;
  text: string;
};
export type Comment = { author: string | null; date: string | null; text: string };

export type DocxReading = {
  /** Fields that every reader found in all five fixtures (see README). */
  paragraphs: Paragraph[];
  text: string;
  wordCount: number;
  footnotes: string[];
  tables: number;
  trackedChanges: TrackedChange[];
  comments: Comment[];
  /** Distinct w:rsid* values: one per editing session Word recorded. */
  rsidCount: number;
  core: {
    creator: string | null;
    lastModifiedBy: string | null;
    created: string | null;
    modified: string | null;
    revision: number | null;
  };
  app: { application: string | null; totalTimeMinutes: number | null };
  /** Package properties that matter for an import decision, never executed. */
  flags: { hasMacros: boolean; externalRelationships: string[]; embeddedObjects: number };
};

type Node = Record<string, unknown>;
const ATTR = "@_";

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  processEntities: false, // the five predefined entities are decoded by hand below
  trimValues: false,
  parseTagValue: false,
});

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Every XML character reference, decoded exactly once, in one pass. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (whole, ref: string) => {
    const named = NAMED[ref];
    if (named !== undefined) return named;
    const code =
      ref[1] === "x" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
    const legal = code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x10ffff);
    return legal && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

function parseXml(bytes: Uint8Array, part: string): Node[] {
  const source = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // OOXML parts never need a DTD; refusing it closes entity expansion for good.
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new DocxReadError("unsafe_xml", `${part} contains a DOCTYPE or ENTITY declaration`);
  }
  // XMLParser alone accepts unclosed tags and returns a partial tree, so the
  // document is validated first: a half-read paragraph list would look real.
  const verdict = XMLValidator.validate(source);
  if (verdict !== true) {
    throw new DocxReadError("invalid_xml", `${part} is not well-formed XML: ${verdict.err.msg}`);
  }
  try {
    return parser.parse(source) as Node[];
  } catch (error) {
    // The parser refuses, for one, more than 100 nested tags with a plain Error.
    throw new DocxReadError("invalid_xml", `${part} was refused by the parser: ${String(error)}`);
  }
}

function tagOf(node: Node): string | null {
  for (const key of Object.keys(node)) if (key !== ":@") return key;
  return null;
}
function children(node: Node): Node[] {
  const tag = tagOf(node);
  const value = tag === null ? undefined : node[tag];
  return Array.isArray(value) ? (value as Node[]) : [];
}
function attr(node: Node, name: string): string | null {
  const attrs = node[":@"] as Record<string, string> | undefined;
  const value = attrs?.[`${ATTR}${name}`];
  return value === undefined ? null : decodeEntities(value);
}
function find(nodes: Node[], tag: string): Node | undefined {
  return nodes.find((node) => tagOf(node) === tag);
}
function walk(nodes: Node[], visit: (node: Node, tag: string) => void): void {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === null) continue;
    visit(node, tag);
    walk(children(node), visit);
  }
}

type TextMode = "visible" | "all";

/**
 * Text of a subtree, only from w:t (and w:delText in mode "all"): whitespace
 * between tags is XML layout, not content. Tabs and breaks as in Word's copy.
 */
function textOf(nodes: Node[], mode: TextMode = "all"): string {
  let out = "";
  const collect = (list: Node[]): void => {
    for (const node of list) {
      const tag = tagOf(node);
      if (tag === "w:t" || (tag === "w:delText" && mode === "all")) out += propText(node, false);
      else if (tag === "w:tab") out += "\t";
      else if (tag === "w:br" || tag === "w:cr") out += "\n";
      else if (tag === "w:del" && mode === "visible") continue;
      else if (tag === "w:instrText" || tag === "w:pPr" || tag === "w:rPr") continue;
      else if (tag !== null && tag !== "#text") collect(children(node));
    }
  };
  collect(nodes);
  return out;
}

/** Character data directly inside one element (w:t, dc:creator, ...). */
function propText(node: Node, trim: boolean): string {
  const raw = children(node)
    .filter((child) => tagOf(child) === "#text")
    .map((child) => String(child["#text"] ?? ""))
    .join("");
  return decodeEntities(trim ? raw.trim() : raw);
}

function paragraphOf(node: Node): Paragraph {
  const kids = children(node);
  const pPr = find(kids, "w:pPr");
  const style = pPr === undefined ? null : attr(find(children(pPr), "w:pStyle") ?? {}, "w:val");
  const heading = style === null ? null : /^Heading([1-9])$/i.exec(style)?.[1];
  return {
    style,
    heading: heading === undefined || heading === null ? null : Number(heading),
    text: textOf(kids, "visible"),
  };
}

function numberOf(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function simpleField(nodes: Node[], tag: string): string | null {
  const node = find(nodes, tag);
  if (node === undefined) return null;
  const text = propText(node, true);
  return text === "" ? null : text;
}

function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > LIMITS.maxPackageBytes) {
    throw new DocxReadError("too_large", `package is ${bytes.byteLength} bytes`);
  }
  // A password-protected DOCX is an OLE compound file, not a ZIP.
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (ole.every((byte, i) => bytes[i] === byte)) {
    throw new DocxReadError("encrypted", "OLE compound file: encrypted or legacy .doc");
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new DocxReadError("not_zip", "missing ZIP signature");
  }
  let entries = 0;
  let declared = 0;
  try {
    return unzipSync(bytes, {
      // Decides from the central directory, before anything is inflated.
      filter(file) {
        entries += 1;
        declared += file.originalSize;
        if (entries > LIMITS.maxEntries) {
          throw new DocxReadError("too_many_entries", `more than ${LIMITS.maxEntries} entries`);
        }
        if (file.originalSize > LIMITS.maxPartBytes || declared > LIMITS.maxUncompressedBytes) {
          throw new DocxReadError("uncompressed_too_large", "declared size over the limit");
        }
        return /^(word\/|docProps\/|_rels\/|\[Content_Types\]\.xml$|customXml\/)/.test(file.name);
      },
    });
  } catch (error) {
    if (error instanceof DocxReadError) throw error;
    throw new DocxReadError("not_zip", `unreadable ZIP: ${String(error)}`);
  }
}

export function readDocx(bytes: Uint8Array): DocxReading {
  const files = unpack(bytes);
  const documentBytes = files["word/document.xml"];
  if (documentBytes === undefined) {
    throw new DocxReadError("missing_document", "word/document.xml is missing");
  }
  const total = Object.values(files).reduce((sum, file) => sum + file.byteLength, 0);
  if (total > LIMITS.maxUncompressedBytes) {
    throw new DocxReadError("uncompressed_too_large", "inflated size over the limit");
  }

  const documentTree = parseXml(documentBytes, "word/document.xml");
  const paragraphs: Paragraph[] = [];
  let tables = 0;
  const trackedChanges: TrackedChange[] = [];
  const rsids = new Set<string>();
  walk(documentTree, (node, tag) => {
    if (tag === "w:p") paragraphs.push(paragraphOf(node));
    if (tag === "w:tbl") tables += 1;
    if (tag === "w:ins" || tag === "w:del") {
      // Run-level revisions only; paragraph-mark revisions sit in w:rPr and carry no text.
      const text = textOf(children(node));
      if (text !== "") {
        trackedChanges.push({
          kind: tag === "w:ins" ? "insert" : "delete",
          author: attr(node, "w:author"),
          date: attr(node, "w:date"),
          text,
        });
      }
    }
    for (const name of Object.keys((node[":@"] as object | undefined) ?? {})) {
      if (name.startsWith(`${ATTR}w:rsid`)) {
        const value = (node[":@"] as Record<string, string>)[name];
        if (value !== undefined) rsids.add(value);
      }
    }
  });

  // Visible text: deleted runs are not part of the current document.
  const currentText = paragraphs
    .map((paragraph) => paragraph.text)
    .filter((line) => line !== "")
    .join("\n");

  const footnotes: string[] = [];
  const footnotePart = files["word/footnotes.xml"];
  if (footnotePart !== undefined) {
    walk(parseXml(footnotePart, "word/footnotes.xml"), (node, tag) => {
      const type = attr(node, "w:type");
      if (tag === "w:footnote" && (type === null || type === "normal"))
        footnotes.push(textOf(children(node), "visible").trim());
    });
  }

  const comments: Comment[] = [];
  const commentPart = files["word/comments.xml"];
  if (commentPart !== undefined) {
    walk(parseXml(commentPart, "word/comments.xml"), (node, tag) => {
      if (tag === "w:comment") {
        comments.push({
          author: attr(node, "w:author"),
          date: attr(node, "w:date"),
          text: textOf(children(node), "visible").trim(),
        });
      }
    });
  }

  const coreBytes = files["docProps/core.xml"];
  const coreRoot =
    coreBytes === undefined
      ? []
      : children(find(parseXml(coreBytes, "docProps/core.xml"), "cp:coreProperties") ?? {});
  const appBytes = files["docProps/app.xml"];
  const appRoot =
    appBytes === undefined
      ? []
      : children(find(parseXml(appBytes, "docProps/app.xml"), "Properties") ?? {});

  const externalRelationships: string[] = [];
  for (const [name, bytesOfPart] of Object.entries(files)) {
    if (!name.endsWith(".rels")) continue;
    walk(parseXml(bytesOfPart, name), (node, tag) => {
      if (tag === "Relationship" && attr(node, "TargetMode") === "External") {
        externalRelationships.push(attr(node, "Type")?.split("/").pop() ?? "unknown");
      }
    });
  }

  const words = currentText.split(/\s+/).filter((word) => word !== "");
  return {
    paragraphs,
    text: currentText,
    wordCount: words.length,
    footnotes,
    tables,
    trackedChanges,
    comments,
    rsidCount: rsids.size,
    core: {
      creator: simpleField(coreRoot, "dc:creator"),
      lastModifiedBy: simpleField(coreRoot, "cp:lastModifiedBy"),
      created: simpleField(coreRoot, "dcterms:created"),
      modified: simpleField(coreRoot, "dcterms:modified"),
      revision: numberOf(simpleField(coreRoot, "cp:revision")),
    },
    app: {
      application: simpleField(appRoot, "Application"),
      totalTimeMinutes: numberOf(simpleField(appRoot, "TotalTime")),
    },
    flags: {
      hasMacros: Object.keys(files).some((name) => /vbaProject\.bin$/i.test(name)),
      externalRelationships,
      embeddedObjects: Object.keys(files).filter((name) =>
        /^word\/(embeddings|activeX)\//i.test(name),
      ).length,
    },
  };
}
