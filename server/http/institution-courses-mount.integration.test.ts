// DAN-852-5a (contract Ductus#1836 c.6951540037): the routes the entry point
// mounts, createInstitutionCourseRoutesFor(main), run every statement on
// main's own withActor: an accepted answer the RPC of its route and then the
// activity touch, a refusal before the port nothing, a refusal of the RPC that
// RPC alone. A fake withActor records the statements; the database side is
// pgTAP and tests/db (852-5b). Every value is invented.
import { connect } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { ActorTransaction, WithActor } from "../database/index.ts";

import { createDatabases } from "./databases.ts";
import { createInstitutionCourseRoutesFor } from "./institution-courses.ts";
import { createLayers } from "./pipeline.ts";
import { type Running, startServer } from "./start.ts";

const ORIGIN = "https://ductura.example.invalid";
const TOKEN = "Izmisljeni_token-kolegija-ustanove_00000052";
const COURSE = "7b6a5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c01";
const UNTIL = "2026-12-31T23:59:59.123456+01:00";
const STUDENT = "9d8c7b6a-5f4e-4c3b-9a2d-1e0f9a8b7c01";
const ROWS: ReadonlyMap<string, unknown> = new Map([
  ["create_course", { id: COURSE }],
  ["create_enrollment_code", { code: "A1B2-C3D4-E5F6-0789" }],
  ["revoke_enrollment_code", { revoked: true }],
  ["remove_student", { removed: true }],
  ["allow_student_return", { allowed: false }],
]);

let server: Running | undefined;
let refuseWith: unknown;
let malformed = false;
const seen: { token: unknown; rpc: string; values: readonly unknown[] }[] = [];
let touched: () => void = () => undefined;
let touch = new Promise<void>((resolve) => (touched = resolve));

const withActor = (async (token, fn) => {
  const tx = {
    async query(sql: string, values: readonly unknown[] = []) {
      const rpc = /\.(\w+)\(/u.exec(sql)?.[1] ?? sql;
      seen.push({ token, rpc, values });
      if (rpc === "touch_current_session") {
        touched();
        return { rows: [{ touched: true }], rowCount: 1 };
      }
      if (refuseWith !== undefined) throw refuseWith;
      return { rows: malformed ? [] : [ROWS.get(rpc)], rowCount: 1 };
    },
  } as unknown as ActorTransaction;
  return fn(tx);
}) as WithActor;

async function start() {
  server = await startServer({
    host: "127.0.0.1",
    port: 0,
    layers: createLayers({ expectedOrigin: ORIGIN }),
    databases: createDatabases(),
    routes: createInstitutionCourseRoutesFor({ withActor }),
  });
}
afterEach(async () => {
  seen.length = 0;
  refuseWith = undefined;
  malformed = false;
  touch = new Promise<void>((resolve) => (touched = resolve));
  await server?.close();
  server = undefined;
});

function send(path: string, body: string, headers: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(server!.port, "127.0.0.1");
    const head = [`POST ${path} HTTP/1.1`, "host: 127.0.0.1", ...headers];
    head.push(`content-length: ${Buffer.byteLength(body)}`);
    socket.write(`${head.join("\r\n")}\r\n\r\n${body}`);
    let text = "";
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      const [first = "", rest = ""] = text.split("\r\n\r\n");
      const length = Number(/content-length: (\d+)/i.exec(first)?.[1] ?? 0);
      if (text.includes("\r\n\r\n") && Buffer.byteLength(rest) >= length) {
        socket.destroy();
        resolve(Number(first.split(" ")[1]));
      }
    });
    socket.on("error", reject);
  });
}
const BASE = [`origin: ${ORIGIN}`, "sec-fetch-site: same-origin"];
const HEADERS = [
  ...BASE,
  `cookie: __Host-ductus_session=${TOKEN}`,
  "content-type: application/json",
];
const CODE_PATH = `/api/v1/institution/courses/${COURSE}/enrollment-code`;
type Rpc =
  | "create_course"
  | "create_enrollment_code"
  | "revoke_enrollment_code"
  | "remove_student"
  | "allow_student_return";
