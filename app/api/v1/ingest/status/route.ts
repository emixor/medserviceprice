/**
 * GET /api/v1/ingest/status
 * -------------------------------------------------------------
 * Returns recent ingestion jobs + live worker status. The frontend polls
 * this every 2-3s when the admin "Background Scraper" panel is open to
 * render the job queue + progress without blocking.
 *
 * Query params:
 *   limit  number of recent jobs to return. Default 10, max 50.
 *
 * Response:
 *   {
 *     worker: { state, currentJobId, queueDepth, registeredScrapers, uptimeMs },
 *     jobs:   IngestionJob[],   // most-recent first, limited
 *     total:  number
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkerStatus } from "@/lib/scraper/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeParseArr(s: string | null): unknown[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
    : 10;

  const [jobs, worker] = await Promise.all([
    db.ingestionJob.findMany({
      orderBy: { queuedAt: "desc" },
      take: limit,
    }),
    Promise.resolve(getWorkerStatus()),
  ]);

  return NextResponse.json({
    worker,
    jobs: jobs.map((j) => ({
      jobId: j.jobId,
      status: j.status,
      triggeredBy: j.triggeredBy,
      sourcesTotal: j.sourcesTotal,
      sourcesDone: j.sourcesDone,
      sourcesFailed: j.sourcesFailed,
      rowsFetched: j.rowsFetched,
      rowsNormalized: j.rowsNormalized,
      rowsUnmatched: j.rowsUnmatched,
      errorMessage: j.errorMessage,
      sources: safeParseArr(j.sourcesJson),
      queuedAt: j.queuedAt.toISOString(),
      startedAt: j.startedAt?.toISOString() ?? null,
      finishedAt: j.finishedAt?.toISOString() ?? null,
      durationMs: j.durationMs,
    })),
    total: jobs.length,
  });
}
