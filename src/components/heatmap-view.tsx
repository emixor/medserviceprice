"use client";

/**
 * HeatmapView — Price Volatility Heatmap (Workstream 6).
 *
 * Replaces the prior stub. Fetches aggregated price-spread data from
 * `/api/v1/heatmap?group_by=X` via react-query and renders:
 *
 *   1. A header with title + subtitle (i18n `heatmap.title` / `heatmap.subtitle`)
 *      and a "View by" toggle (service / city / category).
 *   2. A Recharts horizontal BarChart where each bar's length = spreadPct and
 *      its color encodes volatility:
 *        green   (0–20%)   — stable
 *        amber   (20–50%)  — moderate
 *        red     (>50%)    — volatile
 *      with a 3-swatch legend.
 *   3. A compact detail table (sticky header, scrollable) showing min / avg /
 *      max price, sample count, and color-coded spreadPct per group.
 *
 * States handled: loading skeleton, error with retry button, empty state, and
 * the normal populated state. Layout is fully responsive (1 col mobile,
 * 3+2 col desktop). Never crashes on sparse / empty data.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { fetcher, formatPrice, cityName } from "@/lib/format";
import { localizedCategory, type Lang } from "@/lib/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type GroupBy = "service" | "city" | "category";

type HeatmapRow = {
  key: string;
  label: string;
  count: number;
  min: number;
  max: number;
  avg: number;
  spreadPct: number;
};

type HeatmapResponse = {
  groupBy: GroupBy;
  rows: HeatmapRow[];
  elapsedMs: number;
};

/* ----------------------------- color buckets ----------------------------- */

const COLOR_STABLE = "#10b981"; // emerald-500
const COLOR_MODERATE = "#f59e0b"; // amber-500
const COLOR_VOLATILE = "#ef4444"; // red-500

function spreadColor(spreadPct: number): string {
  if (spreadPct > 50) return COLOR_VOLATILE;
  if (spreadPct > 20) return COLOR_MODERATE;
  return COLOR_STABLE;
}

/* --------------------------- i18n fallback keys --------------------------- */
// The i18n dictionary doesn't ship a "retry" key, so we localize a tiny label
// here in-component (3 languages) rather than touching the i18n module (which
// is out of scope for this task).
const RETRY_LABEL: Record<Lang, string> = {
  en: "Retry",
  ru: "Повторить",
  kk: "Қайталау",
};

/** Chart caps — keeps the bar chart readable when many groups are returned. */
const CHART_MAX_ROWS = 20;

/* ------------------------------- tooltip ---------------------------------- */

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: HeatmapRow & { localizedLabel: string } }>;
  t: (k: string, vars?: Record<string, string | number>) => string;
  currency: "KZT" | "USD" | "RUB";
};

function HeatmapTooltip({ active, payload, t, currency }: TooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 max-w-[220px] truncate font-semibold text-foreground">
        {r.localizedLabel}
      </div>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">{t("heatmap.minPrice")}</span>
        <span className="text-right font-medium text-foreground">
          {formatPrice(r.min, currency)}
        </span>
        <span className="text-muted-foreground">{t("heatmap.avgPrice")}</span>
        <span className="text-right font-medium text-foreground">
          {formatPrice(r.avg, currency)}
        </span>
        <span className="text-muted-foreground">{t("heatmap.maxPrice")}</span>
        <span className="text-right font-medium text-foreground">
          {formatPrice(r.max, currency)}
        </span>
        <span className="text-muted-foreground">
          {t("heatmap.samples", { count: r.count })}
        </span>
        <span className="text-right font-medium text-foreground">{r.count}</span>
        <span className="text-muted-foreground">{t("heatmap.spreadPct")}</span>
        <span
          className="text-right font-bold"
          style={{ color: spreadColor(r.spreadPct) }}
        >
          {r.spreadPct}%
        </span>
      </div>
    </div>
  );
}

/* ------------------------------ skeleton ---------------------------------- */

function HeatmapSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- main ------------------------------------ */

