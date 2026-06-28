/**
 * GET /api/v1/services/[id]/detail
 * -------------------------------------------------------------
 * Full service detail: all clinics offering this service with their
 * current prices + per-clinic 30-day history, stats, distribution.
 *
 * Returns:
 *  - service: directory entry (RU/KK/EN names, synonyms, category, description, unit)
 *  - offerings: list of {clinic, priceKzt, durationDays, parsedAt, serviceNameRaw}
 *      sorted by price ascending (cheapest first)
 *  - stats: {clinicCount, min, max, avg, median, spread, spreadPct}
 *  - distribution: price histogram buckets (5 buckets between min..max)
 *  - history: overall 30-day series (date, min, avg, max) for sparkline + chart
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function safeArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const service = await db.serviceDirectory.findUnique({ where: { id } });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  // All current offerings of this service
  const offerings = await db.normalizedPrice.findMany({
    where: { serviceId: id, isActive: true },
    include: { clinic: true },
    orderBy: { priceKzt: "asc" },
  });

  // Stats
  const prices = offerings.map((o) => o.priceKzt);
  const clinicCount = prices.length;
  const min = clinicCount ? Math.min(...prices) : 0;
  const max = clinicCount ? Math.max(...prices) : 0;
  const sum = prices.reduce((a, b) => a + b, 0);
  const avg = clinicCount ? Math.round(sum / clinicCount) : 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const median = clinicCount
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : 0;
  const spread = max - min;
  const spreadPct = min > 0 ? Math.round((spread / min) * 100) : 0;

  // Distribution: 5 buckets between min..max
  const BUCKETS = 5;
  const distribution: { bucket: string; count: number; lo: number; hi: number }[] = [];
  if (clinicCount >= 2 && max > min) {
    const step = (max - min) / BUCKETS;
    for (let i = 0; i < BUCKETS; i++) {
      const lo = Math.round(min + step * i);
      const hi = i === BUCKETS - 1 ? max : Math.round(min + step * (i + 1) - 1);
      const count = prices.filter((p) =>
        i === 0 ? p >= lo && p <= hi : p > lo - 1 && p <= hi + (i === BUCKETS - 1 ? 1 : 0)
      ).length;
      // Simpler: count prices in [lo, hi]
      const cnt = prices.filter((p) => p >= lo && (i === BUCKETS - 1 ? p <= hi : p < hi + 1)).length;
      distribution.push({
        bucket: `${lo}–${hi}`,
        count: cnt,
        lo,
        hi,
      });
    }
  }

  // History: 30-day overall series
  const history = await db.priceHistory.findMany({
    where: { serviceId: id },
    orderBy: { recordedAt: "asc" },
  });
  const byDay = new Map<string, { min: number; max: number; sum: number; count: number }>();
  for (const h of history) {
    const k = dayKey(h.recordedAt);
    const cur = byDay.get(k) ?? { min: Infinity, max: -Infinity, sum: 0, count: 0 };
    cur.min = Math.min(cur.min, h.priceKzt);
    cur.max = Math.max(cur.max, h.priceKzt);
    cur.sum += h.priceKzt;
    cur.count += 1;
    byDay.set(k, cur);
  }
  // include current snapshot as "today"
  if (offerings.length) {
    const k = dayKey(new Date());
    const cur = byDay.get(k) ?? { min: Infinity, max: -Infinity, sum: 0, count: 0 };
    for (const o of offerings) {
      cur.min = Math.min(cur.min, o.priceKzt);
      cur.max = Math.max(cur.max, o.priceKzt);
      cur.sum += o.priceKzt;
      cur.count += 1;
    }
    byDay.set(k, cur);
  }
  const overallSeries = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      min: v.min === Infinity ? null : v.min,
      max: v.max === -Infinity ? null : v.max,
      avg: v.count ? Math.round(v.sum / v.count) : null,
    }));

  return NextResponse.json({
    service: {
      id: service.id,
      nameRu: service.nameRu,
      nameKk: service.nameKk,
      nameEn: service.nameEn,
      category: service.category,
      synonyms: safeArr(service.synonyms),
      description: service.description,
      unit: service.unit,
    },
    offerings: offerings.map((o) => ({
      id: o.id,
      priceKzt: o.priceKzt,
      currency: o.currency,
      durationDays: o.durationDays,
      parsedAt: o.parsedAt,
      serviceNameRaw: o.serviceNameRaw,
      clinic: {
        id: o.clinic.id,
        name: o.clinic.clinicName,
        city: o.clinic.city,
        address: o.clinic.address,
        phone: o.clinic.phone,
        workingHours: o.clinic.workingHours,
        rating: o.clinic.rating,
        onlineBooking: o.clinic.onlineBooking,
        website: o.clinic.website,
        sourceUrl: o.clinic.sourceUrl,
        latitude: o.clinic.latitude,
        longitude: o.clinic.longitude,
      },
    })),
    stats: {
      clinicCount,
      min,
      max,
      avg,
      median,
      spread,
      spreadPct,
    },
    distribution,
    history: overallSeries,
    historyCount: history.length,
  });
}
