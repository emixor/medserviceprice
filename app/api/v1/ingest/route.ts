/**
 * POST /api/v1/ingest
 * Triggers a full ingestion cycle (re-scrape all sources) without reseeding
 * the services directory. Used by the admin "Re-run ingestion" button and by
 * the scheduled cron job.
 *
 * Body: { forceOneFailure?: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { runIngestion } from "@/lib/scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { forceOneFailure?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty */
  }
  const report = await runIngestion({ forceOneFailure: body.forceOneFailure ?? false });
  return NextResponse.json(report);
}
