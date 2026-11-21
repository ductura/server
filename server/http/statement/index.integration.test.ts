import { afterEach, expect, it, vi } from "vitest";
import { createDatabases, createLayers, startServer, type Running } from "../index.ts";
import { createStatementRoutes, type StatementPort } from "./index.ts";

const ORIGIN = "https://ductura.example.invalid";
const HEADERS = {
  cookie: `__Host-ductus_session=${"V".repeat(43)}`,
  origin: ORIGIN,
  "sec-fetch-site": "same-origin",
};
const ID = "00000000-0000-4000-8000-0000000000a1";
const BODY = {
  baseVersion: 0,
  revision: 1,
  form: { formId: "test-izjava", formVersion: 1, formSha256: "a".repeat(64) },
  ownWork: { confirmed: true },
  humanHelp: {
    received: true,
    entries: [{ kind: "language", text: "Izmišljena kolegica pregledala je uvod." }],
  },
  ai: { use: "used", declaredTools: [], attachments: [], externalAttachmentIds: [] },
  confirm: true,
};
let running: Running | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function serve(answer: Awaited<ReturnType<StatementPort["run"]>>) {
  const run = vi.fn<StatementPort["run"]>().mockResolvedValue(answer);
  running = await startServer({
    host: "127.0.0.1",
    port: 0,
    databases: createDatabases(),
    layers: createLayers({ expectedOrigin: ORIGIN }),
    routes: createStatementRoutes({ institutionSlug: async () => "demo-fakultet", run }),
  });
  return { url: `http://127.0.0.1:${running.port}/api/v1/student/assignments/${ID}`, run };
}

it.each([
  ["text/html", "<p>Izmisljeni ispis</p>"],
  ["application/json", '{"izmisljeno":true}'],
  ["image/png", "izmisljeno"],
  ["application/pdf", "nije PDF"],
  ["text/plain", ""],
])("returns 422 without a DB write for %s with invalid bytes or type", async (type, body) => {
  const { url, run } = await serve({ status: "conflict" });
  const response = await fetch(`${url}/declaration-attachments`, {
    method: "POST",
    headers: { ...HEADERS, "content-type": type },
    body,
  });
  expect(response.status).toBe(422);
  expect(run).not.toHaveBeenCalled();
});

it.each([
  ["text/plain; charset=utf-8", "Izmišljeni ispis."],
  ["application/pdf", "%PDF-1.4\n% synthetic fixture"],
])("stores %s as the exact original bytes", async (type, body) => {
  const format = type.split(";")[0];
  const bytes = new TextEncoder().encode(body);
  const upload = {
    externalAttachmentId: ID,
    format,
    byteLength: bytes.length,
    contentSha256: "b".repeat(64),
  };
  const { url, run } = await serve({ status: "ok", body: upload });
  const response = await fetch(`${url}/declaration-attachments`, {
    method: "POST",
    headers: { ...HEADERS, "content-type": type },
    body,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(upload);
  expect(run).toHaveBeenCalledWith("V".repeat(43), ID, "demo-fakultet", {
    type: "upload",
    format,
    bytes,
  });
});

it.each([
  [{ ...BODY, principalId: ID }, 422],
  [
    {
      ...BODY,
      humanHelp: { received: true, entries: [{ kind: "unlisted", text: "Izmišljeni unos." }] },
    },
    422,
  ],
  [{ ...BODY, ownWork: { confirmed: false } }, 409],
])("refuses invalid or incomplete declarations before the DB write", async (body, status) => {
  const { url, run } = await serve({ status: "conflict" });
  const response = await fetch(`${url}/declaration`, {
    method: "PUT",
    headers: { ...HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(status);
  expect(run).not.toHaveBeenCalled();
});
