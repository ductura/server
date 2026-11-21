// The dev fake server: every route of ROUTE_TABLE, input checked by the
// contract validators, answers from in-memory state. Local development and
// tests only (D-09): the package guard refuses to load it anywhere else, and
// the only sign-in is the local role switch /__lazni/uloga.
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { OperationId, Operations } from "../../contracts/index.ts";
import {
  bodyType,
  errorAnswer,
  errorCodes,
  firstError,
  hasValidator,
  matchRoute,
  validPart,
  type Answer,
  type RouteId,
} from "./contract.ts";
import { multipartFields } from "../fake-server/index.ts";
import { ACCOUNT_KEYS, createState, type Account, type AccountKey, type State } from "./state.ts";

export const SESSION_COOKIE = "ductura_lazna_sesija";
export const ERROR_PARAM = "__lazni_greska";
export const DELAY_PARAM = "__lazni_kasnjenje";
export const ERROR_HEADER = "x-lazni-greska";
export const DELAY_HEADER = "x-lazni-kasnjenje";
/** The longest delay a request may ask for. */
export const MAX_DELAY_MS = 30_000;

type Op<Id extends OperationId> = Operations[Id];
type Success<S> = S extends { status: infer Status; body: infer B }
  ? { status: Status; headers?: Record<string, string | string[]> } & (undefined extends B
      ? { body?: undefined }
      : { body: B })
  : never;
/** A handler's answer: a contract success, or a contract error by code. */
export type Reply<Id extends OperationId> =
  | Success<Op<Id>["success"]>
  // An error of the route; `body` replaces the vector's body where the
  // contract carries state in it (stale_base, stale_revision). Tests check it.
  | { error: Op<Id>["errorCode"]; body?: Record<string, unknown> };

export type Context<Id extends OperationId> = {
  readonly state: State;
  /** The account of the session cookie, or null. */
  readonly account: Account | null;
  readonly token: string | null;
  readonly params: Op<Id>["params"];
  readonly query: Op<Id>["query"];
  readonly body: Op<Id>["body"];
  readonly rawBody: Uint8Array;
  readonly now: Date;
  /** A request header by lowercase name. */
  readonly header: (name: string) => string | undefined;
};

export type Handlers = { [Id in OperationId]?: (ctx: Context<Id>) => Reply<Id> };

export type DevRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: Uint8Array;
};

function header(req: DevRequest, name: string): string | undefined {
  const value = req.headers[name];
  return value === undefined ? undefined : typeof value === "string" ? value : value.join(", ");
}

function json(
  status: number,
  body: unknown,
  extra: Record<string, string | string[]> = {},
): Answer {
  return {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
    body: JSON.stringify(body),
  };
}

