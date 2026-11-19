// DAN-852-4a and 4b (contracts Ductus#1836 c.6947710352, c.6949068519): the
// course, enrolment code and revocation routes on a real server with the real pipeline, over
// the real institution service and a fake InstitutionCourses port. Every
// vector a socket can reach is sent as its bytes; every refusal before the
// port leaves it uncalled. All values are invented.
import { readFileSync } from "node:fs";
import { connect } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CourseCreateOutcome,
  CourseInput,
  EnrollmentCodeIssueOutcome,
  EnrollmentCodeRevokeOutcome,
  InstitutionCourses,
  InstitutionMembers,
} from "../database/index.ts";

import { createDatabases } from "./databases.ts";
import { createInstitutionCourseRoutes } from "./institution-courses.ts";
import { createLayers } from "./pipeline.ts";
import { type Running, startServer } from "./start.ts";

type Vector = {
  name: string;
  request: { headers: Record<string, string>; body?: unknown; rawBody?: string };
  response: { status: number; body: Record<string, unknown> };
};
const VECTORS = (
  JSON.parse(
    readFileSync(
      new URL("../contracts/vectors/institution.courses.post.json", import.meta.url),
      "utf8",
    ),
  ) as { vectors: Vector[] }
).vectors;
const CREATED = VECTORS.find((v) => v.name === "created")!;
const ORIGIN = CREATED.request.headers.origin!;
const COOKIE = CREATED.request.headers.cookie!;
const TOKEN = COOKIE.slice("__Host-ductus_session=".length);
const ID = CREATED.response.body.id as string;
const GOOD = CREATED.request.body as CourseInput;

// The student and version routes are institution-members.integration.test.ts.
const NO_MEMBERS = {} as InstitutionMembers;
let server: Running | undefined;
const calls = {
  port: [] as [string, CourseInput][],
  issue: [] as [string, string, string][],
  revoke: [] as [string, string][],
  activity: [] as string[],
};
let answer: () => Promise<CourseCreateOutcome> = async () => ({ status: "created", id: ID });
const CODE = "A1B2-C3D4-E5F6-0789";
let issueAnswer: () => Promise<EnrollmentCodeIssueOutcome> = async () => ({
  status: "issued",
  code: CODE,
});
let revokeAnswer: () => Promise<EnrollmentCodeRevokeOutcome> = async () => ({
  status: "revoked",
  revoked: true,
});
let activity: () => Promise<unknown> = async () => undefined;

async function start() {
  const courses = {
    createCourse: async (token: string, course: CourseInput) => {
      calls.port.push([token, course]);
      return answer();
    },
    issueEnrollmentCode: async (token: string, courseId: string, validUntil: string) => {
      calls.issue.push([token, courseId, validUntil]);
      return issueAnswer();
    },
    revokeEnrollmentCode: async (token: string, courseId: string) => {
      calls.revoke.push([token, courseId]);
      return revokeAnswer();
    },
  } satisfies InstitutionCourses;
  server = await startServer({
    host: "127.0.0.1",
    port: 0,
    layers: createLayers({ expectedOrigin: ORIGIN }),
    databases: createDatabases(),
    routes: createInstitutionCourseRoutes({
      courses,
      members: NO_MEMBERS,
      recordActivity: (token) => {
        calls.activity.push(token);
        return activity();
      },
      timeoutMs: 300,
    }),
  });
}
afterEach(async () => {
  calls.port.length = 0;
  calls.issue.length = 0;
  calls.revoke.length = 0;
  calls.activity.length = 0;
  issueAnswer = async () => ({ status: "issued", code: CODE });
  revokeAnswer = async () => ({ status: "revoked", revoked: true });
  answer = async () => ({ status: "created", id: ID });
  activity = async () => undefined;
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
});

