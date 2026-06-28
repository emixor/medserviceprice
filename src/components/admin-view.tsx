"use client";

import { useI18n } from "@/components/providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetcher,
  type UnmatchedItem,
  type ServiceDirectoryItem,
  formatKzt,
  relativeDate,
  cityName,
  svcName,
} from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck,
  RefreshCw,
  Play,
  AlertTriangle,
  Check,
  X,
  Trash2,
  Loader2,
  Sparkles,
  Activity,
  Database,
  TrendingUp,
  Clock,
  HeartPulse,
  Timer,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  BarChart3,
  History,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Cell,
} from "recharts";
import { localizedCategory } from "@/lib/i18n";
import { useState, useMemo } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DataQualityPanel } from "@/components/data-quality-panel";
import { ParserRunsPanel } from "@/components/parser-runs-panel";
import { BackgroundScraperPanel } from "@/components/background-scraper-panel";

export function AdminView() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [assigning, setAssigning] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [ingesting, setIngesting] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);

  const categoryBarColors = useCategoryBarColors();
  const topServiceColors = useTopServiceColors();

  async function runAiNormalize() {
    setAiRunning(true);
    try {
      const res = await fetch("/api/v1/admin/ai-normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`ai-normalize failed ${res.status}`);
      const data = await res.json();
      const count = data.suggestions?.filter((s: { serviceId: string | null }) => s.serviceId).length ?? 0;
      toast.success(t("admin.aiDone", { count }));
      // Pre-fill the assigning map with AI suggestions
      const nextAssign: Record<string, string> = { ...assigning };
      for (const s of data.suggestions ?? []) {
        if (s.serviceId && s.unmatchedId) {
          nextAssign[s.unmatchedId] = s.serviceId;
        }
      }
      setAssigning(nextAssign);
      qc.invalidateQueries({ queryKey: ["unmatched"] });
    } catch (e) {
      toast.error(t("admin.aiFailed") + ": " + String((e as Error).message));
    } finally {
      setAiRunning(false);
    }
  }

  const { data, isLoading, refetch, isFetching } = useQuery<{
    items: UnmatchedItem[];
    directory: ServiceDirectoryItem[];
  }>({
    queryKey: ["unmatched", showAll ? "all" : "pending"],
    queryFn: () => fetcher(`/api/v1/admin/unmatched?status=${showAll ? "all" : "pending"}`),
    staleTime: 15_000,
  });

  // Pull global stats for the quick-insights dashboard
  const { data: stats } = useQuery<{
    clinics: number;
    services: number;
    normalized: number;
    raw: number;
    unmatched: number;
    history: number;
    avgSpreadPct: number;
    categoryCounts?: Record<string, number>;
    topServices?: {
      id: string;
      nameRu: string;
      nameKk: string;
      nameEn: string;
      count: number;
      minPrice: number;
      avgPrice: number;
    }[];
    cityCounts?: Record<string, number>;
    recentActivity?: {
      id: string;
      serviceId: string;
      clinicId: string;
      clinicName: string;
      serviceName: { id: string; nameRu: string; nameKk: string; nameEn: string } | null;
      oldPrice: number | null;
      newPrice: number;
      recordedAt: string;
    }[];
  }>({
    queryKey: ["stats"],
    queryFn: () => fetcher("/api/v1/stats"),
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  const directory = data?.directory ?? [];

  // Compute status breakdown from the "all" view if available
  const pendingCount = showAll ? items.filter((i) => i.status === "pending").length : items.length;
  const resolvedCount = showAll ? items.filter((i) => i.status === "resolved").length : 0;
  const ignoredCount = showAll ? items.filter((i) => i.status === "ignored").length : 0;

  // Match rate: (normalized / (normalized + pending_unmatched)) * 100
  const matchRate =
    stats && stats.normalized + pendingCount > 0
      ? Math.round((stats.normalized / (stats.normalized + pendingCount)) * 100)
      : null;

  // Data Freshness: compute from most recent parsedAt across items
  const lastIngestionLabel = useMemo(() => {
    if (items.length === 0) return "—";
    const dates = items
      .map((i) => new Date(i.parsedAt).getTime())
      .filter((d) => !isNaN(d));
    if (dates.length === 0) return "—";
    const latest = new Date(Math.max(...dates));
    return relativeDate(latest.toISOString(), lang);
  }, [items, lang]);

  // Chart data: records by category (always 4 bars)
  const categoryChartData = useMemo(() => {
    const cc = stats?.categoryCounts ?? {};
    return [
      {
        key: "laboratory",
        label: localizedCategory("laboratory", lang),
        count: cc.laboratory ?? 0,
      },
      {
        key: "diagnostics",
        label: localizedCategory("diagnostics", lang),
        count: cc.diagnostics ?? 0,
      },
      {
        key: "doctor_appointment",
        label: localizedCategory("doctor_appointment", lang),
        count: cc.doctor_appointment ?? 0,
      },
      {
        key: "procedure",
        label: localizedCategory("procedure", lang),
        count: cc.procedure ?? 0,
      },
    ];
  }, [stats?.categoryCounts, lang]);

  // Chart data: top services by price count
  const topServicesData = useMemo(() => {
    return (stats?.topServices ?? []).map((s) => ({
      id: s.id,
      name: svcName(s, lang),
      count: s.count,
      minPrice: s.minPrice,
      avgPrice: s.avgPrice,
    }));
  }, [stats?.topServices, lang]);

  const recentActivity = useMemo(() => stats?.recentActivity ?? [], [stats?.recentActivity]);

  async function resolve(id: string) {
    const serviceId = assigning[id];
    if (!serviceId) {
      toast.error(t("admin.assignTo"));
      return;
    }
    setResolving((r) => ({ ...r, [id]: true }));
    try {
      const res = await fetch("/api/v1/admin/unmatched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "resolve", serviceId }),
      });
      if (!res.ok) throw new Error(`resolve failed ${res.status}`);
      toast.success(t("toast.resolved"));
      setAssigning((a) => {
        const next = { ...a };
        delete next[id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["unmatched"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["compare"] });
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setResolving((r) => ({ ...r, [id]: false }));
    }
  }

  async function ignore(id: string) {
    setResolving((r) => ({ ...r, [id]: true }));
    try {
      const res = await fetch("/api/v1/admin/unmatched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "ignore" }),
      });
      if (!res.ok) throw new Error(`ignore failed ${res.status}`);
      toast.success(t("toast.ignored"));
      qc.invalidateQueries({ queryKey: ["unmatched"] });
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setResolving((r) => ({ ...r, [id]: false }));
    }
  }

  async function runIngestion() {
    setIngesting(true);
    try {
      const res = await fetch("/api/v1/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`ingest failed ${res.status}`);
      const report = await res.json();
      toast.success(
        t("toast.ingestDone", {
          fetched: report.totalFetched,
          normalized: report.totalNormalized,
          unmatched: report.totalUnmatched,
        })
      );
      qc.invalidateQueries({ queryKey: ["unmatched"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (e) {
      toast.error(t("toast.ingestError") + ": " + String((e as Error).message));
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 msp-fade-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" />
            {t("admin.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("admin.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="show-all"
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2"
          >
            <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
            <Label className="text-xs">{t("admin.showAll")}</Label>
          </label>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            {t("admin.refresh")}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={runIngestion}
            disabled={ingesting}
          >
            {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {ingesting ? t("admin.ingestionRunning") : t("admin.runIngestion")}
          </Button>
          {items.length > 0 && (
            <Button
              variant="default"
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-primary to-cyan-600"
              onClick={runAiNormalize}
              disabled={aiRunning}
            >
              {aiRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiRunning ? t("admin.aiRunning") : t("admin.aiNormalize")}
            </Button>
          )}
        </div>
      </div>

      {/* Quick Insights Dashboard */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-8">
        <InsightTile
          icon={<Database className="h-4 w-4" />}
          label={t("footer.raw")}
          value={stats?.raw ?? "—"}
          tint="text-cyan-600 dark:text-cyan-400"
          iconBg="bg-cyan-500/10"
          gradient="from-cyan-500/8 to-transparent"
          description={t("admin.rawDesc")}
        />
        <InsightTile
          icon={<Check className="h-4 w-4" />}
          label={t("footer.normalized")}
          value={stats?.normalized ?? "—"}
          tint="text-emerald-600 dark:text-emerald-400"
          iconBg="bg-emerald-500/10"
          gradient="from-emerald-500/8 to-transparent"
          description={t("admin.normalizedDesc")}
        />
        <InsightTile
          icon={<AlertTriangle className="h-4 w-4" />}
          label={t("admin.pending")}
          value={pendingCount}
          tint="text-amber-600 dark:text-amber-400"
          iconBg="bg-amber-500/10"
          gradient="from-amber-500/8 to-transparent"
          description={t("admin.pendingDesc")}
        />
        <InsightTile
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("admin.resolved")}
          value={showAll ? resolvedCount : "—"}
          tint="text-primary"
          iconBg="bg-primary/10"
          gradient="from-primary/8 to-transparent"
          description={t("admin.resolvedDesc")}
        />
        <InsightTile
          icon={<Clock className="h-4 w-4" />}
          label={t("history.title")}
          value={stats?.history ?? "—"}
          tint="text-violet-600 dark:text-violet-400"
          iconBg="bg-violet-500/10"
          gradient="from-violet-500/8 to-transparent"
          description={t("admin.historyDesc")}
        />
        <InsightTile
          icon={<Activity className="h-4 w-4" />}
          label={t("admin.matchRate")}
          value={matchRate != null ? `${matchRate}%` : "—"}
          tint="text-primary"
          iconBg="bg-primary/10"
          gradient="from-primary/8 to-transparent"
          progress={matchRate ?? 0}
          description={t("admin.matchRateDesc")}
        />
        <InsightTile
          icon={<Timer className="h-4 w-4" />}
          label={t("admin.dataFreshness")}
          value={lastIngestionLabel}
          tint="text-cyan-600 dark:text-cyan-400"
          iconBg="bg-cyan-500/10"
          gradient="from-cyan-500/8 to-transparent"
          description={t("admin.lastIngestion")}
        />
        <InsightTile
          icon={<HeartPulse className="h-4 w-4" />}
          label={t("admin.systemHealth")}
          value={
            <span className="flex items-center gap-1.5">
              <span className="msp-status-dot" />
              {t("admin.healthy")}
            </span>
          }
          tint="text-emerald-600 dark:text-emerald-400"
          iconBg="bg-emerald-500/10"
          gradient="from-emerald-500/8 to-transparent"
        />
      </div>

      {/* Section divider */}
      <div className="section-divider mb-5" />

      {/* Price Trends: category bar chart + top services horizontal bar chart */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="card-premium p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <BarChart3 className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-bold">{t("admin.byCategory")}</h3>
          </div>
          <div className="h-56 w-full">
            {categoryChartData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                    interval={0}
                    angle={-12}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                    allowDecimals={false}
                    width={32}
                  />
                  <RTooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.2 }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                    formatter={(v: number) => [v, t("footer.normalized")]}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56}>
                    {categoryChartData.map((d) => (
                      <Cell key={d.key} fill={categoryBarColors[d.key] ?? "#14b8a6"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("admin.empty")}
              </div>
            )}
          </div>
        </Card>

        <Card className="card-premium p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-bold">{t("admin.topServices")}</h3>
          </div>
          <div className="h-56 w-full">
            {topServicesData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topServicesData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                    width={130}
                    tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 18) + "…" : v)}
                  />
                  <RTooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.2 }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                    formatter={(v: number, _name: string, item: { payload?: { avgPrice?: number; minPrice?: number } }) => [
                      `${v} · ${formatKzt(item?.payload?.avgPrice ?? 0)} ${t("serviceDetail.avg")}`,
                      t("footer.normalized"),
                    ]}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={28}>
                    {topServicesData.map((_, i) => (
                      <Cell key={i} fill={topServiceColors[i % topServiceColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {t("admin.empty")}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Recent Activity: 5 latest price_history changes */}
      <Card className="card-premium mb-5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <History className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold">{t("admin.recentActivity")}</h3>
        </div>
        {recentActivity.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            {t("admin.empty")}
          </div>
        ) : (
          <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {recentActivity.map((a) => {
              const svcNameLabel = a.serviceName ? svcName(a.serviceName, lang) : "—";
              const diff =
                a.oldPrice != null && Number.isFinite(a.oldPrice)
                  ? a.newPrice - a.oldPrice
                  : null;
              const dir = diff == null ? "none" : diff > 0 ? "up" : diff < 0 ? "down" : "same";
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{svcNameLabel}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="truncate">{a.clinicName}</span>
                      <span className="mx-1.5 opacity-50">·</span>
                      <span>{relativeDate(a.recordedAt, lang)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                    <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                      {a.oldPrice != null ? formatKzt(a.oldPrice) : "—"}
                    </span>
                    <ArrowRightMuted />
                    <span
                      className={cn(
                        "font-bold",
                        dir === "up" && "text-rose-600 dark:text-rose-400",
                        dir === "down" && "text-emerald-600 dark:text-emerald-400",
                        dir === "same" && "text-foreground",
                        dir === "none" && "text-foreground"
                      )}
                    >
                      {dir === "up" && <ArrowUpRight className="mr-0.5 inline h-3.5 w-3.5" />}
                      {dir === "down" && <ArrowDownRight className="mr-0.5 inline h-3.5 w-3.5" />}
                      {dir === "same" && <Minus className="mr-0.5 inline h-3.5 w-3.5" />}
                      {formatKzt(a.newPrice)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Section divider before Parser Runs panel */}
      <div className="section-divider mb-5" />

      <ParserRunsPanel />

      {/* Section divider before Data Quality panel */}
      <div className="section-divider mb-5" />

      <DataQualityPanel />

      {/* Section divider before Background Scraper panel */}
      <div className="section-divider mb-5" />

      <BackgroundScraperPanel />

      {/* Section divider before unmatched queue */}
      <div className="section-divider mb-5" />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-400/40 bg-emerald-500/5 px-6 py-16 text-center">
          <Check className="h-10 w-10 text-emerald-500" />
          <h3 className="mt-3 text-base font-semibold">{t("admin.empty")}</h3>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <UnmatchedRow
              key={item.id}
              item={item}
              directory={directory}
              lang={lang}
              t={t}
              assignValue={assigning[item.id] ?? ""}
              onAssign={(v) => setAssigning((a) => ({ ...a, [item.id]: v }))}
              onResolve={() => resolve(item.id)}
              onIgnore={() => ignore(item.id)}
              resolving={!!resolving[item.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnmatchedRow({
  item,
  directory,
  lang,
  t,
  assignValue,
  onAssign,
  onResolve,
  onIgnore,
  resolving,
}: {
  item: UnmatchedItem;
  directory: ServiceDirectoryItem[];
  lang: "kk" | "ru" | "en";
  t: (k: string, v?: Record<string, string | number>) => string;
  assignValue: string;
  onAssign: (v: string) => void;
  onResolve: () => void;
  onIgnore: () => void;
  resolving: boolean;
}) {
  const confidencePct = Math.round(item.confidence * 100);
  const confColor =
    confidencePct < 40 ? "text-red-600" : confidencePct < 70 ? "text-amber-600" : "text-emerald-600";
  const confBg =
    confidencePct < 40 ? "bg-red-500/10" : confidencePct < 70 ? "bg-amber-500/10" : "bg-emerald-500/10";
  const statusTint =
    item.status === "resolved"
      ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-600"
      : item.status === "ignored"
        ? "border-muted-foreground/30 bg-muted/40 text-muted-foreground"
        : "border-amber-400/50 bg-amber-500/10 text-amber-600";

  return (
    <Card className="card-premium p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {/* Raw name + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold tracking-tight">{item.serviceNameRaw}</h3>
            {item.status === "pending" && (
              <Badge variant="outline" className={cn("gap-1 border-transparent", statusTint)}>
                <AlertTriangle className="h-2.5 w-2.5" />
                {t("admin.pending")}
              </Badge>
            )}
            {item.status === "resolved" && (
              <Badge variant="outline" className={cn("gap-1 border-transparent", statusTint)}>
                <Check className="h-2.5 w-2.5" />
                {t("admin.resolved")}
              </Badge>
            )}
            {item.status === "ignored" && (
              <Badge variant="outline" className={cn("gap-1 border-transparent", statusTint)}>
                <X className="h-2.5 w-2.5" />
                {t("admin.ignored")}
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="opacity-70">{t("admin.clinic")}:</span> {item.clinicNameRaw} ·{" "}
              {cityName(item.cityNameRaw, lang)}
            </span>
            <span>
              <span className="opacity-70">{t("admin.source")}:</span>{" "}
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {item.sourceName}
              </Badge>
            </span>
            <span>
              <span className="opacity-70">{t("admin.price")}:</span>{" "}
              <span className="font-semibold text-foreground">
                {formatKzt(item.currencyRaw === "USD" ? item.priceRaw * 470 : item.priceRaw)}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="opacity-70">{t("admin.confidence")}:</span>
              <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums", confBg, confColor)}>
                {confidencePct}%
              </span>
            </span>
            <span className="opacity-70">{relativeDate(item.parsedAt, lang)}</span>
          </div>
          {item.suggestedService && (
            <div className="mt-1.5 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="opacity-70">→</span>
              <span className="font-medium">{item.suggestedService.nameRu}</span>
            </div>
          )}
        </div>

        {/* Assignment controls (only for pending) */}
        {item.status === "pending" && (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={assignValue} onValueChange={onAssign}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-[260px]">
                <SelectValue placeholder={t("admin.assignTo")} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {directory.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="text-xs">{svcName(d, lang)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-primary to-cyan-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-emerald-500/20"
              onClick={onResolve}
              disabled={resolving || !assignValue}
            >
              {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {t("admin.resolve")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={onIgnore}
              disabled={resolving}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("admin.ignore")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function InsightTile({
  icon,
  label,
  value,
  tint = "text-primary",
  iconBg = "bg-primary/10",
  gradient = "from-primary/8 to-transparent",
  progress,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tint?: string;
  iconBg?: string;
  gradient?: string;
  progress?: number;
  description?: string;
}) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border border-border/70 bg-gradient-to-br p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
      gradient
    )}>
      <div className="flex items-center gap-1.5">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg", iconBg, tint)}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn("mt-1.5 text-xl font-extrabold tabular-nums tracking-tight", tint)}>{value}</div>
      {description && (
        <p className="mt-0.5 text-[9px] leading-tight text-muted-foreground/70">{description}</p>
      )}
      {progress != null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-500 transition-all duration-300"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* ---- Chart constants --------------------------------------------------- */

/* Unified premium chart palette — emerald/teal/amber/rose/violet/cyan.
   CSS variables don't reliably resolve inside recharts SVG attributes,
   so we resolve them here in JS via a useTheme-aware hook. */
const CHART_PALETTE_LIGHT = ["#10b981", "#14b8a6", "#06b6d4", "#f59e0b", "#f43f5e"];
const CHART_PALETTE_DARK = ["#34d399", "#2dd4bf", "#22d3ee", "#fbbf24", "#fb7185"];

function useChartColors() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT;
}

/** Category bar colors — pulled from the unified premium chart palette. */
function useCategoryBarColors() {
  const palette = useChartColors();
  return {
    laboratory: palette[2], // cyan
    diagnostics: palette[1], // teal
    doctor_appointment: palette[3], // amber
    procedure: palette[0], // emerald
  };
}

function useTopServiceColors() {
  return useChartColors();
}

function ArrowRightMuted() {
  return (
    <span className="text-muted-foreground/60" aria-hidden>
      →
    </span>
  );
}
