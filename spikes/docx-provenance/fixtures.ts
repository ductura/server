// Invented DOCX packages for SRV-1802. Every name, text and date is made up;
// nothing here comes from a real student or a real file. The packages are built
// in memory so no binary is committed.
import { strToU8, zipSync, type Zippable } from "fflate";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const CONTENT_TYPES =
  `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const ROOT_RELS =
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

export function xmlEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export const run = (text: string, rsid = "00A11111") =>
  `<w:r w:rsidR="${rsid}"><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
export const para = (inner: string, style?: string, rsid = "00A11111") =>
  `<w:p w:rsidR="${rsid}">${style === undefined ? "" : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`}${inner}</w:p>`;

export function pack(documentBody: string, extra: Zippable = {}, withRels = ""): Uint8Array {
  const rels =
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `${withRels}</Relationships>`;
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    "word/document.xml": strToU8(
      `${HEAD}<w:document ${W}><w:body>${documentBody}<w:sectPr/></w:body></w:document>`,
    ),
    "word/_rels/document.xml.rels": strToU8(rels),
    ...extra,
  });
}

const core = (parts: Record<string, string>) =>
  strToU8(
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">' +
      Object.entries(parts)
        .map(([tag, value]) => `<${tag}>${xmlEscape(value)}</${tag}>`)
        .join("") +
      "</cp:coreProperties>",
  );
const app = (application: string, totalTime: number) =>
  strToU8(
    `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
      `<TotalTime>${totalTime}</TotalTime><Application>${xmlEscape(application)}</Application></Properties>`,
  );

export type Fixture = { name: string; what: string; bytes: Uint8Array };

/** 1. Word-like: headings, plain paragraphs, full core and app properties, several rsids. */
export function plainWord(): Fixture {
  const body =
    para(run("Kućno kompostiranje u Lipovcu"), "Heading1") +
    para(run("Prvi odlomak izmišljenog seminara o biootpadu u gradskim kućanstvima.", "00B22222")) +
    para(run("Drugi odlomak."), "Normal", "00C33333") +
    para(run("Podnaslov"), "Heading2") +
    para(run("Treći odlomak s nekoliko riječi."), undefined, "00B22222");
  return {
    name: "plain-word",
    what: "Word-like, headings, core and app properties, three rsids",
    bytes: pack(body, {
      "docProps/core.xml": core({
        "dc:creator": "Ana Izmišljena",
        "cp:lastModifiedBy": "Ana Izmišljena",
        "cp:revision": "7",
        "dcterms:created": "2026-09-14T08:02:00Z",
        "dcterms:modified": "2026-10-02T17:45:00Z",
      }),
      "docProps/app.xml": app("Microsoft Office Word", 94),
    }),
  };
}

/** 2. Review copy: tracked insertions and deletions by two authors, two comments. */
export function trackedReview(): Fixture {
  const change = (kind: "ins" | "del", id: number, author: string, date: string, text: string) =>
    kind === "ins"
      ? `<w:ins w:id="${id}" w:author="${author}" w:date="${date}">${run(text, "00D44444")}</w:ins>`
      : `<w:del w:id="${id}" w:author="${author}" w:date="${date}"><w:r><w:delText xml:space="preserve">${xmlEscape(text)}</w:delText></w:r></w:del>`;
  const body =
    para(
      run("Pregled nacrta: ") +
        change("del", 1, "Marko Izmišljeni", "2026-10-05T10:00:00Z", "stari ") +
        change("ins", 2, "Marko Izmišljeni", "2026-10-05T10:01:00Z", "novi ") +
        run("tekst."),
    ) +
    para(
      run("Završna rečenica.") +
        change("ins", 3, "Iva Izmišljena", "2026-10-06T09:30:00Z", " Dodana rečenica."),
    );
  const comments =
    `${HEAD}<w:comments ${W}>` +
    '<w:comment w:id="0" w:author="Marko Izmišljeni" w:date="2026-10-05T10:02:00Z"><w:p><w:r><w:t>Dodaj izvor.</w:t></w:r></w:p></w:comment>' +
    '<w:comment w:id="1" w:author="Iva Izmišljena" w:date="2026-10-06T09:31:00Z"><w:p><w:r><w:t>Uskladi s uvodom.</w:t></w:r></w:p></w:comment>' +
    "</w:comments>";
  return {
    name: "tracked-review",
    what: "tracked changes by two authors, two comments",
    bytes: pack(body, {
      "word/comments.xml": strToU8(comments),
      "docProps/core.xml": core({
        "dc:creator": "Ana Izmišljena",
        "cp:lastModifiedBy": "Iva Izmišljena",
        "cp:revision": "12",
      }),
      "docProps/app.xml": app("Microsoft Office Word", 210),
    }),
  };
}

