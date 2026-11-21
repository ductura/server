// The worker's sweep job (SRV-1205) over scripted ports: the job definition
// carries only the request id (M10), the handler calls the sweep with that id
// and answers with a closed code, and the scan puts one job per due request.
// The database is covered by db/main/tests/172-assistant-sweep-due.sql and
// tests/db/assistant-sweep.integration.test.ts. Every id is invented.
import { describe, expect, it } from "vitest";

import { isJobDefinition } from "../../domain/index.ts";

import {
  ASSISTANT_SWEEP_JOB,
  ASSISTANT_SWEEP_QUEUE,
  STALE_RESERVED_AFTER_SECONDS,
  STALE_SENT_AFTER_SECONDS,
  SWEEP_SCAN_LIMIT,
  createSweepHandler,
  scanSweepDue,
  type SweepPorts,
} from "./sweep-job.ts";

const A = "7b6c5d4e-3f2a-4b1c-8d9e-0a1b2c3d4e21";
const B = "7b6c5d4e-3f2a-4b1c-8d9e-0a1b2c3d4e22";
const live = () => new AbortController().signal;

function handlerWith(answer: Awaited<ReturnType<SweepPorts["sweepAndSettle"]>> | Error) {
  const calls: string[] = [];
  const handler = createSweepHandler({
    sweepAndSettle: async (requestId) => {
      calls.push(requestId);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  return { handler, calls };
}

describe("the sweep job definition", () => {
  it("is a valid queue whose body is the request id alone (M10)", () => {
    expect(isJobDefinition(ASSISTANT_SWEEP_JOB)).toBe(true);
    expect(ASSISTANT_SWEEP_JOB).toEqual({
      name: "assistant_sweep",
      fields: ["requestId"],
      subject: "requestId",
    });
    expect(Object.isFrozen(ASSISTANT_SWEEP_JOB)).toBe(true);
    expect(Object.isFrozen(ASSISTANT_SWEEP_JOB.fields)).toBe(true);
  });

  it("names its deadlines, and the queue gives the handler less time than the expiry", () => {
    expect(STALE_RESERVED_AFTER_SECONDS).toBe(300);
    expect(STALE_SENT_AFTER_SECONDS).toBe(600);
    expect(SWEEP_SCAN_LIMIT).toBeGreaterThanOrEqual(1);
    expect(SWEEP_SCAN_LIMIT).toBeLessThanOrEqual(1000);
    expect(ASSISTANT_SWEEP_QUEUE.deadlineMs).toBeLessThanOrEqual(
      ASSISTANT_SWEEP_QUEUE.expireSeconds * 1000 - 500,
    );
  });
});

describe("createSweepHandler", () => {
  it("sweeps the job's request and is done whatever state the database answers", async () => {
    for (const state of [
      "rejected",
      "settled",
      "completed",
      "provider_failed",
      "reserved",
      "sent",
    ] as const) {
      const { handler, calls } = handlerWith({ status: "ok", state });
      expect(await handler({ requestId: A }, live())).toEqual({ ok: true });
      expect(calls).toEqual([A]);
    }
  });

  it("refuses an id that does not exist with its own code", async () => {
    const { handler } = handlerWith({ status: "forbidden" });
    expect(await handler({ requestId: A }, live())).toEqual({
      ok: false,
      code: "assistant_request_unknown",
    });
  });

  it("refuses so the queue tries again when the database does not answer", async () => {
    for (const status of ["unavailable", "conflict", "invalid", "unauthenticated"] as const) {
      expect(await handlerWith({ status }).handler({ requestId: A }, live())).toEqual({
        ok: false,
        code: "assistant_sweep_unavailable",
      });
    }
    expect(await handlerWith(new Error("izmišljeno")).handler({ requestId: A }, live())).toEqual({
      ok: false,
      code: "assistant_sweep_unavailable",
    });
  });

  it("checks the body again and calls nothing for one it refuses", async () => {
    const { handler, calls } = handlerWith({ status: "ok", state: "settled" });
    for (const body of [
      {},
      { requestId: "nije-uuid" },
      { requestId: A.toUpperCase() },
      { requestId: A, studentId: B },
      { requestId: A, text: "Izmišljeni odlomak." },
    ]) {
      expect(await handler(body, live())).toEqual({
        ok: false,
        code: "assistant_sweep_body_invalid",
      });
    }
    expect(calls).toEqual([]);
  });

  it("does not start when the queue already asked it to stop", async () => {
    const { handler, calls } = handlerWith({ status: "ok", state: "settled" });
    const stop = new AbortController();
    stop.abort();
    expect(await handler({ requestId: A }, stop.signal)).toEqual({
      ok: false,
      code: "assistant_sweep_aborted",
    });
    expect(calls).toEqual([]);
  });
});

describe("scanSweepDue", () => {
  it("puts one job per due request, its body only the id, and counts the outcomes", async () => {
    const queued: [string, unknown][] = [];
    const answers = ["queued", "duplicate"] as const;
    const limits: number[] = [];
    expect(
      await scanSweepDue({
        sweepDue: async (limit) => {
          limits.push(limit);
          return { status: "ok", requestIds: [A, B] };
        },
        enqueue: async (name, input) => {
          queued.push([name, input]);
          return answers[queued.length - 1]!;
        },
      }),
    ).toEqual({ status: "ok", queued: 1, duplicate: 1, rejected: 0 });
    expect(limits).toEqual([SWEEP_SCAN_LIMIT]);
    expect(queued).toEqual([
      ["assistant_sweep", { requestId: A }],
      ["assistant_sweep", { requestId: B }],
    ]);
  });

  it("passes its own bound and queues nothing when nothing is due", async () => {
    const limits: number[] = [];
    expect(
      await scanSweepDue(
        {
          sweepDue: async (limit) => {
            limits.push(limit);
            return { status: "ok", requestIds: [] };
          },
          enqueue: async () => {
            throw new Error("must not be called");
          },
        },
        7,
      ),
    ).toEqual({ status: "ok", queued: 0, duplicate: 0, rejected: 0 });
    expect(limits).toEqual([7]);
  });

  it("is unavailable when the listing or the queue fails, or the queue answers oddly", async () => {
    const due = async () => ({ status: "ok" as const, requestIds: [A] });
    for (const ports of [
      { sweepDue: async () => ({ status: "unavailable" as const }), enqueue: async () => "queued" },
      { sweepDue: async () => ({ status: "invalid" as const }), enqueue: async () => "queued" },
      {
        sweepDue: async () => {
          throw new Error("izmišljeno");
        },
        enqueue: async () => "queued",
      },
      {
        sweepDue: due,
        enqueue: async () => {
          throw new Error("izmišljeno");
        },
      },
      { sweepDue: due, enqueue: async () => "nešto" },
    ]) {
      expect(await scanSweepDue(ports as never)).toEqual({ status: "unavailable" });
    }
  });
});
