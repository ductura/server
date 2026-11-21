import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  verifySignedEvidenceReceiptV2,
  type EvidenceDomainKey,
  type SignedEvidenceReceiptV2,
} from "../../../server/domain/index.ts";
import { createState, EMPTY_DOCUMENT, IDS, type State } from "./index.ts";
import { contractProblems, evidenceSegment, send, signIn } from "./testing.ts";

const EVIDENCE = { "ductus-protocol": "1" };

async function commit(
  state: State,
  headers: Record<string, string>,
  txid: string,
  baseRevision: number,
  segment = evidenceSegment(state),
) {
  return send(state, "/api/v1/evidence/commit", {
    body: {
      documentId: IDS.document,
      clientTransactionId: txid,
      baseRevision,
      segments: [segment],
      document: EMPTY_DOCUMENT,
    },
    headers: { ...EVIDENCE, ...headers },
  });
}

describe("dev fake server: evidence receipts", () => {
  it("accepts a signed receipt under the published key and rejects a wrong signature", async () => {
    const state = createState();
    const headers = await signIn(state, "student");
    const opened = await send(state, "/api/v1/evidence/open", {
      body: { assignmentId: IDS.assignment },
      headers: { ...headers, ...EVIDENCE },
    });
    expect(contractProblems("evidence.open.post", opened)).toEqual([]);
    const {
      documentId,
      receiptKeys: [key],
    } = opened.json as { documentId: string; receiptKeys: EvidenceDomainKey[] };
    if (key === undefined) throw new Error("missing receipt key");
    const segment = evidenceSegment(state, 2);
    const committed = await commit(state, headers, "izmisljena-1", 0, segment);
    expect(contractProblems("evidence.commit.post", committed)).toEqual([]);
    const { signedReceipt } = (
      committed.json as { receipt: { signedReceipt: SignedEvidenceReceiptV2 } }
    ).receipt;
    const bytes = Buffer.from(segment, "base64");
    expect(signedReceipt.payload).toMatchObject({
      principalId: IDS.student,
      segmentHash: createHash("sha256").update(bytes).digest("hex"),
      sequenceFrom: 1,
      sequenceTo: 2,
      eventCount: 2,
      payloadBytes: bytes.length,
    });
    const expected = {
      documentId,
      evidenceDomainId: key.evidenceDomainId,
      clientTransactionId: "izmisljena-1",
      revision: 1,
    };
    await expect(verifySignedEvidenceReceiptV2(signedReceipt, expected, [key])).resolves.toEqual({
      ok: true,
      payload: signedReceipt.payload,
    });
    const { signature } = signedReceipt;
    const { privateKey } = generateKeyPairSync("ed25519");
    const substitute = sign(null, Buffer.from("izmišljeni pogrešan potpis"), privateKey);
    const changed = {
      ...signedReceipt,
      signature: { ...signature, signatureBase64Url: substitute.toString("base64url") },
    };
    await expect(verifySignedEvidenceReceiptV2(changed, expected, [key])).resolves.toEqual({
      ok: false,
      reason: "signature_invalid",
    });
    expect(createState().receiptSigner.key.keyBase64Url).not.toBe(key.keyBase64Url);

    const submitted = await send(state, "/api/v1/submission", {
      body: { documentId: IDS.document, revision: 1 },
      headers: { ...headers, ...EVIDENCE },
    });
    expect(contractProblems("submission.submit.post", submitted)).toEqual([]);
    expect(submitted.json).toMatchObject({
      receipt: {
        signature: { keyId: "lazni-kljuc-nepotpisano", signatureBase64Url: "A".repeat(86) },
      },
    });
  });

  it("returns the same receipt on retry and completes protocol 2 after a pending response", async () => {
    const state = createState();
    const headers = await signIn(state, "student");
    const segment = evidenceSegment(state, 2);
    const first = await commit(state, headers, "izmisljena-1", 0, segment);
    const duplicate = await commit(state, headers, "izmisljena-1", 0, segment);
    expect(duplicate.json).toMatchObject({ status: "duplicate", duplicate: true, revision: 1 });
    expect(duplicate.json).toEqual({
      ...(first.json as object),
      status: "duplicate",
      duplicate: true,
    });
    expect((await commit(state, headers, "izmisljena-1", 0)).json).toMatchObject({
      status: "txid_reused",
    });
    const stale = await commit(state, headers, "izmisljena-2", 0);
    expect(contractProblems("evidence.commit.post", stale, "stale_base")).toEqual([]);
    expect(stale.json).toMatchObject({ status: "stale_base", currentRevision: 1 });
    const v2 = { ...headers, "ductus-protocol": "2" };
    const next = evidenceSegment(state);
    const pending = await commit(state, v2, "izmisljena-3", 1, next);
    expect(contractProblems("evidence.commit.post", pending)).toEqual([]);
    expect(pending.status).toBe(202);
    const signed = await commit(state, v2, "izmisljena-3", 1, next);
    expect(signed.status).toBe(200);
    expect(contractProblems("evidence.commit.post", signed)).toEqual([]);
    expect(signed.json).toMatchObject({
      status: "duplicate",
      duplicate: true,
      revision: 2,
      receipt: { status: "signed", signedReceipt: { payload: { sequenceFrom: 3, sequenceTo: 3 } } },
    });
    expect((await commit(state, headers, "izmisljena-1", 0, segment)).json).toEqual(duplicate.json);
  });

  it.each(["invalid JSON", "invalid segment shape", "noncanonical bytes"])(
    "refuses %s without advancing the work",
    async (kind) => {
      const state = createState();
      const headers = await signIn(state, "student");
      const canonical = Buffer.from(evidenceSegment(state), "base64").toString("utf8");
      const input =
        kind === "invalid JSON" ? "{" : kind === "invalid segment shape" ? "{}" : ` ${canonical}`;
      const refused = await commit(
        state,
        headers,
        "izmisljena-1",
        0,
        Buffer.from(input).toString("base64"),
      );
      expect(refused.status).toBe(422);
      expect(contractProblems("evidence.commit.post", refused, "invalid")).toEqual([]);
      expect(state.works[0]?.revision).toBe(0);
    },
  );

  it("refuses another student's work and a stale submission", async () => {
    const state = createState();
    const other = await commit(state, await signIn(state, "student-2"), "izmisljena-1", 0);
    expect(other.json).toMatchObject({ status: "not_found" });
    const headers = await signIn(state, "student");
    await commit(state, headers, "izmisljena-1", 0);
    const stale = await send(state, "/api/v1/submission", {
      body: { documentId: IDS.document, revision: 0 },
      headers,
    });
    expect(contractProblems("submission.submit.post", stale, "stale_revision")).toEqual([]);
    expect(stale.json).toMatchObject({ currentRevision: 1 });
  });
});

