import { createActorReader, type WithActor } from "../index.ts";
import type { DeclarationForm, DeclarationPutBody } from "../../domain/index.ts";
export {
  checkExternalAttachmentBytes,
  incompleteFields,
  isExternalFormat,
  parseDeclarationFormFile,
  parseDeclarationPutBody,
} from "../../domain/index.ts";

export type ConfiguredForm = { file: string; form: DeclarationForm & { text: string } };
export type FormReader = (slug: string) => Promise<ConfiguredForm | null>;

type Outcome =
  | { status: "unauthorized" | "not_found" | "conflict" | "invalid_input" }
  | { status: "ok"; body: unknown };
export type StatementOperation =
  | { type: "read" }
  | { type: "save"; body: DeclarationPutBody }
  | { type: "upload"; format: string; bytes: Uint8Array };

export type StatementPort = {
  institutionSlug(token: string): Promise<string | null>;
  run(token: string, assignmentId: string, slug: string, op: StatementOperation): Promise<Outcome>;
};

const SQL = {
  read: "SELECT declaration.read_statement($1) AS result",
  save: "SELECT declaration.save_statement($1, $2, $3) AS result",
  upload: "SELECT declaration.upload_attachment($1, $2, $3) AS result",
} as const;

export function createStatementPort(withActor: WithActor, readForm: FormReader): StatementPort {
  const reader = createActorReader(withActor);
  return {
    async institutionSlug(token) {
      return (await reader.currentActorWithInstitution(token)).institutionSlug;
    },
    async run(token, assignmentId, slug, op) {
      const form = op.type === "upload" ? null : await readForm(slug);
      const args =
        op.type === "save"
          ? [assignmentId, op.body, form?.file ?? null]
          : op.type === "upload"
            ? [assignmentId, op.format, Buffer.from(op.bytes)]
            : [assignmentId];
      return withActor(token, async (tx) => {
        const { rows } = await tx.query<{ result: unknown }>(SQL[op.type], args);
        const result = rows[0]?.result;
        if (typeof result !== "object" || result === null || !("status" in result)) {
          throw new Error("Invalid declaration database response");
        }
        const { status, ...data } = result;
        switch (status) {
          case "unauthorized":
          case "not_found":
          case "conflict":
          case "invalid_input":
            return { status };
          case "ok":
            if (op.type === "upload") return { status, body: data };
            if (
              !("statement" in data) ||
              typeof data.statement !== "object" ||
              data.statement === null
            )
              break;
            return { status, body: { ...data.statement, currentForm: form?.form ?? null } };
        }
        throw new Error("Invalid declaration database response");
      });
    },
  };
}