function sessionToken(req: DevRequest): string | null {
  for (const part of (header(req, "cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
export const clearedSessionCookie = (): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** A relative path on this server, never another host. */
function localPath(value: string | null): string | null {
  return value !== null && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : null;
}

/** The local role switch: the only way to a session (D-09). */
function roleSwitch(state: State, req: DevRequest, url: URL): Answer {
  const as = url.searchParams.get("kao");
  const back = localPath(url.searchParams.get("povratak"));
  const old = sessionToken(req);
  if (old !== null) state.sessions.delete(old);
  if (as === null) {
    const links = ACCOUNT_KEYS.map(
      (key) =>
        `<li><a href="/__lazni/uloga?kao=${key}&amp;povratak=${encodeURIComponent(back ?? "/")}">${key}</a></li>`,
    ).join("");
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      body: `<!doctype html><meta charset="utf-8"><title>Lažni server</title><p>Lažni server (samo lokalno): odaberi račun.</p><ul>${links}</ul>`,
    };
  }
  if (as === "odjava") {
    const cleared = { "set-cookie": [clearedSessionCookie()] };
    return back === null ? json(200, { kao: null }, cleared) : redirect(back, cleared);
  }
  const account = state.accounts.find((a) => a.key === as);
  if (account === undefined)
    return json(400, { lazniServer: "nepoznat_racun", racuni: ACCOUNT_KEYS });
  const token = randomBytes(24).toString("base64url");
  state.sessions.set(token, account.id);
  const cookie = { "set-cookie": [sessionCookie(token)] };
  if (back !== null) return redirect(back, cookie);
  return json(
    200,
    {
      kao: account.key,
      id: account.id,
      ime: account.givenName,
      prezime: account.familyName,
      uloge: account.roles,
    },
    cookie,
  );
}

function redirect(location: string, extra: Record<string, string | string[]>): Answer {
  return { status: 303, headers: { location, "cache-control": "no-store", ...extra }, body: "" };
}

/** Query or form fields; the control parameters of the fake are left out. */
function fields(search: URLSearchParams): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  for (const [name, value] of search)
    if (name !== ERROR_PARAM && name !== DELAY_PARAM) out[name] = value;
  return out;
}

const PARAM_ERRORS = [
  "invalid_assignment_id",
  "invalid_input",
  "invalid",
  "invalid_document",
  "bad_request",
];
const BODY_ERRORS = [
  "invalid_input",
  "invalid",
  "invalid_document",
  "invalid_logout_token",
  "bad_request",
  "invalid_json",
];
const QUERY_ERRORS = ["invalid_input", "login_failed", "bad_request"];
const NOT_FOUND = json(404, { error: "not_found" });

/** Parses the body by the route's content type; undefined when it does not parse. */
function readBody(
  route: RouteId,
  req: DevRequest,
): { ok: true; value: unknown } | { ok: false; answer: Answer } {
  const type = bodyType(route);
  if (type === null) return { ok: true, value: undefined };
  const media = (header(req, "content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (media !== type)
    return {
      ok: false,
      answer: firstError(route, ["unsupported_media_type", "bad_request"]) ?? NOT_FOUND,
    };
  // A file part arrives in Base64, as the vectors write it; the handler decodes it.
  if (type === "multipart/form-data") {
    const parts = multipartFields(req.body);
    return parts === null
      ? { ok: false, answer: firstError(route, ["invalid_input", "bad_request"]) ?? NOT_FOUND }
      : {
          ok: true,
          // A form writes every line break of a text field as CR LF; the
          // contract takes LF, as the real route keeps it (Base64 has neither).
          value: Object.fromEntries(
            Object.entries(parts).map(([name, value]) => [name, value.replaceAll("\r\n", "\n")]),
          ),
        };
  }
  const text = Buffer.from(req.body).toString("utf8");
  if (type === "application/x-www-form-urlencoded")
    return { ok: true, value: fields(new URLSearchParams(text)) };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, answer: firstError(route, ["invalid_json", "bad_request"]) ?? NOT_FOUND };
  }
}

/** The answer of the dev fake server to one request. */
export async function answerDev(
  state: State,
  handlers: Handlers,
  req: DevRequest,
): Promise<Answer> {
  const url = new URL(req.url, "http://lazni.invalid");
  const delay = Number(url.searchParams.get(DELAY_PARAM) ?? header(req, DELAY_HEADER) ?? 0);
  if (Number.isFinite(delay) && delay > 0)
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, MAX_DELAY_MS)));
  if (url.pathname === "/__lazni/uloga" && req.method === "GET") return roleSwitch(state, req, url);
  if (url.pathname === "/__lazni/ponovno" && req.method === "POST") {
    Object.assign(state, createState(state.receiptSigner));
    return json(200, { ponovno: true });
  }
  const match = matchRoute(req.method, url.pathname);
  if (match.kind === "none") return NOT_FOUND;
  if (match.kind === "method")
    return json(405, { error: "method_not_allowed" }, { allow: match.allow });
  const route = match.id;
  const wanted = url.searchParams.get(ERROR_PARAM) ?? header(req, ERROR_HEADER);
  if (wanted !== null && wanted !== undefined)
    return (
      errorAnswer(route, wanted) ??
      json(400, { lazniServer: "nepoznata_greska", dopustene: errorCodes(route) })
    );
  if (match.params === null || !validPart(route, "params", match.params))
    return firstError(route, PARAM_ERRORS) ?? NOT_FOUND;
  const token = sessionToken(req);
  const accountId = token === null ? undefined : state.sessions.get(token);
  const account = state.accounts.find((a) => a.id === accountId) ?? null;
  // A route that can answer 401 needs a session; the others are open (health, login).
  if (account === null) {
    const refused = firstError(route, ["unauthorized", "unauthenticated"]);
    if (refused !== null) return refused;
  }
  const query = fields(url.searchParams);
  if (hasValidator(route, "query") && !validPart(route, "query", query))
    return firstError(route, QUERY_ERRORS) ?? NOT_FOUND;
  const body = readBody(route, req);
  if (!body.ok) return body.answer;
  if (bodyType(route) !== null && !validPart(route, "body", body.value))
    return firstError(route, BODY_ERRORS) ?? NOT_FOUND;
  const handler = handlers[route] as ((ctx: Context<RouteId>) => Reply<RouteId>) | undefined;
  if (handler === undefined) return json(501, { error: "not_implemented" });
  const reply = handler({
    state,
    account,
    token: account === null ? null : token,
    params: match.params as never,
    query: query as never,
    body: body.value as never,
    rawBody: req.body,
    now: new Date(),
    header: (name) => header(req, name),
  });
  if ("error" in reply) {
    const answer = errorAnswer(route, reply.error);
    if (answer === null) throw new Error(`${route}: ${reply.error} is not a contract error`);
    return reply.body === undefined ? answer : { ...answer, body: JSON.stringify(reply.body) };
  }
  const headers: Record<string, string | string[]> = {
    "cache-control": "no-store",
    ...reply.headers,
  };
  if (reply.body === undefined) return { status: reply.status, headers, body: "" };
  if (reply.body instanceof Blob) {
    const bytes = new Uint8Array(await reply.body.arrayBuffer());
    return {
      status: reply.status,
      headers: { "content-type": reply.body.type, ...headers },
      body: "",
      bytes,
    };
  }
  return {
    status: reply.status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(reply.body),
  };
}

/** An HTTP server over `answerDev`, with its own state. */
export function createDevServer(handlers: Handlers, state: State = createState()): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", () => res.destroy());
    req.on("end", () => {
      answerDev(state, handlers, {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks),
      }).then(
        (out) => {
          res.writeHead(out.status, out.headers);
          res.end(out.bytes ?? out.body);
        },
        (error: unknown) => {
          console.error(error);
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal" }));
        },
      );
    });
  });
}
