"use client";

import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import {
  fetcher,
  type ServiceHistory,
  type ServiceDirectoryItem,
  formatKzt,
  formatPrice,
  svcName,
  shortDate,
} from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LineChart as LineChartIcon, TrendingUp, Minus, Activity, Stethoscope, ArrowUpRight, ArrowDownRight, Calendar, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  ComposedChart,
} from "recharts";
import { localizedCategory } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { EmptyState } from "@/components/empty-state";

/* Unified premium chart palette — emerald/teal/amber/rose/violet/cyan.
   Two variants (light/dark) for crisp contrast in both modes. CSS variables
   don't reliably resolve inside recharts SVG attributes, so we resolve them
   here in JS based on the active theme. */
const CHART_PALETTE_LIGHT = [
  "#10b981", // emerald-500
  "#14b8a6", // teal-500
  "#06b6d4", // cyan-500
  "#f59e0b", // amber-500
  "#f43f5e", // rose-500
  "#8b5cf6", // violet-500
  "#db2777", // pink-600
  "#0284c7", // sky-600
];
const CHART_PALETTE_DARK = [
  "#34d399", // emerald-400
  "#2dd4bf", // teal-400
  "#22d3ee", // cyan-400
  "#fbbf24", // amber-400
  "#fb7185", // rose-400
  "#a78bfa", // violet-400
  "#ec4899", // pink-500
  "#0ea5e9", // sky-500
];

function useChartColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const palette = isDark ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT;
  return {
    palette,
    overall: {
      min: palette[0], // emerald
      avg: palette[1], // teal
      max: palette[4], // rose
    },
  };
}

/** Currency symbol helper for axis labels. */
function currencySymbol(currency: "KZT" | "USD" | "RUB"): string {
  if (currency === "USD") return "$";
  if (currency === "RUB") return "₽";
  return "₸";
}

/** Format a value for the Y-axis tick using the active currency. */
function yAxisTickFormatter(v: number, currency: "KZT" | "USD" | "RUB"): string {
  if (currency === "USD") {
    const usd = v / 450;
    if (usd >= 1000) return `${(usd / 1000).toFixed(1)}k`;
    return `${usd.toFixed(0)}`;
  }
  if (currency === "RUB") {
    const rub = v / 5;
    if (rub >= 1000) return `${(rub / 1000).toFixed(0)}k`;
    return `${rub.toFixed(0)}`;
  }
  return `${(v / 1000).toFixed(0)}k`;
}

type TimeRange = "7d" | "30d" | "90d" | "all";

function timeRangeDays(range: TimeRange): number | null {
  switch (range) {
    case "7d": return 7;
    case "30d": return 30;
    case "90d": return 90;
    case "all": return null;
  }
}