describe("dev fake server: live view and collaboration", () => {
  it("publishes the live state with a token, answers 304 to its ETag and logs a teacher's read", async () => {
    const state = createState();
    const url = `/api/v1/live/${IDS.document}`;
    const student = await signIn(state, "student");
    const body = { nodes: [], schemaVersion: 1 };
    const first = await send(state, url, {
      method: "PUT",
      body,
      headers: { ...student, "if-none-match": "*" },
    });
    const token = (first.json as { token: string }).token;
    const again = await send(state, url, {
      method: "PUT",
      body,
      headers: { ...student, "if-none-match": "*" },
    });
    expect(contractProblems("live.document.put", again)).toEqual([]);
    expect(again.json).toEqual({ outcome: "conflict", token });
    const none = await send(state, url, { method: "PUT", body, headers: student });
    expect(none.status).toBe(428);
    const teacher = await signIn(state, "nastavnik");
    const read = await send(state, url, { headers: teacher });
    const etag = String(read.headers.etag);
    const unchanged = await send(state, url, { headers: { ...teacher, "if-none-match": etag } });
    expect(unchanged.status).toBe(304);
    // Two reads in one five-minute window are one row of the access log.
    expect(state.accessLog.filter((e) => e.surface === "live_view")).toHaveLength(1);
  });

  it("keeps comment threads and hides a deleted comment's text", async () => {
    const state = createState();
    const teacher = await signIn(state, "nastavnik");
    const anchor = {
      nodeId: "0a000000-0000-4000-8000-000000000001",
      quote: "Izmišljeno",
      prefix: "",
      suffix: "",
      startHint: 0,
      endHint: 10,
    };
    const created = await send(state, "/api/v1/comments/create", {
      body: { anchor, body: "Izmišljeni komentar.", documentId: IDS.document },
      headers: teacher,
    });
    expect(created.status).toBe(200);
    const threadId = (created.json as { id: string }).id;
    const student = await signIn(state, "student");
    const reply = await send(state, "/api/v1/comments/reply", {
      body: { body: "Izmišljeni odgovor.", threadId },
      headers: student,
    });
    const replyId = (reply.json as { id: string }).id;
    await send(state, "/api/v1/comments/delete", {
      body: { commentId: replyId },
      headers: student,
    });
    const list = await send(state, "/api/v1/comments/list", {
      body: { documentId: IDS.document },
      headers: teacher,
    });
    expect(contractProblems("collaboration.comments.post", list)).toEqual([]);
    expect(list.json).toMatchObject({
      comments: [
        { authorRole: "teacher", isOwn: true, state: "answered" },
        { authorRole: "student", body: null, position: 1 },
      ],
    });
    const stranger = await send(state, "/api/v1/comments/list", {
      body: { documentId: IDS.document },
      headers: await signIn(state, "student-2"),
    });
    expect(stranger.status).toBe(403);
  });

  it("moves a revision request through its states and answers a stale sequence with 409 conflict", async () => {
    const state = createState();
    const teacher = await signIn(state, "nastavnik");
    const student = await signIn(state, "student");
    const anchor = {
      nodeId: "0a000000-0000-4000-8000-000000000001",
      quote: "Izmišljeno",
      prefix: "",
      suffix: "",
      startHint: 0,
      endHint: 10,
    };
    const created = await send(state, "/api/v1/revision-requests/create", {
      body: {
        anchor,
        documentId: IDS.document,
        instruction: "Izmišljena uputa.",
        requestedRevision: 0,
      },
      headers: teacher,
    });
    expect(created.status).toBe(200);
    const requestId = (created.json as { request_id: string }).request_id;
    const respond = {
      expectedSeq: 1,
      explanation: "Izmišljeno.",
      kind: "done",
      requestId,
      responseRevision: 0,
    };
    expect(
      (await send(state, "/api/v1/revision-requests/respond", { body: respond, headers: student }))
        .json,
    ).toMatchObject({
      outcome: "applied",
      state: "responded",
    });
    const stale = await send(state, "/api/v1/revision-requests/withdraw", {
      body: { expectedSeq: 1, requestId },
      headers: teacher,
    });
    expect(contractProblems("collaboration.revision-requests.post", stale)).toEqual([]);
    expect(stale.status).toBe(409);
    const notAllowed = await send(state, "/api/v1/revision-requests/respond", {
      body: { ...respond, expectedSeq: 2 },
      headers: student,
    });
    expect(notAllowed.json).toMatchObject({ error: "not_allowed" });
    const list = await send(state, "/api/v1/revision-requests/list", {
      body: { documentId: IDS.document },
      headers: student,
    });
    expect(contractProblems("collaboration.revision-requests.post", list)).toEqual([]);
  });
});

