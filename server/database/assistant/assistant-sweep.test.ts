// The worker's listing of due assistant requests (SRV-1205) over a scripted
// query: the SQL and bound it sends, the ids it returns, and the closed
// statuses for a bad bound, database errors and rows of an unexpected shape.
// The database itself is covered by db/main/tests/172-assistant-sweep-due.sql
// and tests/db/assistant-sweep.integration.test.ts. Every id is invented.
import { describe, expect, it } from "vitest";

import { SWEEP_DUE_MAX, sweepDue } from "./assistant-sweep.ts";

const A = "7b6c5d4e-3f2a-4b1c-8d9e-0a1b2c3d4e11";
const B = "7b6c5d4e-3f2a-4b1c-8d9e-0a1b2c3d4e12";
const dbError = (code: string) => Object.assign(new Error("izmišljena greška"), { code });

function scripted(rows: Record<string, unknown>[]) {
  const calls: unknown[][] = [];
  const query = async (text: string, values: readonly unknown[]) => {
    calls.push([text, ...values]);
    return { rows };
  };
  return { query, calls };
}

describe("sweepDue", () => {
  it("sends the bound and returns the ids in order, frozen", async () => {
    const run = scripted([{ request_id: A }, { request_id: B }]);
    const answer = await sweepDue(run.query, 10);
    expect(answer).toEqual({ status: "ok", requestIds: [A, B] });
    expect(answer.status === "ok" && Object.isFrozen(answer.requestIds)).toBe(true);
    expect(run.calls).toEqual([
      ["SELECT request_id FROM assistant.sweep_due($1) AS d (request_id)", 10],
    ]);
  });

  it("returns an empty listing", async () => {
    expect(await sweepDue(scripted([]).query, 1)).toEqual({ status: "ok", requestIds: [] });
  });

  it("refuses a bound outside 1 to the maximum without a query", async () => {
    for (const limit of [0, -1, 1.5, SWEEP_DUE_MAX + 1, Number.NaN]) {
      const run = scripted([]);
      expect(await sweepDue(run.query, limit)).toEqual({ status: "invalid" });
      expect(run.calls).toEqual([]);
    }
    expect(await sweepDue(scripted([]).query, SWEEP_DUE_MAX)).toEqual({
      status: "ok",
      requestIds: [],
    });
  });

  it("maps ZD422 to invalid and any other error to unavailable, without the message", async () => {
    const failing = (error: unknown) => async () => {
      throw error;
    };
    expect(await sweepDue(failing(dbError("ZD422")), 5)).toEqual({ status: "invalid" });
    expect(await sweepDue(failing(dbError("42501")), 5)).toEqual({ status: "unavailable" });
    expect(await sweepDue(failing("izmišljeno"), 5)).toEqual({ status: "unavailable" });
    const hostile = new Proxy(
      {},
      {
        has: () => {
          throw new Error("izmišljeno");
        },
      },
    );
    expect(await sweepDue(failing(hostile), 5)).toEqual({ status: "unavailable" });
  });

  it("treats a row of an unexpected shape, a duplicate or too many rows as unavailable", async () => {
    for (const rows of [
      [{ request_id: "nije-uuid" }],
      [{ request_id: A.toUpperCase() }],
      [{ request_id: 7 }],
      [{}],
      [{ request_id: A }, { request_id: A }],
      [{ request_id: A }, { request_id: B }],
    ]) {
      expect(await sweepDue(scripted(rows).query, rows.length === 2 ? 1 : 5)).toMatchObject({
        status: "unavailable",
      });
    }
    expect(await sweepDue(scripted([{ request_id: A }, { request_id: A }]).query, 5)).toMatchObject(
      { status: "unavailable" },
    );
  });
});
