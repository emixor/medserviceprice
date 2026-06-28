/**
 * POST /api/v1/admin/parser-runs/backfill
 *   Seeds historical ParserRun rows (last 14 days, ~3 runs/day per source)
 *   so the Source Health dashboard has realistic data on first view.
 *   Idempotent: skips if any ParserRun already exists.
 *
 *   Returns: { created, skipped, total }
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CLINIC_SOURCES } from "@/lib/seed-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE_MODES = [
  "ConnectionTimeout: Read timed out after 30s on /api/prices",
  "HTTPError 403 Forbidden: Cloudflare bot protection triggered",
  "LayoutChangeError: expected <div class='price-list'> not found",
  "PDFParseError: pdfplumber failed to extract tables",
];

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

function seededRandom(seed: number): number {
  let h = (seed * 2654435761) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h % 100000) / 100000;
}

export async function POST() {
  const existing = await db.parserRun.count();
  if (existing > 0) {
    return NextResponse.json({
      created: 0,
      skipped: true,
      total: existing,
      message: "ParserRun rows already exist; backfill skipped.",
    });
  }

  const sources = distinctSources();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const runsToCreate: Array<{
    sourceName: string;
    sourceUrl: string;
    startedAt: Date;
    finishedAt: Date;
    status: string;
    rowsParsed: number;
    rowsNormalized: number;
    rowsUnmatched: number;
    rowsUpserted: number;
    errorsCount: number;
    errorMessage: string | null;
    triggeredBy: string;
    durationMs: number;
  }> = [];

  // ~3 runs per day for last 14 days, per source
  let seedCounter = 1;
  for (let dayAgo = 14; dayAgo >= 1; dayAgo--) {
    for (const src of sources) {
      for (const hour of [9, 14, 19]) {
        const startedAt = new Date(now - dayAgo * DAY);
        startedAt.setHours(hour, Math.floor(seededRandom(seedCounter) * 60), 0, 0);
        seedCounter++;

        const r1 = seededRandom(seedCounter++);
        const willFail = r1 < 0.1;
        const r2 = seededRandom(seedCounter++);
        const willPartial = !willFail && r2 < 0.15;

        const durationMs = 800 + Math.floor(seededRandom(seedCounter++) * 4200);
        const finishedAt = new Date(startedAt.getTime() + durationMs);

        const baseRows = 24 + Math.floor(seededRandom(seedCounter++) * 30);
        const clinicCount = CLINIC_SOURCES.filter((c) => c.sourceName === src.sourceName).length;
        const rowsParsed = willFail ? 0 : baseRows * clinicCount;
        const rowsNormalized = willFail
          ? 0
          : willPartial
            ? Math.floor(rowsParsed * 0.85)
            : rowsParsed;
        const rowsUnmatched = willFail ? 0 : rowsParsed - rowsNormalized;
        const rowsUpserted = rowsNormalized;

        runsToCreate.push({
          sourceName: src.sourceName,
          sourceUrl: src.sourceUrl,
          startedAt,
          finishedAt,
          status: willFail ? "failed" : willPartial ? "partial" : "success",
          rowsParsed,
          rowsNormalized,
          rowsUnmatched,
          rowsUpserted,
          errorsCount: willFail ? 1 : willPartial ? 1 : 0,
          errorMessage: willFail
            ? FAILURE_MODES[Math.floor(seededRandom(seedCounter++) * FAILURE_MODES.length)]
            : willPartial
              ? "Partial: some rows failed normalization"
              : null,
          triggeredBy: "schedule",
          durationMs,
        });
      }
    }
  }

  runsToCreate.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  // Batch insert in chunks of 100 to avoid SQLite param limits
  const CHUNK = 100;
  for (let i = 0; i < runsToCreate.length; i += CHUNK) {
    await db.parserRun.createMany({ data: runsToCreate.slice(i, i + CHUNK) });
  }

  return NextResponse.json({
    created: runsToCreate.length,
    skipped: false,
    total: runsToCreate.length,
    daysBackfilled: 14,
    sources: sources.length,
  });
}