export function HeatmapView() {
  const { t, lang } = useI18n();
  const currency = useAppStore((s) => s.currency);
  const [groupBy, setGroupBy] = useState<GroupBox>("service");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<HeatmapResponse>({
    queryKey: ["heatmap", groupBy],
    queryFn: () =>
      fetcher<HeatmapResponse>(
        `/api/v1/heatmap?group_by=${groupBy}&limit=50`
      ),
    staleTime: 60_000,
  });

  const rows = data?.rows ?? [];

  // Localize labels depending on group_by. For services the API already
  // returns the Russian name as `label`; for cities and categories we apply
  // the shared i18n helpers so the UI shows the user's preferred language.
  const localizeLabel = (r: HeatmapRow): string => {
    if (groupBy === "city") return cityName(r.label, lang);
    if (groupBy === "category") return localizedCategory(r.label, lang);
    return r.label;
  };

  // Chart data: top N rows (already sorted desc by spreadPct from the API),
  // each augmented with a localized label for the YAxis.
  const chartData = rows.slice(0, CHART_MAX_ROWS).map((r) => ({
    ...r,
    localizedLabel: localizeLabel(r),
  }));

  // Adaptive chart height — taller when there are more rows, capped so very
  // long lists scroll inside the chart container instead of pushing the page.
  const chartHeight = Math.max(
    280,
    Math.min(chartData.length * 32 + 48, 720)
  );

  const labelColumnTitle =
    groupBy === "city"
      ? t("heatmap.byCity")
      : groupBy === "category"
      ? t("heatmap.byCategory")
      : t("heatmap.byService");

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Activity className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">
              {t("heatmap.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("heatmap.subtitle")}
            </p>
          </div>
        </div>

        {/* View-by toggle */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("heatmap.viewBy")}
          </span>
          <ToggleGroup
            type="single"
            value={groupBy}
            onValueChange={(v) => {
              if (v === "service" || v === "city" || v === "category") {
                setGroupBy(v);
              }
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="service">
              {t("heatmap.byService")}
            </ToggleGroupItem>
            <ToggleGroupItem value="city">{t("heatmap.byCity")}</ToggleGroupItem>
            <ToggleGroupItem value="category">
              {t("heatmap.byCategory")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {isLoading ? (
        <HeatmapSkeleton />
      ) : isError ? (
        /* ----------------------------- error state ---------------------------- */
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("heatmap.empty")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              />
              {RETRY_LABEL[lang]}
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        /* ----------------------------- empty state ---------------------------- */
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Activity className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("heatmap.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        /* ------------------------------ data state ---------------------------- */
        <div className="grid gap-4 lg:grid-cols-5">
          {/* Chart card */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {t("heatmap.spreadPct")}
                </CardTitle>
                {/* Legend */}
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    <span
                      className="h-2.5 w-3 rounded-sm"
                      style={{ background: COLOR_STABLE }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      {t("heatmap.stable")}
                    </span>
                    <span className="text-muted-foreground">0–20%</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="h-2.5 w-3 rounded-sm"
                      style={{ background: COLOR_MODERATE }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      20–50%
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="h-2.5 w-3 rounded-sm"
                      style={{ background: COLOR_VOLATILE }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-red-600 dark:text-red-400">
                      {t("heatmap.volatile")}
                    </span>
                    <span className="text-muted-foreground">&gt;50%</span>
                  </span>
                </div>
              </div>
              <CardDescription>{t("heatmap.tooltip")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="w-full overflow-y-auto"
                style={{ maxHeight: 720 }}
              >
                <div style={{ height: chartHeight, width: "100%" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      layout="vertical"
                      margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                      barCategoryGap={4}
                    >
                      <XAxis
                        type="number"
                        domain={[
                          0,
                          Math.max(
                            100,
                            ...chartData.map((d) => d.spreadPct)
                          ),
                        ]}
                        tick={{ fontSize: 11, fill: "currentColor" }}
                        tickLine={false}
                        axisLine={false}
                        className="text-muted-foreground"
                        unit="%"
                      />
                      <YAxis
                        type="category"
                        dataKey="localizedLabel"
                        width={180}
                        tick={{ fontSize: 11, fill: "currentColor" }}
                        tickLine={false}
                        axisLine={false}
                        className="text-muted-foreground"
                        interval={0}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                        content={
                          <HeatmapTooltip t={t} currency={currency} />
                        }
                      />
                      <Bar dataKey="spreadPct" radius={[0, 4, 4, 0]}>
                        {chartData.map((d, i) => (
                          <Cell
                            key={`${d.key}-${i}`}
                            fill={spreadColor(d.spreadPct)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {rows.length > CHART_MAX_ROWS && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Showing top {CHART_MAX_ROWS} of {rows.length} groups by
                  spread.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Detail table card */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">{t("heatmap.title")}</CardTitle>
              <CardDescription>{t("heatmap.tooltip")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="overflow-y-auto"
                style={{ maxHeight: 720 }}
              >
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 pr-2 font-medium">
                        {labelColumnTitle}
                      </th>
                      <th className="py-2 px-1 text-right font-medium">
                        {t("heatmap.minPrice")}
                      </th>
                      <th className="py-2 px-1 text-right font-medium">
                        {t("heatmap.avgPrice")}
                      </th>
                      <th className="py-2 px-1 text-right font-medium">
                        {t("heatmap.maxPrice")}
                      </th>
                      <th className="py-2 px-1 text-right font-medium">#</th>
                      <th className="py-2 pl-1 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.key}
                        className="border-t border-border/40 hover:bg-accent/40"
                      >
                        <td className="py-1.5 pr-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{
                                background: spreadColor(r.spreadPct),
                              }}
                              aria-hidden="true"
                            />
                            <span className="line-clamp-1 font-medium text-foreground">
                              {localizeLabel(r)}
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5 px-1 text-right tabular-nums text-muted-foreground">
                          {formatPrice(r.min, currency)}
                        </td>
                        <td className="py-1.5 px-1 text-right tabular-nums font-medium text-foreground">
                          {formatPrice(r.avg, currency)}
                        </td>
                        <td className="py-1.5 px-1 text-right tabular-nums text-muted-foreground">
                          {formatPrice(r.max, currency)}
                        </td>
                        <td className="py-1.5 px-1 text-right tabular-nums text-muted-foreground">
                          {r.count}
                        </td>
                        <td
                          className="py-1.5 pl-1 text-right font-bold tabular-nums"
                          style={{ color: spreadColor(r.spreadPct) }}
                        >
                          {r.spreadPct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                {t("heatmap.samples", { count: rows.length })}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
