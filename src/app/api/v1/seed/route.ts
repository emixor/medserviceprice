/**
 * POST /api/v1/seed
 * Initializes the services_directory (52 services) and, if requested, runs a
 * full ingestion cycle to populate raw + normalized layers + price history.
 *
 * Body: { runIngestion?: boolean (default true), forceOneFailure?: boolean }
 *
 * GET /api/v1/seed returns current DB row counts.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureServicesDirectory } from "@/lib/seed";
import { runIngestion } from "@/lib/scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [clinics, services, raw, normalized, unmatched, history] = await Promise.all([
    db.clinic.count(),
    db.serviceDirectory.count(),
    db.rawParsedData.count(),
    db.normalizedPrice.count(),
    db.unmatchedQueue.count(),
    db.priceHistory.count(),
  ]);
  return NextResponse.json({
    counts: { clinics, services, raw, normalized, unmatched, history },
    seeded: services > 0,
  });
}

export async function POST(req: NextRequest) {
  let body: { runIngestion?: boolean; forceOneFailure?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }

  const dirResult = await ensureServicesDirectory();

  let ingestReport = null;
  if (body.runIngestion !== false) {
    ingestReport = await runIngestion({ forceOneFailure: body.forceOneFailure ?? false });
  }

  const counts = {
    clinics: await db.clinic.count(),
    services: await db.serviceDirectory.count(),
    raw: await db.rawParsedData.count(),
    normalized: await db.normalizedPrice.count(),
    unmatched: await db.unmatchedQueue.count(),
    history: await db.priceHistory.count(),
  };

  return NextResponse.json({
    directory: dirResult,
    ingestion: ingestReport,
    counts,
  });
}
