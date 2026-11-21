import { Type } from "@sinclair/typebox";

import { closed, defineRoute, error, REQUEST_ID_PATTERN } from "../schema/index.ts";
import { MUTATION_GUARD } from "./shared.ts";

const SHA256 = Type.String({ pattern: "^[0-9a-f]{64}$" });
const ID = Type.String({ pattern: REQUEST_ID_PATTERN });
const Version = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const DraftVersion = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const Use = Type.Union([Type.Literal("used"), Type.Literal("not_used")]);
const Format = Type.Union([Type.Literal("application/pdf"), Type.Literal("text/plain")]);
const Form = closed({
  formId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
  formVersion: Type.Integer({ minimum: 1, maximum: 2147483647 }),
  formSha256: SHA256,
});
const HumanHelp = closed({
  received: Type.Boolean(),
  entries: Type.Array(
    closed({
      kind: Type.Union(
        ["language", "structure", "sources", "content", "technical", "other"].map((kind) =>
          Type.Literal(kind),
        ),
      ),
      text: Type.String({
        minLength: 1,
        maxLength: 4000,
        description: "Up to 2000 Unicode code points.",
      }),
    }),
    { maxItems: 20 },
  ),
});
const Tools = Type.Array(
  closed({
    toolLabel: Type.String({
      minLength: 1,
      maxLength: 400,
      description: "Up to 200 Unicode code points.",
    }),
    purposeText: Type.String({
      minLength: 1,
      maxLength: 400,
      description: "Up to 200 Unicode code points.",
    }),
    phaseText: Type.String({
      minLength: 1,
      maxLength: 400,
      description: "Up to 200 Unicode code points.",
    }),
  }),
  { maxItems: 20 },
);
const OwnWork = closed({ confirmed: Type.Boolean() });
const Put = closed({
  baseVersion: DraftVersion,
  revision: Version,
  form: Form,
  ownWork: OwnWork,
  humanHelp: HumanHelp,
  ai: closed({
    use: Type.Union([Use, Type.Null()]),
    declaredTools: Tools,
    attachments: Type.Array(
      closed({ conversationId: ID, throughSeq: Version, messagesSha256: SHA256 }),
      { maxItems: 0 },
    ),
    externalAttachmentIds: Type.Array(ID, { maxItems: 10 }),
  }),
  confirm: Type.Boolean(),
});
// The request generator supports one object level and no nested item validators.
// The HTTP edge runs the closed declaration parser on the full input.
const PutRequest = closed({
  ...Put.properties,
  humanHelp: Type.Object(
    { received: Type.Boolean() },
    {
      description: "Closed declaration-v1 object with received and entries [{kind,text}].",
    },
  ),
  ai: Type.Object(
    { use: Type.Union([Use, Type.Null()]) },
    {
      description:
        "Closed declaration-v1 object with use, declaredTools, empty attachments, and externalAttachmentIds.",
    },
  ),
});
const Attachment = closed({
  externalAttachmentId: ID,
  format: Format,
  byteLength: Type.Integer({ minimum: 1, maximum: 2097152 }),
  contentSha256: SHA256,
});
const Payload = closed({
  declarationSchema: Type.Literal("ductura-declaration-v1"),
  declarationId: ID,
  declarationVersion: Version,
  principalId: ID,
  assignmentId: ID,
  assignmentVersion: Version,
  documentId: Type.String({ minLength: 1, maxLength: 256 }),
  revision: Version,
  form: Form,
  ownWork: closed({ confirmed: Type.Literal(true) }),
  humanHelp: HumanHelp,
  ai: closed({
    use: Use,
    declaredTools: Tools,
    recorded: Type.Array(closed({ aiTransferId: ID, aiTransferSha256: SHA256 }), { maxItems: 0 }),
    attachments: Type.Array(
      closed({ ...Attachment.properties, reason: Type.Literal("external_upload") }),
      { maxItems: 10 },
    ),
  }),
  confirmedAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$" }),
});
// TypeBox's runtime checker counts UTF-16 units. The domain and the database
// enforce the tighter limit in Unicode code points.
const FormText = Type.String({
  minLength: 1,
  maxLength: 40000,
  description: "Up to 20000 Unicode code points.",
});
const Statement = closed({
  state: Type.Union(
    ["none", "draft", "confirmed", "stale", "bound"].map((state) => Type.Literal(state)),
  ),
  submitted: Type.Boolean(),
  currentRevision: Type.Union([DraftVersion, Type.Null()]),
  version: DraftVersion,
  formText: Type.Union([FormText, Type.Null()]),
  currentForm: Type.Union([closed({ ...Form.properties, text: FormText }), Type.Null()]),
  draft: Type.Union([Put, Type.Null()]),
  payload: Type.Union([Payload, Type.Null()]),
  declarationSha256: Type.Union([SHA256, Type.Null()]),
  uploads: Type.Array(Attachment, { maxItems: 10 }),
});
const Params = closed({ assignmentId: Type.String({ minLength: 1 }) });
const READ_ERRORS = [
  error(401, "unauthorized"),
  error(403, "forbidden"),
  error(404, "not_found"),
  error(503, "unavailable"),
];
const WRITE_ERRORS = [
  ...MUTATION_GUARD,
  error(401, "unauthorized"),
  error(404, "not_found"),
  error(409, "conflict"),
  error(422, "invalid_input"),
  error(503, "unavailable"),
];
const INVENTORY = "app/api/student/assignments/[assignmentId]";
const URL = "/api/v1/student/assignments/{assignmentId}";
export const STATEMENT_MAX_BODY_BYTES = (20 * 2000 + 20 * 3 * 200) * 12 + 16 * 1024;

