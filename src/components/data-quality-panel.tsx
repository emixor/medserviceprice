"use client";

import { useI18n } from "@/components/providers";
import { useQuery } from "@tanstack/react-query";
import {
  fetcher,
  relativeDate,
} from "@/lib/format";
import { localizedCategory } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Database,
  AlertTriangle,
  Activity,
  HeartPulse,
  Clock,
  Check,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Shape returned by GET /api/v1/admin/data-quality */
type DataQualityResponse = {
  summary: {
    totalPrices: number;
    anomalousCount: number;
    anomalyPct: number;
    servicesChecked: number;
    servicesWithAnomaly: number;
    currencyMix: { KZT: number; USD: number; other: number };
    staleRawCount: number;
  };
  distribution: {
    min: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p99: number;
    max: number;
    mean: number;
  } | null;
  anomalies: Array<{
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
    deviationPct: number;
    direction: "high" | "low";
    severity: "warn" | "critical";
    updatedAt: string;
  }>;
  byCategory: Array<{ category: string; count: number }>;
  byClinic: Array<{ clinicId: string; clinicName: string; city: string; count: number }>;
  currencyMix: { KZT: number; USD: number; other: number };
  staleRawCount: number;
  generatedAt: string;
};

/** Map raw category code to a tailwind color tint used across the panel. */
const CATEGORY_TINT: Record<string, string> = {
  laboratory: "text-violet-600 dark:text-violet-400 bg-violet-500/10",
  diagnostics: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  doctor_appointment: "text-teal-600 dark:text-teal-400 bg-teal-500/10",
  procedure: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
};

const CATEGORY_BAR: Record<string, string> = {
  laboratory: "bg-violet-500",
  diagnostics: "bg-amber-500",
  doctor_appointment: "bg-teal-500",
  procedure: "bg-rose-500",
};

