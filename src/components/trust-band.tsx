"use client";

/**
 * TrustBand — a full-width premium section replacing the legacy "Why Use Us"
 * static cards. Fetches real platform insights from `/api/v1/insights` and
 * renders four data-rich cards that build trust:
 *
 *  1. Real Savings       — biggest single-service savings (₸) + sparkline accent
 *  2. Price Transparency — mini BarChart of the price-bucket distribution
 *  3. City Coverage      — top 5 cities with avg price + clinic count rows
 *  4. Top Savings Now    — top 3 services by absolute savings (min→max range)
 *
 * Loading state = shimmer skeletons per card. If the API call fails we render
 * a graceful fallback band instead of crashing.
 *
 * Layout: 1 col mobile → 2 col tablet → 4 col desktop.
 */
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { fetcher, formatPrice, cityName } from "@/lib/format";
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  PiggyBank,
  BarChart3,
  MapPin,
  TrendingDown,
  Sparkles,
  Building2,
} from "lucide-react";

type InsightsResponse = {
  cityAverages: {
    city: string;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    clinicCount: number;
    priceCount: number;
  }[];
  savingsStats: {
    maxSavingsKzt: number;
    avgSavingsPct: number;
    servicesWithSpread: number;
    totalServices: number;
  };
  priceBuckets: { label: string; count: number }[];
  topSavings: {
    name: string;
    savingsKzt: number;
    minPrice: number;
    maxPrice: number;
    savingsPct: number;
  }[];
};

/** Unified chart palette — emerald / teal / cyan / amber / rose / violet. */
const CHART_PALETTE = [
  "#10b981", // emerald-500
  "#14b8a6", // teal-500
  "#06b6d4", // cyan-500
  "#f59e0b", // amber-500
  "#f43f5e", // rose-500
  "#8b5cf6", // violet-500
];

/** City dot palette — colors for the city coverage rows. */
const CITY_DOT_COLORS = [
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#f59e0b",
  "#f43f5e",
];

