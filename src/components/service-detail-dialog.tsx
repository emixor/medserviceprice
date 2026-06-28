"use client";

import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import {
  fetcher,
  type ServiceDetail,
  formatPrice,
  cityName,
  relativeDate,
  isStale,
} from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  Star,
  MapPin,
  Phone,
  Clock,
  Globe,
  CheckCircle2,
  ExternalLink,
  Stethoscope,
  TrendingUp,
  TrendingDown,
  Crown,
  ArrowUpRight,
  ArrowDownRight,
  Bell,
  GitCompareArrows,
  Check,
  Activity,
  BarChart3,
  Share2,
  Info,
} from "lucide-react";
import { localizedCategory } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { shortDate } from "@/lib/format";
import { MAX_COMPARE } from "@/store/app-store";

/** Sync the URL hash with the selected service so service links are shareable. */
function useServiceHashSync() {
  const serviceDetailId = useAppStore((s) => s.selectedServiceDetailId);
  const setSelectedServiceDetail = useAppStore((s) => s.setSelectedServiceDetail);
  const selectedClinicId = useAppStore((s) => s.selectedClinicId);

  // On mount: read hash → open service if present (#/service/{id})
  useEffect(() => {
    function apply() {
      // Skip if a clinic dialog is already open (clinic takes precedence)
      if (useAppStore.getState().selectedClinicId) return;
      const m = window.location.hash.match(/^#\/service\/(.+)$/);
      if (m && m[1]) {
        const id = decodeURIComponent(m[1]);
        if (useAppStore.getState().selectedServiceDetailId !== id) {
          setSelectedServiceDetail(id);
        }
      }
    }
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [setSelectedServiceDetail]);

  // Sync hash with current selection
  useEffect(() => {
    if (serviceDetailId) {
      const target = `#/service/${encodeURIComponent(serviceDetailId)}`;
      if (window.location.hash !== target) {
        window.history.replaceState(null, "", target);
      }
    } else {
      if (window.location.hash.startsWith("#/service/")) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
  }, [serviceDetailId, selectedClinicId]);
}

export function ServiceDetailDialog() {
  const { t, lang } = useI18n();
  const serviceDetailId = useAppStore((s) => s.selectedServiceDetailId);
  const setSelectedServiceDetail = useAppStore((s) => s.setSelectedServiceDetail);
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);
  const toggleCompare = useAppStore((s) => s.toggleCompare);
  const inCompare = useAppStore((s) => s.inCompare);
  const setSubscribeService = useAppStore((s) => s.setSubscribeService);
  const pushRecent = useAppStore((s) => s.pushRecentService);
  const currency = useAppStore((s) => s.currency);

  const [copied, setCopied] = useState(false);
  useServiceHashSync();

  const open = !!serviceDetailId;

  const { data, isLoading } = useQuery<ServiceDetail>({
    queryKey: ["service-detail", serviceDetailId],
    queryFn: () => fetcher(`/api/v1/services/${serviceDetailId}/detail`),
    enabled: !!serviceDetailId,
    staleTime: 30_000,
  });

  function close() {
    setSelectedServiceDetail(null);
  }

  async function shareService() {
    if (!serviceDetailId) return;
    const url = `${window.location.origin}/#/service/${encodeURIComponent(serviceDetailId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: data?.service.nameRu ?? "Service", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("share.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* dismissed */
    }
  }

  const offerings = data?.offerings ?? [];
  const stats = data?.stats;
  const cheapestPrice = stats?.min;
  const avgPrice = stats?.avg;

  const chartData = (data?.history ?? []).map((p) => ({
    date: shortDate(p.date),
    min: p.min,
    avg: p.avg,
    max: p.max,
  }));

  // Trend: compare first vs last avg
  let trendPct: number | null = null;
  if (chartData.length >= 2) {
    const first = chartData[0].avg;
    const last = chartData[chartData.length - 1].avg;
    if (first && last) trendPct = Math.round(((last - first) / first) * 100);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("serviceDetail.title")}</DialogTitle>
          <DialogDescription>{t("serviceDetail.allClinics")}</DialogDescription>
        </DialogHeader>
        {isLoading || !data || !stats ? (
          <div className="grid h-64 place-items-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Header banner */}
            <DialogHeader className="border-b border-border/60 p-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Activity className="h-5 w-5" />
                    </span>
                    <span className="truncate">
                      {lang === "en" ? data.service.nameEn : lang === "kk" ? data.service.nameKk : data.service.nameRu}
                    </span>
                  </DialogTitle>
                  <DialogDescription className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <Badge variant="secondary" className="bg-primary/10 px-1.5 py-0 text-[10px] uppercase text-primary">
                      {localizedCategory(data.service.category, lang)}
                    </Badge>
                    <span className="flex items-center gap-1">
                      <Stethoscope className="h-3 w-3" />
                      {stats.clinicCount} {t("serviceDetail.clinics")}
                    </span>
                    {data.service.synonyms.length > 0 && (
                      <span className="text-muted-foreground/80">
                        {t("serviceDetail.synonyms")}: {data.service.synonyms.slice(0, 4).join(", ")}
                      </span>
                    )}
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={shareService}>
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Share2 className="h-3.5 w-3.5" />}
                    {t("share.title")}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={close}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <ScrollArea className="h-[68vh]">
              <div className="space-y-5 p-5">
                {/* Stats grid */}
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <BarChart3 className="h-3.5 w-3.5" />
                    {t("serviceDetail.stats")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <StatTile label={t("serviceDetail.min")} value={formatPrice(stats.min, currency)} tone="emerald" />
                    <StatTile label={t("serviceDetail.max")} value={formatPrice(stats.max, currency)} tone="rose" />
                    <StatTile label={t("serviceDetail.avg")} value={formatPrice(stats.avg, currency)} tone="primary" />
                    <StatTile label={t("serviceDetail.median")} value={formatPrice(stats.median, currency)} tone="cyan" />
                    <StatTile label={t("serviceDetail.spread")} value={formatPrice(stats.spread, currency)} tone="amber" />
                    <StatTile
                      label="Δ %"
                      value={`${stats.spreadPct}%`}
                      tone="purple"
                      hint={stats.spreadPct > 100 ? "High variance" : undefined}
                    />
                  </div>
                </div>

                {/* Price distribution */}
                {data.distribution.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      <TrendingUp className="h-3.5 w-3.5" />
                      {t("serviceDetail.distribution")}
                    </h3>
                    <div className="space-y-1.5 rounded-xl border border-border/60 bg-muted/20 p-3">
                      {data.distribution.map((d) => {
                        const pct = stats.clinicCount > 0 ? (d.count / stats.clinicCount) * 100 : 0;
                        return (
                          <div key={d.bucket} className="flex items-center gap-3 text-xs">
                            <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{d.bucket} ₸</span>
                            <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                              <div
                                className="h-full rounded bg-primary/70 transition-all"
                                style={{ width: `${Math.max(pct, 4)}%` }}
                              />
                            </div>
                            <span className="w-10 shrink-0 text-right font-semibold tabular-nums">
                              {d.count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 30-day history chart */}
                {chartData.length > 1 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      <TrendingUp className="h-3.5 w-3.5" />
                      {t("serviceDetail.history")}
                      {trendPct != null && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "ml-2 gap-1 text-[10px] font-semibold",
                            trendPct > 0
                              ? "border-rose-400/40 bg-rose-500/5 text-rose-600 dark:text-rose-400"
                              : trendPct < 0
                              ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                              : "border-border text-muted-foreground"
                          )}
                        >
                          {trendPct > 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : trendPct < 0 ? <ArrowDownRight className="h-2.5 w-2.5" /> : null}
                          {trendPct > 0 ? "+" : ""}{trendPct}%
                        </Badge>
                      )}
                    </h3>
                    <div className="h-56 w-full rounded-xl border border-border/60 bg-card p-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                          <defs>
                            <linearGradient id="svcBandFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            stroke="var(--muted-foreground)"
                            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "var(--popover)",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                            formatter={(v: number) => formatPrice(v, currency)}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Area type="monotone" dataKey="max" name="max" stroke="none" fill="url(#svcBandFill)" />
                          <Area type="monotone" dataKey="min" name="min" stroke="none" fill="var(--background)" />
                          <Line type="monotone" dataKey="avg" name="avg" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Description */}
                {data.service.description && (
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Info className="h-3 w-3" />
                      {t("serviceDetail.description")}
                    </div>
                    <p className="text-sm text-foreground/90">{data.service.description}</p>
                  </div>
                )}

                {/* All clinics offering this service (cheapest first) */}
                <div>
                  <h3 className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Stethoscope className="h-3.5 w-3.5" />
                      {t("serviceDetail.allClinics")}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground/70">
                      {t("serviceDetail.cheapestFirst")}
                    </span>
                  </h3>
                  {offerings.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                      {t("serviceDetail.noOfferings")}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {offerings.map((o, idx) => {
                        const isBest = o.priceKzt === cheapestPrice;
                        const isWorst = o.priceKzt === stats.max && stats.clinicCount > 1;
                        const belowAvg = avgPrice != null && o.priceKzt < avgPrice;
                        const savingsVsAvg = avgPrice != null ? avgPrice - o.priceKzt : 0;
                        const stale = isStale(o.parsedAt);
                        const added = inCompare(data.service.id);

                        function handleCompare() {
                          const ok = toggleCompare(data.service.id);
                          if (!ok && !added) {
                            toast.error(t("toast.compareFull", { max: MAX_COMPARE }));
                            return;
                          }
                          toast.success(added ? t("toast.compareRemoved") : t("toast.compareAdded"));
                        }

                        return (
                          <div
                            key={o.id}
                            className={cn(
                              "flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 transition-colors",
                              isBest
                                ? "border-primary/40 bg-primary/5 msp-best-card"
                                : isWorst
                                ? "border-rose-300/50 bg-rose-50/40 dark:bg-rose-950/10"
                                : "border-border/60 hover:border-primary/30"
                            )}
                          >
                            {/* Rank + clinic block */}
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <div
                                className={cn(
                                  "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold tabular-nums",
                                  isBest
                                    ? "bg-primary text-primary-foreground"
                                    : isWorst
                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                    : "bg-muted text-muted-foreground"
                                )}
                              >
                                {idx + 1}
                              </div>
                              <div className="min-w-0">
                                <button
                                  onClick={() => {
                                    pushRecent(data.service.id);
                                    setSelectedClinic(o.clinic.id);
                                  }}
                                  className="block truncate text-left text-sm font-semibold hover:text-primary hover:underline"
                                >
                                  {o.clinic.name}
                                </button>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                  <span className="flex items-center gap-0.5">
                                    <MapPin className="h-2.5 w-2.5" />
                                    {cityName(o.clinic.city, lang)}
                                  </span>
                                  <span className="flex items-center gap-0.5">
                                    <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                                    {o.clinic.rating.toFixed(1)}
                                  </span>
                                  {o.clinic.onlineBooking && (
                                    <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="h-2.5 w-2.5" />
                                      {t("result.bookOnline")}
                                    </span>
                                  )}
                                  <span className={cn(stale && "text-amber-600")}>
                                    · {relativeDate(o.parsedAt, lang)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Price block */}
                            <div className="text-right">
                              <div className="flex items-baseline justify-end gap-1.5">
                                {isBest && (
                                  <Badge className="gap-0.5 bg-primary/15 text-[9px] font-bold uppercase text-primary hover:bg-primary/20">
                                    <Crown className="h-2.5 w-2.5" />
                                    {t("serviceDetail.bestDeal")}
                                  </Badge>
                                )}
                                {isWorst && (
                                  <Badge variant="outline" className="gap-0.5 border-rose-400/40 bg-rose-500/5 text-[9px] font-semibold uppercase text-rose-600 dark:text-rose-400">
                                    <ArrowUpRight className="h-2.5 w-2.5" />
                                    {t("serviceDetail.worstDeal")}
                                  </Badge>
                                )}
                                <div className="text-lg font-extrabold tabular-nums">
                                  {formatPrice(o.priceKzt, currency)}
                                </div>
                              </div>
                              {belowAvg && savingsVsAvg > 0 && (
                                <div className="mt-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  {t("serviceDetail.saveVsAvg")}: {formatPrice(savingsVsAvg, currency)}
                                </div>
                              )}
                              {o.durationDays != null && (
                                <div className="mt-0.5 text-[10px] text-muted-foreground">
                                  <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                                  {o.durationDays === 0
                                    ? t("result.sameDay")
                                    : `${o.durationDays} ${o.durationDays === 1 ? t("result.day") : t("result.days")}`}
                                </div>
                              )}
                            </div>

                            {/* Action buttons */}
                            <div className="flex w-full items-center gap-1.5 sm:w-auto">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-xs"
                                onClick={() => {
                                  pushRecent(data.service.id);
                                  setSelectedClinic(o.clinic.id);
                                }}
                              >
                                <Stethoscope className="h-3 w-3" />
                                {t("serviceDetail.viewClinic")}
                              </Button>
                              <Button
                                variant={added ? "default" : "outline"}
                                size="sm"
                                className="gap-1 text-xs"
                                onClick={handleCompare}
                              >
                                <GitCompareArrows className="h-3 w-3" />
                                {added ? t("serviceDetail.inCompare") : t("serviceDetail.addToCompare")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-xs text-primary"
                                onClick={() =>
                                  setSubscribeService({
                                    id: data.service.id,
                                    nameRu: data.service.nameRu,
                                    nameKk: data.service.nameKk,
                                    nameEn: data.service.nameEn,
                                    category: data.service.category,
                                    synonyms: data.service.synonyms,
                                    description: data.service.description,
                                    unit: data.service.unit,
                                  })
                                }
                              >
                                <Bell className="h-3 w-3" />
                                {t("serviceDetail.subscribe")}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "primary" | "cyan" | "amber" | "purple";
  hint?: string;
}) {
  const toneClass: Record<typeof tone, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400",
    primary: "border-primary/30 bg-primary/5 text-primary",
    cyan: "border-cyan-500/30 bg-cyan-500/5 text-cyan-700 dark:text-cyan-400",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    purple: "border-purple-500/30 bg-purple-500/5 text-purple-700 dark:text-purple-400",
  };
  return (
    <div className={cn("rounded-lg border p-2.5", toneClass[tone])}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[9px] opacity-70">{hint}</div>}
    </div>
  );
}
