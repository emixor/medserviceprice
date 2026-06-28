/**
 * GET /api/v1/insights
 * Rich comparison insights for the homepage trust band + city comparison widget.
 *
 * Returns:
 *  - cityAverages: per-city avg/min/max price + clinic count (for city comparison)
 *  - categoryInsights: per-category avg price + count + cheapest clinic
 *  - savingsStats: max savings (₸) across any single service, avg savings pct,
 *    total services with >20% spread
 *  - priceBuckets: distribution of all active prices into 6 ranges (for a histogram)
 *  - topSavings: top 5 services by absolute savings (max-min) with names
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRICE_BUCKETS = [
  { label: "0–3K", min: 0, max: 3000 },
  { label: "3–6K", min: 3000, max: 6000 },
  { label: "6–10K", min: 6000, max: 10000 },
  { label: "10–20K", min: 10000, max: 20000 },
  { label: "20–40K", min: 20000, max: 40000 },
  { label: "40K+", min: 40000, max: Infinity },
];

export async function GET(_req: NextRequest) {
  // Load all active normalized prices with their clinic + service (small dataset ~383)
  const prices = await db.normalizedPrice.findMany({
    where: { isActive: true },
    select: {
      priceKzt: true,
      clinicId: true,
      serviceId: true,
      clinic: { select: { city: true, clinicName: true } },
      service: {
        select: { id: true, nameRu: true, nameKk: true, nameEn: true, category: true },
      },
    },
  });

  if (!prices.length) {
    return NextResponse.json({
      cityAverages: [],
      categoryInsights: [],
      savingsStats: { maxSavingsKzt: 0, avgSavingsPct: 0, servicesWithSpread: 0 },
      priceBuckets: [],
      topSavings: [],
    });
  }

  // ---- City averages ----
  const cityMap = new Map<string, { prices: number[]; clinicIds: Set<string> }>();
  for (const p of prices) {
    const city = p.clinic.city;
    if (!cityMap.has(city)) cityMap.set(city, { prices: [], clinicIds: new Set() });
    const e = cityMap.get(city)!;
    e.prices.push(p.priceKzt);
    e.clinicIds.add(p.clinicId);
  }
  const cityAverages = Array.from(cityMap.entries())
    .map(([city, data]) => {
      const avg = data.prices.reduce((a, b) => a + b, 0) / data.prices.length;
      return {
        city,
        avgPrice: Math.round(avg),
        minPrice: Math.min(...data.prices),
        maxPrice: Math.max(...data.prices),
        clinicCount: data.clinicIds.size,
        priceCount: data.prices.length,
      };
    })
    .sort((a, b) => a.avgPrice - b.avgPrice);

  // ---- Category insights ----
  const catMap = new Map<string, { prices: number[]; services: Set<string> }>();
  for (const p of prices) {
    const cat = p.service.category;
    if (!catMap.has(cat)) catMap.set(cat, { prices: [], services: new Set() });
    const e = catMap.get(cat)!;
    e.prices.push(p.priceKzt);
    e.services.add(p.serviceId);
  }
  const categoryInsights = Array.from(catMap.entries())
    .map(([category, data]) => {
      const avg = data.prices.reduce((a, b) => a + b, 0) / data.prices.length;
      return {
        category,
        avgPrice: Math.round(avg),
        minPrice: Math.min(...data.prices),
        maxPrice: Math.max(...data.prices),
        serviceCount: data.services.size,
        priceCount: data.prices.length,
      };
    })
    .sort((a, b) => a.avgPrice - b.avgPrice);

  // ---- Savings stats: per-service min/max spread ----
  const serviceSpreadMap = new Map<string, { min: number; max: number; name: string }>();
  for (const p of prices) {
    const sid = p.serviceId;
    if (!serviceSpreadMap.has(sid)) {
      serviceSpreadMap.set(sid, {
        min: p.priceKzt,
        max: p.priceKzt,
        name: p.service.nameEn,
      });
    }
    const e = serviceSpreadMap.get(sid)!;
    e.min = Math.min(e.min, p.priceKzt);
    e.max = Math.max(e.max, p.priceKzt);
  }
  const spreads = Array.from(serviceSpreadMap.values());
  const maxSavingsKzt = spreads.length ? Math.max(...spreads.map((s) => s.max - s.min)) : 0;
  // Savings % expressed as discount off the most expensive option:
  //   (max - min) / max * 100  →  "Save X% off the highest price"
  // (Industry-standard savings framing — avoids meaningless >100% values
  // that the previous `(max-min)/min * 100` formula produced.)
  const savingsPct = (s: { min: number; max: number }) =>
    s.max > 0 ? Math.round(((s.max - s.min) / s.max) * 100) : 0;
  const avgSavingsPct = spreads.length
    ? Math.round(spreads.map(savingsPct).reduce((a, b) => a + b, 0) / spreads.length)
    : 0;
  const servicesWithSpread = spreads.filter((s) => savingsPct(s) > 20).length;

  // ---- Top 5 services by absolute savings ----
  const topSavings = spreads
    .map((s) => ({
      name: s.name,
      savingsKzt: s.max - s.min,
      minPrice: s.min,
      maxPrice: s.max,
      savingsPct: savingsPct(s),
    }))
    .sort((a, b) => b.savingsKzt - a.savingsKzt)
    .slice(0, 5);

  // ---- Price buckets histogram ----
  const priceBuckets = PRICE_BUCKETS.map((b) => ({
    label: b.label,
    count: prices.filter((p) => p.priceKzt >= b.min && p.priceKzt < b.max).length,
  }));

  return NextResponse.json({
    cityAverages,
    categoryInsights,
    savingsStats: { maxSavingsKzt, avgSavingsPct, servicesWithSpread, totalServices: spreads.length },
    priceBuckets,
    topSavings,
  });
}
