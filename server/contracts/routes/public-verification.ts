import { Type } from "@sinclair/typebox";

import { closed, defineRoute, error } from "../schema/index.ts";

import { MUTATION_GUARD } from "./shared.ts";

// SRV-9B (Ductus#2028 c.7041664094; plan „Val 9”, ✓ C-6): the public check of a
// submission receipt. The page /provjera reads the two values of the receipt's
// QR fragment (r = submissionId, o = artifactSha256) and posts them here. The
// route never reads, issues or changes a session (D-09) and gives no access
// to a work (C-23): the answer is only whether a signed receipt binds exactly
// that text, and then when it was submitted and signed and by which key.

const END = "(?![\\s\\S])";
const LowerUuid = Type.String({
  pattern: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}${END}`,
});
const Sha256 = Type.String({ pattern: `^[0-9a-f]{64}${END}` });
/** isSubmissionInstant: the database clock with exactly six fraction digits, in UTC. */
const Microsecond = Type.String({
  pattern: `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z${END}`,
});

export const publicVerificationPost = defineRoute({
  id: "public.verification.post",
  method: "POST",
  path: "/api/v1/public/verification",
  inventory: "app/api/public/verification/route.ts",
  access: "anyone",
  summary:
    "Checks whether a signed submission receipt binds exactly the given text (C-6). The body is the two values of the receipt's QR fragment: the submission id and the SHA-256 of the submitted text, lowercase. Works without a login, never reads or sets a session cookie and is not a way to sign in (D-09); it has its own rate limit per address. match is true only when the institution's receipt for that submission names that hash and its Ed25519 signature verifies with a key valid then and not revoked; the answer then carries only the submission and signing instants and the key id, never a name, course, assignment or text. Every other case, an unknown submission included, is the same match false.",
  request: {
    contentType: "application/json",
    maxBodyBytes: 256,
    body: closed({ submissionId: LowerUuid, artifactSha256: Sha256 }),
  },
  responses: [
    {
      status: 200,
      description: "the answer of the check",
      body: Type.Union([
        closed({
          match: Type.Literal(true),
          submittedAt: Microsecond,
          signedAt: Microsecond,
          keyId: Type.String({ minLength: 1, maxLength: 256 }),
        }),
        closed({ match: Type.Literal(false) }),
      ]),
    },
  ],
  errors: [
    ...MUTATION_GUARD,
    error(415, "unsupported_media_type"),
    error(400, "invalid_json"),
    error(422, "invalid_input"),
    error(503, "unavailable"),
  ],
});

export const publicVerificationRoutes = [publicVerificationPost] as const;
