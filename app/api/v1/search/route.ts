/**
 * GET /api/v1/search
 * Full-text search with filters and autocomplete.
 *
 * IMPORTANT: SQLite's LOWER() only lowercases ASCII, so Cyrillic "ОАК" would
 * never match a lowercase query "оак" at the SQL level. We therefore apply the
 * text query (`q`) in JavaScript using Unicode-aware `.toLowerCase()` after
 * fetching rows that satisfy the non-text filters (city, category, price,
 * rating, online_booking) via Prisma. The dataset is small enough that this is
 * instantaneous and is correct for KK/RU/EN simultaneously.
 *
 * Query params:
 *  - q            search query (service name RU/KK/EN/synonyms, or clinic name)
 *  - city         clinic city filter
 *  - category     laboratory | doctor_appointment | diagnostics | procedure
 *  - price_min    minimum price (KZT)
 *  - price_max    maximum price (KZT)
 *  - rating_min   minimum clinic rating
 *  - online_booking "true" to only include clinics with online booking
 *  - exclude_stale "true" => hide rows whose parsedAt is older than STALE_DAYS (30)
 *  - sort         price_asc | price_desc | rating_desc | parsed_desc | distance_asc
 *  - limit        page size (default 30, max 100)
 *  - offset       pagination offset
 *  - suggest      "true" => return only service-directory autocomplete suggestions
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rows older than this many days are considered "stale" (archived). */
const STALE_DAYS = 30;

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

function safeArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Build a haystack string for a service (RU/KK/EN + synonyms), lowercased. */
function serviceHaystack(svc: {
  nameRu: string;
  nameKk: string;
  nameEn: string;
  synonyms: string | null;
}): string {
  const syn = safeArr(svc.synonyms).join(" ");
  return `${svc.nameRu} ${svc.nameKk} ${svc.nameEn} ${syn}`.toLowerCase();
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const sp = req.nextUrl.searchParams;

  const q = asStr(sp.get("q"));
  const city = asStr(sp.get("city"));
  const category = asStr(sp.get("category"));
  const priceMin = asNum(sp.get("price_min"));
  const priceMax = asNum(sp.get("price_max"));
  const ratingMin = asNum(sp.get("rating_min"));
  const onlineBooking = asBool(sp.get("online_booking"));
  const excludeStale = asBool(sp.get("exclude_stale")) === true;
  const sort = asStr(sp.get("sort")) ?? "price_asc";
  const limit = Math.min(Math.max(asNum(sp.get("limit")) ?? 30, 1), 100);
  const offset = Math.max(asNum(sp.get("offset")) ?? 0, 0);
  const suggest = asBool(sp.get("suggest")) === true;
  const qLower = q ? q.toLowerCase() : null;

  // Geolocation (for distance_asc sort)
  const lat = asNum(sp.get("lat"));
  const lng = asNum(sp.get("lng"));
  const hasGeo = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

  // --- Autocomplete path: JS-filter the directory (Unicode-aware) ---
  // Returns each match with a `matchedOn` hint telling the frontend WHICH
  // field matched the query (nameRu | nameKk | nameEn | synonym), plus the
  // matched synonym string when the hit was on a synonym. This lets the UI
  // show e.g. "CBC → Общий анализ крови (ОАК)" in the dropdown.
  if (suggest && q) {
    const services = await db.serviceDirectory.findMany({
      orderBy: { nameRu: "asc" },
    });
    const scored = services
      .map((s) => {
        const syns = safeArr(s.synonyms);
        let matchedOn: "nameRu" | "nameKk" | "nameEn" | "synonym" | null = null;
        let matchedSynonym: string | null = null;
        if (s.nameRu.toLowerCase().includes(qLower!)) matchedOn = "nameRu";
        else if (s.nameKk.toLowerCase().includes(qLower!)) matchedOn = "nameKk";
        else if (s.nameEn.toLowerCase().includes(qLower!)) matchedOn = "nameEn";
        else {
          for (const syn of syns) {
            if (syn.toLowerCase().includes(qLower!)) {
              matchedOn = "synonym";
              matchedSynonym = syn;
              break;
            }
          }
        }
        return { s, syns, matchedOn, matchedSynonym };
      })
      .filter((x) => x.matchedOn !== null)
      .slice(0, 12);
    return NextResponse.json({
      suggestions: scored.map((x) => ({
        id: x.s.id,
        nameRu: x.s.nameRu,
        nameKk: x.s.nameKk,
        nameEn: x.s.nameEn,
        category: x.s.category,
        synonyms: x.syns,
        osmsCoverage: (x.s.osmsCoverage ?? "unknown") as "likely" | "unlikely" | "unknown",
        matchedOn: x.matchedOn,
        matchedSynonym: x.matchedSynonym,
      })),
      elapsedMs: Date.now() - t0,
    });
  }

  // --- Build non-text SQL filters ---
  const where: Record<string, unknown> = { isActive: true };
  if (excludeStale) {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    where.parsedAt = { gte: cutoff };
  }
  const serviceWhere: Record<string, unknown> = {};
  if (category) serviceWhere.category = category;
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
  if (Object.keys(clinicWhere).length) where.clinic = clinicWhere;

  // Fetch all rows matching non-text filters (text filtering done in JS).
  const rows = await db.normalizedPrice.findMany({
    where,
    include: { clinic: true, service: true },
    // no pagination yet — apply after JS text filtering
  });

  // Apply Unicode-aware text filter in JS
  const filtered = qLower
    ? rows.filter(
        (r) =>
          serviceHaystack(r.service).includes(qLower) ||
          r.clinic.clinicName.toLowerCase().includes(qLower) ||
          r.serviceNameRaw.toLowerCase().includes(qLower)
      )
    : rows;

  // Stale-data flagging: compute a freshness bucket per row for the UI badge.
  // (Only computed when exclude_stale is off, since otherwise all rows are fresh.)
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  function freshness(parsedAt: Date): { daysAgo: number; bucket: "fresh" | "recent" | "stale" } {
    const daysAgo = Math.floor((nowMs - parsedAt.getTime()) / dayMs);
    if (daysAgo <= 7) return { daysAgo, bucket: "fresh" };
    if (daysAgo <= STALE_DAYS) return { daysAgo, bucket: "recent" };
    return { daysAgo, bucket: "stale" };
  }

  // Sort
  const sorted = [...filtered];
  switch (sort) {
    case "price_desc":
      sorted.sort((a, b) => b.priceKzt - a.priceKzt);
      break;
    case "rating_desc":
      sorted.sort((a, b) => b.clinic.rating - a.clinic.rating || a.priceKzt - b.priceKzt);
      break;
    case "parsed_desc":
      sorted.sort((a, b) => b.parsedAt.getTime() - a.parsedAt.getTime());
      break;
    case "distance_asc":
      if (hasGeo) {
        sorted.sort((a, b) => {
          const da =
            a.clinic.latitude != null && a.clinic.longitude != null
              ? haversine(lat!, lng!, a.clinic.latitude, a.clinic.longitude)
              : Number.POSITIVE_INFINITY;
          const db_ =
            b.clinic.latitude != null && b.clinic.longitude != null
              ? haversine(lat!, lng!, b.clinic.latitude, b.clinic.longitude)
              : Number.POSITIVE_INFINITY;
          return da - db_;
        });
      } else {
        sorted.sort((a, b) => a.priceKzt - b.priceKzt);
      }
      break;
    case "price_asc":
    default:
      sorted.sort((a, b) => a.priceKzt - b.priceKzt);
  }

  // Compute per-service stats across the *full* filtered set (before pagination).
  // This powers the price-insight badges (Lowest / Below avg / Above avg / Highest).
  const statsByService = new Map<string, { min: number; max: number; sum: number; count: number }>();
  for (const r of sorted) {
    const s = statsByService.get(r.service.id);
    if (s) {
      if (r.priceKzt < s.min) s.min = r.priceKzt;
      if (r.priceKzt > s.max) s.max = r.priceKzt;
      s.sum += r.priceKzt;
      s.count += 1;
    } else {
      statsByService.set(r.service.id, {
        min: r.priceKzt,
        max: r.priceKzt,
        sum: r.priceKzt,
        count: 1,
      });
    }
  }

  const total = sorted.length;
  const paged = sorted.slice(offset, offset + limit);

  const items = paged.map((r) => {
    const s = statsByService.get(r.service.id);
    const serviceStats = s
      ? { clinicCount: s.count, min: s.min, max: s.max, avg: Math.round(s.sum / s.count) }
      : undefined;
    // Distance from geo (if provided) for display
    const distanceKm =
      hasGeo && r.clinic.latitude != null && r.clinic.longitude != null
        ? haversine(lat!, lng!, r.clinic.latitude, r.clinic.longitude)
        : null;
    const fresh = freshness(r.parsedAt);
    return {
      id: r.id,
      priceKzt: r.priceKzt,
      currency: r.currency,
      durationDays: r.durationDays,
      parsedAt: r.parsedAt,
      isActive: r.isActive,
      serviceNameRaw: r.serviceNameRaw,
      distanceKm,
      freshness: fresh,
      clinic: {
        id: r.clinic.id,
        name: r.clinic.clinicName,
        city: r.clinic.city,
        address: r.clinic.address,
        phone: r.clinic.phone,
        workingHours: r.clinic.workingHours,
        rating: r.clinic.rating,
        onlineBooking: r.clinic.onlineBooking,
        website: r.clinic.website,
        sourceUrl: r.clinic.sourceUrl,
        latitude: r.clinic.latitude,
        longitude: r.clinic.longitude,
      },
      service: {
        id: r.service.id,
        nameRu: r.service.nameRu,
        nameKk: r.service.nameKk,
        nameEn: r.service.nameEn,
        category: r.service.category,
        synonyms: safeArr(r.service.synonyms),
        osmsCoverage: (r.service.osmsCoverage ?? "unknown") as "likely" | "unlikely" | "unknown",
      },
      serviceStats,
    };
  });

  return NextResponse.json({
    items,
    total,
    limit,
    offset,
    elapsedMs: Date.now() - t0,
    filters: { q, city, category, priceMin, priceMax, ratingMin, onlineBooking, excludeStale, sort },
  });
}

/** Haversine distance in km. */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