const STUDENT_PATH = `/api/v1/institution/courses/${COURSE}/students/${STUDENT}`;
type Case = { readonly path: string; readonly body: string; readonly values: readonly unknown[] };
const ROUTES: ReadonlyMap<Rpc, Case> = new Map<Rpc, Case>([
  [
    "create_course",
    {
      path: "/api/v1/institution/courses",
      body: '{"name":"Izmišljeni kolegij","academicYear":"2026/2027","aiPolicy":"encouraged"}',
      values: ["Izmišljeni kolegij", "2026/2027", "encouraged"],
    },
  ],
  [
    "create_enrollment_code",
    { path: CODE_PATH, body: JSON.stringify({ validUntil: UNTIL }), values: [COURSE, UNTIL] },
  ],
  ["revoke_enrollment_code", { path: `${CODE_PATH}/revocation`, body: "{}", values: [COURSE] }],
  ["remove_student", { path: `${STUDENT_PATH}/removal`, body: "{}", values: [COURSE, STUDENT] }],
  [
    "allow_student_return",
    { path: `${STUDENT_PATH}/return-permission`, body: "{}", values: [COURSE, STUDENT] },
  ],
]);
const rpcs = [...ROUTES.keys()];
const route = (rpc: Rpc): Case => ROUTES.get(rpc)!;
const call = (rpc: Rpc, headers = HEADERS, body: string = route(rpc).body) =>
  send(route(rpc).path, body, headers);
/** Waits as long as a touch that was started needs to arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const coded = (code: string) => Object.assign(new Error("izmišljeno"), { code });

describe("createInstitutionCourseRoutesFor(main)", () => {
  it("a refusal before the port runs no statement on any route", async () => {
    await start();
    for (const rpc of rpcs) {
      expect(await call(rpc, [...BASE, "content-type: application/json"])).toBe(401);
      expect(await call(rpc, [...HEADERS.slice(0, 3), "content-type: text/plain"])).toBe(415);
      expect(await call(rpc, HEADERS, '{"x":1}')).toBe(422);
    }
    expect(await send(`/api/v1/institution/courses/nije-uuid/enrollment-code`, "{}", HEADERS)).toBe(
      422,
    );
    await settle();
    expect(seen).toEqual([]);
  });

  // Each route refuses with its own map (server/database/institution-courses.ts).
  const REFUSALS: [Rpc, unknown, number][] = [
    ["create_course", coded("ZD401"), 401],
    ["create_course", coded("ZD403"), 403],
    ["create_course", coded("ZD409"), 409],
    ["create_course", coded("ZD422"), 422],
    ["create_enrollment_code", coded("ZD401"), 401],
    ["create_enrollment_code", coded("ZD403"), 403],
    ["create_enrollment_code", coded("ZD422"), 422],
    ["create_enrollment_code", coded("ZD409"), 503],
    ["revoke_enrollment_code", coded("ZD401"), 401],
    ["revoke_enrollment_code", coded("ZD403"), 403],
    ["revoke_enrollment_code", coded("ZD409"), 503],
    ["revoke_enrollment_code", coded("ZD422"), 503],
    ["remove_student", coded("ZD401"), 401],
    ["remove_student", coded("ZD403"), 403],
    ["remove_student", coded("ZD422"), 503],
    ["allow_student_return", coded("ZD401"), 401],
    ["allow_student_return", coded("ZD403"), 403],
    ["allow_student_return", coded("ZD409"), 503],
    ...rpcs.map((rpc): [Rpc, unknown, number] => [rpc, coded("XX000"), 503]),
    ...rpcs.map((rpc): [Rpc, unknown, number] => [rpc, new Error("izmišljeno"), 503]),
  ];
  it.each(REFUSALS)("%s refused with %o is %i: the RPC alone, no touch", async (rpc, e, status) => {
    refuseWith = e;
    await start();
    expect(await call(rpc)).toBe(status);
    await settle();
    expect(seen.map((s) => s.rpc)).toEqual([rpc]);
  });

  it.each(rpcs)("%s with a row of the wrong form is 503, no touch", async (rpc) => {
    malformed = true;
    await start();
    expect(await call(rpc)).toBe(503);
    await settle();
    expect(seen.map((s) => s.rpc)).toEqual([rpc]);
  });

  it.each(rpcs)("%s accepted runs its RPC and then the touch, on one withActor", async (rpc) => {
    await start();
    expect(await call(rpc)).toBe(200);
    await touch;
    expect(seen.map((s) => [s.rpc, s.token])).toEqual([
      [rpc, TOKEN],
      ["touch_current_session", TOKEN],
    ]);
    expect(seen[0]!.values).toEqual(route(rpc).values);
  });

  it("a course id with an encoded character reaches the RPC decoded once", async () => {
    await start();
    const encoded = `%${COURSE.charCodeAt(0).toString(16)}${COURSE.slice(1)}`;
    const path = `/api/v1/institution/courses/${encoded}/enrollment-code/revocation`;
    expect(await send(path, "{}", HEADERS)).toBe(200);
    await touch;
    expect(seen[0]!.values).toEqual([COURSE]);
  });
});