/** Compact decorative sparkline for the "Real Savings" card. */
function SavingsSparkline() {
  // Static decorative shape (sweeping upward curve — no data dependency).
  const W = 96;
  const H = 28;
  const pts = [4, 8, 6, 12, 10, 18, 16, 22, 26];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const stepX = (W - 4) / (pts.length - 1);
  const path = pts
    .map((v, i) => {
      const x = 2 + i * stepX;
      const y = 2 + (H - 4) * (1 - (v - min) / range);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${path} L ${W - 2} ${H - 2} L 2 ${H - 2} Z`;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="opacity-70"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="savings-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(16, 185, 129, 0.28)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#savings-spark-fill)" />
      <path
        d={path}
        fill="none"
        stroke="#10b981"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrustBandSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="card-premium shimmer h-44 w-full rounded-2xl border border-border/40"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function TrustBandFallback() {
  const { t } = useI18n();
  return (
    <div className="card-premium rounded-2xl border-border/60 bg-card/80 p-8 text-center text-sm text-muted-foreground">
      <Sparkles className="mx-auto mb-2 h-6 w-6 text-primary/60" />
      {t("trust.title")}
    </div>
  );
}

export function TrustBand() {
  const { t, lang } = useI18n();
  const currency = useAppStore((s) => s.currency);

  const { data, isLoading, isError } = useQuery<InsightsResponse>({
    queryKey: ["insights"],
    queryFn: () => fetcher("/api/v1/insights"),
    staleTime: 60_000,
  });

  return (
    <section className="trust-band-bg relative -mx-4 mt-8 mb-2 px-4 py-8 sm:-mx-6 sm:px-6">
      <div className="mx-auto max-w-7xl">
        {/* Section header */}
        <div className="mb-6 text-center">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <Sparkles className="h-3 w-3" />
            {t("trust.title")}
          </div>
          <div className="mx-auto h-px w-24 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        </div>

        {isError ? (
          <TrustBandFallback />
        ) : isLoading ? (
          <TrustBandSkeleton />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Card 1 — Real Savings */}
            <div className="card-premium group flex flex-col gap-3 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <PiggyBank className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    {t("trust.realSavings")}
                  </div>
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <PiggyBank className="h-4 w-4" />
                </span>
              </div>
              <div>
                <div className="gradient-text stat-glow text-3xl font-black leading-none tabular-nums sm:text-4xl">
                  {data?.savingsStats?.maxSavingsKzt
                    ? formatPrice(data.savingsStats.maxSavingsKzt, currency)
                    : "—"}
                </div>
                <p className="mt-2 text-xs leading-snug text-muted-foreground">
                  {t("trust.maxSavingsDesc")}
                </p>
              </div>
              <div className="mt-auto flex items-end justify-between">
                <SavingsSparkline />
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                  <TrendingDown className="h-2.5 w-2.5" />
                  {data?.savingsStats?.avgSavingsPct ?? 0}%
                </span>
              </div>
            </div>

            {/* Card 2 — Price Transparency (BarChart) */}
            <div className="card-premium group flex flex-col gap-3 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <BarChart3 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                    {t("trust.priceTransparency")}
                  </div>
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-500/12 text-teal-600 dark:text-teal-400">
                  <BarChart3 className="h-4 w-4" />
                </span>
              </div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("trust.priceDistDesc")}
              </p>
              <div className="mt-auto" style={{ height: 80 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data?.priceBuckets ?? []}
                    margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "currentColor" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(16,185,129,0.08)" }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--popover)",
                        fontSize: 11,
                        padding: "4px 8px",
                      }}
                      labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                      formatter={(v: number) => [`${v} ${t("analytics.results")}`, ""]}
                    />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {(data?.priceBuckets ?? []).map((_, i) => (
                        <Cell
                          key={i}
                          fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Card 3 — City Coverage */}
            <div className="card-premium group flex flex-col gap-3 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                    {t("trust.cityCoverage")}
                  </div>
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-500/12 text-cyan-600 dark:text-cyan-400">
                  <MapPin className="h-4 w-4" />
                </span>
              </div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("trust.cityAvgDesc")}
              </p>
              <div className="mt-auto max-h-36 space-y-1.5 overflow-y-auto quick-chips-scroll">
                {(data?.cityAverages ?? []).slice(0, 5).map((c, i) => (
                  <div
                    key={c.city}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CITY_DOT_COLORS[i % CITY_DOT_COLORS.length] }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {cityName(c.city, lang)}
                    </span>
                    <span className="shrink-0 font-bold tabular-nums text-foreground">
                      {formatPrice(c.avgPrice, currency)}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Building2 className="h-2.5 w-2.5" />
                      {c.clinicCount}
                    </span>
                  </div>
                ))}
                {!data?.cityAverages?.length && (
                  <p className="text-xs text-muted-foreground/60">—</p>
                )}
              </div>
            </div>

            {/* Card 4 — Top Savings Opportunities */}
            <div className="card-premium group flex flex-col gap-3 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <TrendingDown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    {t("trust.topSavings")}
                  </div>
                </div>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
                  <TrendingDown className="h-4 w-4" />
                </span>
              </div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("trust.topSavingsDesc")}
              </p>
              <div className="mt-auto space-y-2">
                {(data?.topSavings ?? []).slice(0, 3).map((s, i) => (
                  <div
                    key={`${s.name}-${i}`}
                    className="rounded-lg border border-border/60 bg-card/60 px-2.5 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="line-clamp-1 text-[11px] font-semibold text-foreground">
                        {s.name}
                      </span>
                      <span className="shrink-0 text-[10px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {t("trust.save")} {formatPrice(s.savingsKzt, currency)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="tabular-nums">
                        {formatPrice(s.minPrice, currency)} →{" "}
                        {formatPrice(s.maxPrice, currency)}
                      </span>
                      <span className="font-semibold text-emerald-600/80 dark:text-emerald-400/80">
                        −{s.savingsPct}%
                      </span>
                    </div>
                  </div>
                ))}
                {!data?.topSavings?.length && (
                  <p className="text-xs text-muted-foreground/60">—</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
