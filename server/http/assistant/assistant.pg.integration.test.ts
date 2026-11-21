// The AI assistant proxy (SRV-1204) as the real caller of the real RPCs
// (migration 20261122110000) on PostgreSQL, through the synthetic adapter:
// the last row of "Testovi prije koda" in Ductus docs/contracts/ai-request-v1.md.
// The fixture institution of db/main/tests (Ana and Dora students of Z1,
// whose version 2 allows only proofreading); the cost configuration is
// published as the administrator and the operator do it. One rollback-only
// transaction; the test database puts each statement under a savepoint, so a
// refusal does not end it. Every person, text, provider and model is invented (S4).
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { createTestDatabase } from "../../../test-support/database/index.ts";
import { createAssistantRequests, type WithActor } from "../../database/index.ts";
import { createSyntheticAssistant } from "../../external/assistant/index.ts";
import { createDatabases, createLayers, startServer } from "../index.ts";

import {
  assignmentRulesFrom,
  createAssistantRoutes,
  parseAssistantProviderConfig,
} from "./index.ts";

const FIXTURES = new URL("../../../db/main/tests/fixtures/", import.meta.url);
const institution = readFileSync(new URL("institution.inc", FIXTURES), "utf8");
const ORIGIN = "https://ductura.example.invalid";
const ANA = "D".repeat(43);
const DORA = "E".repeat(43);

