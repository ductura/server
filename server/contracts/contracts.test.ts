import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { generate, OUT_DIR, toPosix } from "../../scripts/index.ts";
import { checkInventory, checkRoute, pathOf } from "./check.ts";
import { createClient, validateInput } from "./generated/index.ts";
import { FALLBACK, ROUTES, defineRoute, error, type RouteContract } from "./index.ts";
import { INVENTORY, PENDING, SERVER_SOURCES } from "./inventory.ts";

// An import or export specifier. Not a quoted key or a word inside one: a
// property named "from" (a minute span) is data, not an import.
const IMPORT_RE = /(?<![\w"'.$])(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const CONTRACTS_DIR = dirname(fileURLToPath(import.meta.url));
// Fixed here, not read from the contract, so the fallback cannot be moved to hide a route.
const FALLBACK_FILE = "app/api/[...path]/route.ts";

describe("generated = committed", () => {
  it("every generated file matches a fresh run, byte for byte, with no extra files", () => {
    const files = generate();
    const onDisk = readdirSync(OUT_DIR, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => toPosix(relative(OUT_DIR, join(entry.parentPath, entry.name))));
    expect(onDisk.sort()).toEqual(Object.keys(files).sort());
    for (const [name, content] of Object.entries(files)) {
      expect(readFileSync(join(OUT_DIR, name), "utf8"), name).toBe(content);
    }
  });

  it("is deterministic", () => {
    expect(generate()).toEqual(generate());
  });
});

describe("route inventory", () => {
  it("covers all 38 inventory files: contract, fallback or pending, never two of them", () => {
    expect(Object.keys(INVENTORY)).toHaveLength(38);
    expect(checkInventory(ROUTES, INVENTORY, PENDING, FALLBACK_FILE, SERVER_SOURCES)).toEqual([]);
  });

  it("the fallback is the catch-all file", () => {
    expect(FALLBACK.inventory).toBe(FALLBACK_FILE);
  });

  it("pending only shrinks: 28 files are left for part 2", () => {
    expect(PENDING.length).toBeLessThanOrEqual(28);
  });

  const extra = defineRoute({
    id: "made-up.route.get",
    method: "GET",
    path: "/api/v1/made-up/route",
    inventory: "app/api/made-up/route/route.ts",
    access: "anyone",
    summary: "not in the inventory",
    request: {},
    responses: [{ status: 200, description: "ok" }],
    errors: [],
  });

  it("a route outside the inventory fails", () => {
    expect(
      checkInventory([...ROUTES, extra], INVENTORY, PENDING, FALLBACK_FILE, SERVER_SOURCES),
    ).toEqual(["made-up.route.get: app/api/made-up/route/route.ts is not in the inventory"]);
  });

  it("a missing method, a contracted pending file and an unknown pending file fail", () => {
    const withoutHealth = ROUTES.filter((r) => r.id !== "platform.health.get");
    expect(
      checkInventory(withoutHealth, INVENTORY, PENDING, FALLBACK_FILE, SERVER_SOURCES),
    ).toEqual(["app/api/health/route.ts: methods none, inventory GET"]);
    const pending = [...PENDING, "app/api/health/route.ts", "app/api/nope/route.ts"];
    expect(checkInventory(ROUTES, INVENTORY, pending, FALLBACK_FILE, SERVER_SOURCES)).toEqual([
      "platform.health.get: app/api/health/route.ts is also pending",
      "app/api/nope/route.ts: pending but not in the inventory",
    ]);
  });

  it("a server source counts as a file: its methods must match, and it is not an inventory file", () => {
    const withoutStudent = ROUTES.filter((r) => r.id !== "student.assignments.get");
    expect(
      checkInventory(withoutStudent, INVENTORY, PENDING, FALLBACK_FILE, SERVER_SOURCES),
    ).toEqual(["app/api/student/assignments/route.ts: methods none, inventory GET"]);
    expect(checkInventory(ROUTES, INVENTORY, PENDING, FALLBACK_FILE)).toEqual([
      "client.context.post: app/api/client-context/route.ts is not in the inventory",
      "auth.webauthn-challenge.post: app/api/auth/webauthn/challenge/route.ts is not in the inventory",
      "auth.webauthn-registration.post: app/api/auth/webauthn/registration/route.ts is not in the inventory",
      "auth.webauthn-assertion.post: app/api/auth/webauthn/assertion/route.ts is not in the inventory",
      "profile.me.get: app/api/me/route.ts is not in the inventory",
      "student.assignments.get: app/api/student/assignments/route.ts is not in the inventory",
      "student.access-log.get: app/api/student/works/[documentId]/access-log/route.ts is not in the inventory",
      "student.assignment-work.get: app/api/student/assignment-work/route.ts is not in the inventory",
      "student.notice-read.post: app/api/student/assignments/[assignmentId]/notice-read/route.ts is not in the inventory",
      "student.notice.get: app/api/student/assignments/[assignmentId]/notice/route.ts is not in the inventory",
      "student.submission.get: app/api/student/assignments/[assignmentId]/submission/route.ts is not in the inventory",
      "student.assignment-requirements.get: app/api/student/assignments/[assignmentId]/requirements/route.ts is not in the inventory",
      "student.submission-notes.get: app/api/student/assignments/[assignmentId]/submission-notes/route.ts is not in the inventory",
      "student.submission-notes.post: app/api/student/submission-notes/route.ts is not in the inventory",
      "student.work-sources.get: app/api/student/assignments/[assignmentId]/sources/route.ts is not in the inventory",
      "student.work-sources.put: app/api/student/assignments/[assignmentId]/sources/[sourceId]/route.ts is not in the inventory",
      "student.work-sources.delete: app/api/student/assignments/[assignmentId]/sources/[sourceId]/route.ts is not in the inventory",
      "projection.process-summary-details.post: app/api/process-summary/details/route.ts is not in the inventory",
      "student.enrollments.post: app/api/student/enrollments/route.ts is not in the inventory",
      "institution.admin-courses.post: app/api/institution/admin/courses/route.ts is not in the inventory",
      "institution.course-groups.get: app/api/institution/courses/[courseId]/groups/route.ts is not in the inventory",
      "institution.course-groups.post: app/api/institution/courses/[courseId]/groups/route.ts is not in the inventory",
      "institution.course-group-teachers.post: app/api/institution/groups/[groupId]/teachers/route.ts is not in the inventory",
      "institution.assignment.get: app/api/institution/assignments/[assignmentId]/route.ts is not in the inventory",
      "institution.enrollment-code-state.get: app/api/institution/courses/[courseId]/enrollment-code/state/route.ts is not in the inventory",
      "teacher.assignment-submissions.post: app/api/teacher/assignment-submissions/route.ts is not in the inventory",
      "teacher.access.get: app/api/teacher/access/route.ts is not in the inventory",
      "settings.catalogue.get: app/api/settings/catalogue/route.ts is not in the inventory",
      "settings.values.get: app/api/settings/values/route.ts is not in the inventory",
      "settings.values.put: app/api/settings/values/route.ts is not in the inventory",
      "downloads.manifest.get: app/api/downloads/manifest/route.ts is not in the inventory",
      "student.receipt-pdf.get: app/api/student/assignments/[assignmentId]/submission/pdf/route.ts is not in the inventory",
      "teacher.receipt-pdf.get: app/api/teacher/assignments/[assignmentId]/submissions/[studentId]/pdf/route.ts is not in the inventory",
      "sources.lookup.post: app/api/sources/lookup/route.ts is not in the inventory",
      "public.verification.post: app/api/public/verification/route.ts is not in the inventory",
      "work.versions.get: app/api/works/[documentId]/versions/route.ts is not in the inventory",
    ]);
    const clash = { "app/api/health/route.ts": { methods: ["GET"] as const } };
    expect(
      checkInventory(ROUTES, INVENTORY, PENDING, FALLBACK_FILE, { ...SERVER_SOURCES, ...clash }),
    ).toEqual(["app/api/health/route.ts: server source is also in the inventory"]);
  });

  it("maps inventory files to /api/v1 paths", () => {
    expect(pathOf("app/api/health/route.ts")).toBe("/api/v1/health");
    expect(pathOf("app/api/live/[documentId]/route.ts")).toBe("/api/v1/live/{documentId}");
  });
});

describe("every route is complete", () => {
  it.each(ROUTES.map((r) => [r.id, r] as const))("%s", (id, route) => {
    expect(checkRoute(route)).toEqual([]);
    expect(route.summary.length).toBeGreaterThan(0);
  });

  it("refuses a route with a bad key, a duplicate error, a body without limit and no success", () => {
    const bad = defineRoute({
      id: "platform.bad.post",
      method: "POST",
      path: "/api/v1/bad",
      inventory: "app/api/bad/route.ts",
      access: "anyone",
      summary: "bad",
      request: { body: Type.Object({}) },
      responses: [],
      errors: [{ status: 400, code: "invalid", key: "Neispravno." }, error(400, "invalid")],
    });
    expect(checkRoute(bad)).toEqual([
      "platform.bad.post: body without type or limit",
      "platform.bad.post: no success response",
      "platform.bad.post: error key Neispravno.",
      "platform.bad.post: duplicate error 400 invalid",
    ]);
  });

  it("refuses an error whose key is not the one of ERROR_MESSAGE_KEYS", () => {
    const health = ROUTES.find((r) => r.id === "platform.health.get") as RouteContract;
    const route = (errors: RouteContract["errors"]) =>
      checkRoute(defineRoute({ ...health, id: "platform.keys.get", errors }));
    expect(route([{ status: 404, code: "not_found", key: "errors.not_found" }])).toEqual([
      "platform.keys.get: error key errors.not_found",
    ]);
    expect(route([{ status: 400, code: "x", key: "errors.x" }])).toEqual([
      "platform.keys.get: error key errors.x",
    ]);
    expect(() => error(400, "x")).toThrow(/no message key for x/u);
  });
});

describe("server/contracts imports only the schema library", () => {
  const sources = readdirSync(CONTRACTS_DIR, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it.each(sources)("%s", (file) => {
    const text = readFileSync(join(CONTRACTS_DIR, file), "utf8");
    const specifiers = [...text.matchAll(IMPORT_RE)].map((m) => m[1] ?? "");
    for (const spec of specifiers) {
      const target = resolve(dirname(join(CONTRACTS_DIR, file)), spec);
      const inside = spec.startsWith(".") && !relative(CONTRACTS_DIR, target).startsWith("..");
      const allowed = inside || spec === "@sinclair/typebox";
      // The generated fake server is the one file that may use node:http, and
      // node:fs to read its vectors.json.
      expect(
        allowed ||
          (file === join("generated", "fake-server", "index.ts") &&
            (spec === "node:http" || spec === "node:fs")),
        `${file}: ${spec}`,
      ).toBe(true);
    }
  });
});

describe("generated/index.ts loads without Node built-ins", () => {
  it("no module reachable from it imports node:", () => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const [, spec = ""] of text.matchAll(IMPORT_RE)) {
        expect(spec.startsWith("node:"), `${relative(CONTRACTS_DIR, file)}: ${spec}`).toBe(false);
        if (spec.startsWith(".")) visit(resolve(dirname(file), spec));
      }
    };
    visit(join(OUT_DIR, "index.ts"));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("generated validators", () => {
  const id = "profile.interface-locale.post";
  it.each([
    [{ locale: "hr" }, true],
    [{ locale: "en" }, true],
    [{ locale: "de" }, false],
    [{ locale: "hr", extra: 1 }, false],
    [{ locale: 1 }, false],
    [{}, false],
    [null, false],
    [["hr"], false],
  ])("body %j -> %s", (value, ok) => {
    expect(validateInput(id, "body", value)).toBe(ok);
  });

  it("a route without a schema accepts no body and an empty query", () => {
    expect(validateInput("platform.health.get", "body", undefined)).toBe(true);
    expect(validateInput("platform.health.get", "body", {})).toBe(false);
    expect(validateInput("platform.health.get", "query", {})).toBe(true);
    expect(validateInput("platform.health.get", "query", { a: "1" })).toBe(false);
  });

  it("login and back-channel logout ignore extra keys, like the Ductus routes", () => {
    expect(
      validateInput("auth.login.get", "query", { returnTo: "/x".repeat(2000), utm: "1" }),
    ).toBe(true);
    expect(
      validateInput("auth.backchannel-logout.post", "body", { logout_token: "t", extra: "1" }),
    ).toBe(true);
    expect(validateInput("auth.backchannel-logout.post", "body", { extra: "1" })).toBe(false);
  });
});

describe("generated client", () => {
  function fakeFetch(status: number, body?: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: URL, init: RequestInit) => {
      calls.push({ url: url.href, init });
      const headers = body === undefined ? {} : { "content-type": "application/json" };
      return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it("sends JSON under /api/v1 and returns the body", async () => {
    const f = fakeFetch(200, { locale: "en" });
    const call = createClient("https://api.primjer.invalid", f.impl);
    const res = await call("profile.interface-locale.post", {
      params: undefined,
      query: undefined,
      body: { locale: "en" },
    });
    expect(res).toEqual({ ok: true, status: 200, body: { locale: "en" }, headers: {} });
    expect(f.calls[0]?.url).toBe("https://api.primjer.invalid/api/v1/profile/interface-locale");
    expect(f.calls[0]?.init).toMatchObject({
      method: "POST",
      body: '{"locale":"en"}',
      redirect: "manual",
    });
  });

  it("reads the code from `code` first (problem body, S-1L.3), never falls back on an unknown one", async () => {
    const id = "profile.interface-locale.post";
    const input = { params: undefined, query: undefined, body: { locale: "hr" as const } };
    const c = async (status: number, body?: unknown) =>
      (await createClient("https://a.invalid", fakeFetch(status, body).impl)(id, input)) as {
        code?: string;
      };
    expect((await c(500, { code: "internal" })).code).toBe("internal");
    const problem = {
      error: "invalid_input",
      code: "invalid_input",
      messageKey: "errors.invalidInput",
      status: 422,
      requestId: "0f0e0d0c-0b0a-4908-8706-050403020100",
    };
    expect(await c(422, problem)).toEqual({ ok: false, status: 422, code: "invalid_input" });
    // `code` wins over `error` and `status`, both ways.
    expect((await c(500, { code: "made_up", error: "internal" })).code).toBe("unexpected");
    expect((await c(403, { code: "made_up", error: "cross_site" })).code).toBe("unexpected");
    expect((await c(403, { code: "cross_site", error: "made_up" })).code).toBe("cross_site");
    expect((await c(503, { code: "internal", error: "internal" })).code).toBe("unexpected");
    const ready = createClient(
      "https://a.invalid",
      fakeFetch(503, { status: "draining", code: "made_up" }).impl,
    );
    expect(
      await ready("platform.ready.get", { params: undefined, query: undefined, body: undefined }),
    ).toMatchObject({ code: "unexpected" });
    // A `code` that is not a string is not a code: the next field names it.
    expect((await c(500, { code: 500, error: "internal" })).code).toBe("internal");
  });

  it("maps errors to contract codes, unknown ones to unexpected", async () => {
    const id = "profile.interface-locale.post";
    const input = { params: undefined, query: undefined, body: { locale: "hr" as const } };
    const c = (status: number, body?: unknown) =>
      createClient("https://a.invalid", fakeFetch(status, body).impl)(id, input);
    expect(await c(403, { error: "cross_site" })).toEqual({
      ok: false,
      status: 403,
      code: "cross_site",
    });
    expect(await c(422)).toEqual({ ok: false, status: 422, code: "invalid_input" });
    expect(await c(403, { error: "made_up" })).toEqual({
      ok: false,
      status: 403,
      code: "unexpected",
    });
    expect(await c(422, { error: "made_up" })).toEqual({
      ok: false,
      status: 422,
      code: "unexpected",
    });
    expect(await c(500)).toEqual({ ok: false, status: 500, code: "unexpected" });
    // The shared 500 internal (DAN-776) only when the body names it.
    expect(await c(500, { error: "internal" })).toEqual({
      ok: false,
      status: 500,
      code: "internal",
    });
    expect(await c(500, { error: "made_up" })).toEqual({
      ok: false,
      status: 500,
      code: "unexpected",
    });
    expect(await c(503, { error: "internal" })).toEqual({
      ok: false,
      status: 503,
      code: "unexpected",
    });
    const ready = createClient("https://a.invalid", fakeFetch(503, { status: "draining" }).impl);
    expect(
      await ready("platform.ready.get", { params: undefined, query: undefined, body: undefined }),
    ).toEqual({
      ok: false,
      status: 503,
      code: "draining",
    });
  });

  it("returns the contracted redirect headers: location and every set-cookie", async () => {
    const headers = new Headers({
      location: "https://idp.primjer.invalid/authorize",
      "x-other": "1",
    });
    headers.append("set-cookie", "a=1; HttpOnly");
    headers.append("set-cookie", "b=2; HttpOnly");
    const impl = (async () =>
      new Response(null, { status: 303, headers })) as unknown as typeof fetch;
    const res = await createClient("https://a.invalid", impl)("auth.login.get", {
      params: undefined,
      query: {},
      body: undefined,
    });
    expect(res).toEqual({
      ok: true,
      status: 303,
      body: undefined,
      headers: {
        location: "https://idp.primjer.invalid/authorize",
        "set-cookie": ["a=1; HttpOnly", "b=2; HttpOnly"],
      },
    });
  });

  it("leaves out an undefined query value", async () => {
    const f = fakeFetch(303);
    await createClient("https://a.invalid", f.impl)("auth.login.get", {
      params: undefined,
      query: { returnTo: undefined } as unknown as { returnTo?: string },
      body: undefined,
    });
    expect(f.calls[0]?.url).toBe("https://a.invalid/api/v1/auth/login");
  });

  it("sends the back-channel logout token as a form", async () => {
    const f = fakeFetch(200);
    const res = await createClient("https://a.invalid", f.impl)("auth.backchannel-logout.post", {
      params: undefined,
      query: undefined,
      body: { logout_token: "izmisljeni.token" },
    });
    expect(res).toEqual({ ok: true, status: 200, body: undefined, headers: {} });
    expect(f.calls[0]?.init.body).toBe("logout_token=izmisljeni.token");
    expect(f.calls[0]?.init.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
  });
});
