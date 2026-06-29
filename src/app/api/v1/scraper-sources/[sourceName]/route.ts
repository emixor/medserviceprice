/**
 * PATCH /api/v1/scraper-sources/[sourceName]
 * -------------------------------------------------------------
 * Update a scraper source's operator-mutable fields. Used by the admin
 * "Background Scraper" panel to toggle the active routing switch, change
 * the parser type, or adjust the per-source timeout / politeness delay.
 *
 * Path param: sourceName (URL-encoded). Matches the `sourceName` column.
 *   NOTE: if multiple cities share the same sourceName, ALL matching rows
 *   are updated — this is intentional so operators can toggle "KDL" off
 *   globally without editing each city row.
 *
 * Body (all optional, partial update):
 *   {
 *     "isActive":     true | false,        // routing switch
 *     "parserType":   "simulated",         // registry key
 *     "timeoutMs":    15000,               // per-source timeout
 *     "politenessMs": 200                  // politeness delay
 *   }
 *
 * Response (200): { updated: number, sourceName }
 * Response (404): { error: "No sources found" }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sourceName: string }> }
) {
  const { sourceName } = await params;
  if (!sourceName) {
    return NextResponse.json({ error: "Missing sourceName" }, { status: 400 });
  }

  let body: {
    isActive?: boolean;
    parserType?: string;
    timeoutMs?: number;
    politenessMs?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Build the partial update — only include fields that were provided.
  const data: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.parserType === "string" && body.parserType.trim()) {
    data.parserType = body.parserType.trim();
  }
  if (typeof body.timeoutMs === "number" && body.timeoutMs >= 1000 && body.timeoutMs <= 120000) {
    data.timeoutMs = Math.trunc(body.timeoutMs);
  }
  if (typeof body.politenessMs === "number" && body.politenessMs >= 0 && body.politenessMs <= 60000) {
    data.politenessMs = Math.trunc(body.politenessMs);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No updatable fields provided" },
      { status: 400 }
    );
  }

  const result = await db.scraperSourceConfig.updateMany({
    where: { sourceName },
    data,
  });

  if (result.count === 0) {
    return NextResponse.json(
      { error: `No sources found with sourceName="${sourceName}"` },
      { status: 404 }
    );
  }

  return NextResponse.json({ updated: result.count, sourceName });
}

/**
 * GET /api/v1/scraper-sources/[sourceName]
 * Returns all config rows matching the given sourceName (one per city).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sourceName: string }> }
) {
  const { sourceName } = await params;
  if (!sourceName) {
    return NextResponse.json({ error: "Missing sourceName" }, { status: 400 });
  }

  const rows = await db.scraperSourceConfig.findMany({
    where: { sourceName },
    orderBy: { city: "asc" },
  });

  if (rows.length === 0) {
    return NextResponse.json(
      { error: `No sources found with sourceName="${sourceName}"` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    sourceName,
    sources: rows.map((r) => ({
      id: r.id,
      clinicName: r.clinicName,
      city: r.city,
      sourceUrl: r.sourceUrl,
      isActive: r.isActive,
      parserType: r.parserType,
      timeoutMs: r.timeoutMs,
      politenessMs: r.politenessMs,
      lastSuccessfulAt: r.lastSuccessfulAt?.toISOString() ?? null,
      lastErrorMessage: r.lastErrorMessage,
      lastErrorAt: r.lastErrorAt?.toISOString() ?? null,
      consecutiveFailures: r.consecutiveFailures,
      totalRuns: r.totalRuns,
      totalSuccess: r.totalSuccess,
      totalFailed: r.totalFailed,
      successRate: r.totalRuns > 0 ? Math.round((r.totalSuccess / r.totalRuns) * 100) : 0,
    })),
  });
}
