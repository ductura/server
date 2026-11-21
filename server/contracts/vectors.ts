// Success and error vectors: example requests and answers for every route,
// kept as JSON data in server/contracts/vectors/<route id>.json (S-1H.4). The
// fake server (U8) answers with them and a ported route must pass them. This
// file only checks them; reading the files is the caller's job, and the schema
// check is passed in so the package keeps importing nothing but TypeBox.
import { Type, type TSchema } from "@sinclair/typebox";

import { closed, errorBody, type ErrorSpec, type RouteContract } from "./schema/index.ts";

const Headers = Type.Record(Type.String(), Type.String());

const VectorSchema = closed({
  /** Stable within the route; kebab-case. Never renamed once published. */
  name: Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$" }),
  kind: Type.Union([Type.Literal("success"), Type.Literal("error")]),
  /** The contract error code; only for kind "error". */
  code: Type.Optional(Type.String()),
  request: closed({
    params: Type.Optional(Type.Record(Type.String(), Type.String())),
    query: Type.Optional(Type.Record(Type.String(), Type.String())),
    headers: Type.Optional(Headers),
    /**
     * A JSON body or form fields, as the route's content type says; a
     * multipart file part (contentMediaType) is written in Base64.
     */
    body: Type.Optional(Type.Unknown()),
    /** Bytes sent as they are, for a body that is not valid by design. */
    rawBody: Type.Optional(Type.String()),
  }),
  response: closed({
    status: Type.Integer({ minimum: 200, maximum: 599 }),
    contentType: Type.Optional(
      Type.Union([
        Type.Literal("application/json"),
        Type.Literal("text/html"),
        Type.Literal("image/jpeg"),
      ]),
    ),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())])),
    ),
    body: Type.Optional(Type.Unknown()),
  }),
});

/** The shape of one vectors file. */
export const VectorFileSchema = closed({
  route: Type.String(),
  vectors: Type.Array(VectorSchema, { minItems: 1 }),
});

export type Vector = {
  readonly name: string;
  readonly kind: "success" | "error";
  readonly code?: string;
  readonly request: {
    readonly params?: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: unknown;
    readonly rawBody?: string;
  };
  readonly response: {
    readonly status: number;
    /** image/jpeg: `body` is the bytes in Base64. */
    readonly contentType?: "application/json" | "text/html" | "image/jpeg";
    readonly headers?: Readonly<Record<string, string | readonly string[]>>;
    readonly body?: unknown;
  };
};
export type VectorFile = { readonly route: string; readonly vectors: readonly Vector[] };

/** Schema check, e.g. Value.Check from @sinclair/typebox/value. */
export type SchemaCheck = (schema: TSchema, value: unknown) => boolean;

/**
 * Every problem with a set of vector files (file name without .json -> content),
 * or an empty list. Each route needs a file, a vector for each success status
 * and one for each error code; every answer must match the route's schemas.
 * A shared error (SHARED_ERRORS, e.g. 500 internal) may be a vector of any
 * route and needs one vector in at least one file.
 */
export function checkVectors(
  routes: readonly RouteContract[],
  files: Readonly<Record<string, unknown>>,
  check: SchemaCheck,
  shared: readonly ErrorSpec[] = [],
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const ids = new Set(routes.map((r) => r.id));
  for (const name of Object.keys(files).sort()) {
    if (!ids.has(name)) problems.push(`${name}.json: no route with this id`);
  }
  for (const route of routes) {
    const raw = files[route.id];
    const at = (text: string) => problems.push(`${route.id}: ${text}`);
    if (raw === undefined) {
      at("no vectors file");
      continue;
    }
    if (!check(VectorFileSchema, raw)) {
      at("vectors file does not match the vector format");
      continue;
    }
    const file = raw as VectorFile;
    if (file.route !== route.id) at(`file names route ${file.route}`);
    const names = new Set<string>();
    for (const vector of file.vectors) {
      if (names.has(vector.name)) at(`duplicate vector ${vector.name}`);
      names.add(vector.name);
      if (vector.kind === "error") seen.add(String(vector.code));
      for (const text of checkVector(route, vector, check, shared)) at(`${vector.name}: ${text}`);
    }
    for (const spec of route.responses) {
      if (!file.vectors.some((v) => v.kind === "success" && v.response.status === spec.status))
        at(`no success vector for ${spec.status}`);
    }
    for (const spec of route.errors) {
      if (!file.vectors.some((v) => v.kind === "error" && v.code === spec.code))
        at(`no error vector for ${spec.status} ${spec.code}`);
    }
  }
  for (const spec of shared) {
    if (!seen.has(spec.code))
      problems.push(`no vector for shared error ${spec.status} ${spec.code}`);
  }
  return problems;
}