it("runs begin, mark_sent, the port and the settlement on the real RPCs", async () => {
  const db = await createTestDatabase("main", { authority: true });
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await db.exec(institution);
    const id = async (name: string) =>
      (await db.query<{ id: string }>("SELECT pg_temp.id($1)::text AS id", [name])).rows[0]!.id;
    const z1 = await id("z1");
    // The administrator's limits and reservation, then the operator's caps.
    expect(
      (
        await db.query<{ v: string }>(
          "SELECT pg_temp.ask('iva', 'SELECT outcome FROM assistant.publish_cost_config(0, 30, 30, 7)') AS v",
        )
      ).rows[0]!.v,
    ).toBe("published");
    await db.exec(
      "SELECT assistant.publish_cost_cap(pg_temp.id('fak_a'), 1, 100, 'day', 'Zahtjev 1/2026')",
    );
    await db.exec("SELECT assistant.publish_cost_cap(NULL, 0, 1000000, 'month', 'Zahtjev 2/2026')");

    // The test database runs every statement under its own savepoint, so a
    // refusal of an RPC leaves the transaction usable; the role is reset either way.
    const withActor: WithActor = async (token, run) => {
      await db.query("SELECT set_config('app.session_token', $1, true)", [token]);
      await db.exec("SET LOCAL ROLE ductus_app");
      try {
        return await run({
          async query<Row>(text: string, values?: readonly unknown[]) {
            const { rows } = await db.query<Row>(text, [...(values ?? [])]);
            return { rows, rowCount: rows.length };
          },
        });
      } finally {
        await db.exec("RESET ROLE");
      }
    };
    const config = parseAssistantProviderConfig({
      configVersion: "test-1",
      provider: {
        providerId: "provider-test-a",
        modelId: "model-test-1",
        headquarters: "HR",
        modelDeveloperHeadquarters: "HR",
        processingCountries: ["HR"],
      },
    });
    if (!config.ok) throw new Error("test configuration not loaded");
    const port = createSyntheticAssistant([
      { branch: "success", actualMicro: 5n, text: "Izmišljeni odgovor o zarezima." },
      { branch: "provider_error", actualMicro: 2n },
      { branch: "timeout" },
      { branch: "success", actualMicro: 7n },
      { branch: "success", actualMicro: 7n },
    ]);
    running = await startServer({
      host: "127.0.0.1",
      port: 0,
      databases: createDatabases(),
      layers: createLayers({ expectedOrigin: ORIGIN }),
      routes: createAssistantRoutes({
        requests: createAssistantRequests(withActor),
        rules: assignmentRulesFrom(withActor),
        provider: { config: config.config, port },
      }),
    });
    const base = `http://127.0.0.1:${running.port}`;
    const ask = async (
      token: string,
      key: string,
      fields: Partial<Record<string, unknown>> = {},
    ): Promise<Record<string, unknown>> => {
      const got = await fetch(`${base}/api/v1/student/assistant/requests`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          cookie: `__Host-ductus_session=${token}`,
          "idempotency-key": key,
        },
        body: JSON.stringify({
          assignmentId: z1,
          conversationId: null,
          purposeCatalogVersion: 1,
          purposeKey: "proofreading",
          paragraph: "Izmišljeni odlomak o mlinovima.",
          ...fields,
        }),
      });
      expect(got.status).toBe(200);
      return (await got.json()) as Record<string, unknown>;
    };
    const key = (n: number) => `00000000-0000-4000-8000-000001204${String(n).padStart(3, "0")}`;
    const stateOf = async (requestId: unknown) =>
      (
        await db.query<{ state: string; ledger: string | null }>(
          `SELECT r.state, l.state || ':' || l.reserved_micro || ':' || coalesce(l.actual_micro::text, '-') AS ledger
             FROM assistant.request r LEFT JOIN assistant.cost_ledger l ON l.request_id = r.id WHERE r.id = $1`,
          [requestId],
        )
      ).rows[0];

    // completed: the response stored as the next message, settled at the actual cost.
    const done = await ask(ANA, key(1));
    expect(done["outcome"]).toBe("completed");
    expect(done["response"]).toMatchObject({ text: "Izmišljeni odgovor o zarezima." });
    expect(await stateOf(done["requestId"])).toEqual({ state: "completed", ledger: "settled:7:5" });
    // The same key again: the same answer, no second reservation or call (R4).
    expect(await ask(ANA, key(1))).toEqual(done);
    expect(port.calls).toHaveLength(1);
    // The owner reads the conversation; Dora does not (G1).
    const conversation = done["conversationId"] as string;
    const read = await fetch(`${base}/api/v1/student/assistant/conversations/${conversation}`, {
      headers: { cookie: `__Host-ductus_session=${ANA}` },
    });
    expect(read.status).toBe(200);
    expect(
      ((await read.json()) as { messages: { seq: number; role: string }[] }).messages.map((m) => [
        m.seq,
        m.role,
      ]),
    ).toEqual([
      [1, "student_paragraph"],
      [2, "provider_response"],
    ]);
    const foreign = await fetch(`${base}/api/v1/student/assistant/conversations/${conversation}`, {
      headers: { cookie: `__Host-ductus_session=${DORA}` },
    });
    expect(foreign.status).toBe(404);
    // Dora cannot continue Ana's conversation: forbidden, no row, no call.
    expect(await ask(DORA, key(2), { conversationId: conversation })).toEqual({
      outcome: "forbidden",
      requestId: null,
      conversationId: null,
    });
    // A purpose version 2 of Z1 does not allow: rejected by the database, no call.
    expect((await ask(ANA, key(3), { purposeKey: "formatting" }))["outcome"]).toBe(
      "purpose_not_allowed",
    );
    expect(port.calls).toHaveLength(1);

    // provider_failed, settled at the reported cost.
    const failed = await ask(ANA, key(4), {
      paragraph: "Drugi izmišljeni odlomak.",
      conversationId: conversation,
    });
    expect(failed["outcome"]).toBe("provider_failed");
    expect(await stateOf(failed["requestId"])).toEqual({
      state: "provider_failed",
      ledger: "settled:7:2",
    });
    // A timeout: outcome_unknown, the reservation stays until the worker settles it.
    const unknown = await ask(ANA, key(5), { paragraph: "Treći izmišljeni odlomak." });
    expect(unknown["outcome"]).toBe("request_outcome_unknown");
    expect(await stateOf(unknown["requestId"])).toEqual({
      state: "outcome_unknown",
      ledger: "reserved:7:-",
    });
    // Used so far 5 + 2 + 7 = 14 of 30: two more reservations of 7 fit, the third not.
    expect((await ask(ANA, key(6), { paragraph: "Četvrti izmišljeni odlomak." }))["outcome"]).toBe(
      "completed",
    );
    expect((await ask(ANA, key(7), { paragraph: "Peti izmišljeni odlomak." }))["outcome"]).toBe(
      "completed",
    );
    // 28 of 30: the next reservation of 7 is over the student's day limit (T1).
    expect((await ask(ANA, key(8), { paragraph: "Šesti izmišljeni odlomak." }))["outcome"]).toBe(
      "budget_exceeded",
    );
    expect(port.calls).toHaveLength(5);

    // What reached the port: five fields, no id of a person, an assignment or a request.
    const seen = JSON.stringify(port.calls);
    for (const secret of [await id("ana"), await id("fak_a"), z1, conversation, ANA, key(1)]) {
      expect(seen, secret).not.toContain(secret);
    }
    for (const call of port.calls) {
      expect(Object.keys(call).sort()).toEqual([
        "instructions",
        "maxResponseCodePoints",
        "modelId",
        "paragraph",
        "purposeKey",
      ]);
      expect(call.modelId).toBe("model-test-1");
    }
  } finally {
    await running?.close();
    await db.close();
  }
});
