/**
 * GET /api/v1/heatmap
 * Price Volatility Heatmap — DETERMINISTIC aggregation (no AI).
 *
 * Groups all active normalized prices by service / city / category and computes
 * min / max / avg / count / spreadPct for each group. Drops groups with fewer
 * than `min_samples` price observations (default 2) so a single-clinic outlier
 * is never misreported as a "100% spread". Sorts by spreadPct descending — the
 * most volatile groups bubble to the top, which surfaces the biggest
 * cross-clinic savings opportunities first.
 *
 * Query params:
 *  - group_by    "service" | "city" | "category"   (default: "service")
 *  - city        optional city filter (matches clinic.city)
 *  - category    optional category filter (matches service.category)
 *  - min_samples int, default 2 (groups with fewer price rows are dropped)
 *  - limit       int, default 50, max 200
 *
 * Response:
 *  {
 *    groupBy: "service" | "city" | "category",
 *    rows: [{ key, label, count, min, max, avg, spreadPct }],
 *    elapsedMs: number
 *  }
 *
 * Notes:
 *  - All aggregation is deterministic; results are reproducible for the same DB
 *    state. No AI / LLM calls anywhere.
 *  - The `count` field is the number of active normalized price rows in the
 *    group (one row per (clinic, service) pair). For group_by=service this is
 *    exactly the number of clinics offering that service; for group_by=city and
 *    group_by=category it is the total price-row count which may exceed the
 *    number of distinct clinics.
 *  - `spreadPct = round((max - min) / avg * 100)` with a divide-by-zero guard
 *    (avg == 0 → spreadPct = 0).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupBy = "service" | "city" | "category";

function parseGroupBy(v: string | null): GroupBy {
  if (v === "city" || v === "category" || v === "service") return v;
  return "service";
}

/** Parse an int query param with bounds. Bad input → default. */
function parseInt32(
  v: string | null,
  def: number,
  min: number,
  max: number
): number {
  if (v == null || v.trim() === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function asStr(v: string | null): string | null {
  return v && v.trim() ? v.trim() : null;
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const sp = req.nextUrl.searchParams;

  const groupBy = parseGroupBy(sp.get("group_by"));
  const cityFilter = asStr(sp.get("city"));
  const categoryFilter = asStr(sp.get("category"));
  const minSamples = parseInt32(sp.get("min_samples"), 2, 1, 1000);
  const limit = parseInt32(sp.get("limit"), 50, 1, 200);

  // Build the where clause with optional city/category filters via relations.
  // Prisma's relation filters work on SQLite and produce a single SQL query.
  // `any` is intentional here — Prisma's generated `WhereInput` type for a
  // relation filter is verbose; the project's eslint config already disables
  // `@typescript-eslint/no-explicit-any`.
  const where: { isActive: boolean; clinic?: { city: string }; service?: { category: string } } = { isActive: true };
  if (cityFilter) {
    where.clinic = { city: cityFilter };
  }
  if (categoryFilter) {
    where.service = { category: categoryFilter };
  }

  const prices = await db.normalizedPrice.findMany({
    where,
    select: {
      priceKzt: true,
      clinicId: true,
      serviceId: true,
      clinic: { select: { city: true } },
      service: {
        select: {
          id: true,
          nameRu: true,
          nameKk: true,
          nameEn: true,
          category: true,
        },
      },
    },
  });

  // Aggregate into groups based on the chosen dimension.
  type Acc = { prices: number[]; label: string };
  const groups = new Map<string, Acc>();

  for (const p of prices) {
    let key: string;
    let label: string;
    if (groupBy === "service") {
      key = p.serviceId;
      // Prefer the Russian name as the canonical label (most clinic data is
      // in Russian); fall back to English / Kazakh / id.
      label = p.service.nameRu || p.service.nameEn || p.service.nameKk || p.serviceId;
    } else if (groupBy === "city") {
      key = p.clinic.city;
      label = p.clinic.city;
    } else {
      key = p.service.category;
      label = p.service.category;
    }
    let acc = groups.get(key);
    if (!acc) {
      acc = { prices: [], label };
      groups.set(key, acc);
    }
    acc.prices.push(p.priceKzt);
  }

  const rows = Array.from(groups.entries())
    .map(([key, acc]) => {
      const count = acc.prices.length;
      // Defensive: count > 0 is guaranteed by construction (we only add to
      // the map when we see a price), but guard anyway.
      if (count === 0) {
        return { key, label: acc.label, count: 0, min: 0, max: 0, avg: 0, spreadPct: 0 };
      }
      let min = acc.prices[0];
      let max = acc.prices[0];
      let sum = 0;
      for (const v of acc.prices) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      const avg = sum / count;
      const spreadPct = avg > 0 ? Math.round(((max - min) / avg) * 100) : 0;
      return {
        key,
        label: acc.label,
        count,
        min,
        max,
        avg: Math.round(avg),
        spreadPct,
      };
    })
    .filter((r) => r.count >= minSamples)
    .sort((a, b) => b.spreadPct - a.spreadPct)
    .slice(0, limit);

  return NextResponse.json({
    groupBy,
    rows,
    elapsedMs: Date.now() - t0,
  });
}
