// The dev fake server (Ductus#2028): every route of /api/v1 from the contract,
// with in-memory state, for building the web without the server's handlers.
// Local development and tests only (D-09): loading it elsewhere throws.
import "../guard/index.ts";

import type { Operations } from "../../contracts/index.ts";
import { ACCOUNT_HANDLERS } from "./account-routes.ts";
import { ASSISTANT_HANDLERS } from "./assistant-routes.ts";
import { ATTACHMENT_HANDLERS } from "./attachment-routes.ts";
import { COLLABORATION_HANDLERS } from "./collaboration-routes.ts";
import { CONSULTATION_SLOT_HANDLERS } from "./consultation-slots.ts";
import { successBody } from "./contract.ts";
import { EVIDENCE_HANDLERS } from "./evidence-routes.ts";
import { COURSE_SETUP_HANDLERS } from "./course-setup-routes.ts";
import { INSTITUTION_HANDLERS } from "./institution-routes.ts";
import { SETTINGS_HANDLERS } from "./settings-routes.ts";
import { STUDENT_HANDLERS } from "./student-routes.ts";
import { TEACHER_HANDLERS } from "./teacher-routes.ts";
import { MESSAGES_HANDLERS } from "./messages-routes.ts";
import { CONSULTATION_HANDLERS } from "./consultation-routes.ts";
import { MILESTONE_HANDLERS } from "./milestone-routes.ts";
import { VERSIONS_HANDLERS } from "./versions-routes.ts";
import type { Handlers } from "./server.ts";

type SourceLookupBody = Operations["sources.lookup.post"]["success"]["body"];
type PublicVerificationBody = Operations["public.verification.post"]["success"]["body"];

export {
  answerDev,
  createDevServer,
  DELAY_HEADER,
  DELAY_PARAM,
  ERROR_HEADER,
  ERROR_PARAM,
  MAX_DELAY_MS,
  SESSION_COOKIE,
  type Context,
  type DevRequest,
  type Handlers,
  type Reply,
} from "./server.ts";
export { DEFAULT_PORT, devServerPort } from "./port.ts";
export {
  ACCOUNT_KEYS,
  CODES,
  createState,
  EMPTY_DOCUMENT,
  IDS,
  INSTITUTION,
  type AccountKey,
  type State,
} from "./state.ts";

/**
 * The answer of every route of the contract, by operation id.
 * coverage.test.ts fails for a route of ROUTE_TABLE without one.
 */
export const DEV_HANDLERS: Handlers = {
  ...ATTACHMENT_HANDLERS,
  ...ACCOUNT_HANDLERS,
  ...INSTITUTION_HANDLERS,
  ...COURSE_SETUP_HANDLERS,
  ...STUDENT_HANDLERS,
  ...TEACHER_HANDLERS,
  ...SETTINGS_HANDLERS,
  ...EVIDENCE_HANDLERS,
  ...COLLABORATION_HANDLERS,
  ...CONSULTATION_SLOT_HANDLERS,
  ...ASSISTANT_HANDLERS,
  ...VERSIONS_HANDLERS,
  ...MESSAGES_HANDLERS,
  ...CONSULTATION_HANDLERS,
  ...MILESTONE_HANDLERS,
  "sources.lookup.post": ({ account, body }) => {
    if (!account?.roles.includes("student")) return { error: "forbidden" };
    const match =
      body.kind === "doi" && body.identifier.trim().toLowerCase() === "10.99999/izmisljeni";
    const result = match
      ? (successBody("sources.lookup.post") as SourceLookupBody)
      : { source: null };
    return { status: 200, body: result };
  },
  // SRV-9B (C-6): only the invented pair of the contract's "match" vector matches.
  "public.verification.post": ({ body }) => {
    const known = successBody("public.verification.post") as PublicVerificationBody;
    const match =
      body.submissionId === "00000000-0000-4000-8000-00000000c0de" &&
      body.artifactSha256 === "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    return { status: 200, body: match ? known : { match: false } };
  },
};