type Answer = { status: number; head: Record<string, string>; body: string };
function send(raw: Buffer): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const socket = connect(server!.port, "127.0.0.1");
    let text = "";
    socket.write(raw);
    const finish = (): Answer => {
      const [head = "", ...rest] = text.split("\r\n\r\n");
      const headers: Record<string, string> = {};
      for (const field of head.split("\r\n").slice(1)) {
        const at = field.indexOf(":");
        headers[field.slice(0, at).toLowerCase()] = field.slice(at + 1).trim();
      }
      return { status: Number(head.split(" ")[1]), head: headers, body: rest.join("\r\n\r\n") };
    };
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      const got = finish();
      if (!text.includes("\r\n\r\n")) return;
      if (Buffer.byteLength(got.body) >= Number(got.head["content-length"] ?? 0)) {
        socket.destroy();
        resolve(got);
      }
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(finish()));
  });
}

/** One request as bytes; `headers` is a list so a header can be sent twice. */
function raw(
  headers: [string, string][],
  body: string | Buffer = "",
  path = "/api/v1/institution/courses",
): Buffer {
  const all: [string, string][] = [["host", "127.0.0.1"], ...headers];
  const framed = all.some(([k]) => /^(content-length|transfer-encoding)$/i.test(k));
  if (!framed) all.push(["content-length", String(Buffer.byteLength(body))]);
  const head = `POST ${path} HTTP/1.1\r\n${all.map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`;
  return Buffer.concat([Buffer.from(head, "latin1"), Buffer.from(body)]);
}
const headers = (cookie = COOKIE, type = "application/json"): [string, string][] => [
  ["origin", ORIGIN],
  ["sec-fetch-site", "same-origin"],
  ["content-type", type],
  ["cookie", cookie],
];
const post = (body: string | Buffer, list = headers()) => send(raw(list, body));
const good = (change: Record<string, unknown> = {}) => JSON.stringify({ ...GOOD, ...change });
const codeOf = (got: Answer) => [got.status, (JSON.parse(got.body) as { code: string }).code];

// A short body under a longer Content-Length is a wait (408) or a client gone
// on a real socket; the reader's own 400 is mutation-request.test.ts.
const UNREACHABLE = new Set(["content-length-mismatch", "body-stream-error"]);
const REACHES_PORT = new Set(["created", "forbidden", "conflict", "unavailable"]);
const OUTCOME: Record<string, CourseCreateOutcome> = {
  forbidden: { status: "forbidden" },
  conflict: { status: "conflict" },
  unavailable: { status: "unavailable", reason: "database_error" },
};

describe("every vector a socket can reach", () => {
  it.each(VECTORS.filter((v) => !UNREACHABLE.has(v.name)).map((v) => [v.name, v] as const))(
    "%s",
    async (_name, v) => {
      const outcome = OUTCOME[v.name];
      if (outcome !== undefined) answer = async () => outcome;
      await start();
      const body = v.request.rawBody ?? JSON.stringify(v.request.body);
      const got = await send(raw(Object.entries(v.request.headers), body));
      expect(got.status).toBe(v.response.status);
      if (v.name === "content-length-invalid") return; // Node's parser answers it itself.
      expect(got.head["content-type"]?.split(";")[0]).toBe("application/json");
      expect(got.head["cache-control"]).toBe("no-store");
      const json = JSON.parse(got.body) as Record<string, unknown>;
      if (got.status === 200) expect(json).toEqual(v.response.body);
      else expect(json).toEqual({ ...v.response.body, requestId: got.head["x-request-id"] });
      expect(calls.port).toEqual(REACHES_PORT.has(v.name) ? [[TOKEN, GOOD]] : []);
      expect(calls.activity).toEqual(got.status === 200 ? [TOKEN] : []);
    },
  );
});

