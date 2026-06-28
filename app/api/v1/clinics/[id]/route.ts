/**
 * GET /api/v1/clinics/[id]
 * Full clinic profile detail.
 *
 * Returns the full clinic profile:
 *   - clinic:           full clinic record (name, city, address, contact, geo,
 *                       rating, onlineBooking, description, sourceUrl).
 *   - stats:            totalServices, min/max/avgPrice, freshness breakdown
 *                       (fresh <7d, recent 7–30d, stale >30d).
 *   - topCheapest:      up to 10 cheapest active services at this clinic,
 *                       with localized name fields + category + osmsCoverage.
 *   - priceHistory:     per-day avg/min/max/count for the last 30 days.
 *   - badges:           ["best_price", "fair_price"] computed against
 *                       city-wide stats (deterministic, no AI).
 *   - services:         legacy full-services array (kept for backward
 *                       compatibility with clinic-detail-dialog.tsx, which is
 *                       NOT touched by this task).
 *   - stats.servicesCount / stats.byCategory / stats.lastUpdated:
 *                       legacy fields also kept for the dialog.
 *   - elapsedMs:        deterministic timing from t0 (first line of handler).
 *
 * Algorithm (DETERMINISTIC, no AI):
 *   1. Validate `id` is a non-empty string.
 *   2. Look up clinic by id — 404 if not found.
 *   3. Look up all active NormalizedPrice rows where clinicId = id, including
 *      the service relation.
 *   4. Compute stats: totalServices, min/max/avg price, freshness buckets
 *      (fresh/recent/stale using 7-day and 30-day cutoffs from `parsedAt`).
 *   5. Build topCheapest: sort by priceKzt asc (already sorted by the query),
 *      slice 10. Include service.nameRu/Kk/En + service.category +
 *      service.osmsCoverage (default "unknown").
 *   6. Build priceHistory: query PriceHistory where clinicId = id AND
 *      recordedAt >= 30 days ago. Group by day (YYYY-MM-DD, UTC — deterministic
 *      across timezones). Compute avg/min/max/count per day. Sort by date asc.
 *   7. Compute badges:
 *        "best_price"  — this clinic has the lowest price for ANY service in
 *                        its city (compares each of this clinic's active
 *                        prices to the city-wide minimum per serviceId).
 *        "fair_price"  — the clinic's avgPrice is within ±15% of the city-wide
 *                        avgPrice (only when both are > 0).
 *
 * Missing data is handled gracefully: `topCheapest` can be empty (clinic has
 * no active prices), `priceHistory` can be empty (no historical rows in the
 * last 30 days), `badges` can be empty. The endpoint never crashes on sparse
 * data.
 *
 * Response (200): see shape above.
 * Response (400): `{ "error": "Invalid clinic id" }` when `id` is empty.
 * Response (404): `{ "error": "Clinic not found" }` when id is unknown.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_CUTOFF_DAYS = 7;
const STALE_CUTOFF_DAYS = 30;
const FAIR_PRICE_TOLERANCE = 0.15; // ±15%
const TOP_CHEAPEST_LIMIT = 10;
const PRICE_HISTORY_DAYS = 30;

/** Parse a JSON-encoded synonyms string into a string[] (defensive). */
function safeArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Format a Date as YYYY-MM-DD in UTC (deterministic across timezones). */
function dayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

type OsmsCoverage = "likely" | "unlikely" | "unknown";

