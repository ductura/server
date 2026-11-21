import { request } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createFakeServer,
  FAKE_VECTOR_HEADER,
  ROUTE_TABLE,
  VECTORS,
  type FakeVector,
} from "./generated/fake-server/index.ts";
import { createClient } from "./generated/index.ts";
import { ROUTES } from "./index.ts";

const server = createFakeServer();
let port = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

type Reply = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

/** A raw HTTP request, so every header a vector names is sent as it is. */
function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body: string | Buffer = "",
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          // A JPEG answer (SRV-1102) is compared in Base64, as the vector writes it.
          body: Buffer.concat(chunks).toString(
            res.headers["content-type"] === "image/jpeg" ? "base64" : "utf8",
          ),
        }),
      );
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** A multipart body (SRV-1102): a contentMediaType field is a file part, Base64 in the vector. */
function multipartOf(v: FakeVector, body: Record<string, string>): Buffer {
  const boundary = /boundary=([^;]+)/u.exec(v.request.headers?.["content-type"] ?? "")?.[1];
  const schema = ROUTES.find((r) => r.id === v.route)?.request.body as
    { properties?: Record<string, { contentMediaType?: string }> } | undefined;
  const parts = Object.entries(body).map(([name, value]) => {
    const type = schema?.properties?.[name]?.contentMediaType;
    const head =
      type === undefined
        ? `Content-Disposition: form-data; name="${name}"`
        : `Content-Disposition: form-data; name="${name}"; filename="isjecak.jpg"\r\nContent-Type: ${type}`;
    const bytes = type === undefined ? Buffer.from(value) : Buffer.from(value, "base64");
    return Buffer.concat([
      Buffer.from(`--${boundary}\r\n${head}\r\n\r\n`),
      bytes,
      Buffer.from("\r\n"),
    ]);
  });
  return Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);
}

function sendVector(v: FakeVector): Promise<Reply> {
  const route = ROUTE_TABLE[v.route as keyof typeof ROUTE_TABLE];
  const params = v.request.params ?? {};
  let path = route.path.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(params[name] ?? ""),
  );
  const query = new URLSearchParams(v.request.query ?? {}).toString();
  if (query) path += `?${query}`;
  const { body, rawBody } = v.request;
  const text =
    rawBody ??
    (body !== undefined && route.body === "multipart/form-data"
      ? multipartOf(v, body as Record<string, string>)
      : body === undefined
        ? ""
        : route.body === "application/x-www-form-urlencoded"
          ? new URLSearchParams(body as Record<string, string>).toString()
          : JSON.stringify(body));
  return send(route.method, path, { ...v.request.headers, [FAKE_VECTOR_HEADER]: v.name }, text);
}

// A content-length the body does not have (invalid, mismatched, cut short) is
// refused or waited on by Node itself; fake-server.test.ts covers those vectors.
const overHttp = VECTORS.filter((v) => v.request.headers?.["content-length"] === undefined);

