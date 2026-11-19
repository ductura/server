// The student removal and student return routes on a real server with the
// real pipeline, over the real institution service and a fake
// InstitutionMembers port: every vector of the two contracts a socket can
// reach is sent as its bytes; a refusal before the port leaves it uncalled.
// Port of the HTTP edge of Ductus student-removal-route.ts and
// student-return-route.ts at 078c780 (the assignment version route is
// institution-assignments.integration.test.ts, SRV-14). All values are invented.
import { readFileSync } from "node:fs";
import { connect } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type {
  InstitutionCourses,
  InstitutionMembers,
  StudentRemovalOutcome,
  StudentReturnOutcome,
} from "../database/index.ts";

import { createDatabases } from "./databases.ts";
import { createInstitutionCourseRoutes } from "./institution-courses.ts";
import { createLayers } from "./pipeline.ts";
import { type Running, startServer } from "./start.ts";

type Vector = {
  name: string;
  request: {
    params: Record<string, string>;
    headers: Record<string, string>;
    body?: unknown;
    rawBody?: string;
  };
  response: { status: number; body: Record<string, unknown> };
};
const vectorsOf = (id: string): Vector[] =>
  (
    JSON.parse(
      readFileSync(new URL(`../contracts/vectors/${id}.json`, import.meta.url), "utf8"),
    ) as { vectors: Vector[] }
  ).vectors;

type Kind = "removal" | "return";
const ROUTES: Record<Kind, { id: string; path: (p: Record<string, string>) => string }> = {
  removal: {
    id: "institution.student-removal.post",
    path: (p) => `/api/v1/institution/courses/${p.courseId}/students/${p.studentId}/removal`,
  },
  return: {
    id: "institution.student-return.post",
    path: (p) =>
      `/api/v1/institution/courses/${p.courseId}/students/${p.studentId}/return-permission`,
  },
};
const ORIGIN = vectorsOf(ROUTES.removal.id)[0]!.request.headers.origin!;

let server: Running | undefined;
const calls: { method: string; args: unknown[] }[] = [];
const activity: string[] = [];
let outcome: unknown;

async function start() {
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return outcome;
    };
  const members = {
    removeStudent: record("removeStudent") as () => Promise<StudentRemovalOutcome>,
    allowStudentReturn: record("allowStudentReturn") as () => Promise<StudentReturnOutcome>,
  } satisfies InstitutionMembers;
  server = await startServer({
    host: "127.0.0.1",
    port: 0,
    layers: createLayers({ expectedOrigin: ORIGIN }),
    databases: createDatabases(),
    routes: createInstitutionCourseRoutes({
      courses: {} as InstitutionCourses,
      members,
      recordActivity: async (token) => activity.push(token),
      timeoutMs: 300,
    }),
  });
}
afterEach(async () => {
  calls.length = 0;
  activity.length = 0;
  outcome = undefined;
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
      if (!text.includes("\r\n\r\n")) return;
      const got = finish();
      if (Buffer.byteLength(got.body) >= Number(got.head["content-length"] ?? 0)) {
        socket.destroy();
        resolve(got);
      }
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(finish()));
  });
}

function raw(path: string, headers: [string, string][], body: string): Buffer {
  const all: [string, string][] = [["host", "127.0.0.1"], ...headers];
  const framed = all.some(([k]) => /^(content-length|transfer-encoding)$/i.test(k));
  if (!framed) all.push(["content-length", String(Buffer.byteLength(body))]);
  const head = `POST ${path} HTTP/1.1\r\n${all.map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`;
  return Buffer.concat([Buffer.from(head, "latin1"), Buffer.from(body)]);
}

// A short body under a longer Content-Length is a wait or a client gone on a
// real socket; the reader's own 400 is mutation-request.test.ts.
const UNREACHABLE = new Set(["content-length-mismatch", "body-stream-error"]);
/** The port's outcome of each vector that reaches it. */
const OUTCOME: Record<Kind, Record<string, unknown>> = {
  removal: {
    true: { status: "removed", removed: true },
    false: { status: "removed", removed: false },
    forbidden: { status: "forbidden" },
    unavailable: { status: "unavailable", reason: "database_error" },
  },
  return: {
    true: { status: "allowed", allowed: true },
    false: { status: "allowed", allowed: false },
    forbidden: { status: "forbidden" },
    unavailable: { status: "unavailable", reason: "database_error" },
  },
};
const METHOD: Record<Kind, string> = {
  removal: "removeStudent",
  return: "allowStudentReturn",
};

const cases = (Object.keys(ROUTES) as Kind[]).flatMap((kind) =>
  vectorsOf(ROUTES[kind].id)
    .filter((v) => !UNREACHABLE.has(v.name))
    .map((v) => [`${ROUTES[kind].id} ${v.name}`, kind, v] as const),
);

describe("every vector a socket can reach", () => {
  it.each(cases)("%s", async (_name, kind, v) => {
    outcome = OUTCOME[kind][v.name];
    await start();
    const body = v.request.rawBody ?? JSON.stringify(v.request.body);
    const path = ROUTES[kind].path(v.request.params);
    const got = await send(raw(path, Object.entries(v.request.headers), body));
    expect(got.status).toBe(v.response.status);
    if (v.name === "content-length-invalid") return; // Node's parser answers it itself.
    expect(got.head["content-type"]?.split(";")[0]).toBe("application/json");
    expect(got.head["cache-control"]).toBe("no-store");
    const json = JSON.parse(got.body) as Record<string, unknown>;
    if (got.status < 300) expect(json).toEqual(v.response.body);
    else expect(json).toEqual({ ...v.response.body, requestId: got.head["x-request-id"] });
    const token = v.request.headers.cookie?.slice("__Host-ductus_session=".length);
    if (outcome === undefined) expect(calls).toEqual([]);
    else expect(calls.map((c) => [c.method, c.args[0]])).toEqual([[METHOD[kind], token]]);
    expect(activity).toEqual(got.status < 300 ? [token] : []);
  });
});

describe("what reaches the port", () => {
  const removed = vectorsOf(ROUTES.removal.id).find((v) => v.name === "true")!;
  const headers = Object.entries(removed.request.headers);
  const STUDENT = removed.request.params.studentId!;

  it("the ids come from the path, in order; the body {} carries nothing", async () => {
    outcome = { status: "removed", removed: true };
    await start();
    const params = { courseId: "7B6A5C4D-3E2F-4A1B-9C8D-7E6F5A4B3C01", studentId: STUDENT };
    expect((await send(raw(ROUTES.removal.path(params), headers, "{}"))).status).toBe(200);
    outcome = { status: "allowed", allowed: true };
    expect((await send(raw(ROUTES.return.path(params), headers, "{}"))).status).toBe(200);
    expect(calls.map((c) => c.args.slice(1))).toEqual([
      [params.courseId, params.studentId],
      [params.courseId, params.studentId],
    ]);
  });

  it("a non-empty body on removal or return is 422 without a call", async () => {
    outcome = { status: "removed", removed: true };
    await start();
    const params = { courseId: STUDENT, studentId: STUDENT };
    for (const body of ['{"studentId":"x"}', "[]", "null", '""']) {
      expect((await send(raw(ROUTES.removal.path(params), headers, body))).status).toBe(422);
      expect((await send(raw(ROUTES.return.path(params), headers, body))).status).toBe(422);
    }
    expect(calls).toEqual([]);
  });
});