function checkVector(
  route: RouteContract,
  vector: Vector,
  check: SchemaCheck,
  shared: readonly ErrorSpec[],
): string[] {
  const problems: string[] = [];
  const { request, response } = vector;
  if (request.body !== undefined && request.rawBody !== undefined)
    problems.push("request has both body and rawBody");
  if (vector.kind === "success") {
    if (vector.code !== undefined) problems.push("a success vector carries a code");
    // A success is reached only by a valid request.
    for (const part of ["params", "query", "body"] as const) {
      // Routes without a structured request schema can carry bounded raw bytes.
      const valid =
        part === "body" && request.rawBody !== undefined
          ? route.request.body === undefined &&
            request.body === undefined &&
            route.request.maxBodyBytes !== undefined &&
            new TextEncoder().encode(request.rawBody).byteLength <= route.request.maxBodyBytes
          : validRequestPart(part, route.request[part], request[part], check);
      if (!valid) problems.push(`request ${part} does not match the contract`);
    }
    const spec = route.responses.find((s) => s.status === response.status);
    if (!spec) return [...problems, `status ${response.status} is not a contract success`];
    problems.push(...checkBody(spec.contentType ?? spec.body ?? "none", response, check));
    for (const header of spec.headers ?? []) {
      if (!present(response.headers?.[header])) problems.push(`missing header ${header}`);
    }
    return problems;
  }
  const spec = [...route.errors, ...shared].find((e) => e.code === vector.code);
  if (!spec) return [...problems, `code ${String(vector.code)} is not a contract error`];
  if (spec.status !== response.status)
    problems.push(`status ${response.status}, contract says ${spec.status}`);
  problems.push(...checkBody(spec.body ?? errorBody(spec.code, spec.status), response, check));
  return problems;
}

/** Base64 of bytes that start with the JPEG marker FF D8 FF. */
const JPEG_BASE64 = /^\/9j\/[A-Za-z0-9+/]*={0,2}$/u;

function checkBody(
  expected: TSchema | "none" | "html" | "image/jpeg",
  response: Vector["response"],
  check: SchemaCheck,
): string[] {
  if (expected === "image/jpeg") {
    return response.contentType === "image/jpeg" &&
      typeof response.body === "string" &&
      JPEG_BASE64.test(response.body)
      ? []
      : ["the contract answers with JPEG bytes"];
  }
  if (expected === "none") {
    return response.body === undefined && response.contentType === undefined
      ? []
      : ["the contract answers without a body"];
  }
  if (expected === "html") {
    return response.contentType === "text/html" && typeof response.body === "string"
      ? []
      : ["the contract answers with an html page"];
  }
  if (response.contentType !== "application/json") return ["the contract answers with JSON"];
  return check(expected, response.body) ? [] : ["response body does not match the contract"];
}

/** A missing params or query is {}; without a schema it must stay empty and a body absent. */
function validRequestPart(
  part: "params" | "query" | "body",
  schema: TSchema | undefined,
  value: unknown,
  check: SchemaCheck,
): boolean {
  const given = part === "body" ? value : (value ?? {});
  if (schema !== undefined) return check(schema, given);
  return part === "body" ? given === undefined : Object.keys(given as object).length === 0;
}

/** A declared header has a value: a non-empty string, or a list of them with at least one. */
function present(value: string | readonly string[] | undefined): boolean {
  const values = typeof value === "string" ? [value] : (value ?? []);
  return values.length > 0 && values.every((v) => v.length > 0);
}