/** Normalize a raw osmsCoverage string to the canonical enum. */
function normalizeOsms(v: string | null | undefined): OsmsCoverage {
  if (v === "likely" || v === "unlikely") return v;
  return "unknown";
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const t0 = Date.now();
  const { id } = await ctx.params;

  // Step 1: Validate id is a non-empty string.
  if (typeof id !== "string" || id.trim().length === 0) {
    return NextResponse.json(
      { error: "Invalid clinic id" },
      { status: 400 }
    );
  }

  // Step 2: Look up clinic — 404 if not found.
  const clinic = await db.clinic.findUnique({ where: { id } });
  if (!clinic) {
    return NextResponse.json(
      { error: "Clinic not found" },
      { status: 404 }
    );
  }

  // Step 3: All active NormalizedPrice rows for this clinic, with service.
  const prices = await db.normalizedPrice.findMany({
    where: { clinicId: id, isActive: true },
    include: { service: true },
    orderBy: { priceKzt: "asc" },
  });

  // Step 4: Compute stats with a single-pass min/max/sum loop + freshness
  // buckets (avoids Math.min(...arr) stack overflow on large arrays and
  // avoids iterating prices more than once).
  const now = Date.now();
  const freshCutoff = now - FRESH_CUTOFF_DAYS * DAY_MS;
  const staleCutoff = now - STALE_CUTOFF_DAYS * DAY_MS;
  let minPrice = 0;
  let maxPrice = 0;
  let sumPrice = 0;
  let freshCount = 0;
  let recentCount = 0;
  let staleCount = 0;
  let first = true;
  let lastParsedAtMs = 0;
  for (const p of prices) {
    const price = p.priceKzt;
    if (first) {
      minPrice = price;
      maxPrice = price;
      first = false;
    } else {
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;
    }
    sumPrice += price;

    const ts = p.parsedAt.getTime();
    if (ts >= freshCutoff) freshCount++;
    else if (ts >= staleCutoff) recentCount++;
    else staleCount++;
    if (ts > lastParsedAtMs) lastParsedAtMs = ts;
  }
  const totalServices = prices.length;
  const avgPrice = totalServices > 0 ? Math.round(sumPrice / totalServices) : 0;
  const lastUpdated = lastParsedAtMs > 0 ? new Date(lastParsedAtMs).toISOString() : null;

  // Step 5: Build topCheapest — prices is already sorted asc by priceKzt.
  const topCheapest = prices.slice(0, TOP_CHEAPEST_LIMIT).map((p) => ({
    serviceId: p.serviceId,
    nameRu: p.service.nameRu,
    nameKk: p.service.nameKk,
    nameEn: p.service.nameEn,
    category: p.service.category,
    priceKzt: p.priceKzt,
    durationDays: p.durationDays ?? 0,
    parsedAt: p.parsedAt.toISOString(),
    osmsCoverage: normalizeOsms(p.service.osmsCoverage),
  }));

  // Step 6: Price history — last 30 days, grouped by UTC day.
  const histFrom = new Date(now - PRICE_HISTORY_DAYS * DAY_MS);
  const historyRows = await db.priceHistory.findMany({
    where: { clinicId: id, recordedAt: { gte: histFrom } },
    select: { priceKzt: true, recordedAt: true },
  });
  const byDay = new Map<
    string,
    { sum: number; min: number; max: number; count: number }
  >();
  for (const h of historyRows) {
    const key = dayKey(h.recordedAt);
    const e = byDay.get(key) ?? {
      sum: 0,
      min: Infinity,
      max: -Infinity,
      count: 0,
    };
    e.sum += h.priceKzt;
    if (h.priceKzt < e.min) e.min = h.priceKzt;
    if (h.priceKzt > e.max) e.max = h.priceKzt;
    e.count++;
    byDay.set(key, e);
  }
  const priceHistory = Array.from(byDay.entries())
    .map(([date, e]) => ({
      date,
      avgPrice: Math.round(e.sum / e.count),
      minPrice: e.min,
      maxPrice: e.max,
      count: e.count,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Step 7: Badges — best_price + fair_price computed against the clinic's
  // city-wide stats. Single query for all active city prices, then group in
  // memory (avoids N+1 per-service queries).
  const cityPrices = await db.normalizedPrice.findMany({
    where: { clinic: { city: clinic.city }, isActive: true },
    select: { serviceId: true, priceKzt: true },
  });
  const cityMinByService = new Map<string, number>();
  let citySum = 0;
  let cityCount = 0;
  for (const cp of cityPrices) {
    const cur = cityMinByService.get(cp.serviceId);
    if (cur === undefined || cp.priceKzt < cur) {
      cityMinByService.set(cp.serviceId, cp.priceKzt);
    }
    citySum += cp.priceKzt;
    cityCount++;
  }
  const cityAvg = cityCount > 0 ? citySum / cityCount : 0;

  // best_price: this clinic has the lowest price for ANY service in its city.
  let hasBestPrice = false;
  for (const p of prices) {
    const cityMin = cityMinByService.get(p.serviceId);
    if (cityMin !== undefined && p.priceKzt <= cityMin) {
      hasBestPrice = true;
      break;
    }
  }

  // fair_price: this clinic's avgPrice is within ±15% of city-wide avgPrice.
  let isFairPrice = false;
  if (cityAvg > 0 && avgPrice > 0) {
    const ratio = avgPrice / cityAvg;
    isFairPrice =
      ratio >= 1 - FAIR_PRICE_TOLERANCE && ratio <= 1 + FAIR_PRICE_TOLERANCE;
  }
  const badges: string[] = [];
  if (hasBestPrice) badges.push("best_price");
  if (isFairPrice) badges.push("fair_price");

  // Backward-compat: legacy `services` array + legacy stats keys used by
  // clinic-detail-dialog.tsx (NOT touched by this task).
  const services = prices.map((p) => ({
    id: p.id,
    serviceNameRaw: p.serviceNameRaw,
    priceKzt: p.priceKzt,
    currency: p.currency,
    durationDays: p.durationDays,
    parsedAt: p.parsedAt,
    service: {
      id: p.service.id,
      nameRu: p.service.nameRu,
      nameKk: p.service.nameKk,
      nameEn: p.service.nameEn,
      category: p.service.category,
      synonyms: safeArr(p.service.synonyms),
      osmsCoverage: normalizeOsms(p.service.osmsCoverage),
    },
  }));

  const byCategory = services.reduce<Record<string, number>>((acc, s) => {
    acc[s.service.category] = (acc[s.service.category] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    clinic: {
      id: clinic.id,
      name: clinic.clinicName,
      city: clinic.city,
      address: clinic.address,
      phone: clinic.phone,
      workingHours: clinic.workingHours,
      sourceUrl: clinic.sourceUrl,
      website: clinic.website,
      rating: clinic.rating,
      onlineBooking: clinic.onlineBooking,
      latitude: clinic.latitude,
      longitude: clinic.longitude,
      description: clinic.description,
    },
    stats: {
      // New spec fields
      totalServices,
      minPrice,
      maxPrice,
      avgPrice,
      freshCount,
      recentCount,
      staleCount,
      // Legacy fields (used by clinic-detail-dialog.tsx — DO NOT remove)
      servicesCount: totalServices,
      byCategory,
      lastUpdated,
    },
    topCheapest,
    priceHistory,
    badges,
    // Legacy field kept for clinic-detail-dialog.tsx backward compat.
    services,
    elapsedMs: Date.now() - t0,
  });
}
