/**
 * GET /api/v1/admin/data-quality
 * Platform data-quality dashboard: detects anomalous prices, reports distribution
 * stats, currency anomalies, and stale raw entries.
 *
 * Anomaly detection uses the IQR (interquartile range) method per service:
 *   - Q1, Q3 computed from active normalized prices for the service
 *   - IQR = Q3 - Q1
 *   - Lower bound = Q1 - 1.5 * IQR, Upper bound = Q3 + 1.5 * IQR
 *   - Any price outside [lower, upper] is flagged as an outlier
 *   - Services with < 4 prices are skipped (not enough data for IQR)
 *
 * Returns:
 *   - summary: totalPrices, anomalousCount, anomalyPct, servicesChecked,
 *     servicesWithAnomaly, currencyMix, staleRawCount
 *   - distribution: min, p10, p25, p50, p75, p90, p99, max, mean
 *   - anomalies: top 50 flagged prices with service/clinic/price/bounds/score
 *   - byCategory: anomaly counts grouped by service category
 *   - byClinic: anomaly counts grouped by clinic
 *   - currencyMix: { KZT, USD, other } counts from raw_parsed_data
 *   - staleRaw: count of raw_parsed_data rows older than 7 days
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compute quantile (0..1) from a sorted numeric array. Linear interpolation. */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export async function GET(_req: NextRequest) {
  // 1. Load all active normalized prices with service + clinic context
  const prices = await db.normalizedPrice.findMany({
    where: { isActive: true },
    select: {
      id: true,
      priceKzt: true,
      serviceId: true,
      clinicId: true,
      updatedAt: true,
      service: {
        select: { id: true, nameEn: true, nameRu: true, nameKk: true, category: true },
      },
      clinic: {
        select: { id: true, clinicName: true, city: true },
      },
    },
  });

  if (!prices.length) {
    return NextResponse.json({
      summary: {
        totalPrices: 0,
        anomalousCount: 0,
        anomalyPct: 0,
        servicesChecked: 0,
        servicesWithAnomaly: 0,
        currencyMix: { KZT: 0, USD: 0, other: 0 },
        staleRawCount: 0,
      },
      distribution: null,
      anomalies: [],
      byCategory: [],
      byClinic: [],
      currencyMix: { KZT: 0, USD: 0, other: 0 },
      staleRawCount: 0,
    });
  }

  // 2. Group prices by serviceId for IQR computation
  const byService = new Map<string, typeof prices>();
  for (const p of prices) {
    if (!byService.has(p.serviceId)) byService.set(p.serviceId, []);
    byService.get(p.serviceId)!.push(p);
  }

  type Anomaly = {
    id: string;
    serviceId: string;
    serviceName: string;
    serviceNameRu: string;
    category: string;
    clinicId: string;
    clinicName: string;
    clinicCity: string;
    priceKzt: number;
    serviceMedian: number;
    lowerBound: number;
    upperBound: number;
    deviationPct: number; // how far outside the bound, as % of bound
    direction: "high" | "low";
    severity: "warn" | "critical";
    updatedAt: string;
  };

  const anomalies: Anomaly[] = [];
  const servicesWithAnomalySet = new Set<string>();
  const byCategoryMap = new Map<string, number>();
  const byClinicMap = new Map<string, number>();

  for (const [serviceId, svcPrices] of byService.entries()) {
    if (svcPrices.length < 4) continue; // need ≥ 4 data points for IQR
    const sorted = svcPrices.map((p) => p.priceKzt).sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const median = quantile(sorted, 0.5);

    for (const p of svcPrices) {
      let direction: "high" | "low" | null = null;
      let bound = 0;
      if (p.priceKzt > upper && upper > 0) {
        direction = "high";
        bound = upper;
      } else if (p.priceKzt < lower && lower > 0) {
        direction = "low";
        bound = lower;
      }
      if (!direction) continue;

      const deviationPct = bound > 0 ? Math.round(((p.priceKzt - bound) / bound) * 100) : 0;
      const absDeviationPct = Math.abs(deviationPct);
      const severity: "warn" | "critical" = absDeviationPct >= 100 ? "critical" : "warn";

      anomalies.push({
        id: p.id,
        serviceId,
        serviceName: p.service.nameEn,
        serviceNameRu: p.service.nameRu,
        category: p.service.category,
        clinicId: p.clinicId,
        clinicName: p.clinic.clinicName,
        clinicCity: p.clinic.city,
        priceKzt: p.priceKzt,
        serviceMedian: Math.round(median),
        lowerBound: Math.round(Math.max(0, lower)),
        upperBound: Math.round(upper),
        deviationPct,
        direction,
        severity,
        updatedAt: p.updatedAt.toISOString(),
      });
      servicesWithAnomalySet.add(serviceId);
      byCategoryMap.set(p.service.category, (byCategoryMap.get(p.service.category) ?? 0) + 1);
      byClinicMap.set(p.clinicId, (byClinicMap.get(p.clinicId) ?? 0) + 1);
    }
  }

  // Sort anomalies: critical first, then by abs deviation descending
  anomalies.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return Math.abs(b.deviationPct) - Math.abs(a.deviationPct);
  });
  const topAnomalies = anomalies.slice(0, 50);

  // 3. Global distribution stats
  const allSorted = prices.map((p) => p.priceKzt).sort((a, b) => a - b);
  const sum = allSorted.reduce((a, b) => a + b, 0);
  const distribution = {
    min: allSorted[0] ?? 0,
    p10: Math.round(quantile(allSorted, 0.1)),
    p25: Math.round(quantile(allSorted, 0.25)),
    p50: Math.round(quantile(allSorted, 0.5)),
    p75: Math.round(quantile(allSorted, 0.75)),
    p90: Math.round(quantile(allSorted, 0.9)),
    p99: Math.round(quantile(allSorted, 0.99)),
    max: allSorted[allSorted.length - 1] ?? 0,
    mean: Math.round(sum / allSorted.length),
  };

  // 4. Currency mix from raw_parsed_data
  const rawRows = await db.rawParsedData.findMany({
    select: { currencyRaw: true, parsedAt: true },
  });
  const currencyMix: { KZT: number; USD: number; other: number } = { KZT: 0, USD: 0, other: 0 };
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let staleRawCount = 0;
  for (const r of rawRows) {
    const c = (r.currencyRaw || "").toUpperCase();
    if (c === "KZT") currencyMix.KZT++;
    else if (c === "USD") currencyMix.USD++;
    else currencyMix.other++;
    if (r.parsedAt < sevenDaysAgo) staleRawCount++;
  }

  // 5. Assemble byCategory and byClinic (top 10)
  const clinicLookup = new Map(
    (await db.clinic.findMany({ select: { id: true, clinicName: true, city: true } }))
      .map((c) => [c.id, c])
  );
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
  const byClinic = Array.from(byClinicMap.entries())
    .map(([clinicId, count]) => {
      const c = clinicLookup.get(clinicId);
      return {
        clinicId,
        clinicName: c?.clinicName || "Unknown",
        city: c?.city || "",
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 6. Summary
  const anomalousCount = anomalies.length;
  const anomalyPct = prices.length ? Math.round((anomalousCount / prices.length) * 100) : 0;

  return NextResponse.json({
    summary: {
      totalPrices: prices.length,
      anomalousCount,
      anomalyPct,
      servicesChecked: byService.size,
      servicesWithAnomaly: servicesWithAnomalySet.size,
      currencyMix,
      staleRawCount,
    },
    distribution,
    anomalies: topAnomalies,
    byCategory,
    byClinic,
    currencyMix,
    staleRawCount,
    generatedAt: new Date().toISOString(),
  });
}
