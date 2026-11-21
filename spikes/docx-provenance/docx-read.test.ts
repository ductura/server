import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DocxReadError, LIMITS, readDocx, type ReadFailure } from "./docx-read.ts";
import { FIXTURES, hostile, pack, para, run } from "./fixtures.ts";
import { strToU8 } from "fflate";

const byName = (name: string) => {
  const fixture = FIXTURES.find((f) => f.name === name);
  assert.ok(fixture, name);
  return readDocx(fixture.bytes);
};

function failure(bytes: Uint8Array): ReadFailure {
  try {
    readDocx(bytes);
  } catch (error) {
    assert.ok(error instanceof DocxReadError, String(error));
    return error.code;
  }
  assert.fail("expected the reader to refuse the input");
}

describe("five invented DOCX files", () => {
  it("has exactly five fixtures, all invented", () => {
    assert.equal(FIXTURES.length, 5);
    assert.equal(new Set(FIXTURES.map((f) => f.name)).size, 5);
    for (const { bytes } of FIXTURES) {
      const text = Buffer.from(bytes).toString("latin1");
      assert.doesNotMatch(text, /https?:\/\/(?!example\.invalid|schemas\.|purl\.org|www\.w3\.org)/);
    }
  });

  it("plain-word: headings, text, core and app properties, rsids", () => {
    const r = byName("plain-word");
    assert.deepEqual(
      r.paragraphs.map((p) => p.heading),
      [1, null, null, 2, null],
    );
    assert.equal(r.paragraphs[0]?.text, "Kućno kompostiranje u Lipovcu");
    assert.equal(r.wordCount, 21);
    assert.deepEqual(r.core, {
      creator: "Ana Izmišljena",
      lastModifiedBy: "Ana Izmišljena",
      created: "2026-09-14T08:02:00Z",
      modified: "2026-10-02T17:45:00Z",
      revision: 7,
    });
    assert.deepEqual(r.app, { application: "Microsoft Office Word", totalTimeMinutes: 94 });
    assert.equal(r.rsidCount, 3);
  });

  it("tracked-review: changes and comments with authors, deleted text out of the body", () => {
    const r = byName("tracked-review");
    assert.deepEqual(
      r.trackedChanges.map((c) => [c.kind, c.author, c.text]),
      [
        ["delete", "Marko Izmišljeni", "stari "],
        ["insert", "Marko Izmišljeni", "novi "],
        ["insert", "Iva Izmišljena", " Dodana rečenica."],
      ],
    );
    assert.equal(r.trackedChanges[0]?.date, "2026-10-05T10:00:00Z");
    assert.deepEqual(
      r.comments.map((c) => [c.author, c.text]),
      [
        ["Marko Izmišljeni", "Dodaj izvor."],
        ["Iva Izmišljena", "Uskladi s uvodom."],
      ],
    );
    assert.equal(r.paragraphs[0]?.text, "Pregled nacrta: novi tekst.");
    assert.equal(r.core.lastModifiedBy, "Iva Izmišljena");
    assert.equal(r.core.revision, 12);
  });

  it("footnotes-table: footnote without separators, table, external link flagged", () => {
    const r = byName("footnotes-table");
    assert.deepEqual(r.footnotes, ["Izmišljeni izvor, Lipovec 2026."]);
    assert.equal(r.tables, 1);
    assert.deepEqual(r.flags.externalRelationships, ["hyperlink"]);
    assert.equal(r.core.creator, "Luka Izmišljeni");
    assert.equal(r.app.application, null);
  });

  it("online-export: missing metadata is null, never invented", () => {
    const r = byName("online-export");
    assert.deepEqual(r.core, {
      creator: null,
      lastModifiedBy: null,
      created: null,
      modified: null,
      revision: null,
    });
    assert.deepEqual(r.app, { application: null, totalTimeMinutes: null });
    assert.equal(r.rsidCount, 0);
    assert.equal(r.text, "Gradski vrtovi\nIzmišljeni osvrt bez metapodataka.");
  });

  it("desktop-suite: entities decoded once, tab and break kept, field code dropped", () => {
    const r = byName("desktop-suite");
    assert.equal(r.text, "Šuma & vrt <2026> „citat”\tnakon tabulatoraprije prijeloma\nposlije34");
    assert.equal(r.app.application, "LibreOffice/26.8.2.2$Linux_X86_64");
    assert.equal(r.app.totalTimeMinutes, 0);
  });

  it("is deterministic and does not mutate its input", () => {
    for (const { bytes } of FIXTURES) {
      const copy = bytes.slice();
      assert.deepEqual(readDocx(bytes), readDocx(bytes));
      assert.deepEqual(bytes, copy);
    }
  });
});