export function DataQualityPanel() {
  const { t, lang } = useI18n();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin", "data-quality"],
    queryFn: () => fetcher<DataQualityResponse>("/api/v1/admin/data-quality"),
    staleTime: 60_000,
    refetchOnMount: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="card-premium p-6">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
          <p className="text-sm text-muted-foreground">Failed to load data quality report.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      </Card>
    );
  }

  const { summary, distribution, anomalies, byCategory, byClinic, generatedAt } = data;
  const maxCatCount = Math.max(1, ...byCategory.map((c) => c.count));
  const maxClinicCount = Math.max(1, ...byClinic.map((c) => c.count));
  const criticalCount = anomalies.filter((a) => a.severity === "critical").length;

  return (
    <div>
      {/* Section header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-bold tracking-tight">{t("dataQuality.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("dataQuality.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("dataQuality.lastUpdated")}: {relativeDate(generatedAt, lang)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t("admin.refresh")}
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryTile
          icon={<Database className="h-4 w-4" />}
          label={t("dataQuality.totalPrices")}
          value={summary.totalPrices.toLocaleString()}
          tint="text-slate-600 dark:text-slate-300"
          iconBg="bg-slate-500/10"
        />
        <SummaryTile
          icon={<AlertTriangle className="h-4 w-4" />}
          label={t("dataQuality.anomalies")}
          value={
            <span className={cn(summary.anomalousCount > 0 && "gradient-text")}>
              {summary.anomalousCount.toLocaleString()}
            </span>
          }
          tint="text-rose-600 dark:text-rose-400"
          iconBg="bg-rose-500/10"
        />
        <SummaryTile
          icon={<Activity className="h-4 w-4" />}
          label={t("dataQuality.anomalyRate")}
          value={`${summary.anomalyPct}%`}
          tint="text-amber-600 dark:text-amber-400"
          iconBg="bg-amber-500/10"
        />
        <SummaryTile
          icon={<HeartPulse className="h-4 w-4" />}
          label={t("dataQuality.servicesWithAnomaly")}
          value={
            <span>
              {summary.servicesWithAnomaly}
              <span className="text-xs text-muted-foreground"> / {summary.servicesChecked}</span>
            </span>
          }
          tint="text-emerald-600 dark:text-emerald-400"
          iconBg="bg-emerald-500/10"
        />
        <SummaryTile
          icon={<Clock className="h-4 w-4" />}
          label={t("dataQuality.staleRaw")}
          value={summary.staleRawCount.toLocaleString()}
          tint="text-cyan-600 dark:text-cyan-400"
          iconBg="bg-cyan-500/10"
        />
      </div>

      {/* Distribution card */}
      {distribution && (
        <Card className="card-premium mb-5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Activity className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-bold">{t("dataQuality.distribution")}</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <DistTile label={t("dataQuality.min")} value={distribution.min} />
            <DistTile label={t("dataQuality.p25")} value={distribution.p25} />
            <DistTile label={t("dataQuality.median")} value={distribution.p50} highlight />
            <DistTile label={t("dataQuality.p75")} value={distribution.p75} />
            <DistTile label={t("dataQuality.p90")} value={distribution.p90} />
            <DistTile label={t("dataQuality.p99")} value={distribution.p99} />
            <DistTile label={t("dataQuality.max")} value={distribution.max} />
            <DistTile label={t("dataQuality.mean")} value={distribution.mean} />
          </div>
          {/* Visual gradient bar from min to max with median marker */}
          <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500">
            <div
              className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
              style={{
                left: `${Math.min(
                  100,
                  Math.max(
                    0,
                    ((distribution.p50 - distribution.min) /
                      Math.max(1, distribution.max - distribution.min)) *
                      100,
                  ),
                )}%`,
              }}
              title={`Median: ₸${distribution.p50.toLocaleString()}`}
            />
          </div>
        </Card>
      )}

      {/* Anomalies list */}
      <Card className="card-premium mb-5 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-bold">
              {t("dataQuality.flaggedPrice")} ({summary.anomalousCount})
            </h3>
          </div>
          {criticalCount > 0 && (
            <Badge variant="outline" className="border-rose-400/50 bg-rose-500/10 text-rose-600 dark:text-rose-400">
              {t("dataQuality.criticalCount", { count: criticalCount })}
            </Badge>
          )}
        </div>

        {anomalies.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Check className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {t("dataQuality.healthy")}
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              {t("dataQuality.noAnomalies")}
            </p>
          </div>
        ) : (
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
            {anomalies.map((a) => (
              <AnomalyRow key={a.id} a={a} t={t} lang={lang} />
            ))}
          </div>
        )}
      </Card>

      {/* By Category + By Clinic */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="card-premium p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Sparkles className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-bold">{t("dataQuality.byCategory")}</h3>
          </div>
          {byCategory.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t("dataQuality.noAnomalies")}
            </p>
          ) : (
            <div className="space-y-2.5">
              {byCategory.map((c) => {
                const pct = Math.round((c.count / maxCatCount) * 100);
                const tint = CATEGORY_TINT[c.category] ?? CATEGORY_TINT.procedure;
                const bar = CATEGORY_BAR[c.category] ?? CATEGORY_BAR.procedure;
                return (
                  <div key={c.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">
                        {localizedCategory(c.category, lang)}
                      </span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {c.count}
                      </Badge>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full transition-all", bar)}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[10px] italic leading-tight text-muted-foreground">
            {t("dataQuality.method")}
          </p>
        </Card>

        <Card className="card-premium p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                <Database className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-bold">{t("dataQuality.byClinic")}</h3>
            </div>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {byClinic.length}/{10}
            </Badge>
          </div>
          {byClinic.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t("dataQuality.noAnomalies")}
            </p>
          ) : (
            <div className="space-y-2.5">
              {byClinic.map((c, idx) => {
                const pct = Math.round((c.count / maxClinicCount) * 100);
                // Use a distinct cyan-to-emerald gradient instead of teal-only.
                const barColor = idx === 0 ? "bg-gradient-to-r from-cyan-500 to-emerald-500" : "bg-cyan-500";
                return (
                  <div key={c.clinicId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium" title={`${c.clinicName} — ${c.city}`}>
                        <span className="mr-1 text-[10px] tabular-nums text-muted-foreground">#{idx + 1}</span>
                        {c.clinicName}
                        <span className="ml-1 text-muted-foreground">· {c.city}</span>
                      </span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {c.count}
                      </Badge>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full transition-all", barColor)}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[10px] italic leading-tight text-muted-foreground">
            {t("dataQuality.method")}
          </p>
        </Card>
      </div>
    </div>
  );
}

/** Compact summary tile used in the top grid. */
function SummaryTile({
  icon,
  label,
  value,
  tint,
  iconBg,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tint: string;
  iconBg: string;
}) {
  return (
    <Card className="card-premium group p-3 transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", iconBg, tint)}>
          {icon}
        </span>
      </div>
      <div className="mt-2 text-xl font-bold leading-tight tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</div>
    </Card>
  );
}

/** Distribution stat tile. */
function DistTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-2 text-center transition-colors",
        highlight
          ? "border-emerald-400/40 bg-emerald-500/5"
          : "border-border bg-muted/30",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-xs font-bold tabular-nums",
          highlight && "gradient-text",
        )}
      >
        ₸{value.toLocaleString()}
      </div>
    </div>
  );
}

/** Single anomaly row. */
function AnomalyRow({
  a,
  t,
  lang,
}: {
  a: DataQualityResponse["anomalies"][number];
  t: (k: string, v?: Record<string, string | number>) => string;
  lang: "kk" | "ru" | "en";
}) {
  const isHigh = a.direction === "high";
  const isCritical = a.severity === "critical";
  const tint = isCritical
    ? "border-rose-400/50 bg-rose-500/5"
    : "border-amber-400/40 bg-amber-500/5";
  const sevBadge = isCritical
    ? "border-rose-400/60 bg-rose-500/15 text-rose-600 dark:text-rose-400"
    : "border-amber-400/50 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  const priceTint = isHigh
    ? "text-rose-600 dark:text-rose-400"
    : "text-emerald-600 dark:text-emerald-400";

  return (
    <div
      className={cn(
        "group flex flex-col gap-2 rounded-xl border p-3 transition-all hover:-translate-y-px hover:shadow-md sm:flex-row sm:items-center sm:justify-between",
        tint,
      )}
    >
      <div className="flex flex-1 items-start gap-3">
        <Badge
          variant="outline"
          className={cn("h-5 shrink-0 px-1.5 text-[10px] font-bold uppercase", sevBadge)}
        >
          {isCritical ? t("dataQuality.critical") : t("dataQuality.warn")}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{a.serviceName}</span>
            <Badge
              variant="outline"
              className={cn(
                "h-4 shrink-0 border-0 px-1 text-[9px] font-medium",
                CATEGORY_TINT[a.category] ?? "bg-muted text-muted-foreground",
              )}
            >
              {localizedCategory(a.category, lang)}
            </Badge>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {a.clinicName} · {a.clinicCity}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>
              {t("dataQuality.serviceMedian")}:{" "}
              <span className="font-medium text-foreground">₸{a.serviceMedian.toLocaleString()}</span>
            </span>
            <span>
              {t("dataQuality.bounds")}:{" "}
              <span className="font-medium text-foreground">
                ₸{a.lowerBound.toLocaleString()} – ₸{a.upperBound.toLocaleString()}
              </span>
            </span>
            <span>
              {t("dataQuality.lastUpdated")}: {relativeDate(a.updatedAt, lang)}
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pl-0 sm:pl-4 sm:text-right">
        <div>
          <div className={cn("text-base font-bold tabular-nums", priceTint)}>
            ₸{a.priceKzt.toLocaleString()}
          </div>
          <div
            className={cn(
              "flex items-center justify-end gap-0.5 text-[11px] font-semibold",
              isHigh ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {isHigh ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(a.deviationPct)}%
          </div>
        </div>
      </div>
    </div>
  );
}
