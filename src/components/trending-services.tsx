"use client";

/**
 * TrendingServices — full-width section rendered in the search view (after the
 * "Calculate your savings" widget, before the Filters sidebar / results).
 *
 * - Fetches GET /api/v1/stats (the same call the hero already makes — react-query
 *   dedupes the request by key, so no extra network round-trip).
 * - Renders a responsive grid (2 cols mobile, 3 cols md, 6 cols lg) of compact
 *   cards: service name (localized, 2-line clamp), category badge, current min
 *   price, a mini SVG sparkline with gradient fill, and a trend pct badge.
 * - Clicking a card sets `q` to the service name and scrolls to results.
 * - Loading skeleton = 6 shimmer cards; empty state = nothing rendered.
 */
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { fetcher, formatPrice } from "@/lib/format";
import { localizedCategory, localizedServiceName } from "@/lib/i18n";
import { Flame, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

type TrendingService = {
  id: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  category: string;
  activityCount: number;
  currentMinPrice: number;
  sparkline: number[];
  trendDir: "up" | "down" | "flat";
  trendPct: number;
};

type StatsResponse = {
  clinics?: number;
  services?: number;
  normalized?: number;
  cities?: string[];
  avgSpreadPct?: number;
  trendingServices?: TrendingService[];
};

const CATEGORY_BADGE_STYLES: Record<string, string> = {
  laboratory: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  diagnostics: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  doctor_appointment: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  procedure: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const TREND_COLORS: Record<TrendingService["trendDir"], { stroke: string; fill: string; pill: string }> = {
  down: {
    stroke: "#10b981", // emerald-500
    fill: "rgba(16, 185, 129, 0.18)",
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  up: {
    stroke: "#f43f5e", // rose-500
    fill: "rgba(244, 63, 94, 0.18)",
    pill: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  flat: {
    stroke: "#94a3b8", // slate-400
    fill: "rgba(148, 163, 184, 0.18)",
    pill: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
};

/** Build a smooth SVG path string from an array of numbers fitted to a box. */
function sparklinePath(values: number[], w: number, h: number, pad = 2): { line: string; area: string } {
  if (!values.length) return { line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });
  // Smooth path via Catmull-Rom-ish cubic interpolation when ≥ 2 points.
  if (pts.length === 1) {
    return { line: `M ${pts[0][0]} ${pts[0][1]}`, area: `M ${pts[0][0]} ${pts[0][1]}` };
  }
  let line = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    line += ` Q ${cx} ${y0} ${cx} ${(y0 + y1) / 2} T ${x1} ${y1}`;
  }
  const area = `${line} L ${pts[pts.length - 1][0]} ${h - pad} L ${pts[0][0]} ${h - pad} Z`;
  return { line, area };
}

function TrendingCard({ svc }: { svc: TrendingService }) {
  const { t, lang } = useI18n();
  const setFilters = useAppStore((s) => s.setFilters);
  const currency = useAppStore((s) => s.currency);
  const colors = TREND_COLORS[svc.trendDir];
  const name = localizedServiceName(svc, lang);
  const catStyle = CATEGORY_BADGE_STYLES[svc.category] ?? "bg-muted text-muted-foreground";

  const spark = useMemo(() => {
    const W = 80;
    const H = 24;
    return sparklinePath(svc.sparkline ?? [], W, H);
  }, [svc.sparkline]);

  const TrendIcon = svc.trendDir === "down" ? TrendingDown : svc.trendDir === "up" ? TrendingUp : Minus;

  return (
    <button
      onClick={() => setFilters({ q: name })}
      className={cn(
        "card-premium card-hover-border group relative flex h-full w-full flex-col gap-2 p-3 text-left",
        "transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      )}
    >
      {/* Top: name + category */}
      <div className="flex items-start justify-between gap-1.5">
        <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-foreground">
          {name}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium",
            catStyle
          )}
        >
          {localizedCategory(svc.category, lang)}
        </span>
      </div>

      {/* Middle: min price */}
      <div className="mt-auto">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("trending.minPrice")}
        </div>
        <div className="gradient-text text-base font-bold leading-tight tabular-nums">
          {svc.currentMinPrice > 0 ? formatPrice(svc.currentMinPrice, currency) : "—"}
        </div>
      </div>

      {/* Bottom: sparkline + trend pill */}
      <div className="flex items-end justify-between gap-2">
        <svg
          width="80"
          height="24"
          viewBox="0 0 80 24"
          className="shrink-0"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`spark-fill-${svc.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.fill} />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          {spark.area && <path d={spark.area} fill={`url(#spark-fill-${svc.id})`} />}
          {spark.line && (
            <path
              d={spark.line}
              fill="none"
              stroke={colors.stroke}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            colors.pill
          )}
        >
          <TrendIcon className="h-2.5 w-2.5" />
          {svc.trendPct > 0 ? svc.trendPct : Math.abs(svc.trendPct)}%
        </span>
      </div>
    </button>
  );
}

function TrendingSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="shimmer h-32 w-full rounded-xl border border-border/40"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function TrendingServices() {
  const { t } = useI18n();

  const { data, isLoading } = useQuery<StatsResponse>({
    queryKey: ["stats"],
    queryFn: () => fetcher("/api/v1/stats"),
    staleTime: 60_000,
  });

  const trending = data?.trendingServices ?? [];

  if (!isLoading && trending.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400">
              <Flame className="h-4 w-4" />
            </span>
            {t("trending.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {t("trending.subtitle")}
          </p>
        </div>
      </div>

      {isLoading ? (
        <TrendingSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {trending.map((svc) => (
            <TrendingCard key={svc.id} svc={svc} />
          ))}
        </div>
      )}
    </section>
  );
}