describe("hostile and broken input", () => {
  it("refuses what is not a DOCX, with a closed code", () => {
    assert.equal(failure(hostile.notZip()), "not_zip");
    assert.equal(failure(new Uint8Array()), "not_zip");
    assert.equal(failure(hostile.encrypted()), "encrypted");
    assert.equal(failure(hostile.noDocument()), "missing_document");
    assert.equal(failure(hostile.malformed()), "invalid_xml");
  });

  it("refuses a DOCTYPE or ENTITY declaration without expanding it", () => {
    assert.equal(failure(hostile.doctype()), "unsafe_xml");
  });

  it("refuses too many entries and a package that inflates past the limit", () => {
    assert.equal(failure(hostile.tooManyEntries(LIMITS.maxEntries + 1)), "too_many_entries");
    const bomb = hostile.inflatesTo(60);
    assert.ok(bomb.byteLength < 200_000, `bomb is ${bomb.byteLength} bytes packed`);
    assert.equal(failure(bomb), "uncompressed_too_large");
  });

  it("refuses a package over the byte limit before unzipping", () => {
    assert.equal(failure(new Uint8Array(LIMITS.maxPackageBytes + 1)), "too_large");
  });

  it("flags macros and external templates, and executes neither", () => {
    assert.equal(readDocx(hostile.withMacro()).flags.hasMacros, true);
    assert.deepEqual(readDocx(hostile.withTemplateLink()).flags.externalRelationships, [
      "attachedTemplate",
    ]);
  });
});

describe("XML details found in review", () => {
  it("refuses deeply nested XML with a closed code, not a plain Error", () => {
    const deep = "<w:x>".repeat(150) + "</w:x>".repeat(150);
    assert.equal(failure(pack(deep)), "invalid_xml");
  });

  it("decodes numeric references and escaped attributes exactly once", () => {
    const comments =
      '<w:comments xmlns:w="x"><w:comment w:id="0" w:author="Ana &amp;amp; Iva &#x41;"><w:p><w:r><w:t>a&#38;lt;b</w:t></w:r></w:p></w:comment></w:comments>';
    const r = readDocx(
      pack(para("<w:r><w:t>A&#32;B &#x48;&#105;</w:t></w:r>"), {
        "word/comments.xml": strToU8(comments),
      }),
    );
    assert.equal(r.text, "A B Hi");
    assert.equal(r.wordCount, 3);
    assert.equal(r.comments[0]?.author, "Ana &amp; Iva A");
    assert.equal(r.comments[0]?.text, "a&lt;b");
  });

  it("leaves an illegal character reference as written", () => {
    assert.equal(readDocx(pack(para("<w:r><w:t>x&#0;y</w:t></w:r>"))).text, "x&#0;y");
  });

  it("ignores XML layout whitespace between tags, keeps whitespace inside w:t", () => {
    const body =
      '<w:p>\n  <w:r>\n    <w:t>hel</w:t>\n  </w:r>\n  <w:r>\n    <w:t xml:space="preserve">lo </w:t>\n  </w:r>\n  <w:r><w:t>world</w:t></w:r>\n</w:p>';
    const r = readDocx(pack(body));
    assert.equal(r.text, "hello world");
    assert.equal(r.wordCount, 2);
  });

  it("reads a footnote typed normal the same as one without a type", () => {
    const note = (attrs: string) =>
      `<w:footnote ${attrs} w:id="2"><w:p><w:r><w:t>Bilješka.</w:t></w:r></w:p></w:footnote>`;
    const read = (attrs: string) =>
      readDocx(
        pack(para(run("x")), {
          "word/footnotes.xml": strToU8(`<w:footnotes xmlns:w="x">${note(attrs)}</w:footnotes>`),
        }),
      ).footnotes;
    assert.deepEqual(read('w:type="normal"'), ["Bilješka."]);
    assert.deepEqual(read(""), read('w:type="normal"'));
    assert.deepEqual(read('w:type="separator"'), []);
  });
});
