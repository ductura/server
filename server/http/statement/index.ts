import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";

import { Value } from "@sinclair/typebox/value";

import { ROUTES } from "../../contracts/index.ts";
import {
  checkExternalAttachmentBytes,
  createStatementPort,
  incompleteFields,
  isExternalFormat,
  parseDeclarationPutBody,
  type StatementOperation,
  type StatementPort,
  type WithActor,
} from "../../database/index.ts";
import { liveSessionTokenFromCookie } from "../../session/index.ts";
import {
  parseJson,
  readBodyWithLimit,
  refuse,
  reportServerError,
  requestIdOf,
  sendJson,
  sendProblem,
  type Route,
} from "../index.ts";
import { createFormReader } from "./form.ts";

export type { StatementPort } from "../../database/index.ts";

const BODY_TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const READ = "student.declaration.get";
const SAVE = "student.declaration.put";
const UPLOAD = "student.declaration-attachments.post";

function mediaType(request: IncomingMessage): string | undefined {
  const types = request.headersDistinct["content-type"];
  if (types?.length !== 1) return undefined;
  return types[0]?.split(";")[0]?.trim().toLowerCase();
}

export function createStatementRoutes(port: StatementPort): Route[] {
  return [READ, SAVE, UPLOAD].map((id) => {
    const contract = ROUTES.find((route) => route.id === id);
    if (contract === undefined) throw new Error(`Missing contract for ${id}`);
    return {
      contract,
      async handle(request, response, params) {
        const site = request.headersDistinct["sec-fetch-site"];
        if (id === READ && site !== undefined && (site.length !== 1 || site[0] !== "same-origin")) {
          return sendProblem(response, 403, "forbidden");
        }
        const token = liveSessionTokenFromCookie(request.headers.cookie);
        if (token === undefined) return refuse(response, 401, "unauthorized");
        try {
          const slug = await port.institutionSlug(token);
          if (slug === null) return refuse(response, 401, "unauthorized");
          const assignmentId = params?.assignmentId ?? "";
          if (!UUID.test(assignmentId)) return refuse(response, 404, "not_found");
          let op: StatementOperation = { type: "read" };
          if (id !== READ) {
            const format = mediaType(request);
            if (id === UPLOAD && !isExternalFormat(format))
              return refuse(response, 422, "invalid_input");
            if (id === SAVE && format !== "application/json")
              return refuse(response, 415, "unsupported_media_type");
            const raw = await readBodyWithLimit(
              request,
              contract.request.maxBodyBytes!,
              BODY_TIMEOUT_MS,
            );
            if (!raw.ok) return refuse(response, raw.status, raw.reason);
            if (id === SAVE) {
              const json = parseJson(raw.bytes);
              if (!json.ok) return sendProblem(response, 400, "invalid_json");
              const parsed = parseDeclarationPutBody(json.value);
              if (!parsed.ok || parsed.body.ai.attachments.length !== 0) {
                return sendProblem(response, 422, "invalid_input");
              }
              if (parsed.body.confirm && incompleteFields(parsed.body).length > 0) {
                return sendProblem(response, 409, "conflict");
              }
              op = { type: "save", body: parsed.body };
            } else {
              const checked = checkExternalAttachmentBytes(format ?? "", raw.bytes);
              if (!checked.ok) return sendProblem(response, 422, "invalid_input");
              op = { type: "upload", format: checked.format, bytes: raw.bytes };
            }
          }
          const outcome = await port.run(token, assignmentId.toLowerCase(), slug, op);
          switch (outcome.status) {
            case "unauthorized":
              return sendProblem(response, 401, outcome.status);
            case "not_found":
              return sendProblem(response, 404, outcome.status);
            case "conflict":
              return sendProblem(response, 409, outcome.status);
            case "invalid_input":
              return sendProblem(response, 422, outcome.status);
            case "ok": {
              const schema = contract.responses[0]?.body;
              if (schema !== undefined && Value.Check(schema, outcome.body))
                return sendJson(response, 200, outcome.body);
              throw new Error("Declaration response outside its contract");
            }
          }
        } catch {
          // The postgres error can carry submitted text in its detail or context.
          reportServerError(
            "route",
            new Error("Declaration operation failed"),
            requestIdOf(response),
            id,
          );
          return sendProblem(response, 503, "unavailable");
        }
      },
    };
  });
}

export function createStatementRoutesFor(main: { readonly withActor: WithActor }): Route[] {
  return createStatementRoutes(
    createStatementPort(main.withActor, createFormReader(resolve("config/faculties"))),
  );
}