describe("fake server over HTTP", () => {
  it("sends all but the framing vectors over the wire", () => {
    // Five framing vectors per guarded mutation route: 36 on main, +5 revision-requests, +25 enrolment, notice and work language, +40 institution;
    // the submission and the replay (DAN-818), as the evidence routes, have two each (timeout and bad-request);
    // the client context (DAN-846) has four (no session, so no unauthorized vector);
    // the three WebAuthn routes (DAN-840-1) have four each, framing only: timeout, length twice, stream;
    // teacher.assignment-submissions.post (DAN-903-1) five, as the fast path;
    // student.enrollments.post and student.notice-read.post (SRV-02) five each;
    // the four mutation routes of SRV-03 five each; student.submission-notes.post (SRV-19) five;
    // sources.lookup.post (SRV-7D) five, plus the work-source mutations (SRV-7C);
    // the detailed process summary (SRV-9D) adds five more.
    // public.verification.post (SRV-9B) four.
    // teacher.mentorship-request-decision.post (SRV-27) five.
    // work.consultation-records.post and work.consultation-additions.post (SRV-1105) five each.
    // student.source-proofs.post (SRV-1102) five.
    // teacher.deadline-extension.post (SRV-1108) five.
    // SRV-1105 has five framing vectors per mutation.
    // SRV-1104 has two content-length vectors per mutation.
    // teacher.merlin-packages.post (SRV-1110) five.
    // work.messages.post (SRV-1106) five.
    // work.milestones.patch (SRV-1103) five, teacher.working-criterion.put (SRV-1107) five.
    // student.assistant-request.post (SRV-1204) five.
    expect(VECTORS.length - overHttp.length).toBe(244);
  });

  it.each(overHttp.map((v) => [`${v.route} ${v.name}`, v] as const))(
    "%s: exactly the vector",
    async (_, v) => {
      const res = await sendVector(v);
      const { status, contentType, headers = {}, body } = v.response;
      expect(res.status).toBe(status);
      for (const [name, value] of Object.entries(headers)) expect(res.headers[name]).toEqual(value);
      expect(res.headers["content-type"]).toBe(contentType);
      if (body === undefined) expect(res.body).toBe("");
      else if (contentType === "application/json") expect(JSON.parse(res.body)).toEqual(body);
      else expect(res.body).toBe(body);
    },
  );

  it.each([
    ["GET", "/api/v1/health?x=1", 501, "not_implemented"],
    ["POST", "/api/v1/profile/interface-locale", 501, "not_implemented"],
    ["DELETE", "/api/v1/health", 405, "method_not_allowed"],
    ["GET", "/api/v1/evidence/replay", 405, "method_not_allowed"],
    ["GET", "/api/v1/evidence/replay/extra", 404, "not_found"],
    ["GET", "/api/v1/evidence/commit", 405, "method_not_allowed"],
    ["GET", "/api/v1/health/extra", 404, "not_found"],
    ["GET", "/health", 404, "not_found"],
  ])("%s %s -> %i %s", async (method, path, status, code) => {
    const res = await send(method, path);
    expect(res.status).toBe(status);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(res.body)).toEqual({ error: code });
  });

  it("405 lists the allowed methods", async () => {
    const res = await send("PUT", "/api/v1/profile/interface-locale");
    expect(res.headers.allow).toBe("GET, POST");
  });

  it("answers 500 internal when it is picked, and the generated client knows the code", async () => {
    const pick = (async (url: URL, init: RequestInit) =>
      fetch(url, { ...init, headers: { [FAKE_VECTOR_HEADER]: "internal" } })) as typeof fetch;
    const call = createClient(`http://127.0.0.1:${port}`, pick);
    const none = { params: undefined, query: undefined, body: undefined };
    expect(await call("platform.health.get", none)).toEqual({
      ok: false,
      status: 500,
      code: "internal",
    });
  });

  it("the generated client reads the teacher's submissions of many assignments (DAN-903-1)", async () => {
    const route = "teacher.assignment-submissions.post";
    const vector = (name: string) => {
      const v = VECTORS.find((x) => x.route === route && x.name === name);
      if (v === undefined) throw new Error(`no vector ${name}`);
      return v;
    };
    // A browser sends the cookie and the origin itself; here the fetch adds them.
    const as = (name: string) =>
      createClient(`http://127.0.0.1:${port}`, (async (url: URL, init: RequestInit) =>
        fetch(url, {
          ...init,
          headers: { ...(init.headers as object), ...vector(name).request.headers },
        })) as typeof fetch);
    const ok = vector("submissions");
    expect(
      await as("submissions")(route, {
        params: undefined,
        query: undefined,
        body: ok.request.body as { assignmentIds: string[] },
      }),
    ).toEqual({ ok: true, status: 200, body: ok.response.body, headers: {} });
    const bad = vector("invalid-input");
    expect(
      await as("invalid-input")(route, {
        params: undefined,
        query: undefined,
        body: bad.request.body as { assignmentIds: string[] },
      }),
    ).toEqual({ ok: false, status: 422, code: "invalid_input" });
  });

  it("the generated client reads the teacher's access (DAN-903-2)", async () => {
    const route = "teacher.access.get";
    const vector = (name: string) => {
      const v = VECTORS.find((x) => x.route === route && x.name === name);
      if (v === undefined) throw new Error(`no vector ${name}`);
      return v;
    };
    const as = (name: string) =>
      createClient(`http://127.0.0.1:${port}`, (async (url: URL, init: RequestInit) =>
        fetch(url, {
          ...init,
          headers: { ...vector(name).request.headers, [FAKE_VECTOR_HEADER]: name },
        })) as typeof fetch);
    const none = { params: undefined, query: undefined, body: undefined };
    for (const name of ["allowed", "denied"])
      expect(await as(name)(route, none)).toEqual({
        ok: true,
        status: 200,
        body: vector(name).response.body,
        headers: {},
      });
    expect(await as("unauthorized")(route, none)).toEqual({
      ok: false,
      status: 401,
      code: "unauthorized",
    });
    expect(await as("unavailable")(route, none)).toEqual({
      ok: false,
      status: 503,
      code: "unavailable",
    });
  });

  it("the generated client reads the download manifest (DAN-931)", async () => {
    const route = "downloads.manifest.get";
    const vector = (name: string) => {
      const v = VECTORS.find((x) => x.route === route && x.name === name);
      if (v === undefined) throw new Error(`no vector ${name}`);
      return v;
    };
    const as = (name: string) =>
      createClient(`http://127.0.0.1:${port}`, (async (url: URL, init: RequestInit) =>
        fetch(url, { ...init, headers: { [FAKE_VECTOR_HEADER]: name } })) as typeof fetch);
    const none = { params: undefined, query: undefined, body: undefined };
    const ready = await as("ready")(route, none);
    expect(ready).toEqual({
      ok: true,
      status: 200,
      body: vector("ready").response.body,
      headers: {},
    });
    expect(ready.ok ? ready.body.packages.map((p) => `${p.system} ${p.architecture}`) : []).toEqual(
      ["macos arm64", "macos x64", "windows arm64", "windows x64"],
    );
    expect(await as("ready-empty")(route, none)).toEqual({
      ok: true,
      status: 200,
      body: { packages: [] },
      headers: {},
    });
    expect(await as("unavailable")(route, none)).toEqual({
      ok: false,
      status: 503,
      code: "unavailable",
    });
  });

  it("the generated client reads the state of each own work (DAN-989-1)", async () => {
    const route = "student.assignment-work.get";
    const vector = (name: string) => {
      const v = VECTORS.find((x) => x.route === route && x.name === name);
      if (v === undefined) throw new Error(`no vector ${name}`);
      return v;
    };
    const as = (name: string) =>
      createClient(`http://127.0.0.1:${port}`, (async (url: URL, init: RequestInit) =>
        fetch(url, {
          ...init,
          headers: { ...vector(name).request.headers, [FAKE_VECTOR_HEADER]: name },
        })) as typeof fetch);
    const none = { params: undefined, query: undefined, body: undefined };
    const ready = await as("ready")(route, none);
    expect(ready).toEqual({
      ok: true,
      status: 200,
      body: vector("ready").response.body,
      headers: {},
    });
    expect(ready.ok ? ready.body.assignments.map((row) => row.workState) : []).toEqual([
      "in_progress",
      "not_started",
      "submitted",
    ]);
    expect(await as("ready-empty")(route, none)).toEqual({
      ok: true,
      status: 200,
      body: { assignments: [] },
      headers: {},
    });
    for (const [name, status, code] of [
      ["signed-out", 401, "unauthorized"],
      ["unavailable", 503, "unavailable"],
    ] as const)
      expect(await as(name)(route, none)).toEqual({ ok: false, status, code });
  });

  it("the generated client reads the student's own access log page by page (DAN-904)", async () => {
    const route = "student.access-log.get";
    const vector = (name: string) => {
      const v = VECTORS.find((x) => x.route === route && x.name === name);
      if (v === undefined) throw new Error(`no vector ${name}`);
      return v;
    };
    const as = (name: string) =>
      createClient(`http://127.0.0.1:${port}`, (async (url: URL, init: RequestInit) =>
        fetch(url, {
          ...init,
          headers: { ...vector(name).request.headers, [FAKE_VECTOR_HEADER]: name },
        })) as typeof fetch);
    const params = { documentId: "izmisljeni-rad-0001" };
    const first = await as("first-page")(route, { params, query: {}, body: undefined });
    expect(first).toEqual({
      ok: true,
      status: 200,
      body: vector("first-page").response.body,
      headers: {},
    });
    // The next page starts from the cursor the first one gave.
    const next = (first.ok ? first.body.next : null) ?? {};
    expect(await as("continued")(route, { params, query: next, body: undefined })).toEqual({
      ok: true,
      status: 200,
      body: vector("continued").response.body,
      headers: {},
    });
    for (const [name, status, code] of [
      ["not-found-or-not-the-owner", 404, "not_found"],
      ["unauthorized", 401, "unauthorized"],
    ] as const)
      expect(await as(name)(route, { params, query: {}, body: undefined })).toEqual({
        ok: false,
        status,
        code,
      });
  });

  it("a health check without a pick gets its success vector", async () => {
    const res = await send("GET", "/api/v1/health");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });
});
