/**
 * GET /api/v1/ingest/status/[jobId]
 * -------------------------------------------------------------
 * Returns the full status of one ingestion job, including the per-source
 * outcomes array (live-streamed by the worker as each source completes).
 *
 * Response (200):
 *   {
 *     jobId, status, triggeredBy,
 *     sourcesTotal, sourcesDone, sourcesFailed,
 *     rowsFetched, rowsNormalized, rowsUnmatched,
 *     sources: SourceRunOutcome[],
 *     queuedAt, startedAt, finishedAt, durationMs,
 *     errorMessage
 *   }
 *
 * Response (404): { error: "Job not found" }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = await db.ingestionJob.findUnique({
    where: { jobId },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.jobId,
    status: job.status,
    triggeredBy: job.triggeredBy,
    sourcesTotal: job.sourcesTotal,
    sourcesDone: job.sourcesDone,
    sourcesFailed: job.sourcesFailed,
    rowsFetched: job.rowsFetched,
    rowsNormalized: job.rowsNormalized,
    rowsUnmatched: job.rowsUnmatched,
    errorMessage: job.errorMessage,
    sources: safeParseArr(job.sourcesJson),
    queuedAt: job.queuedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    durationMs: job.durationMs,
  });
}
