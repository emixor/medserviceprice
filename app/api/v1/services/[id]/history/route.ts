/**
 * GET /api/v1/services/[id]/history
 * Returns historical price variations for a specific service, grouped by date,
 * suitable for building a chart. Returns both an overall series (min/avg/max
 * across all clinics per day) and per-clinic series.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const service = await db.serviceDirectory.findUnique({ where: { id } });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  const history = await db.priceHistory.findMany({
    where: { serviceId: id },
    orderBy: { recordedAt: "asc" },
  });

  // Current live prices as the latest point
  const current = await db.normalizedPrice.findMany({
    where: { serviceId: id, isActive: true },
    include: { clinic: true },
  });

  // Group by day for the overall series
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
  if (current.length) {
    const k = dayKey(new Date());
    const cur = byDay.get(k) ?? { min: Infinity, max: -Infinity, sum: 0, count: 0 };
    for (const c of current) {
      cur.min = Math.min(cur.min, c.priceKzt);
      cur.max = Math.max(cur.max, c.priceKzt);
      cur.sum += c.priceKzt;
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

  // Per-clinic series
  const clinicMap = new Map<string, { id: string; name: string; city: string }>();
  for (const h of history) {
    if (!clinicMap.has(h.clinicId)) {
      clinicMap.set(h.clinicId, { id: h.clinicId, name: h.clinicName, city: "" });
    }
  }
  for (const c of current) {
    if (!clinicMap.has(c.clinicId)) {
      clinicMap.set(c.clinicId, {
        id: c.clinicId,
        name: c.clinic.clinicName,
        city: c.clinic.city,
      });
    } else {
      const e = clinicMap.get(c.clinicId)!;
      e.city = c.clinic.city;
      e.name = c.clinic.clinicName;
    }
  }

  const perClinic = [...clinicMap.values()].map((c) => {
    const pts = history
      .filter((h) => h.clinicId === c.id)
      .map((h) => ({ date: dayKey(h.recordedAt), priceKzt: h.priceKzt }));
    const cur = current.find((p) => p.clinicId === c.id);
    if (cur) {
      pts.push({ date: dayKey(new Date()), priceKzt: cur.priceKzt });
    }
    // dedupe by date keeping last
    const dedup = new Map<string, number>();
    for (const p of pts) dedup.set(p.date, p.priceKzt);
    return {
      clinic: c,
      series: [...dedup.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, priceKzt]) => ({ date, priceKzt })),
    };
  });

  return NextResponse.json({
    service: {
      id: service.id,
      nameRu: service.nameRu,
      nameKk: service.nameKk,
      nameEn: service.nameEn,
      category: service.category,
    },
    overallSeries,
    perClinic,
    currentCount: current.length,
    historyCount: history.length,
  });
}
