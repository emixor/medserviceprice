/**
 * Shared formatting + type helpers used across the frontend.
 */
import { localizedCity, localizedServiceName, type Lang } from "@/lib/i18n";

/**
 * Conversion rates relative to KZT (the canonical storage currency).
 * `EXCHANGE_RATES.KZT` is always 1; other rates are "1 unit = N KZT".
 */
export const EXCHANGE_RATES: Record<string, number> = {
  KZT: 1,
  USD: 450,
  RUB: 5,
};

export type Currency = "KZT" | "USD" | "RUB";

/** Format a KZT price with thousands separators and the ₸ suffix. */
export function formatKzt(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₸";
}

/**
 * Format a KZT-amount price in the requested display currency.
 * - KZT: "1 550 ₸"  (ru-RU thousands separators, rounded)
 * - USD: "$12.50"   (1 USD = 450 KZT, 2 decimals)
 * - RUB: "1 200 ₽"  (1 RUB = 5 KZT, rounded)
 */
export function formatPrice(amountKzt: number, currency: Currency): string {
  if (!Number.isFinite(amountKzt)) return "—";
  switch (currency) {
    case "USD": {
      const usd = amountKzt / EXCHANGE_RATES.USD;
      return "$" + usd.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    case "RUB": {
      const rub = amountKzt / EXCHANGE_RATES.RUB;
      return new Intl.NumberFormat("ru-RU").format(Math.round(rub)) + " ₽";
    }
    case "KZT":
    default:
      return formatKzt(amountKzt);
  }
}

export type Clinic = {
  id: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  workingHours: string;
  rating: number;
  onlineBooking: boolean;
  website: string | null;
  sourceUrl: string;
  latitude: number | null;
  longitude: number | null;
};

export type ServiceRef = {
  id: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  category: string;
  synonyms: string[];
  /** OSMS (Обязательное социальное медицинское страхование) coverage hint.
   * "likely" = service typically covered by state insurance for insured patients.
   * "unlikely" = service typically not covered (cosmetic, elective, premium).
   * "unknown" / null = no data; UI shows "informational only" disclaimer. */
  osmsCoverage?: "likely" | "unlikely" | "unknown";
};

export type SearchResult = {
  id: string;
  priceKzt: number;
  currency: string;
  durationDays: number | null;
  parsedAt: string;
  isActive: boolean;
  serviceNameRaw: string;
  clinic: Clinic;
  service: ServiceRef;
  /** Per-service stats across the *current* search-result set. */
  serviceStats?: ServiceStats;
  /** Distance (km) from the user's geo location, if `geo` was provided. */
  distanceKm?: number | null;
  /** Freshness bucket for stale-data flagging. */
  freshness?: { daysAgo: number; bucket: "fresh" | "recent" | "stale" };
};

/** Aggregated stats for one service across the active search-result set. */
export type ServiceStats = {
  /** Number of clinics offering this service in the current result set. */
  clinicCount: number;
  /** Minimum price for this service across the current result set. */
  min: number;
  /** Maximum price for this service across the current result set. */
  max: number;
  /** Average price for this service across the current result set. */
  avg: number;
};

/** Haversine distance in km between two coordinates. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type ServiceDirectoryItem = ServiceRef & {
  description: string | null;
  unit: string | null;
};

export type UnmatchedItem = {
  id: string;
  serviceNameRaw: string;
  clinicNameRaw: string;
  cityNameRaw: string;
  priceRaw: number;
  currencyRaw: string;
  sourceName: string;
  confidence: number;
  parsedAt: string;
  status: string;
  suggestedService: { id: string; nameRu: string } | null;
};

export type ClinicDetail = {
  clinic: Clinic & { description: string | null };
  services: {
    id: string;
    serviceNameRaw: string;
    priceKzt: number;
    currency: string;
    durationDays: number | null;
    parsedAt: string;
    service: ServiceRef;
  }[];
  stats: {
    servicesCount: number;
    minPrice: number;
    maxPrice: number;
    avgPrice: number;
    byCategory: Record<string, number>;
    lastUpdated: string | null;
  };
};

export type HistoryPoint = { date: string; min: number | null; max: number | null; avg: number | null };
export type PerClinicSeries = {
  clinic: { id: string; name: string; city: string };
  series: { date: string; priceKzt: number }[];
};
export type ServiceHistory = {
  service: ServiceRef;
  overallSeries: HistoryPoint[];
  perClinic: PerClinicSeries[];
  currentCount: number;
  historyCount: number;
};

export type CompareMatrix = {
  services: ServiceRef[];
  clinics: { id: string; name: string; city: string; rating: number; onlineBooking: boolean }[];
  matrix: {
    service: ServiceRef;
    cells: { clinicId: string; found: boolean; priceKzt: number | null; durationDays: number | null; parsedAt: string | null }[];
    stats: { min: number | null; max: number | null; avg: number | null; clinicCount: number };
  }[];
};

/** Service detail returned by /api/v1/services/[id]/detail */
export type ServiceOffering = {
  id: string;
  priceKzt: number;
  currency: string;
  durationDays: number | null;
  parsedAt: string;
  serviceNameRaw: string;
  clinic: Clinic;
};

export type ServiceDetail = {
  service: ServiceRef & { description: string | null; unit: string | null };
  offerings: ServiceOffering[];
  stats: {
    clinicCount: number;
    min: number;
    max: number;
    avg: number;
    median: number;
    spread: number;
    spreadPct: number;
  };
  distribution: { bucket: string; count: number; lo: number; hi: number }[];
  history: HistoryPoint[];
  historyCount: number;
};

/** Format a plain number with thousands separators (no currency). */
export function formatNum(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

/** Format a date as a relative "Xd ago" / "today" style label. */
export function relativeDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / dayMs);
  if (days <= 0) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    if (hours <= 0) return lang === "kk" ? "қазір" : lang === "en" ? "now" : "сейчас";
    if (lang === "en") return `${hours}h ago`;
    if (lang === "kk") return `${hours} сағ бұрын`;
    return `${hours} ч назад`;
  }
  if (lang === "en") return days === 1 ? "1 day ago" : `${days} days ago`;
  if (lang === "kk") return days === 1 ? "1 күн бұрын" : `${days} күн бұрын`;
  return days === 1 ? "1 день назад" : `${days} дн. назад`;
}

