/**
 * GET /api/v1/admin/parser-runs
 *   Returns parser execution history + per-source health summary.
 *   Query: ?limit=50 (max 200)
 *
 *   Response:
 *   {
 *     runs:        ParserRun[],           // most-recent first
 *     sourceHealth: SourceHealth[],       // per-source aggregate
 *     summary: {
 *       totalRuns, successRuns, partialRuns, failedRuns,
 *       successRate, totalRowsParsed, totalRowsUpserted,
 *       avgDurationMs, lastRunAt, activeSources, totalSources
 *     }
 *   }
 *
 * POST /api/v1/admin/parser-runs
 *   Triggers a new simulated parser run across all known sources.
 *   Body: { source?: string, triggeredBy?: "manual"|"schedule" }
 *
 *   The simulation:
 *     - Creates a ParserRun row per source with status="running"
 *     - Waits a short deterministic delay (simulating network + parse time)
 *     - Counts actual raw_parsed_data rows for that source as "rowsParsed"
 *     - Derives rowsNormalized / rowsUnmatched from raw.normalized flags
 *     - Derives rowsUpserted from normalized_prices count for that source's clinics
 *     - Randomly injects realistic failures (~12% of runs) with error messages
 *       mimicking real scraper failure modes (timeout, 403, layout change, PDF parse error)
 *     - Marks the run success | partial | failed and sets durationMs
 *
 *   Returns: { runs: ParserRun[] }  // the newly created runs
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CLINIC_SOURCES } from "@/lib/seed-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Distinct sources derived from CLINIC_SOURCES (preserves first-seen order). */
function distinctSources(): { sourceName: string; sourceUrl: string }[] {
  const seen = new Set<string>();
  const out: { sourceName: string; sourceUrl: string }[] = [];
  for (const s of CLINIC_SOURCES) {
    if (seen.has(s.sourceName)) continue;
    seen.add(s.sourceName);
    out.push({ sourceName: s.sourceName, sourceUrl: s.website });
  }
  return out;
}

/** Realistic failure messages a scraper might emit. */
const FAILURE_MODES = [
  "ConnectionTimeout: HTTPSConnectionPool(host='invitro.kz', port=443): Read timed out after 30s",
  "HTTPError 403 Forbidden: Cloudflare bot protection triggered on /almaty/prices",
  "LayoutChangeError: expected <div class='price-list'> not found; selector stale",
  "PDFParseError: pdfplumber failed to extract tables from olymp_pricelist_2026.pdf",
  "DOCXParseError: python-docx could not open sultan_pricelist.docx (corrupt header)",
  "JSONDecodeError: XHR endpoint /api/prices returned HTML instead of JSON",
  "AttributeError: 'NoneType' object has no attribute 'find_all' on row[12]",
];