describe("refusals before the port", () => {
  it("the token comes before the media type and the declared length", async () => {
    await start();
    const bare = headers().filter(([k]) => k !== "cookie");
    const typed = bare.map(([k, v]): [string, string] => [
      k,
      k === "content-type" ? "text/plain" : v,
    ]);
    expect(codeOf(await post(good(), typed))).toEqual([401, "unauthorized"]);
    const long = await send(raw([...bare, ["content-length", "99999999"]], good()));
    expect(codeOf(long)).toEqual([401, "unauthorized"]);
    expect(calls.port).toEqual([]);
  });

  it("an ended session, two cookies or a token of the wrong length is 401", async () => {
    const { sessionTag } = await import("../session/index.ts");
    await start();
    for (const list of [
      headers(`${COOKIE}; ductus-ended-${sessionTag(TOKEN)!}=1`),
      [...headers(), ["cookie", COOKIE]] as [string, string][],
      headers(`__Host-ductus_session=${TOKEN.slice(1)}`),
      headers(`${COOKIE}A`),
    ]) {
      expect(codeOf(await post(good(), list))).toEqual([401, "unauthorized"]);
    }
    expect(calls.port).toEqual([]);
  });

  it("only the media type application/json, sent once, is accepted", async () => {
    await start();
    for (const type of [
      "",
      "application/json, application/json",
      "application/jsonx",
      "text/json",
    ]) {
      expect(codeOf(await post(good(), headers(COOKIE, type)))).toEqual([
        415,
        "unsupported_media_type",
      ]);
    }
    const twice = [...headers(), ["content-type", "application/json"]] as [string, string][];
    expect(codeOf(await post(good(), twice))).toEqual([415, "unsupported_media_type"]);
    expect(calls.port).toEqual([]);
    for (const type of [
      "application/json;charset=utf-8",
      "APPLICATION/JSON ; x=y",
      "application/json\t;q",
    ]) {
      expect((await post(good(), headers(COOKIE, type))).status).toBe(200);
    }
    expect(calls.port).toHaveLength(3);
  });

  it("a byte order mark, broken UTF-8 or an empty body is invalid_json", async () => {
    await start();
    for (const body of [
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(good())]),
      Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from('"}')]),
      "",
    ]) {
      expect(codeOf(await post(body))).toEqual([400, "invalid_json"]);
    }
    expect(calls.port).toEqual([]);
  });

  it("a chunked body past 2048 bytes is cut off with 413; 2048 bytes reach the parser", async () => {
    await start();
    const big = `${"x".repeat(2049)}`;
    const chunked = [...headers(), ["transfer-encoding", "chunked"]] as [string, string][];
    const got = await send(raw(chunked, `${(2049).toString(16)}\r\n${big}\r\n0\r\n\r\n`));
    expect(codeOf(got)).toEqual([413, "body_too_large"]);
    const exact = good({ name: "a".repeat(2048 - good({ name: "" }).length) });
    expect(Buffer.byteLength(exact)).toBe(2048);
    expect(codeOf(await post(exact))).toEqual([422, "invalid_input"]); // name over 160: the parser
    expect(calls.port).toEqual([]);
  });
});

describe("input classes the parser alone does not see", () => {
  it("a wire __proto__ key or CRLF or tab at an edge of the name is 422 without a call", async () => {
    await start();
    for (const body of [
      `{"__proto__":{},${good().slice(1)}`,
      good({ name: "\r\nIzmišljeni" }),
      good({ name: "Izmišljeni\t" }),
    ]) {
      expect(codeOf(await post(body))).toEqual([422, "invalid_input"]);
    }
    expect(calls.port).toEqual([]);
  });

  it("a duplicate key hands the port its last value; an inner DEL passes unchanged", async () => {
    await start();
    await post(`{"name":"Prvi",${good().slice(1)}`);
    await post(good({ name: "Izmišljeni\u007fkolegij" }));
    expect(calls.port.map(([, course]) => course.name)).toEqual([
      GOOD.name,
      "Izmišljeni\u007fkolegij",
    ]);
  });
});

describe("outcomes and activity", () => {
  it("invalid is 422; unavailable, an unknown status and a throw are 503 without detail", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const [outcome, expected] of [
      [async () => ({ status: "invalid" }), [422, "invalid_input"]],
      [async () => ({ status: "unavailable", reason: "secret-reason" }), [503, "unavailable"]],
      [async () => ({ status: "surprise" }), [503, "unavailable"]],
      [() => Promise.reject(new TypeError("secret-message")), [503, "unavailable"]],
    ] as const) {
      answer = outcome as () => Promise<CourseCreateOutcome>;
      await start();
      const got = await post(good());
      expect(codeOf(got)).toEqual(expected);
      expect(got.body).not.toMatch(/secret/);
      await server!.close();
      server = undefined;
    }
    expect(calls.activity).toEqual([]);
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/secret/);
  });

  it("activity that throws or never settles still answers 200", async () => {
    for (const next of [() => Promise.reject(new Error("x")), () => new Promise(() => undefined)]) {
      activity = next;
      await start();
      const got = await post(good());
      expect([got.status, JSON.parse(got.body)]).toEqual([200, { id: ID }]);
      await server!.close();
      server = undefined;
    }
    expect(calls.activity).toEqual([TOKEN, TOKEN]);
  });
});

