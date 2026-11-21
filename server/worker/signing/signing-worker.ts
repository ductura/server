// The worker that signs pending receipts (SRV-1502, plan M3.2, B-9, D-210).
// A deferred commit (protocol 2, `202 pending_signature`) leaves a receipt v2
// without a signature; this worker signs it through the signing port it is
// handed (D-92) and stores the signature through the worker's own store.
// Every piece already exists in `database` and `evidence`; this file only
// puts them together and runs them in passes:
//
// - the passes after start sweep every pending receipt, however young, until
//   one has attempted the whole backlog, so receipts left by a worker that
//   died mid-signature are recovered at once (the recovery passes);
// - later passes run every `intervalMs` and leave receipts younger than
//   `graceMs` to the next pass;
// - one structured log line per pass carries the counts, the number of
//   receipts still in `pending_signature` among them, and never an id or a
//   receipt text.
//
// A signature over the same receipt is the same bytes on every attempt
// (Ed25519 is deterministic and the signing input is fixed by the stored
// text), and the store keeps the first signature it receives
// (`already_signed` for every later one), so a pass repeated after a crash
// never makes a second, different receipt. The worker holds no key: the
// signer is a port the caller passes in, a fake in every test.
import type {
  PendingReceiptObjectSource,
  PendingReceiptQueue,
  PendingReceiptStore,
  ReceiptSigner,
} from "../../database/index.ts";
import {
  createCheckPendingReceiptObject,
  createReconcilePendingReceipts,
  createSignPendingReceipt,
  MAX_RECONCILE_BATCH,
  MAX_RECONCILE_DOMAINS,
  MAX_RECONCILE_GRACE_MS,
  type ReconcileSummary,
} from "../../evidence/index.ts";
import type {
  EvidencePayloadLocator,
  EvidencePayloadPresence,
} from "../../external/storage/index.ts";
import type { LogEvent } from "../../log/index.ts";

/** The event of the one log line each pass writes. */
export const RECEIPT_SIGNING_PASS_EVENT = "worker.receipt_signing.pass";
/** The event written when a pass could not run at all. */
export const RECEIPT_SIGNING_FAILED_EVENT = "worker.receipt_signing.pass_failed";

export const MAX_RECEIPT_SIGNING_INTERVAL_MS = 3_600_000;
/** The upper bound of `signTimeoutMs`, as the signing step itself checks it. */
export const MAX_RECEIPT_SIGN_TIMEOUT_MS = 60_000;

export type ReceiptSigningConfig = {
  /** Pause between the end of one pass and the start of the next. */
  intervalMs: number;
  /** Receipts younger than this wait for a later pass; the recovery pass ignores it. */
  graceMs: number;
  batchLimit: number;
  maxDomains: number;
  signTimeoutMs: number;
};

export const DEFAULT_RECEIPT_SIGNING_CONFIG: Readonly<ReceiptSigningConfig> = Object.freeze({
  intervalMs: 5_000,
  graceMs: 0,
  batchLimit: MAX_RECONCILE_BATCH,
  maxDomains: 100,
  signTimeoutMs: 10_000,
});