/** Deterministic pseudo-random in [0,1) seeded by sourceName + runIndex. */
function seededRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Sleep helper for realistic duration simulation. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function safeParseArr(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 1), 200);

  // Fetch ALL runs for accurate aggregation (summary + sourceHealth),
  // then return only the limited subset in the `runs` field.
  const allRuns = await db.parserRun.findMany({
    orderBy: { startedAt: "desc" },
  });
  const runs = allRuns.slice(0, limit);

  // Per-source health aggregation
  const sources = distinctSources();
  const sourceHealth: Array<{
    sourceName: string;
    sourceUrl: string;
    totalRuns: number;
    successRuns: number;
    partialRuns: number;
    failedRuns: number;
    successRate: number;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastRowsParsed: number;
    totalRowsParsed: number;
    avgDurationMs: number;
    clinicCount: number;
  }> = [];

  for (const src of sources) {
    const srcRuns = allRuns.filter((r) => r.sourceName === src.sourceName);
    const success = srcRuns.filter((r) => r.status === "success").length;
    const partial = srcRuns.filter((r) => r.status === "partial").length;
    const failed = srcRuns.filter((r) => r.status === "failed").length;
    const totalRows = srcRuns.reduce((a, r) => a + r.rowsParsed, 0);
    const durations = srcRuns.filter((r) => r.durationMs != null).map((r) => r.durationMs!);
    const avgDur = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    const clinicCount = CLINIC_SOURCES.filter((c) => c.sourceName === src.sourceName).length;
    sourceHealth.push({
      sourceName: src.sourceName,
      sourceUrl: src.sourceUrl,
      totalRuns: srcRuns.length,
      successRuns: success,
      partialRuns: partial,
      failedRuns: failed,
      successRate: srcRuns.length ? Math.round((success / srcRuns.length) * 100) : 0,
      lastRunAt: srcRuns[0]?.startedAt.toISOString() ?? null,
      lastStatus: srcRuns[0]?.status ?? null,
      lastRowsParsed: srcRuns[0]?.rowsParsed ?? 0,
      totalRowsParsed: totalRows,
      avgDurationMs: avgDur,
      clinicCount,
    });
  }

  const totalRuns = allRuns.length;
  const successRuns = allRuns.filter((r) => r.status === "success").length;
  const partialRuns = allRuns.filter((r) => r.status === "partial").length;
  const failedRuns = allRuns.filter((r) => r.status === "failed").length;
  const totalRowsParsed = allRuns.reduce((a, r) => a + r.rowsParsed, 0);
  const totalRowsUpserted = allRuns.reduce((a, r) => a + r.rowsUpserted, 0);
  const allDurations = allRuns.filter((r) => r.durationMs != null).map((r) => r.durationMs!);
  const avgDurationMs = allDurations.length
    ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
    : 0;

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      status: r.status,
      rowsParsed: r.rowsParsed,
      rowsNormalized: r.rowsNormalized,
      rowsUnmatched: r.rowsUnmatched,
      rowsUpserted: r.rowsUpserted,
      errorsCount: r.errorsCount,
      errorMessage: r.errorMessage,
      errorDetails: r.errorDetails ? safeParseArr(r.errorDetails) : [],
      triggeredBy: r.triggeredBy,
      durationMs: r.durationMs,
    })),
    sourceHealth,
    summary: {
      totalRuns,
      successRuns,
      partialRuns,
      failedRuns,
      successRate: totalRuns ? Math.round((successRuns / totalRuns) * 100) : 0,
      totalRowsParsed,
      totalRowsUpserted,
      avgDurationMs,
      lastRunAt: allRuns[0]?.startedAt.toISOString() ?? null,
      activeSources: sources.length,
      totalSources: sources.length,
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { source?: string; triggeredBy?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }
  const triggeredBy = body.triggeredBy === "schedule" ? "schedule" : "manual";

  const allSources = distinctSources();
  const targets = body.source
    ? allSources.filter((s) => s.sourceName === body.source)
    : allSources;

  if (!targets.length) {
    return NextResponse.json({ error: "Unknown source" }, { status: 404 });
  }

  const created: Array<{
    id: string;
    sourceName: string;
    status: string;
    rowsParsed: number;
    durationMs: number;
  }> = [];

  // Run sources sequentially (like a real Celery chain would), each isolated.
  for (let i = 0; i < targets.length; i++) {
    const src = targets[i];
    const runSeed = `${src.sourceName}-${Date.now()}-${i}`;
    const t0 = Date.now();

    // Create "running" row
    const run = await db.parserRun.create({
      data: {
        sourceName: src.sourceName,
        sourceUrl: src.sourceUrl,
        status: "running",
        triggeredBy,
      },
    });

    // Simulate parse latency (150-900ms, deterministic by source)
    const latency = 150 + Math.floor(seededRandom(runSeed) * 750);
    await sleep(latency);

    // Determine success/failure (~12% fail rate, deterministic by seed)
    const failRoll = seededRandom(runSeed + "fail");
    const willFail = failRoll < 0.12;
    const partialRoll = seededRandom(runSeed + "partial");
    const willPartial = !willFail && partialRoll < 0.18;

    // Count actual raw rows for this source
    const rawRows = await db.rawParsedData.count({
      where: { sourceName: src.sourceName },
    });
    const normalizedRows = await db.rawParsedData.count({
      where: { sourceName: src.sourceName, normalized: true },
    });
    const unmatchedCount = Math.max(0, rawRows - normalizedRows);

    // Count upserted normalized prices for this source's clinics
    const clinicNames = CLINIC_SOURCES.filter((c) => c.sourceName === src.sourceName).map(
      (c) => c.clinicName
    );
    const clinics = await db.clinic.findMany({
      where: { clinicName: { in: clinicNames } },
      select: { id: true },
    });
    const upsertedCount = await db.normalizedPrice.count({
      where: { clinicId: { in: clinics.map((c) => c.id) } },
    });

    const durationMs = Date.now() - t0;

    if (willFail) {
      const errMsg = FAILURE_MODES[Math.floor(seededRandom(runSeed + "err") * FAILURE_MODES.length)];
      await db.parserRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          rowsParsed: 0,
          rowsNormalized: 0,
          rowsUnmatched: 0,
          rowsUpserted: 0,
          errorsCount: 1,
          errorMessage: errMsg.slice(0, 500),
          errorDetails: JSON.stringify([
            {
              url: src.sourceUrl,
              error: errMsg,
              ts: new Date().toISOString(),
            },
          ]),
          durationMs,
        },
      });
      created.push({
        id: run.id,
        sourceName: src.sourceName,
        status: "failed",
        rowsParsed: 0,
        durationMs,
      });
    } else {
      // For partial runs, simulate that ~15% of rows failed to normalize
      const normRows = willPartial
        ? Math.floor(normalizedRows * 0.85)
        : normalizedRows;
      const unmtRows = willPartial
        ? unmatchedCount + Math.floor(normalizedRows * 0.15)
        : unmatchedCount;

      await db.parserRun.update({
        where: { id: run.id },
        data: {
          status: willPartial ? "partial" : "success",
          finishedAt: new Date(),
          rowsParsed: rawRows,
          rowsNormalized: normRows,
          rowsUnmatched: unmtRows,
          rowsUpserted: upsertedCount,
          errorsCount: willPartial ? 1 : 0,
          errorMessage: willPartial
            ? "Partial: 15% of rows failed normalization (routed to unmatched_queue)"
            : null,
          durationMs,
        },
      });
      created.push({
        id: run.id,
        sourceName: src.sourceName,
        status: willPartial ? "partial" : "success",
        rowsParsed: rawRows,
        durationMs,
      });
    }
  }

  return NextResponse.json({ runs: created, count: created.length });
}
