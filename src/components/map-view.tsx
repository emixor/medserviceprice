"use client";

import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { fetcher, type Clinic, cityName, formatKzt } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Map as MapIcon,
  Star,
  Phone,
  Building2,
  Navigation,
  TrendingUp,
  Sparkles,
  CircleDollarSign,
  Coins,
  Gem,
  Layers,
  BadgeCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { CITY_LABELS, type Lang } from "@/lib/i18n";
import type { LatLngExpression } from "leaflet";

// Load the leaflet-backed map block only on the client (leaflet touches `window`).
const MapBlock = dynamic(() => import("./map-block"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading map…</div>
  ),
});

const CITY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
  "Алматы": { lat: 43.222, lng: 76.8512, zoom: 12 },
  "Астана": { lat: 51.1605, lng: 71.4704, zoom: 12 },
  "Шымкент": { lat: 42.3417, lng: 69.59, zoom: 12 },
  "Актобе": { lat: 50.2839, lng: 57.167, zoom: 12 },
  "Павлодар": { lat: 52.2873, lng: 76.9676, zoom: 12 },
  "Караганда": { lat: 49.8047, lng: 73.1094, zoom: 12 },
  "Семей": { lat: 50.4116, lng: 80.2236, zoom: 12 },
  "Атырау": { lat: 47.1164, lng: 51.8823, zoom: 12 },
};

const ALL_CENTERS = { lat: 48.5, lng: 67.0, zoom: 5 };

// Tier thresholds (KZT): cheap < 3000, mid 3000–10000, premium > 10000
const TIER_CHEAP_MAX = 3000;
const TIER_MID_MAX = 10000;

type Tier = "cheap" | "mid" | "premium";

type ClinicWithStats = Clinic & {
  priceStats: { count: number; min: number | null; max: number | null; avg: number | null };
};

function tierFor(c: ClinicWithStats): Tier {
  // Use *min* price (not avg) — avg is skewed by high-ticket MRI items.
  // Min price reflects the clinic's starting/entry-level price.
  const m = c.priceStats.min;
  if (m == null) return "mid";
  if (m < TIER_CHEAP_MAX) return "cheap";
  if (m < TIER_MID_MAX) return "mid";
  return "premium";
}

const TIER_COLOR: Record<Tier, string> = {
  cheap: "#16a34a", // green-600
  mid: "#f59e0b", // amber-500
  premium: "#dc2626", // red-600
};

const CITY_COLORS = [
  "#0d9488",
  "#0891b2",
  "#65a30d",
  "#ca8a04",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#0284c7",
];

