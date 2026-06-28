/**
 * GET /api/v1/export/csv
 * Exports the current search results as a CSV file download.
 * Accepts the same query params as /api/v1/search (q, city, category,
 * price_min, price_max, rating_min, online_booking, sort).
 *
 * Returns text/csv with proper Content-Disposition header.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asStr(v: string | null): string | null {
  return v && v.trim() ? v.trim() : null;
}
function asNum(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: string | null): boolean | null {
  if (v == null) return null;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

/** CSV cell escaper — wraps in quotes if it contains comma, quote, or newline. */
function csvCell(s: string | number | null | undefined): string {
  if (s == null) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = asStr(sp.get("q"));
  const city = asStr(sp.get("city"));
  const category = asStr(sp.get("category"));
  const priceMin = asNum(sp.get("price_min"));
  const priceMax = asNum(sp.get("price_max"));
  const ratingMin = asNum(sp.get("rating_min"));
  const onlineBooking = asBool(sp.get("online_booking"));
  const sort = asStr(sp.get("sort")) ?? "price_asc";

  // Build non-text filters (same logic as search route)
  const where: Record<string, unknown> = { isActive: true };
  const serviceWhere: Record<string, unknown> = {};
  if (category) serviceWhere.category = category;
  if (q) serviceWhere.OR = [
    { nameRu: { contains: q } },
    { nameKk: { contains: q } },
    { nameEn: { contains: q } },
    { synonyms: { contains: q } },
  ];
  if (Object.keys(serviceWhere).length) where.service = serviceWhere;
  if (priceMin != null || priceMax != null) {
    const range: Record<string, number> = {};
    if (priceMin != null) range.gte = priceMin;
    if (priceMax != null) range.lte = priceMax;
    where.priceKzt = range;
  }
  const clinicWhere: Record<string, unknown> = {};
  if (city) clinicWhere.city = city;
  if (ratingMin != null) clinicWhere.rating = { gte: ratingMin };
  if (onlineBooking === true) clinicWhere.onlineBooking = true;
  if (q) clinicWhere.OR = [{ clinicName: { contains: q } }];
  if (Object.keys(clinicWhere).length) where.clinic = clinicWhere;

  const orderBy: Record<string, "asc" | "desc"> = {};
  switch (sort) {
    case "price_desc": orderBy.priceKzt = "desc"; break;
    case "rating_desc": orderBy.clinic = { rating: "desc" } as never; break;
    case "parsed_desc": orderBy.parsedAt = "desc"; break;
    default: orderBy.priceKzt = "asc";
  }

  const rows = await db.normalizedPrice.findMany({
    where,
    orderBy: orderBy as never,
    take: 1000,
    include: { clinic: true, service: true },
  });

  // Build CSV
  const header = [
    "clinic_name", "city", "address", "phone", "working_hours",
    "rating", "online_booking", "website",
    "service_name_ru", "service_name_kk", "service_name_en", "category",
    "service_name_raw", "price_kzt", "currency", "duration_days",
    "parsed_at", "source_url",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.clinic.clinicName,
      r.clinic.city,
      r.clinic.address,
      r.clinic.phone,
      r.clinic.workingHours,
      r.clinic.rating,
      r.clinic.onlineBooking ? "yes" : "no",
      r.clinic.website ?? "",
      r.service.nameRu,
      r.service.nameKk,
      r.service.nameEn,
      r.service.category,
      r.serviceNameRaw,
      r.priceKzt,
      r.currency,
      r.durationDays ?? "",
      r.parsedAt.toISOString(),
      r.clinic.sourceUrl,
    ].map(csvCell).join(","));
  }
  const csv = "\uFEFF" + lines.join("\r\n"); // BOM for Excel Cyrillic compatibility

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="medserviceprice_${Date.now()}.csv"`,
    },
  });
}