// DAN-852-4b: the enrolment code and its revocation.
const load = (name: string) =>
  (
    JSON.parse(
      readFileSync(new URL(`../contracts/vectors/${name}.post.json`, import.meta.url), "utf8"),
    ) as { vectors: (Vector & { request: { params: { courseId: string } } })[] }
  ).vectors;
const CODE_VECTORS = load("institution.enrollment-code");
const REVOKE_VECTORS = load("institution.enrollment-code-revocation");
const COURSE = CODE_VECTORS[0]!.request.params.courseId;
const UNTIL = (CODE_VECTORS[0]!.request.body as { validUntil: string }).validUntil;
const codePath = (id = COURSE) => `/api/v1/institution/courses/${id}/enrollment-code`;
const revokePath = (id = COURSE) => `${codePath(id)}/revocation`;
const issue = (body: string, id = COURSE, list = headers()) => send(raw(list, body, codePath(id)));
const revoke = (body: string, id = COURSE, list = headers()) =>
  send(raw(list, body, revokePath(id)));
const UNTIL_BODY = JSON.stringify({ validUntil: UNTIL });
const bodyOf = (got: Answer) => JSON.parse(got.body) as Record<string, unknown>;

describe("every enrolment code and revocation vector a socket can reach", () => {
  const ISSUE: Record<string, EnrollmentCodeIssueOutcome> = {
    forbidden: { status: "forbidden" },
    unavailable: { status: "unavailable", reason: "database_error" },
  };
  const REVOKE: Record<string, EnrollmentCodeRevokeOutcome> = {
    false: { status: "revoked", revoked: false },
    forbidden: { status: "forbidden" },
    unavailable: { status: "unavailable", reason: "database_error" },
  };
  const cases = [
    ...CODE_VECTORS.map((v) => ["code", v] as const),
    ...REVOKE_VECTORS.map((v) => ["revocation", v] as const),
  ].filter(([, v]) => !UNREACHABLE.has(v.name));
  it.each(cases.map(([route, v]) => [`${route} ${v.name}`, route, v] as const))(
    "%s",
    async (_name, route, v) => {
      if (ISSUE[v.name] !== undefined && route === "code") issueAnswer = async () => ISSUE[v.name]!;
      if (REVOKE[v.name] !== undefined && route === "revocation")
        revokeAnswer = async () => REVOKE[v.name]!;
      await start();
      const body = v.request.rawBody ?? JSON.stringify(v.request.body);
      const path = (route === "code" ? codePath : revokePath)(v.request.params.courseId);
      const got = await send(raw(Object.entries(v.request.headers), body, path));
      expect(got.status).toBe(v.response.status);
      if (v.name === "content-length-invalid") return;
      expect(got.head["content-type"]?.split(";")[0]).toBe("application/json");
      expect(got.head["cache-control"]).toBe("no-store");
      if (got.status === 200) expect(bodyOf(got)).toEqual(v.response.body);
      else expect(bodyOf(got)).toEqual({ ...v.response.body, requestId: got.head["x-request-id"] });
      const reached = ["issued", "true", "false", "forbidden", "unavailable"].includes(v.name);
      if (route === "code") expect(calls.issue).toEqual(reached ? [[TOKEN, COURSE, UNTIL]] : []);
      else expect(calls.revoke).toEqual(reached ? [[TOKEN, COURSE]] : []);
      expect(calls.activity).toEqual(got.status === 200 ? [TOKEN] : []);
      if (got.status !== 200) expect(got.body).not.toContain(CODE);
    },
  );
});

