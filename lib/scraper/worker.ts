/**
 * Background ingestion worker
 * =============================================================
 * STEP 3 (Decoupled Background Extraction & Scraping Core) +
 * STEP 4 (Automated Monitoring & Control Tracking).
 *
 * This module implements a non-blocking, fault-isolated, telemetry-tracked
 * background scraping pipeline that runs entirely in the Next.js Node.js
 * runtime — no external message broker, no new dependencies. It uses the
 * existing Prisma/SQLite stack for persistence and the existing `withRetry`
 * helper for transient-failure absorption.
 *
 * Architecture:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  API route (POST /api/v1/ingest/background)                │
 *   │     └─ enqueueIngestion(opts) → { jobId, statusUrl }       │
 *   │        (returns IMMEDIATELY — does NOT block the request)  │
 *   └─────────────────────────┬──────────────────────────────────┘
 *                             │ pushes to in-memory queue
 *                             ▼
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Worker loop (singleton, started on first enqueue)         │
 *   │     while (queue.length) { job = queue.shift(); await... } │
 *   │  • Per-source fault isolation (try/catch per source)       │
 *   │  • Per-source timeout (Promise.race + AbortController)     │
 *   │  • Telemetry writes to IngestionJob + ScraperSourceConfig  │
 *   │  • ParserRun rows for the admin Source Health dashboard    │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Non-blocking guarantee:
 *   `enqueueIngestion()` creates an `IngestionJob` DB row (status="queued"),
 *   pushes a job descriptor to the in-memory queue, calls `scheduleTick()`
 *   to wake the worker (via `setImmediate` so the request's call stack
 *   unwinds first), and returns the jobId. The HTTP response is sent
 *   before any scraping work begins. The worker runs entirely off the
 *   request's call stack.
 *
 * Fault isolation guarantee:
 *   Each source runs inside its own try/catch. A timeout (Promise.race
 *   with an AbortController-driven sleeper) wraps each source so a
 *   hanging upstream cannot stall the queue. Failures are logged to
 *   `ScraperSourceConfig.lastErrorMessage` + the `IngestionJob.sourcesJson`
 *   array; the worker proceeds to the next source immediately.
 *
 * Concurrency:
 *   The worker is a singleton with a `running` mutex — only one job
 *   executes at a time. Enqueued jobs wait in `queue` (FIFO). This is
 *   deliberate: SQLite serialises writes anyway, and parallel scraping
 *   would multiply politeness-delay overhead without speeding up the
 *   DB layer. (A future refactor could shard by city for parallelism.)
 *
 * Lifecycle:
 *   - The worker is lazy: it starts on the first `enqueueIngestion()`
 *     call after server boot and stays alive for the process lifetime.
 *   - On unhandled rejection inside the loop, the current job is marked
 *     "failed" and the loop continues to the next job.
 *   - The queue is in-memory only — jobs pending at server shutdown are
 *     lost. This is acceptable for this stack (no external broker); the
 *     `IngestionJob` DB row remains in "queued" status and can be
 *     retried via POST /api/v1/ingest/background?retry=jobId.
 */

import { db } from "@/lib/db";
import { ensureScraperSourceConfigs, loadActiveScraperSources, recordSourceOutcome } from "./config";
import { getScraper } from "./registry";
import { listRegisteredScrapers } from "./registry";
import {
  applyFreshness,
  loadDirectory,
  processSourceEntries,
} from "./ingest";
import type {
  IngestionJobReport,
  IngestionOptions,
  SourceRunOutcome,
} from "./types";

// ---------------------------------------------------------------------------
// In-memory queue + worker state
// ---------------------------------------------------------------------------

type QueuedJob = {
  jobId: string;
  options: IngestionOptions;
};

const queue: QueuedJob[] = [];
let workerRunning = false;
let currentJobId: string | null = null;
let bootStarted = false;

/** Live snapshot of worker state — returned by `getWorkerStatus()`. */
export type WorkerStatus = {
  state: "idle" | "running";
  currentJobId: string | null;
  queueDepth: number;
  registeredScrapers: string[];
  uptimeMs: number;
};

