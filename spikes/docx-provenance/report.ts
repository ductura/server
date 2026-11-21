// Prints the signal matrix of README.md: which provenance signals each of the
// five invented DOCX files yields. `node report.ts`
import { readDocx, type DocxReading } from "./docx-read.ts";
import { FIXTURES } from "./fixtures.ts";

const SIGNALS: [string, (r: DocxReading) => boolean][] = [
  ["text and word count", (r) => r.wordCount > 0],
  ["heading levels", (r) => r.paragraphs.some((p) => p.heading !== null)],
  ["footnotes", (r) => r.footnotes.length > 0],
  ["tables", (r) => r.tables > 0],
  ["tracked changes (author, date)", (r) => r.trackedChanges.length > 0],
  ["comments (author, date)", (r) => r.comments.length > 0],
  ["rsid sessions", (r) => r.rsidCount > 0],
  ["core.creator", (r) => r.core.creator !== null],
  ["core.lastModifiedBy", (r) => r.core.lastModifiedBy !== null],
  ["core.created and modified", (r) => r.core.created !== null && r.core.modified !== null],
  ["core.revision", (r) => r.core.revision !== null],
  ["app.application", (r) => r.app.application !== null],
  ["app.totalTime", (r) => r.app.totalTimeMinutes !== null],
  ["external relationships", (r) => r.flags.externalRelationships.length > 0],
];

const readings = FIXTURES.map((f) => readDocx(f.bytes));
const names = FIXTURES.map((f) => f.name);
console.log(`| Signal | ${names.join(" | ")} | Found in |`);
console.log(`| --- | ${names.map(() => ":-:").join(" | ")} | --: |`);
for (const [label, present] of SIGNALS) {
  const marks = readings.map((r) => present(r));
  console.log(
    `| ${label} | ${marks.map((m) => (m ? "da" : "-")).join(" | ")} | ${marks.filter(Boolean).length}/${marks.length} |`,
  );
}