describe("the course id in the path, on both routes", () => {
  const routes = [
    ["code", (id: string, list?: [string, string][]) => issue(UNTIL_BODY, id, list)],
    ["revocation", (id: string, list?: [string, string][]) => revoke("{}", id, list)],
  ] as const;
  const portCalls = () => [...calls.issue, ...calls.revoke];

  it.each(routes)("%s: anything but one decoded UUID is 422 without a call", async (_r, call) => {
    await start();
    const [head, ...rest] = COURSE;
    for (const id of [
      "nije-uuid",
      "%ZZ",
      `${COURSE.slice(0, 8)}%2F${COURSE.slice(9)}`,
      COURSE.slice(1),
      `${COURSE.slice(0, 8)}%20${COURSE.slice(9)}`,
      "%2E%2E",
      `%25${head!.charCodeAt(0).toString(16)}${rest.join("")}`, // decoded once: still %37…
    ]) {
      expect(codeOf(await call(id))).toEqual([422, "invalid_input"]);
    }
    expect(portCalls()).toEqual([]);
  });

  it.each(routes)(
    "%s: 401 before the path id, the path id before 415 and 413",
    async (_r, call) => {
      await start();
      const bare = headers().filter(([k]) => k !== "cookie");
      expect(codeOf(await call("%ZZ", bare))).toEqual([401, "unauthorized"]);
      expect(codeOf(await call("nije-uuid", headers(COOKIE, "text/plain")))).toEqual([
        422,
        "invalid_input",
      ]);
      const long = [...headers(), ["content-length", "99999999"]] as [string, string][];
      expect(codeOf(await call("nije-uuid", long))).toEqual([422, "invalid_input"]);
      expect(portCalls()).toEqual([]);
    },
  );

  it("a literal .. or an empty segment never reaches either route", async () => {
    await start();
    for (const path of [codePath(".."), revokePath(".."), codePath("")]) {
      expect((await send(raw(headers(), "{}", path))).status).toBe(404);
    }
    expect(portCalls()).toEqual([]);
  });

  it("an upper-case id and one with an encoded character reach the port decoded once", async () => {
    await start();
    const upper = COURSE.toUpperCase();
    const encoded = `%${COURSE.charCodeAt(0).toString(16)}${COURSE.slice(1)}`;
    for (const id of [upper, encoded]) {
      expect((await issue(UNTIL_BODY, id)).status).toBe(200);
      expect((await revoke("{}", id)).status).toBe(200);
    }
    expect(calls.issue.map(([, id]) => id)).toEqual([upper, COURSE]);
    expect(calls.revoke.map(([, id]) => id)).toEqual([upper, COURSE]);
  });
});

describe("the bodies of the enrolment code routes", () => {
  const chunked = (size: number) => {
    const list = [...headers(), ["transfer-encoding", "chunked"]] as [string, string][];
    return [list, `${size.toString(16)}\r\n${" ".repeat(size)}\r\n0\r\n\r\n`] as const;
  };
  const declared = (size: number) =>
    [...headers(), ["content-length", String(size)]] as [string, string][];

  it("the code body is exactly {validUntil} of a real instant, at most 1024 bytes", async () => {
    await start();
    for (const body of [
      JSON.stringify({ validUntil: "2026-02-30T12:00:00Z" }),
      "{}",
      JSON.stringify({ validUntil: UNTIL, x: 1 }),
    ]) {
      expect(codeOf(await issue(body))).toEqual([422, "invalid_input"]);
    }
    expect(calls.issue).toEqual([]);
    expect((await issue(UNTIL_BODY.padEnd(1024))).status).toBe(200);
    expect(calls.issue).toHaveLength(1);
    expect(codeOf(await send(raw(declared(1025), "", codePath())))).toEqual([
      413,
      "body_too_large",
    ]);
    const [list, body] = chunked(1025);
    expect(codeOf(await send(raw(list, body, codePath())))).toEqual([413, "body_too_large"]);
    expect(calls.issue).toHaveLength(1);
  });

  it("the revocation body is exactly {}, at most 64 bytes", async () => {
    await start();
    for (const body of ["[]", "null", '"x"', "0", '{"a":1}', '{"a":1,"a":2}', '{"__proto__":{}}']) {
      expect(codeOf(await revoke(body))).toEqual([422, "invalid_input"]);
    }
    expect(calls.revoke).toEqual([]);
    for (const body of ["{}", "{ }", `{${" ".repeat(62)}}`]) {
      expect((await revoke(body)).status).toBe(200);
    }
    expect(calls.revoke).toHaveLength(3);
    expect(codeOf(await send(raw(declared(65), "", revokePath())))).toEqual([
      413,
      "body_too_large",
    ]);
    const [list, body] = chunked(65);
    expect(codeOf(await send(raw(list, body, revokePath())))).toEqual([413, "body_too_large"]);
    expect(calls.revoke).toHaveLength(3);
  });
});