export const studentDeclarationGet = defineRoute({
  id: "student.declaration.get",
  method: "GET",
  path: `${URL}/declaration`,
  inventory: `${INVENTORY}/declaration/route.ts`,
  access: "student_enrolled",
  summary:
    "Read the student's declaration, the current faculty form when configured, and the metadata of external uploads.",
  request: { params: Params },
  responses: [
    { status: 200, body: Statement, description: "Declaration state", headers: ["cache-control"] },
  ],
  errors: READ_ERRORS,
});
export const studentDeclarationPut = defineRoute({
  id: "student.declaration.put",
  method: "PUT",
  path: `${URL}/declaration`,
  inventory: `${INVENTORY}/declaration/route.ts`,
  access: "student_enrolled",
  summary:
    "Save a draft or confirm an immutable declaration for the current document revision. A stale base, unconfirmed fields, an outdated form or a submission request returns 409.",
  request: {
    params: Params,
    contentType: "application/json",
    maxBodyBytes: STATEMENT_MAX_BODY_BYTES,
    body: PutRequest,
  },
  responses: studentDeclarationGet.responses,
  errors: [...WRITE_ERRORS, error(400, "invalid_json"), error(415, "unsupported_media_type")],
});
export const studentDeclarationAttachmentsPost = defineRoute({
  id: "student.declaration-attachments.post",
  method: "POST",
  path: `${URL}/declaration-attachments`,
  inventory: `${INVENTORY}/declaration-attachments/route.ts`,
  access: "student_enrolled",
  summary:
    "Send raw PDF or UTF-8 plain-text bytes with Content-Type application/pdf or text/plain. Other media types yield 422. Uploading returns a reference for a later declaration PUT.",
  request: { params: Params, maxBodyBytes: 2097152 },
  responses: [
    {
      status: 200,
      body: Attachment,
      description: "External attachment reference",
      headers: ["cache-control"],
    },
  ],
  errors: WRITE_ERRORS,
});
export const statementRoutes = [
  studentDeclarationGet,
  studentDeclarationPut,
  studentDeclarationAttachmentsPost,
] as const;