export function HistoryView() {
  const { t, lang } = useI18n();
  const selectedServiceId = useAppStore((s) => s.selectedServiceId);
  const setSelectedService = useAppStore((s) => s.setSelectedService);
  const currency = useAppStore((s) => s.currency);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  const { palette: CHART_COLORS, overall: OVERALL_COLORS } = useChartColors();

  /** Localized price formatter bound to the active display currency. */
  const priceFmt = useMemo(() => (n: number) => formatPrice(n, currency), [currency]);
  const sym = currencySymbol(currency);
  const yAxisLabel = `${t("history.priceLabel")} (${sym})`;

  const { data: dirData } = useQuery<{ services: ServiceDirectoryItem[] }>({
    queryKey: ["services-dir"],
    queryFn: () => fetcher("/api/v1/services"),
    staleTime: 60_000,
  });

  // Auto-select first service if none chosen
  const effectiveId = selectedServiceId ?? dirData?.services?.[0]?.id ?? null;

  const { data, isLoading, isError } = useQuery<ServiceHistory>({
    queryKey: ["history", effectiveId],
    queryFn: () => fetcher(`/api/v1/services/${effectiveId}/history`),
    enabled: !!effectiveId,
    staleTime: 30_000,
  });

  const services = dirData?.services ?? [];

  // Build full overall data first (unfiltered)
  const fullOverallData = useMemo(
    () =>
      (data?.overallSeries ?? []).map((p) => ({
        date: shortDate(p.date),
        dateRaw: p.date,
        min: p.min,
        avg: p.avg,
        max: p.max,
      })),
    [data?.overallSeries]
  );

  // Filter by time range
  const overallData = useMemo(() => {
    const days = timeRangeDays(timeRange);
    if (days == null) return fullOverallData;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return fullOverallData.filter((p) => new Date(p.dateRaw) >= cutoff);
  }, [fullOverallData, timeRange]);

  // Per-clinic flat data: one series per clinic (also filtered)
  const perClinicDataRaw = data?.perClinic ?? [];

  const filteredPerClinicData = useMemo(() => {
    const days = timeRangeDays(timeRange);
    if (days == null) return perClinicDataRaw;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return perClinicDataRaw.map((pc) => ({
      ...pc,
      series: pc.series.filter((s) => new Date(s.date) >= cutoff),
    }));
  }, [perClinicDataRaw, timeRange]);

  // Merge all clinic series on date union
  const mergedClinic = useMemo(() => {
    const allDates = new Set<string>();
    filteredPerClinicData.forEach((pc) => pc.series.forEach((s) => allDates.add(shortDate(s.date))));
    const sortedDates = [...allDates].sort();
    return sortedDates.map((d) => {
      const row: Record<string, string | number> = { date: d };
      filteredPerClinicData.forEach((pc) => {
        const pt = pc.series.find((s) => shortDate(s.date) === d);
        row[pc.clinic.name + " · " + pc.clinic.city] = pt ? pt.priceKzt : null;
      });
      return row;
    });
  }, [filteredPerClinicData]);

  // Stable clinic display keys + color map (used by the custom tooltip)
  const clinicKeys = useMemo(
    () =>
      filteredPerClinicData.map(
        (pc) => pc.clinic.name + " · " + pc.clinic.city
      ),
    [filteredPerClinicData]
  );
  const clinicColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    filteredPerClinicData.forEach((pc, i) => {
      const key = pc.clinic.name + " · " + pc.clinic.city;
      m[key] = CHART_COLORS[i % CHART_COLORS.length];
    });
    return m;
  }, [filteredPerClinicData, CHART_COLORS]);

  // Compute trend (% change between first and last avg)
  const trendPct = useMemo(() => {
    if (overallData.length < 2) return null;
    const first = overallData[0].avg;
    const last = overallData[overallData.length - 1].avg;
    if (first == null || last == null || first === 0) return null;
    return Math.round(((last - first) / first) * 100);
  }, [overallData]);

  // Compute spread (max-min) for the latest period
  const latestSpread = useMemo(() => {
    if (overallData.length === 0) return null;
    const last = overallData[overallData.length - 1];
    if (last.min == null || last.max == null) return null;
    return last.max - last.min;
  }, [overallData]);

  // Compute min price in range
  const rangeMin = useMemo(() => {
    const mins = overallData.filter((p) => p.min != null).map((p) => p.min!);
    return mins.length ? Math.min(...mins) : null;
  }, [overallData]);

  // Compute max price in range
  const rangeMax = useMemo(() => {
    const maxs = overallData.filter((p) => p.max != null).map((p) => p.max!);
    return maxs.length ? Math.max(...maxs) : null;
  }, [overallData]);

  const trendIcon =
    trendPct == null ? (
      <Minus className="h-4 w-4 text-muted-foreground" />
    ) : trendPct > 0 ? (
      <ArrowUpRight className="h-4 w-4 text-rose-500" />
    ) : trendPct < 0 ? (
      <ArrowDownRight className="h-4 w-4 text-emerald-500" />
    ) : (
      <Minus className="h-4 w-4 text-muted-foreground" />
    );

  const trendColor =
    trendPct == null
      ? "text-muted-foreground"
      : trendPct > 0
      ? "text-rose-600 dark:text-rose-400"
      : trendPct < 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground";

  const timeRangeButtons: { key: TimeRange; label: string }[] = [
    { key: "7d", label: t("history.7d") },
    { key: "30d", label: t("history.30d") },
    { key: "90d", label: t("history.90d") },
    { key: "all", label: t("history.all") },
  ];

  const noServiceSelected = !selectedServiceId && !dirData?.services?.length;
  const hasNoData = !data || data.overallSeries.length === 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 msp-fade-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <LineChartIcon className="h-6 w-6 text-primary" />
            {t("history.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("history.subtitle")}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Select
            value={effectiveId ?? "__none__"}
            onValueChange={(v) => setSelectedService(v === "__none__" ? null : v)}
          >
            <SelectTrigger className="h-9 w-[320px] gap-1.5 text-sm">
              <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder={t("history.selectService")} />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="text-xs">{svcName(s, lang)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data && overallData.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <RefreshCw className="h-3 w-3" />
              {t("result.lastUpdated")}: {shortDate(overallData[overallData.length - 1].dateRaw)}
            </span>
          )}
        </div>
      </div>

      {!effectiveId ? (
        <EmptyState variant="history" />
      ) : isLoading ? (
        <div className="space-y-4">
          <div className="h-12 animate-pulse rounded-xl bg-muted" />
          <div className="h-80 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {t("history.noData")}
        </div>
      ) : hasNoData ? (
        <EmptyState
          icon={LineChartIcon}
          title={t("history.noData")}
        />
      ) : (
        <div className="space-y-5">
          {/* Stat tiles row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              icon={<TrendingUp className="h-5 w-5" />}
              label={t("history.currentAvg")}
              value={overallData.length > 0 ? priceFmt(overallData[overallData.length - 1].avg ?? 0) : "—"}
              tint="text-primary"
              iconBg="bg-primary/10"
              gradient="from-primary/8 to-transparent"
            />
            <StatTile
              icon={<ArrowDownRight className="h-5 w-5" />}
              label={t("serviceDetail.min")}
              value={rangeMin != null ? priceFmt(rangeMin) : "—"}
              tint="text-emerald-600 dark:text-emerald-400"
              iconBg="bg-emerald-500/10"
              gradient="from-emerald-500/8 to-transparent"
            />
            <StatTile
              icon={<ArrowUpRight className="h-5 w-5" />}
              label={t("serviceDetail.max")}
              value={rangeMax != null ? priceFmt(rangeMax) : "—"}
              tint="text-rose-600 dark:text-rose-400"
              iconBg="bg-rose-500/10"
              gradient="from-rose-500/8 to-transparent"
            />
            <StatTile
              icon={trendIcon}
              label={t("history.changePct")}
              value={trendPct == null ? "—" : `${trendPct > 0 ? "+" : ""}${trendPct}%`}
              tint={trendColor}
              iconBg={
                trendPct == null
                  ? "bg-muted"
                  : trendPct < 0
                    ? "bg-emerald-500/10"
                    : trendPct > 0
                      ? "bg-rose-500/10"
                      : "bg-muted"
              }
              gradient={
                trendPct == null
                  ? "from-muted/30 to-transparent"
                  : trendPct < 0
                    ? "from-emerald-500/8 to-transparent"
                    : trendPct > 0
                      ? "from-rose-500/8 to-transparent"
                      : "from-muted/30 to-transparent"
              }
            />
          </div>

          {/* Service header card with trend + spread */}
          <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight">{svcName(data.service, lang)}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="uppercase">
                  {localizedCategory(data.service.category, lang)}
                </Badge>
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  {data.currentCount} {t("compare.clinics")}
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {data.historyCount} {t("footer.normalized").toLowerCase()}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {/* Spread indicator */}
              {latestSpread != null && (
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("history.spread")}
                  </div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                    {priceFmt(latestSpread)}
                  </div>
                </div>
              )}
              {/* Current avg price */}
              {overallData.length > 0 && (
                <div className="text-right">
                  <div className="text-[10px] uppercase text-muted-foreground">{t("history.currentAvg")}</div>
                  <div className="text-2xl font-extrabold tabular-nums">
                    {priceFmt(overallData[overallData.length - 1].avg ?? 0)}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Time range selector */}
          <Card className="card-premium flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">{t("history.title")}</span>
            </div>
            <div className="msp-pill-group">
              {timeRangeButtons.map((btn) => (
                <button
                  key={btn.key}
                  data-active={timeRange === btn.key}
                  className="msp-pill-btn"
                  onClick={() => setTimeRange(btn.key)}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </Card>

          {/* Overall chart (min/avg/max band) */}
          <Card className="card-premium p-4">
            <h3 className="mb-3 text-sm font-bold">{t("history.overall")}</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={overallData} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
                  <defs>
                    <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={OVERALL_COLORS.avg} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={OVERALL_COLORS.avg} stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="avgAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={OVERALL_COLORS.avg} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={OVERALL_COLORS.avg} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="minAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={OVERALL_COLORS.min} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={OVERALL_COLORS.min} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="maxAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={OVERALL_COLORS.max} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={OVERALL_COLORS.max} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                    tickFormatter={(v: number) => yAxisTickFormatter(v, currency)}
                    label={{
                      value: yAxisLabel,
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 11, fill: "var(--muted-foreground)", textAnchor: "middle" },
                      offset: 8,
                    }}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                    content={<OverallTooltip priceFmt={priceFmt} dateLabel={t("history.priceLabel")} colors={OVERALL_COLORS} />}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    iconType="plainline"
                    formatter={(v) => (
                      <span style={{ color: "var(--muted-foreground)" }}>
                        {v === "max" ? (
                          <span>
                            <span style={{ color: OVERALL_COLORS.max }}>max</span> ·
                            <span style={{ color: OVERALL_COLORS.avg }}> avg</span> ·
                            <span style={{ color: OVERALL_COLORS.min }}> min</span>
                          </span>
                        ) : (
                          v
                        )}
                      </span>
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="avg"
                    name="avgArea"
                    stroke="none"
                    fill="url(#avgAreaFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="max"
                    name="max"
                    stroke="none"
                    fill="url(#bandFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="min"
                    name="min"
                    stroke="none"
                    fill="var(--background)"
                  />
                  <Line
                    type="monotone"
                    dataKey="avg"
                    name="avg"
                    stroke={OVERALL_COLORS.avg}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: OVERALL_COLORS.avg }}
                  />
                  <Line
                    type="monotone"
                    dataKey="min"
                    name="min"
                    stroke={OVERALL_COLORS.min}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="max"
                    name="max"
                    stroke={OVERALL_COLORS.max}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Per-clinic chart */}
          {filteredPerClinicData.length > 0 && (
            <Card className="card-premium p-4">
              <h3 className="mb-3 text-sm font-bold">{t("history.perClinic")}</h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={mergedClinic} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
                    <defs>
                      {filteredPerClinicData.map((pc, i) => {
                        const color = CHART_COLORS[i % CHART_COLORS.length];
                        return (
                          <linearGradient key={pc.clinic.id} id={`clinicArea-${pc.clinic.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      tickFormatter={(v: number) => yAxisTickFormatter(v, currency)}
                      label={{
                        value: yAxisLabel,
                        angle: -90,
                        position: "insideLeft",
                        style: { fontSize: 11, fill: "var(--muted-foreground)", textAnchor: "middle" },
                        offset: 8,
                      }}
                    />
                    <Tooltip
                      cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
                      content={
                        <PerClinicTooltip
                          priceFmt={priceFmt}
                          dateLabel={t("history.priceLabel")}
                          colors={clinicColorMap}
                          keys={clinicKeys}
                        />
                      }
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 10, paddingTop: 8, lineHeight: "1.2em" }}
                      iconType="plainline"
                      iconSize={10}
                    />
                    {filteredPerClinicData.map((pc, i) => {
                      const key = pc.clinic.name + " · " + pc.clinic.city;
                      const color = CHART_COLORS[i % CHART_COLORS.length];
                      return (
                        <Area
                          key={`area-${pc.clinic.id}`}
                          type="monotone"
                          dataKey={key}
                          stroke="none"
                          fill={`url(#clinicArea-${pc.clinic.id})`}
                          connectNulls
                          isAnimationActive={false}
                        />
                      );
                    })}
                    {filteredPerClinicData.map((pc, i) => {
                      const key = pc.clinic.name + " · " + pc.clinic.city;
                      return (
                        <Line
                          key={pc.clinic.id}
                          type="monotone"
                          dataKey={key}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      );
                    })}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tint = "text-primary",
  iconBg = "bg-primary/10",
  gradient = "from-primary/8 to-transparent",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tint?: string;
  iconBg?: string;
  gradient?: string;
}) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border border-border/70 bg-gradient-to-br p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
      gradient
    )}>
      <div className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 place-items-center rounded-xl", iconBg, tint)}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn("mt-2 text-lg font-extrabold tabular-nums", tint)}>{value}</div>
    </div>
  );
}

/* ---- Custom chart tooltips (clean table layout, currency-aware) -------- */

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
  padding: "8px 10px",
  fontSize: 12,
  color: "var(--foreground)",
  maxWidth: 260,
};

const TOOLTIP_WIDE_STYLE: React.CSSProperties = { ...TOOLTIP_STYLE, maxWidth: 340 };

const TOOLTIP_TITLE_STYLE: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 12,
  marginBottom: 4,
  color: "var(--foreground)",
};