describe("outcomes of the enrolment code routes", () => {
  it("the code leaves only in a 200 of issued, as exactly {code}", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const refusals = [
      [{ status: "unauthenticated" }, [401, "unauthorized"]],
      [{ status: "forbidden" }, [403, "forbidden"]],
      [{ status: "invalid" }, [422, "invalid_input"]],
      [{ status: "unavailable", reason: CODE }, [503, "unavailable"]],
      [{ status: "conflict", code: CODE }, [503, "unavailable"]],
      [{ status: "surprise", code: CODE }, [503, "unavailable"]],
    ] as const;
    for (const [outcome, expected] of refusals) {
      issueAnswer = async () => outcome as unknown as EnrollmentCodeIssueOutcome;
      await start();
      const got = await issue(UNTIL_BODY);
      expect(codeOf(got)).toEqual(expected);
      expect(got.body).not.toContain(CODE);
      await server!.close();
      server = undefined;
    }
    issueAnswer = () => Promise.reject(new Error(CODE));
    await start();
    const thrown = await issue(UNTIL_BODY);
    expect([thrown.status, thrown.body.includes(CODE)]).toEqual([503, false]);
    issueAnswer = async () => ({ status: "issued", code: CODE, extra: 1 }) as never;
    expect(bodyOf(await issue(UNTIL_BODY))).toEqual({ code: CODE });
    expect(calls.activity).toEqual([TOKEN]);
  });

  it("revocation answers only revoked, 401 and 403; conflict and invalid are 503", async () => {
    for (const [outcome, expected] of [
      [{ status: "unauthenticated" }, [401, "unauthorized"]],
      [{ status: "conflict" }, [503, "unavailable"]],
      [{ status: "invalid" }, [503, "unavailable"]],
      [{ status: "unavailable", reason: "secret-reason" }, [503, "unavailable"]],
    ] as const) {
      revokeAnswer = async () => outcome as unknown as EnrollmentCodeRevokeOutcome;
      await start();
      const got = await revoke("{}");
      expect(codeOf(got)).toEqual(expected);
      expect(got.body).not.toMatch(/secret/);
      await server!.close();
      server = undefined;
    }
    expect(calls.activity).toEqual([]);
  });
});

describe("an outcome never chooses its own answer (QA on #259)", () => {
  it("a refusal carrying body, ok or a success field is still that refusal on every route", async () => {
    const extra = { body: { code: CODE, id: ID, revoked: true }, ok: true, code: CODE, id: ID };
    answer = async () => ({ status: "forbidden", ...extra }) as never;
    issueAnswer = async () => ({ status: "forbidden", ...extra }) as never;
    revokeAnswer = async () => ({ status: "forbidden", ...extra, revoked: true }) as never;
    await start();
    for (const got of [await post(good()), await issue(UNTIL_BODY), await revoke("{}")]) {
      expect(codeOf(got)).toEqual([403, "forbidden"]);
      expect(got.body).not.toContain(CODE);
      expect(got.body).not.toContain(ID);
    }
    for (const status of [undefined, 403, { toString: () => "forbidden" }]) {
      issueAnswer = async () => ({ status, body: { code: CODE } }) as never;
      const got = await issue(UNTIL_BODY);
      expect(codeOf(got)).toEqual([503, "unavailable"]);
      expect(got.body).not.toContain(CODE);
    }
    expect(calls.activity).toEqual([]);
  });
});
