/**
 * GET /api/v1/scraper-sources
 * -------------------------------------------------------------
 * Returns the full scraper source routing table (`ScraperSourceConfig`)
 * joined with the static `CLINIC_SOURCES` metadata. The admin "Background
 * Scraper" panel renders this as a table with per-source active toggles,
 * last-success timestamps, error messages, and run counters.
 *
 * Response:
 *   {
 *     sources: ScraperSourceConfigView[],
 *     total:   number,
 *     active:  number,
 *     summary: { totalRuns, totalSuccess, totalFailed, avgSuccessRate }
 *   }
 *
 * POST /api/v1/scraper-sources
 *   Body: { action: "sync" }
 *   Re-runs the idempotent CLINIC_SOURCES → ScraperSourceConfig sync.
 *   Used by the admin "Sync sources" button after deploying new clinic
 *   entries. Returns the sync result.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureScraperSourceConfigs } from "@/lib/scraper/config";
import { listRegisteredScrapers } from "@/lib/scraper/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.scraperSourceConfig.findMany({
    orderBy: [{ sourceName: "asc" }, { city: "asc" }],
  });

  const registeredScrapers = listRegisteredScrapers();

  let totalRuns = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let active = 0;

  const sources = rows.map((r) => {
    totalRuns += r.totalRuns;
    totalSuccess += r.totalSuccess;
    totalFailed += r.totalFailed;
    if (r.isActive) active++;

    return {
      id: r.id,
      sourceName: r.sourceName,
      clinicName: r.clinicName,
      city: r.city,
      sourceUrl: r.sourceUrl,
      website: r.website,
      isActive: r.isActive,
      parserType: r.parserType,
      parserConfig: r.parserConfig,
      timeoutMs: r.timeoutMs,
      politenessMs: r.politenessMs,
      lastAttemptedAt: r.lastAttemptedAt?.toISOString() ?? null,
      lastSuccessfulAt: r.lastSuccessfulAt?.toISOString() ?? null,
      lastErrorMessage: r.lastErrorMessage,
      lastErrorAt: r.lastErrorAt?.toISOString() ?? null,
      consecutiveFailures: r.consecutiveFailures,
      totalRuns: r.totalRuns,
      totalSuccess: r.totalSuccess,
      totalFailed: r.totalFailed,
      totalRowsParsed: r.totalRowsParsed,
      totalRowsUpserted: r.totalRowsUpserted,
      successRate: r.totalRuns > 0 ? Math.round((r.totalSuccess / r.totalRuns) * 100) : 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  return NextResponse.json({
    sources,
    total: rows.length,
    active,
    registeredScrapers,
    summary: {
      totalRuns,
      totalSuccess,
      totalFailed,
      avgSuccessRate:
        totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 0,
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty */
  }

  if (body.action === "sync") {
    const result = await ensureScraperSourceConfigs();
    return NextResponse.json({ sync: result });
  }

  return NextResponse.json(
    { error: "Unknown action. Use { action: 'sync' } to re-sync sources." },
    { status: 400 }
  );
}
