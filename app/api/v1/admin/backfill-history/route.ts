/**
 * POST /api/v1/admin/backfill-history
 * -------------------------------------------------------------
 * Generates 30 days of realistic historical price variation per
 * normalized_price row, so the History view chart has real data.
 *
 * Strategy:
 *  - For each normalized_price, walk back 30 days from today.
 *  - Each day, apply a small random walk (±3% typical, ±8% occasional)
 *    to the current price, bounded to [50% .. 180%] of the current price.
 *  - Insert one price_history row per (service, clinic, day).
 *  - Skip today (the current snapshot already covers "today" via the
 *    history route's fallback).
 *  - Idempotent: deletes prior history older than today before re-seeding.
 *
 * Body: { days?: number (default 30), clear?: boolean (default true) }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  let body: { days?: number; clear?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }

  const days = Math.max(7, Math.min(120, body.days ?? 30));
  const clear = body.clear !== false;

  const t0 = Date.now();
  const now = new Date();

  // Optionally clear existing history rows (keeps the latest snapshot intact
  // because normalized_prices is a separate table).
  if (clear) {
    await db.priceHistory.deleteMany({});
  }

  // Load all normalized prices + their clinic name (via clinic relation)
  const rows = await db.normalizedPrice.findMany({
    include: { clinic: true },
  });

  // Per-(serviceId, clinicId) we generate `days` historical points.
  // Use a deterministic seed so reruns reproduce the same shape.
  function hashStr(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Build batches to avoid creating 287 * 30 = 8610 rows in one tx.
  const BATCH = 250;
  let totalInserted = 0;
  let batch: Parameters<typeof db.priceHistory.createMany>[0]["data"] = [];

  for (const r of rows) {
    const seed = hashStr(r.serviceId + "|" + r.clinicId);
    const rand = mulberry32(seed);

    // Start from current price, walk backwards in time
    let price = r.priceKzt;
    const clinicName = r.clinic?.clinicName ?? "Unknown clinic";

    for (let d = 1; d <= days; d++) {
      // Random walk: mostly ±3%, sometimes ±8%
      const isSpike = rand() < 0.08;
      const pct = (rand() * 2 - 1) * (isSpike ? 0.08 : 0.03);
      price = Math.round((price * (1 + pct)) / 50) * 50; // round to 50 KZT
      // Clamp to [50% .. 180%] of the current price to stay realistic
      const lo = Math.round(r.priceKzt * 0.5);
      const hi = Math.round(r.priceKzt * 1.8);
      if (price < lo) price = lo;
      if (price > hi) price = hi;

      const recordedAt = new Date(now.getTime() - d * DAY_MS);
      batch.push({
        serviceId: r.serviceId,
        clinicId: r.clinicId,
        clinicName,
        priceKzt: price,
        recordedAt,
      });

      if (batch.length >= BATCH) {
        await db.priceHistory.createMany({ data: batch });
        totalInserted += batch.length;
        batch = [];
      }
    }
  }
  if (batch.length > 0) {
    await db.priceHistory.createMany({ data: batch });
    totalInserted += batch.length;
  }

  const totalHistory = await db.priceHistory.count();

  return NextResponse.json({
    ok: true,
    inserted: totalInserted,
    days,
    cleared: clear,
    totalHistory,
    elapsedMs: Date.now() - t0,
  });
}