/** Absolute short date (e.g. 26.06.2025). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** Check if a parsed-at date is older than 30 days (stale). */
export function isStale(iso: string): boolean {
  const d = new Date(iso).getTime();
  return Date.now() - d > 30 * 24 * 60 * 60 * 1000;
}

/** Render a star rating string like "4.6 ★". */
export function ratingStars(r: number): string {
  return r.toFixed(1);
}

/** Localized service name helper bound to a lang. */
export function svcName(svc: ServiceRef | null | undefined, lang: Lang): string {
  return localizedServiceName(svc, lang);
}

/** Localized city helper. */
export function cityName(city: string, lang: Lang): string {
  return localizedCity(city, lang);
}

/** Build query string from a filter object for the search API. */
export function filtersToQuery(f: {
  q: string;
  city: string;
  category: string;
  priceMin: string;
  priceMax: string;
  ratingMin: string;
  onlineBooking: boolean;
  excludeStale?: boolean;
  sort: string;
  limit?: number;
  offset?: number;
  geo?: { lat: number; lng: number } | null;
}): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.city) p.set("city", f.city);
  if (f.category) p.set("category", f.category);
  if (f.priceMin) p.set("price_min", f.priceMin);
  if (f.priceMax) p.set("price_max", f.priceMax);
  if (f.ratingMin) p.set("rating_min", f.ratingMin);
  if (f.onlineBooking) p.set("online_booking", "true");
  if (f.excludeStale) p.set("exclude_stale", "true");
  if (f.sort) p.set("sort", f.sort);
  if (f.limit) p.set("limit", String(f.limit));
  if (f.offset) p.set("offset", String(f.offset));
  if (f.geo) {
    p.set("lat", String(f.geo.lat));
    p.set("lng", String(f.geo.lng));
  }
  return p.toString();
}

/** Minimal fetcher for react-query. */
export async function fetcher<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Generate a deterministic clinic avatar: 1-2 letter initials extracted from
 * the clinic name (handles Cyrillic + Latin), plus a stable hue derived from
 * a djb2-style hash of the name. Returns the hue (0–359) and the initials so
 * callers can render the colored badge with whatever size/shape they want
 * (the `.clinic-avatar` CSS class in globals.css consumes the `--ca-hue`
 * custom property to pick light/dark-mode-appropriate bg/fg colors).
 */
export function clinicAvatar(name: string): {
  initials: string;
  hue: number;
} {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  let initials = "";
  if (words.length >= 2) {
    initials = (words[0][0] + words[1][0]).toUpperCase();
  } else if (words.length === 1) {
    initials = words[0].slice(0, 2).toUpperCase();
  }

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;

  return { initials: initials || "?", hue };
}
