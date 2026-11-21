import { randomUUID } from "node:crypto";

import type { Operations } from "../../contracts/index.ts";
import {
  checkExternalAttachmentBytes,
  declarationSha256,
  incompleteFields,
  parseDeclarationPutBody,
} from "../../../server/domain/declaration/index.ts";
import type { Context, Handlers } from "./server.ts";
import type { State } from "./state.ts";

type Statement = Operations["student.declaration.get"]["success"]["body"];
type Upload = Operations["student.declaration-attachments.post"]["success"]["body"];
type Saved = { latest: Statement; confirmed: Statement | null };
const FORM = {
  formId: "test-izjava",
  formVersion: 1,
  formSha256: "a".repeat(64),
  text: "Izmišljeni obrazac.",
};
const SAVED = new WeakMap<State, Map<string, Saved>>();
const UPLOADS = new WeakMap<State, Map<string, Upload[]>>();

function stateFor<T>(map: WeakMap<State, Map<string, T>>, state: State) {
  let data = map.get(state);
  if (data === undefined) {
    data = new Map();
    map.set(state, data);
  }
  return data;
}

function workOf({
  state,
  account,
  params,
}: Pick<Context<"student.declaration.get">, "state" | "account" | "params">) {
  return state.works.find(
    (work) => work.assignmentId === params.assignmentId && work.studentId === account?.id,
  );
}

function answerOf(state: State, work: NonNullable<ReturnType<typeof workOf>>): Statement {
  const submitted = work.state === "submitted";
  const records = stateFor(SAVED, state).get(work.documentId);
  const saved = submitted ? (records?.confirmed ?? undefined) : records?.latest;
  const fresh = saved?.payload?.revision === work.revision;
  const uploads = stateFor(UPLOADS, state).get(work.documentId) ?? [];
  const empty: Statement = {
    state: "none",
    submitted,
    currentRevision: work.revision,
    version: 0,
    formText: null,
    currentForm: FORM,
    draft: null,
    payload: null,
    declarationSha256: null,
    uploads,
  };
  if (saved === undefined || (submitted && !fresh)) return empty;
  return {
    ...saved,
    submitted,
    currentRevision: work.revision,
    uploads,
    state: submitted ? "bound" : saved.state === "confirmed" && !fresh ? "stale" : saved.state,
  };
}

export const STATEMENT_HANDLERS: Handlers = {
  "student.declaration.get": (ctx) => {
    const work = workOf(ctx);
    return work === undefined
      ? { error: "not_found" }
      : { status: 200, body: answerOf(ctx.state, work) };
  },
  "student.declaration.put": (ctx) => {
    const work = workOf(ctx);
    if (work === undefined) return { error: "not_found" };
    const previous = answerOf(ctx.state, work);
    const parsed = parseDeclarationPutBody(ctx.body);
    if (!parsed.ok || parsed.body.ai.attachments.length !== 0) return { error: "invalid_input" };
    const body = parsed.body;
    if (
      previous.submitted ||
      body.revision !== work.revision ||
      body.baseVersion !== previous.version ||
      body.form.formSha256 !== FORM.formSha256 ||
      body.form.formVersion !== FORM.formVersion ||
      body.form.formId !== FORM.formId ||
      (body.confirm && incompleteFields(body).length > 0)
    ) {
      return { error: "conflict" };
    }
    const uploads = previous.uploads.filter((upload) =>
      body.ai.externalAttachmentIds.includes(upload.externalAttachmentId),
    );
    if (uploads.length !== body.ai.externalAttachmentIds.length) return { error: "not_found" };
    const version = previous.version + 1;
    const store = stateFor(SAVED, ctx.state);
    const confirmed = store.get(work.documentId)?.confirmed ?? null;
    const payload =
      body.confirm && body.ai.use !== null
        ? {
            declarationSchema: "ductura-declaration-v1" as const,
            declarationId: confirmed?.payload?.declarationId ?? randomUUID(),
            declarationVersion: (confirmed?.payload?.declarationVersion ?? 0) + 1,
            principalId: work.studentId,
            assignmentId: work.assignmentId,
            assignmentVersion:
              ctx.state.assignments.find((assignment) => assignment.id === work.assignmentId)
                ?.version ?? 1,
            documentId: work.documentId,
            revision: work.revision,
            form: body.form,
            ownWork: { confirmed: true as const },
            humanHelp: body.humanHelp,
            ai: {
              use: body.ai.use,
              declaredTools: body.ai.declaredTools,
              recorded: [],
              attachments: uploads
                .slice()
                .sort((a, b) => a.externalAttachmentId.localeCompare(b.externalAttachmentId))
                .map((upload) => ({ ...upload, reason: "external_upload" as const })),
            },
            confirmedAt: ctx.now.toISOString().replace(/Z$/u, "000Z"),
          }
        : null;
    const next: Statement = {
      ...previous,
      state: payload === null ? "draft" : "confirmed",
      version,
      formText: FORM.text,
      draft: payload === null ? body : null,
      payload,
      declarationSha256: payload === null ? null : declarationSha256(payload),
    };
    store.set(work.documentId, { latest: next, confirmed: payload === null ? confirmed : next });
    return { status: 200, body: next };
  },
  "student.declaration-attachments.post": (ctx) => {
    const work = workOf(ctx);
    if (work === undefined) return { error: "not_found" };
    if (work.state === "submitted") return { error: "conflict" };
    const format = ctx.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (ctx.rawBody.byteLength > 2097152) return { error: "body_too_large" };
    const checked = checkExternalAttachmentBytes(format ?? "", ctx.rawBody);
    if (!checked.ok) return { error: "invalid_input" };
    const { format: accepted, byteLength, contentSha256 } = checked;
    const byWork = stateFor(UPLOADS, ctx.state);
    const files = byWork.get(work.documentId) ?? [];
    const existing = files.find(
      (file) => file.format === accepted && file.contentSha256 === contentSha256,
    );
    if (existing !== undefined) return { status: 200, body: existing };
    if (
      files.length >= 10 ||
      files.reduce((sum, file) => sum + file.byteLength, byteLength) > 10485760
    ) {
      return { error: "conflict" };
    }
    const upload = {
      externalAttachmentId: randomUUID(),
      format: accepted,
      byteLength,
      contentSha256,
    };
    byWork.set(work.documentId, [...files, upload]);
    return { status: 200, body: upload };
  },
};