const TOOLTIP_FOOT_STYLE: React.CSSProperties = {
  marginTop: 4,
  fontSize: 10,
  color: "var(--muted-foreground)",
};

const TOOLTIP_TABLE_STYLE: React.CSSProperties = { borderCollapse: "collapse", width: "100%" };

const TOOLTIP_TD_STYLE: React.CSSProperties = { padding: "2px 0", verticalAlign: "middle" };

const TOOLTIP_VAL_STYLE: React.CSSProperties = {
  textAlign: "right" as const,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
  paddingLeft: 12,
};

function swatchStyle(color: string): React.CSSProperties {
  return {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: 2,
    background: color,
    marginRight: 6,
    verticalAlign: "middle",
  };
}

type OverallPoint = { date: string; min: number | null; avg: number | null; max: number | null };

function OverallTooltip({
  active,
  payload,
  priceFmt,
  dateLabel,
  colors,
}: {
  active?: boolean;
  payload?: { payload: OverallPoint }[];
  priceFmt: (n: number) => string;
  dateLabel: string;
  colors: { min: string; avg: string; max: string };
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const rows = [
    { key: "max", label: "max", value: p.max, color: colors.max },
    { key: "avg", label: "avg", value: p.avg, color: colors.avg },
    { key: "min", label: "min", value: p.min, color: colors.min },
  ];
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={TOOLTIP_TITLE_STYLE}>{p.date}</div>
      <table style={TOOLTIP_TABLE_STYLE}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={TOOLTIP_TD_STYLE}>
                <span style={swatchStyle(r.color)} />
                {r.label}
              </td>
              <td style={{ ...TOOLTIP_TD_STYLE, ...TOOLTIP_VAL_STYLE }}>
                {r.value == null ? "—" : priceFmt(r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={TOOLTIP_FOOT_STYLE}>{dateLabel}</div>
    </div>
  );
}

function PerClinicTooltip({
  active,
  payload,
  priceFmt,
  dateLabel,
  colors,
  keys,
}: {
  active?: boolean;
  payload?: { payload: Record<string, string | number | null>; name: string; value: number; color: string }[];
  priceFmt: (n: number) => string;
  dateLabel: string;
  colors: Record<string, string>;
  keys: string[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const date = String(point.date ?? "");
  const rows = keys
    .map((k) => ({ name: k, value: point[k] as number | null }))
    .filter((r) => r.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div style={TOOLTIP_WIDE_STYLE}>
      <div style={TOOLTIP_TITLE_STYLE}>{date}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>—</div>
      ) : (
        <table style={TOOLTIP_TABLE_STYLE}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td style={TOOLTIP_TD_STYLE}>
                  <span style={swatchStyle(colors[r.name] ?? "var(--primary)")} />
                  <span style={{ verticalAlign: "middle" }}>{r.name}</span>
                </td>
                <td style={{ ...TOOLTIP_TD_STYLE, ...TOOLTIP_VAL_STYLE }}>
                  {priceFmt(r.value ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={TOOLTIP_FOOT_STYLE}>{dateLabel}</div>
    </div>
  );
}