export type ReceiptSigningTimers = {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type ReceiptSigningWorkerDeps = {
  /** The worker's read of the pending receipts (`createPendingReceiptQueue`). */
  queue: PendingReceiptQueue;
  /** The worker's key read and attach (`createPendingReceiptStore`). */
  store: PendingReceiptStore;
  /** The segment object a receipt names (`createPendingReceiptObjectSource`). */
  objects: PendingReceiptObjectSource;
  locator: EvidencePayloadLocator;
  presence: EvidencePayloadPresence;
  /** The signing port (D-92); the only place a signature comes from. */
  signer: ReceiptSigner;
  log: LogEvent;
  now?: () => number;
  timers?: ReceiptSigningTimers;
  config?: Partial<ReceiptSigningConfig>;
};

export type ReceiptSigningPass = {
  /** True until a pass has attempted the whole backlog read after start: every pending receipt is due. */
  recovery: boolean;
  summary: ReconcileSummary;
};

export type ReceiptSigningWorker = {
  /** One pass now; a pass already running is joined, never run twice at once. */
  runPass(): Promise<ReceiptSigningPass | null>;
  /** The recovery pass now, then a pass every `intervalMs` until `stop`. */
  start(): void;
  /** No pass is started after this; resolves once the running pass has ended. */
  stop(): Promise<void>;
};

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

function checkedConfig(given: Partial<ReceiptSigningConfig> | undefined): ReceiptSigningConfig {
  const config = { ...DEFAULT_RECEIPT_SIGNING_CONFIG, ...given };
  if (
    !inRange(config.intervalMs, 1, MAX_RECEIPT_SIGNING_INTERVAL_MS) ||
    !inRange(config.graceMs, 0, MAX_RECONCILE_GRACE_MS) ||
    !inRange(config.batchLimit, 1, MAX_RECONCILE_BATCH) ||
    !inRange(config.maxDomains, 1, MAX_RECONCILE_DOMAINS) ||
    !inRange(config.signTimeoutMs, 1, MAX_RECEIPT_SIGN_TIMEOUT_MS)
  ) {
    throw new RangeError("receiptSigningWorker: invalid config");
  }
  return config;
}

const DEFAULT_TIMERS: ReceiptSigningTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The fields of the pass's log line: counts only. `pendingReceipts` is the
 * metric of receipts in `pending_signature` when the pass read the backlog,
 * and `oldestPendingAgeMs` how long the oldest of them has waited. No key
 * name here contains a word the log redacts (server/log/redact.ts).
 */
export function passFields(pass: ReceiptSigningPass): Record<string, unknown> {
  const { summary } = pass;
  const r = summary.receipts;
  const d = summary.domains;
  return {
    recovery: pass.recovery,
    status: summary.status,
    stoppedAt: summary.stoppedAt ?? null,
    pendingReceipts: summary.pendingTotal,
    oldestPendingAgeMs: summary.oldestPendingAgeMs,
    signed: r.signed,
    alreadySigned: r.alreadySigned,
    refused: r.refused,
    held: r.held,
    signerRejected: r.signerRejected,
    unavailable: r.unavailable,
    malformed: r.malformed,
    domainsSwept: d.swept,
    domainsFresh: d.fresh,
    domainsDeferred: d.deferred,
    domainsUnavailable: d.unavailable,
    domainsMalformed: d.malformed,
  };
}

function levelOf(summary: ReconcileSummary): "info" | "warn" {
  const r = summary.receipts;
  const healthy =
    summary.status === "completed" &&
    r.unavailable === 0 &&
    r.signerRejected === 0 &&
    r.malformed === 0 &&
    summary.domains.unavailable === 0 &&
    summary.domains.malformed === 0;
  return healthy ? "info" : "warn";
}

/**
 * Whether a recovery pass attempted the whole backlog it read: it ran to the
 * end, no domain was deferred, unavailable or malformed, and fewer receipts
 * were attempted than one batch, so no domain's read was cut at the batch
 * limit. Until then every pass stays a recovery pass (grace 0, the same
 * cursors), so a receipt left by a crashed worker never waits for the grace
 * period. A backlog that never fits this test keeps grace 0, which is only
 * the default configuration.
 */
function recoveryComplete(summary: ReconcileSummary, batchLimit: number): boolean {
  const r = summary.receipts;
  const attempted =
    r.signed +
    r.alreadySigned +
    r.refused +
    r.held +
    r.signerRejected +
    r.unavailable +
    r.malformed;
  const d = summary.domains;
  return (
    summary.status === "completed" &&
    d.deferred === 0 &&
    d.unavailable === 0 &&
    d.malformed === 0 &&
    attempted < batchLimit
  );
}

/**
 * The receipt signing worker over the worker's own ports (D-71, D-102): the
 * web process never builds it. The signature is stored only after it passes
 * the verifier with a receipt key of the payload's own domain, and only once
 * the segment object it names is in the payload store (DAN-301).
 */
export function createReceiptSigningWorker(deps: ReceiptSigningWorkerDeps): ReceiptSigningWorker {
  const { queue, store, objects, locator, presence, signer, log } = deps;
  if (typeof log !== "function") throw new TypeError("receiptSigningWorker: log is required");
  if (typeof signer?.sign !== "function") {
    throw new TypeError("receiptSigningWorker: signer is required");
  }
  const config = checkedConfig(deps.config);
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? DEFAULT_TIMERS;

  const checkObject = createCheckPendingReceiptObject({ source: objects, locator, presence });
  const signPendingReceipt = createSignPendingReceipt({
    signer,
    store,
    checkObject,
    signTimeoutMs: config.signTimeoutMs,
  });
  const limits = { batchLimit: config.batchLimit, maxDomains: config.maxDomains };
  const recover = createReconcilePendingReceipts({
    queue,
    signPendingReceipt,
    now,
    graceMs: 0,
    ...limits,
  });
  const steady = createReconcilePendingReceipts({
    queue,
    signPendingReceipt,
    now,
    graceMs: config.graceMs,
    ...limits,
  });

  let recovered = false;
  let running: Promise<ReceiptSigningPass | null> | null = null;
  let timer: unknown = null;
  let started = false;
  let stopped = false;

  async function pass(): Promise<ReceiptSigningPass | null> {
    const recovery = !recovered;
    try {
      const summary = await (recovery ? recover() : steady());
      if (recovery && recoveryComplete(summary, config.batchLimit)) recovered = true;
      const done: ReceiptSigningPass = { recovery, summary };
      log(levelOf(summary), RECEIPT_SIGNING_PASS_EVENT, passFields(done));
      return done;
    } catch {
      // The sweep answers values; this is only for a programming error.
      log("error", RECEIPT_SIGNING_FAILED_EVENT, { recovery });
      return null;
    }
  }

  function runPass(): Promise<ReceiptSigningPass | null> {
    if (running === null) {
      running = pass().finally(() => {
        running = null;
      });
    }
    return running;
  }

  function schedule(ms: number): void {
    if (stopped) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (stopped) return;
      void runPass().then(() => schedule(config.intervalMs));
    }, ms);
  }

  return {
    runPass,
    start() {
      if (started || stopped) return;
      started = true;
      schedule(0);
    },
    async stop() {
      stopped = true;
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      if (running !== null) await running;
    },
  };
}