/** 3. Footnotes, a table and an external hyperlink. */
export function footnotesTable(): Fixture {
  const cell = (text: string) => `<w:tc>${para(run(text))}</w:tc>`;
  const body =
    para(run("Tekst s bilješkom.") + '<w:r><w:footnoteReference w:id="2"/></w:r>') +
    `<w:tbl><w:tr>${cell("Četvrt")}${cell("Kućanstva")}</w:tr><w:tr>${cell("Zelena")}${cell("18")}</w:tr></w:tbl>` +
    para(
      '<w:hyperlink r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        run("izvor") +
        "</w:hyperlink>",
    );
  const footnotes =
    `${HEAD}<w:footnotes ${W}>` +
    '<w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:id="2"><w:p><w:r><w:t>Izmišljeni izvor, Lipovec 2026.</w:t></w:r></w:p></w:footnote></w:footnotes>';
  return {
    name: "footnotes-table",
    what: "one footnote, one table, one external hyperlink",
    bytes: pack(
      body,
      {
        "word/footnotes.xml": strToU8(footnotes),
        "docProps/core.xml": core({ "dc:creator": "Luka Izmišljeni" }),
      },
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/izvor" TargetMode="External"/>',
    ),
  };
}

/** 4. Export without docProps and without rsids, as an online editor writes it. */
export function onlineExport(): Fixture {
  const body =
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Gradski vrtovi</w:t></w:r></w:p>' +
    "<w:p><w:r><w:t>Izmišljeni osvrt bez metapodataka.</w:t></w:r></w:p>";
  return { name: "online-export", what: "no docProps, no rsids", bytes: pack(body) };
}

/** 5. LibreOffice-like: entities, diacritics, tab, break, field code, other application name. */
export function desktopSuite(): Fixture {
  const body = para(
    run("Šuma & vrt <2026> „citat”") +
      "<w:r><w:tab/><w:t>nakon tabulatora</w:t></w:r>" +
      "<w:r><w:t>prije prijeloma</w:t><w:br/><w:t>poslije</w:t></w:r>" +
      '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
      run("34"),
  );
  return {
    name: "desktop-suite",
    what: "entities, diacritics, tab, break, field code, LibreOffice application",
    bytes: pack(body, {
      "docProps/core.xml": core({
        "dc:creator": "Petra Izmišljena",
        "dcterms:created": "2026-08-01T12:00:00Z",
      }),
      "docProps/app.xml": app("LibreOffice/26.8.2.2$Linux_X86_64", 0),
    }),
  };
}

export const FIXTURES = [plainWord, trackedReview, footnotesTable, onlineExport, desktopSuite].map(
  (make) => make(),
);

/** Hostile and broken inputs; none may be read, none may take down the reader. */
export const hostile = {
  notZip: () => strToU8("ovo nije DOCX"),
  encrypted: () => Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
  noDocument: () => zipSync({ "[Content_Types].xml": strToU8(CONTENT_TYPES) }),
  doctype: () =>
    zipSync({
      "word/document.xml": strToU8(
        `${HEAD}<!DOCTYPE d [<!ENTITY x "bomb">]><w:document ${W}><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>`,
      ),
    }),
  malformed: () =>
    zipSync({ "word/document.xml": strToU8(`${HEAD}<w:document ${W}><w:body><w:p>`) }),
  tooManyEntries: (count: number) => {
    const entries: Zippable = {
      "word/document.xml": strToU8(`<w:document ${W}><w:body/></w:document>`),
    };
    for (let i = 0; i < count; i += 1) entries[`word/media/i${i}.bin`] = new Uint8Array(1);
    return zipSync(entries);
  },
  /** A few kilobytes that inflate to `megabytes` MiB. */
  inflatesTo: (megabytes: number) =>
    zipSync({
      "word/document.xml": strToU8(`<w:document ${W}><w:body/></w:document>`),
      "word/media/zeros.bin": new Uint8Array(megabytes * 1024 * 1024),
    }),
  withMacro: () => pack(para(run("Makro")), { "word/vbaProject.bin": new Uint8Array([1, 2, 3]) }),
  withTemplateLink: () =>
    pack(
      para(run("Predložak")),
      {},
      '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:/izmisljeno.dotm" TargetMode="External"/>',
    ),
};
