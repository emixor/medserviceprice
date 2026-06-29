/**
 * POST /api/v1/ingest/background
 * -------------------------------------------------------------
 * Non-blocking background ingestion trigger. Enqueues a scraping job and
 * returns IMMEDIATELY with a jobId — the HTTP response is sent before
 * any scraping work begins. The worker runs the job off the request's
 * call stack via `setImmediate`.
 *
 * Body (all optional):
 *   {
 *     "triggeredBy":   "manual" | "schedule" | "api",  // default "api"
 *     "sourceName":    "KDL",                           // restrict to one source
 *     "city":          "Алматы",                        // restrict to one city
 *     "forceOneFailure": true                           // demo fault tolerance
 *   }
 *
 * Response (202 Accepted):
 *   {
 *     "jobId":      "job_a1b2c3",
 *     "status":     "queued",
 *     "queuedAt":   "2025-01-01T00:00:00.000Z",
 *     "statusUrl":  "/api/v1/ingest/status/job_a1b2c3",
 *     "queueDepth": 0
 *   }
 *
 * The frontend polls GET /api/v1/ingest/status/[jobId] every 2-3s to
 * render live progress.
 */
import { NextRequest, NextResponse } from "next/server";
import { enqueueIngestion } from "@/lib/scraper/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: {
    triggeredBy?: "manual" | "schedule" | "api";
    sourceName?: string;
    city?: string;
    forceOneFailure?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }

  // Validate triggeredBy — fall back to "api" on any invalid value.
  const triggeredBy: "manual" | "schedule" | "api" =
    body.triggeredBy === "manual" ||
    body.triggeredBy === "schedule" ||
    body.triggeredBy === "api"
      ? body.triggeredBy
      : "api";

  try {
    const result = await enqueueIngestion({
      triggeredBy,
      sourceName: body.sourceName?.trim() || undefined,
      city: body.city?.trim() || undefined,
      forceOneFailure: body.forceOneFailure === true,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to enqueue ingestion job", detail: msg },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/ingest/background
 * Returns live worker status (idle/running, current job, queue depth,
 * registered scrapers). Does NOT touch the DB for the core fields —
 * pure in-memory read.
 */
export async function GET() {
  // Lazy import to avoid loading the worker module on every cold start
  // of unrelated routes (worker.ts is only needed here + on enqueue).
  const { getWorkerStatus } = await import("@/lib/scraper/worker");
  const status = getWorkerStatus();
  return NextResponse.json(status);
}