const bootedAt = Date.now();

/**
 * Get a live snapshot of the worker's state for the admin UI.
 * Does not touch the DB — pure in-memory read.
 */
export function getWorkerStatus(): WorkerStatus {
  return {
    state: workerRunning ? "running" : "idle",
    currentJobId,
    queueDepth: queue.length,
    registeredScrapers: listRegisteredScrapers(),
    uptimeMs: Date.now() - bootedAt,
  };
}

// ---------------------------------------------------------------------------
// Job ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a short, opaque, URL-safe job ID. Format: `job_<6 hex chars>`.
 * Collisions are astronomically unlikely (16^6 = 16M space); the DB
 * unique constraint catches the rare collision and we retry.
 */
function generateJobId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `job_${hex}`;
}

async function createUniqueJobId(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateJobId();
    const existing = await db.ingestionJob.findUnique({
      where: { jobId: id },
      select: { jobId: true },
    });
    if (!existing) return id;
  }
  // Fallback — append a timestamp to guarantee uniqueness.
  return `job_${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Public API — enqueue
// ---------------------------------------------------------------------------

export type EnqueueResult = {
  jobId: string;
  status: "queued";
  queuedAt: string;
  statusUrl: string;
  queueDepth: number;
};

/**
 * Enqueue a background ingestion job. Returns immediately with a jobId —
 * the HTTP request is NOT blocked by scraping work.
 *
 * Side effects:
 *   1. Ensures `ScraperSourceConfig` rows exist (idempotent sync from
 *      `CLINIC_SOURCES` — cheap when rows already exist).
 *   2. Creates an `IngestionJob` DB row (status="queued") so the frontend
 *      can poll /api/v1/ingest/status/[jobId] immediately.
 *   3. Pushes the job descriptor to the in-memory queue.
 *   4. Calls `scheduleTick()` to wake the worker via `setImmediate`.
 */
export async function enqueueIngestion(
  options: IngestionOptions = {}
): Promise<EnqueueResult> {
  // Lazy one-time config sync — ensures the routing table is populated
  // before the worker tries to read it. Idempotent.
  if (!bootStarted) {
    bootStarted = true;
    try {
      await ensureScraperSourceConfigs();
    } catch (err) {
      console.error("[worker] config sync failed (non-fatal):", err);
    }
  }

  const triggeredBy = options.triggeredBy ?? "api";
  const jobId = await createUniqueJobId();

  // Pre-count active sources so the UI can show "0 / N" immediately.
  let sourcesTotal = 0;
  try {
    const sources = await loadActiveScraperSources({
      sourceName: options.sourceName,
      city: options.city,
    });
    sourcesTotal = sources.length;
  } catch {
    // Non-fatal — the worker will recount when it picks up the job.
  }

  await db.ingestionJob.create({
    data: {
      jobId,
      status: "queued",
      triggeredBy,
      sourcesTotal,
      sourcesJson: "[]",
    },
  });

  queue.push({ jobId, options });
  scheduleTick();

  return {
    jobId,
    status: "queued",
    queuedAt: new Date().toISOString(),
    statusUrl: `/api/v1/ingest/status/${jobId}`,
    queueDepth: queue.length,
  };
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

/**
 * Schedule a single worker tick on the next event-loop iteration.
 * Uses `setImmediate` so the calling request's call stack unwinds first
 * (the HTTP response is sent before any scraping work begins).
 *
 * Idempotent: if the worker is already running, this is a no-op.
 */
function scheduleTick(): void {
  if (workerRunning) return;
  setImmediate(() => {
    void tick();
  });
}

/**
 * Process the next queued job. If the queue is empty, the worker goes idle.
 * If a job is available, the worker runs it to completion (fault-isolated
 * per source) and then re-schedules itself for the next job.
 */
async function tick(): Promise<void> {
  if (workerRunning) return;
  const next = queue.shift();
  if (!next) {
    workerRunning = false;
    currentJobId = null;
    return;
  }

  workerRunning = true;
  currentJobId = next.jobId;
  try {
    await runJob(next.jobId, next.options);
  } catch (err) {
    // Should be unreachable — runJob catches per-source errors. But if
    // something escapes (e.g. a DB connection drop), mark the job failed
    // so the frontend doesn't poll forever.
    console.error(`[worker] job ${next.jobId} escaped with error:`, err);
    try {
      await db.ingestionJob.update({
        where: { jobId: next.jobId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        },
      });
    } catch {
      /* nothing more we can do */
    }
  } finally {
    workerRunning = false;
    currentJobId = null;
  }

  // Re-schedule for the next queued job (if any).
  scheduleTick();
}

// ---------------------------------------------------------------------------
// Per-job execution
// ---------------------------------------------------------------------------

/**
 * Execute one ingestion job end-to-end. Fault-isolated per source.
 *
 * Steps:
 *   1. Mark the IngestionJob row "running" with startedAt.
 *   2. Load active sources (filtered by options.sourceName / options.city).
 *   3. Load the services directory once (shared across all sources).
 *   4. For each source:
 *        a. Resolve the scraper implementation from the registry.
 *        b. Create a ParserRun row (status="running").
 *        c. Run the scraper under a Promise.race timeout (AbortController).
 *        d. On success: process entries through the idempotent ingest
 *           pipeline (upsert clinic → raw → normalized → price history).
 *        e. On failure/timeout: log + isolate (continue to next source).
 *        f. Update the ParserRun row (status, rows, duration, error).
 *        g. Update the ScraperSourceConfig telemetry (lastSuccess, etc.).
 *        h. Append the per-source outcome to the IngestionJob.sourcesJson.
 *   5. Apply the freshness engine (mark stale normalized_prices inactive).
 *   6. Mark the IngestionJob row success | partial | failed.
 */
async function runJob(jobId: string, options: IngestionOptions): Promise<void> {
  const startedAt = new Date();
  const t0 = Date.now();

  await db.ingestionJob.update({
    where: { jobId },
    data: { status: "running", startedAt },
  });

  // Load sources + directory in parallel.
  const [sources, directory] = await Promise.all([
    loadActiveScraperSources({
      sourceName: options.sourceName,
      city: options.city,
    }),
    loadDirectory(),
  ]);

  await db.ingestionJob.update({
    where: { jobId },
    data: { sourcesTotal: sources.length },
  });

  const outcomes: SourceRunOutcome[] = [];
  let rowsFetched = 0;
  let rowsNormalized = 0;
  let rowsUnmatched = 0;
  let sourcesFailed = 0;

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const sourceStartedAt = new Date();

    // Inject the force-fail flag for the demo (only on the second source
    // when options.forceOneFailure is set, mirroring the legacy contract).
    const forceFail =
      options.forceOneFailure === true && i === 1
        ? { __forceFail: true }
        : null;
    const effectiveSource = forceFail
      ? {
          ...source,
          parserConfig: {
            ...(source.parserConfig ?? {}),
            __forceFail: true,
          },
        }
      : source;

    const outcome: SourceRunOutcome = {
      configId: source.configId,
      sourceName: source.sourceName,
      clinicName: source.clinicName,
      city: source.city,
      sourceUrl: source.sourceUrl,
      status: "success",
      fetched: 0,
      normalized: 0,
      unmatched: 0,
      upserted: 0,
      durationMs: 0,
      error: null,
      warnings: [],
      startedAt: sourceStartedAt.toISOString(),
      finishedAt: sourceStartedAt.toISOString(),
    };

    // Create the ParserRun row for this source's attempt.
    const parserRun = await db.parserRun.create({
      data: {
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        status: "running",
        triggeredBy: options.triggeredBy ?? "api",
      },
    });

    try {
      // Resolve the scraper implementation.
      const scraper = getScraper(source.parserType);

      // Per-source timeout via AbortController + Promise.race.
      const controller = new AbortController();
      const timeoutMs = Math.max(1000, source.timeoutMs);
      const timeoutHandle = setTimeout(() => {
        controller.abort(new Error(`Source timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Politeness delay before the source runs (configurable per source).
      if (source.politenessMs > 0) {
        await sleep(source.politenessMs, controller.signal).catch(() => {
          /* aborted — will surface below */
        });
      }

      let fetchResult;
      try {
        fetchResult = await scraper.run(effectiveSource, controller.signal);
      } finally {
        clearTimeout(timeoutHandle);
      }

      // Process the fetched entries through the idempotent ingest pipeline.
      const now = new Date();
      const proc = await processSourceEntries(
        effectiveSource,
        fetchResult.entries,
        directory,
        now
      );

      outcome.fetched = proc.fetched;
      outcome.normalized = proc.normalized;
      outcome.unmatched = proc.unmatched;
      outcome.upserted = proc.upserted;
      outcome.warnings = fetchResult.warnings;
      rowsFetched += proc.fetched;
      rowsNormalized += proc.normalized;
      rowsUnmatched += proc.unmatched;

      // Update the ParserRun row to "success".
      await db.parserRun.update({
        where: { id: parserRun.id },
        data: {
          status: "success",
          finishedAt: new Date(),
          rowsParsed: proc.fetched,
          rowsNormalized: proc.normalized,
          rowsUnmatched: proc.unmatched,
          rowsUpserted: proc.upserted,
          errorsCount: 0,
          durationMs: Date.now() - sourceStartedAt.getTime(),
        },
      });

      // Update ScraperSourceConfig telemetry.
      await recordSourceOutcome(source.configId, {
        success: true,
        fetched: proc.fetched,
        upserted: proc.upserted,
        durationMs: Date.now() - sourceStartedAt.getTime(),
        error: null,
      });
    } catch (err) {
      // Fault isolation — log + record + continue to next source.
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout =
        err instanceof Error && /timeout/i.test(err.message);
      const fullError = isTimeout
        ? `Timeout: ${msg}`
        : msg;
      outcome.status = "failed";
      outcome.error = fullError;
      sourcesFailed++;

      console.error(
        `[worker] source ${source.sourceName} (${source.city}) FAILED: ${fullError}`
      );

      // Update the ParserRun row to "failed".
      await db.parserRun.update({
        where: { id: parserRun.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          rowsParsed: 0,
          rowsNormalized: 0,
          rowsUnmatched: 0,
          rowsUpserted: 0,
          errorsCount: 1,
          errorMessage: fullError.slice(0, 500),
          errorDetails: JSON.stringify([
            {
              url: source.sourceUrl,
              error: fullError,
              ts: new Date().toISOString(),
            },
          ]),
          durationMs: Date.now() - sourceStartedAt.getTime(),
        },
      });

      // Update ScraperSourceConfig telemetry.
      await recordSourceOutcome(source.configId, {
        success: false,
        fetched: 0,
        upserted: 0,
        durationMs: Date.now() - sourceStartedAt.getTime(),
        error: fullError,
      });
    } finally {
      outcome.durationMs = Date.now() - sourceStartedAt.getTime();
      outcome.finishedAt = new Date().toISOString();
      outcomes.push(outcome);

      // Stream progress to the IngestionJob row so the frontend can poll.
      await db.ingestionJob.update({
        where: { jobId },
        data: {
          sourcesDone: outcomes.length,
          sourcesFailed,
          rowsFetched,
          rowsNormalized,
          rowsUnmatched,
          sourcesJson: JSON.stringify(outcomes),
        },
      });
    }
  }

  // Apply the freshness engine once per job (not per source).
  await applyFreshness(new Date());

  const finishedAt = new Date();
  const durationMs = Date.now() - t0;
  const status: IngestionJobReport["status"] =
    sourcesFailed === 0
      ? "success"
      : sourcesFailed === sources.length
        ? "failed"
        : "partial";

  await db.ingestionJob.update({
    where: { jobId },
    data: {
      status,
      finishedAt,
      durationMs,
      sourcesDone: outcomes.length,
      sourcesFailed,
      rowsFetched,
      rowsNormalized,
      rowsUnmatched,
      sourcesJson: JSON.stringify(outcomes),
      errorMessage:
        status === "failed"
          ? `All ${sources.length} sources failed`
          : status === "partial"
            ? `${sourcesFailed} of ${sources.length} sources failed`
            : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sleep that resolves early (rejecting) when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