/** Extract up to 2 leading letters of a clinic name for the avatar bubble. */
function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // Split on whitespace and take first letter of the first two tokens; fall back
  // to the first two chars of the name if there's only one token (or it starts
  // with a non-letter, e.g. a digit).
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return (tokens[0][0] + tokens[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function MapView() {
  const { t, lang } = useI18n();
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);
  const [city, setCity] = useState<string>("__all__");
  const [tierFilter, setTierFilter] = useState<Tier | "all">("all");

  const { data, isLoading } = useQuery<{ clinics: ClinicWithStats[] }>({
    queryKey: ["clinics-map", city],
    queryFn: () =>
      fetcher(
        `/api/v1/clinics?with_stats=true${
          city !== "__all__" ? `&city=${encodeURIComponent(city)}` : ""
        }`
      ),
    staleTime: 60_000,
  });

  const allClinics = data?.clinics ?? [];
  const validClinics = allClinics.filter((c) => c.latitude != null && c.longitude != null);

  // Tier counts for the filter chips
  const tierCounts = useMemo(() => {
    const c = { cheap: 0, mid: 0, premium: 0 };
    for (const cl of validClinics) c[tierFor(cl)]++;
    return c;
  }, [validClinics]);

  // Number of unique cities represented in the loaded set (for the subtitle).
  const cityCount = useMemo(
    () => new Set(validClinics.map((c) => c.city)).size,
    [validClinics]
  );

  // Apply tier filter
  const filtered =
    tierFilter === "all"
      ? validClinics
      : validClinics.filter((c) => tierFor(c) === tierFilter);

  const center = useMemo<LatLngExpression>(() => {
    if (city !== "__all__" && CITY_CENTERS[city]) {
      const c = CITY_CENTERS[city];
      return [c.lat, c.lng] as LatLngExpression;
    }
    return [ALL_CENTERS.lat, ALL_CENTERS.lng] as LatLngExpression;
  }, [city]);

  const zoom = city !== "__all__" && CITY_CENTERS[city] ? CITY_CENTERS[city].zoom : ALL_CENTERS.zoom;

  // Color by tier (more useful than by city for medical pricing context)
  const colorFor = (c: ClinicWithStats) => TIER_COLOR[tierFor(c)];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 msp-fade-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <MapIcon className="h-6 w-6 text-primary" />
            {t("map.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("map.subtitle", {
              count: validClinics.length,
              cities: cityCount,
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="h-9 w-[200px] gap-1.5 text-sm">
              <Navigation className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder={t("map.selectCity")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("map.allCities")}</SelectItem>
              {Object.keys(CITY_CENTERS).map((c) => (
                <SelectItem key={c} value={c}>
                  {cityLabel(c, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="h-9 gap-1.5 bg-primary/10 px-3 text-primary">
            <Building2 className="h-3.5 w-3.5" />
            {filtered.length} {t("stats.clinics").toLowerCase()}
          </Badge>
        </div>
      </div>

      {/* Price-tier legend + filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/80 p-3 shadow-sm backdrop-blur-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("map.filterByTier")}:
        </span>
        <TierChip
          active={tierFilter === "all"}
          onClick={() => setTierFilter("all")}
          color="var(--primary)"
          label={t("filters.allCities")}
          count={validClinics.length}
        />
        <TierChip
          active={tierFilter === "cheap"}
          onClick={() => setTierFilter("cheap")}
          color={TIER_COLOR.cheap}
          label={t("map.cheap")}
          count={tierCounts.cheap}
          Icon={CircleDollarSign}
        />
        <TierChip
          active={tierFilter === "mid"}
          onClick={() => setTierFilter("mid")}
          color={TIER_COLOR.mid}
          label={t("map.mid")}
          count={tierCounts.mid}
          Icon={Coins}
        />
        <TierChip
          active={tierFilter === "premium"}
          onClick={() => setTierFilter("premium")}
          color={TIER_COLOR.premium}
          label={t("map.premium")}
          count={tierCounts.premium}
          Icon={Gem}
        />
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
          <Sparkles className="h-3 w-3" />
          {t("map.priceTier")}: &lt; 3 000 ₸ · 3 000–10 000 ₸ · &gt; 10 000 ₸
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Map */}
        <Card className="card-premium overflow-hidden p-0">
          <div className="h-[520px] w-full sm:h-[600px]">
            <MapBlock
              clinics={filtered}
              center={center}
              zoom={zoom}
              colorFor={colorFor}
              onPick={setSelectedClinic}
            />
          </div>
        </Card>

        {/* Clinic list */}
        <Card className="card-premium flex max-h-[600px] flex-col p-0">
          <div className="border-b border-border/60 bg-gradient-to-r from-muted/40 to-transparent px-4 py-3">
            <h3 className="text-sm font-bold tracking-tight">
              {filtered.length} {t("stats.clinics").toLowerCase()}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("map.priceTier")} · {t("map.filterByTier")}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">{t("search.noResults")}</div>
            ) : (
              <ul className="divide-y divide-border/50">
                {filtered.map((c) => {
                  const tier = tierFor(c);
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelectedClinic(c.id)}
                        className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-all duration-200 hover:bg-accent/50 hover:shadow-sm"
                      >
                        <span
                          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white shadow-sm transition-transform duration-200 group-hover:scale-110 [box-shadow:0_4px_8px_-2px_rgba(0,0,0,0.2)]"
                          style={{ background: TIER_COLOR[tier] }}
                          aria-hidden
                        >
                          {initials(c.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="block truncate text-sm font-semibold transition-colors group-hover:text-primary">
                              {c.name}
                            </span>
                            {c.rating >= 4.5 && (
                              <span className="msp-verified inline-flex shrink-0" aria-hidden>
                                <BadgeCheck className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                            {c.rating.toFixed(1)} · {cityName(c.city, lang)}
                          </span>
                          {c.priceStats?.count > 0 ? (
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                                <TrendingUp className="h-2.5 w-2.5" />
                                {t("map.priceFrom", { price: formatKzt(c.priceStats.min!) })}
                              </span>
                              <span className="text-muted-foreground">
                                · {t("map.clinicPrices", { count: c.priceStats.count })}
                              </span>
                            </span>
                          ) : (
                            <span className="mt-1 block text-[11px] text-muted-foreground">
                              {c.address}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Legend — what each tier color means, with a subtle gradient bar */}
      <Card className="card-premium mt-5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <Layers className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold">{t("map.legend")}</h3>
        </div>
        {/* Subtle gradient legend bar showing the price-tier spectrum */}
        <div className="mb-3 flex h-2 w-full overflow-hidden rounded-full">
          <div className="flex-1 bg-emerald-500" />
          <div className="flex-1 bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500" />
          <div className="flex-1 bg-rose-500" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LegendItem
            color={TIER_COLOR.cheap}
            Icon={CircleDollarSign}
            label={t("map.cheap")}
            description={`${t("map.priceTier")}: < 3 000 ₸`}
          />
          <LegendItem
            color={TIER_COLOR.mid}
            Icon={Coins}
            label={t("map.mid")}
            description={`${t("map.priceTier")}: 3 000–10 000 ₸`}
          />
          <LegendItem
            color={TIER_COLOR.premium}
            Icon={Gem}
            label={t("map.premium")}
            description={`${t("map.priceTier")}: > 10 000 ₸`}
          />
        </div>
      </Card>
    </div>
  );

  function TierChip({
    active,
    onClick,
    color,
    label,
    count,
    Icon,
  }: {
    active: boolean;
    onClick: () => void;
    color: string;
    label: string;
    count: number;
    Icon?: ComponentType<{ className?: string }>;
  }) {
    return (
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 hover:-translate-y-0.5 ${
          active
            ? "border-foreground/25 bg-gradient-to-r from-foreground/8 to-foreground/4 text-foreground shadow-sm [box-shadow:0_4px_10px_-2px_rgba(0,0,0,0.08)]"
            : "border-border bg-card/80 text-muted-foreground hover:border-foreground/20 hover:bg-accent/50 hover:text-foreground hover:shadow-sm"
        }`}
      >
        {Icon ? (
          <Icon className="h-3 w-3 shrink-0 transition-transform" style={active ? { color } : undefined} />
        ) : (
          <span
            className="h-2 w-2 rounded-full ring-2 ring-background"
            style={{ background: color }}
            aria-hidden
          />
        )}
        {label}
        <span className={cn(
          "rounded-full px-1.5 text-[10px] font-bold tabular-nums transition-colors",
          active ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground"
        )}>
          {count}
        </span>
      </button>
    );
  }
}

/** A single legend entry: colored dot + icon + label + description. */
function LegendItem({
  color,
  Icon,
  label,
  description,
}: {
  color: string;
  Icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/70 p-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-sm">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white shadow-sm [box-shadow:0_4px_8px_-2px_rgba(0,0,0,0.2)]"
        style={{ background: color }}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{description}</span>
      </span>
    </div>
  );
}

function cityLabel(city: string, lang: Lang): string {
  return CITY_LABELS[lang]?.[city] ?? city;
}
