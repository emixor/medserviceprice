/**
 * GET /api/v1/stats
 * Platform-wide statistics for the homepage hero: total clinics, services,
 * normalized prices, cities covered, average savings, etc.
 *
 * Also powers the admin dashboard with extra aggregates:
 *   - categoryCounts: normalized price counts grouped by service category
 *   - topServices:    top 5 services by normalized price count (with min/avg)
 *   - cityCounts:     clinic counts grouped by city
 *   - recentActivity: 5 most recent price_history changes with old→new price
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const [clinics, services, normalized, raw, unmatched, history, activePrices] = await Promise.all([
    db.clinic.count(),
    db.serviceDirectory.count(),
    db.normalizedPrice.count(),
    db.rawParsedData.count(),
    db.unmatchedQueue.count(),
    db.priceHistory.count(),
    db.normalizedPrice.count({ where: { isActive: true } }),
  ]);

  const cities = await db.clinic.findMany({
    select: { city: true },
    distinct: ["city"],
  });

  // Average price spread (max-min per service) as a "savings" indicator
  const servicePriceRows = await db.normalizedPrice.groupBy({
    by: ["serviceId"],
    _min: { priceKzt: true },
    _max: { priceKzt: true },
    where: { isActive: true },
  });
  let avgSpreadPct = 0;
  if (servicePriceRows.length) {
    const spreads = servicePriceRows
      .map((r) => {
        const min = r._min.priceKzt ?? 0;
        const max = r._max.priceKzt ?? 0;
        if (max <= 0) return 0;
        // Discount off the most expensive clinic (industry-standard savings framing).
        return ((max - min) / max) * 100;
      })
      .filter((v) => Number.isFinite(v));
    if (spreads.length) {
      avgSpreadPct = Math.round(spreads.reduce((a, b) => a + b, 0) / spreads.length);
    }
  }

  // ---- Trending services (by price-history activity in the last 30 days) ----
  // We count price_history rows per service in the trailing 30-day window as a
  // proxy for "interest / volatility" and surface the top 6 with their current
  // min price + a 7-point sparkline of the daily min.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const trendingRows = await db.priceHistory.groupBy({
    by: ["serviceId"],
    _count: { _all: true },
    _min: { priceKzt: true },
    where: { recordedAt: { gte: thirtyDaysAgo } },
  });
  const trendingTop = trendingRows
    .sort((a, b) => (b._count._all ?? 0) - (a._count._all ?? 0))
    .slice(0, 6);

  // For each trending service, build a 7-point sparkline from the last 7
  // distinct recorded days of min prices.
  const trendingServices = await Promise.all(
    trendingTop.map(async (row) => {
      const svc = (await db.serviceDirectory.findUnique({
        where: { id: row.serviceId },
        select: { id: true, nameRu: true, nameKk: true, nameEn: true, category: true },
      }));
      if (!svc) return null;
      // Fetch the last 14 history rows for this service to derive a sparkline.
      const hist = await db.priceHistory.findMany({
        where: { serviceId: row.serviceId },
        orderBy: { recordedAt: "desc" },
        take: 30,
        select: { priceKzt: true, recordedAt: true },
      });
      // Build a coarse 7-bucket sparkline (oldest -> newest) by slicing into 7
      // equal parts and taking the min of each bucket.
      const spark: number[] = [];
      if (hist.length) {
        const bucketSize = Math.max(1, Math.ceil(hist.length / 7));
        const ordered = [...hist].reverse(); // oldest first
        for (let i = 0; i < ordered.length; i += bucketSize) {
          const slice = ordered.slice(i, i + bucketSize);
          const mn = Math.min(...slice.map((h) => h.priceKzt));
          spark.push(Math.round(mn));
        }
        while (spark.length < 2) spark.push(spark[spark.length - 1] ?? 0);
      }
      // Current min active price (for the badge).
      const currentMin = await db.normalizedPrice.aggregate({
        where: { serviceId: row.serviceId, isActive: true },
        _min: { priceKzt: true },
      });
      // Sparkline direction: compare last vs first.
      const first = spark[0] ?? 0;
      const last = spark[spark.length - 1] ?? 0;
      const trendDir: "up" | "down" | "flat" = last > first ? "up" : last < first ? "down" : "flat";
      const trendPct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
      return {
        id: svc.id,
        nameRu: svc.nameRu,
        nameKk: svc.nameKk,
        nameEn: svc.nameEn,
        category: svc.category,
        activityCount: row._count._all ?? 0,
        currentMinPrice: currentMin._min.priceKzt ?? 0,
        sparkline: spark,
        trendDir,
        trendPct,
      };
    })
  ).then((arr) => arr.filter((x): x is NonNullable<typeof x> => x !== null));

  // ---- Admin dashboard extras -------------------------------------------

  // categoryCounts: normalized prices grouped by the service's category.
  // SQLite Prisma groupBy can't span a relation, so we fetch services once
  // (small set, ~50 rows) and join in JS.
  const [allServices, priceCountsByService, clinicCityRows, recentHistory] = await Promise.all([
    db.serviceDirectory.findMany({
      select: { id: true, nameRu: true, nameKk: true, nameEn: true, category: true },
    }),
    db.normalizedPrice.groupBy({
      by: ["serviceId"],
      _count: { _all: true },
      _min: { priceKzt: true },
      _avg: { priceKzt: true },
      where: { isActive: true },
    }),
    db.clinic.groupBy({ by: ["city"], _count: { _all: true } }),
    db.priceHistory.findMany({
      orderBy: { recordedAt: "desc" },
      take: 5,
      select: {
        id: true,
        serviceId: true,
        clinicId: true,
        clinicName: true,
        priceKzt: true,
        recordedAt: true,
      },
    }),
  ]);

  const serviceById = new Map(allServices.map((s) => [s.id, s]));

  // categoryCounts — initialize all four categories so the chart always has
  // every bar even when a category has zero rows.
  const categoryCounts: Record<string, number> = {
    laboratory: 0,
    diagnostics: 0,
    doctor_appointment: 0,
    procedure: 0,
  };
  for (const row of priceCountsByService) {
    const svc = serviceById.get(row.serviceId);
    if (!svc) continue;
    const cat = categoryCounts[svc.category] != null ? svc.category : "procedure";
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + (row._count._all ?? 0);
  }

  // topServices — sort by price count desc, take 5
  const topServices = priceCountsByService
    .map((row) => {
      const svc = serviceById.get(row.serviceId);
      if (!svc) return null;
      return {
        id: svc.id,
        nameRu: svc.nameRu,
        nameKk: svc.nameKk,
        nameEn: svc.nameEn,
        count: row._count._all ?? 0,
        minPrice: row._min.priceKzt ?? 0,
        avgPrice: Math.round(row._avg.priceKzt ?? 0),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // cityCounts — turn groupBy rows into a { city: count } map
  const cityCounts: Record<string, number> = {};
  for (const row of clinicCityRows) {
    cityCounts[row.city] = row._count._all ?? 0;
  }

  // recentActivity — for each of the 5 newest price_history rows, fetch the
  // immediately preceding row for the same (serviceId, clinicId) so we can
  // render an old → new price delta. Run in parallel.
  const recentActivity = await Promise.all(
    recentHistory.map(async (h) => {
      const svc = serviceById.get(h.serviceId);
      const prev = await db.priceHistory.findFirst({
        where: {
          serviceId: h.serviceId,
          clinicId: h.clinicId,
          recordedAt: { lt: h.recordedAt },
        },
        orderBy: { recordedAt: "desc" },
        select: { priceKzt: true, recordedAt: true },
      });
      return {
        id: h.id,
        serviceId: h.serviceId,
        clinicId: h.clinicId,
        clinicName: h.clinicName,
        serviceName: svc
          ? { id: svc.id, nameRu: svc.nameRu, nameKk: svc.nameKk, nameEn: svc.nameEn }
          : null,
        oldPrice: prev?.priceKzt ?? null,
        newPrice: h.priceKzt,
        recordedAt: h.recordedAt,
      };
    })
  );

  return NextResponse.json({
    clinics,
    services,
    normalized,
    raw,
    unmatched,
    history,
    activePrices,
    cities: cities.map((c) => c.city),
    avgSpreadPct,
    categoryCounts,
    topServices,
    cityCounts,
    recentActivity,
    trendingServices,
  });
}