describe("dev fake server: review findings on #366", () => {
  it("pages the replay at 256 segments", async () => {
    const state = createState();
    const work = state.works[0];
    if (work === undefined) throw new Error("no work");
    work.segments = Array.from({ length: 300 }, (_, i) => `{"izmisljeni":${i}}`);
    const headers = { ...(await signIn(state, "student")), ...EVIDENCE };
    const first = await send(state, "/api/v1/evidence/replay", {
      body: { documentId: IDS.document, from: 0 },
      headers,
    });
    expect(contractProblems("evidence.replay.post", first)).toEqual([]);
    expect(first.json).toMatchObject({ next: 256, segmentCount: 300 });
    expect((first.json as { segments: unknown[] }).segments).toHaveLength(256);
  });

  it("serves the submitted revision in the live view, even without a live snapshot", async () => {
    const state = createState();
    const headers = await signIn(state, "student");
    await commit(state, headers, "izmisljena-1", 0);
    await send(state, "/api/v1/submission", {
      body: { documentId: IDS.document, revision: 1 },
      headers: { ...headers, ...EVIDENCE },
    });
    const live = await send(state, `/api/v1/live/${IDS.document}`, {
      headers: await signIn(state, "nastavnik"),
    });
    expect(live.status).toBe(200);
    expect(live.headers["ductus-live-state"]).toBe("submitted");
    expect(live.json).toEqual(JSON.parse(Buffer.from(EMPTY_DOCUMENT, "base64").toString("utf8")));
  });

  it("writes receipt instants with six fraction digits after a version with an offset", async () => {
    const state = createState();
    const assignment = state.assignments[0];
    if (assignment === undefined) throw new Error("no assignment");
    assignment.content.dueAt = "2027-01-31T23:59:00+01:00";
    const headers = await signIn(state, "student");
    await commit(state, headers, "izmisljena-1", 0);
    const submitted = await send(state, "/api/v1/submission", {
      body: { documentId: IDS.document, revision: 1 },
      headers: { ...headers, ...EVIDENCE },
    });
    expect(contractProblems("submission.submit.post", submitted)).toEqual([]);
    expect(submitted.json).toMatchObject({
      receipt: { payload: { dueAt: "2027-01-31T22:59:00.000000Z" } },
    });
  });

  it("refuses a body of another action with 422 and changes nothing", async () => {
    const state = createState();
    const teacher = await signIn(state, "nastavnik");
    const comment = await send(state, "/api/v1/comments/create", {
      body: { documentId: IDS.document },
      headers: teacher,
    });
    expect([comment.status, comment.json]).toMatchObject([422, { error: "invalid_input" }]);
    const request = await send(state, "/api/v1/revision-requests/create", {
      body: { documentId: IDS.document },
      headers: teacher,
    });
    expect(request.status).toBe(422);
    expect(state.comments).toHaveLength(0);
    expect(state.revisionRequests).toHaveLength(0);
  });
});
