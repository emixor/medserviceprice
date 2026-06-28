"use client";

/**
 * Background Scraper Panel
 * =============================================================
 * Admin UI for the non-blocking background ingestion pipeline.
 *
 * Three sections:
 *   1. Worker status card — live state (idle/running), current job,
 *      queue depth, uptime, registered scrapers. Auto-refreshes every
 *      2s while a job is running.
 *   2. Recent jobs list — last N ingestion jobs with progress bars,
 *      row counts, duration, and per-source status expandable.
 *   3. Source configuration table — one row per ScraperSourceConfig
 *      with an active toggle, parser type, last success/error, run
 *      counters, and success rate.
 *
 * All actions are non-blocking:
 *   - "Trigger background scrape" → POST /api/v1/ingest/background,
 *     returns immediately with a jobId, panel switches to live-poll mode.
 *   - "Trigger with 1 failure" → same endpoint with forceOneFailure=true
 *     to demonstrate per-source fault isolation.
 *   - Source toggle → PATCH /api/v1/scraper-sources/[sourceName].
 *   - "Sync from config" → POST /api/v1/scraper-sources {action:"sync"}.
 */

import { useI18n } from "@/components/providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  Play,
  Zap,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Server,
  Database,
  ZapOff,
  ToggleLeft,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types matching the API responses
// ---------------------------------------------------------------------------

type WorkerStatus = {
  state: "idle" | "running";
  currentJobId: string | null;
  queueDepth: number;
  registeredScrapers: string[];
  uptimeMs: number;
};

type SourceOutcome = {
  configId: string;
  sourceName: string;
  clinicName: string;
  city: string;
  sourceUrl: string;
  status: "success" | "failed";
  fetched: number;
  normalized: number;
  unmatched: number;
  upserted: number;
  durationMs: number;
  error: string | null;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
};

type IngestionJobView = {
  jobId: string;
  status: "queued" | "running" | "success" | "partial" | "failed" | "cancelled";
  triggeredBy: string;
  sourcesTotal: number;
  sourcesDone: number;
  sourcesFailed: number;
  rowsFetched: number;
  rowsNormalized: number;
  rowsUnmatched: number;
  errorMessage: string | null;
  sources: SourceOutcome[];
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

type ScraperSourceView = {
  id: string;
  sourceName: string;
  clinicName: string;
  city: string;
  sourceUrl: string;
  website: string | null;
  isActive: boolean;
  parserType: string;
  timeoutMs: number;
  politenessMs: number;
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  totalSuccess: number;
  totalFailed: number;
  totalRowsParsed: number;
  totalRowsUpserted: number;
  successRate: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatUptime(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - d);
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const STATUS_VARIANT: Record<
  IngestionJobView["status"],
  { label: string; cls: string; icon: typeof CheckCircle2 }
> = {
  queued: { label: "bgJobQueued", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: Clock },
  running: { label: "bgJobRunning", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 animate-pulse", icon: Loader2 },
  success: { label: "bgJobSuccess", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: CheckCircle2 },
  partial: { label: "bgJobPartial", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", icon: AlertTriangle },
  failed: { label: "bgJobFailed", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", icon: XCircle },
  cancelled: { label: "bgJobCancelled", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", icon: XCircle },
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BackgroundScraperPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [triggering, setTriggering] = useState(false);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch worker status + recent jobs (combined endpoint).
  const statusQuery = useQuery<{ worker: WorkerStatus; jobs: IngestionJobView[] }>({
    queryKey: ["bg-scraper-status"],
    queryFn: () => fetcher("/api/v1/ingest/status?limit=10"),
    refetchInterval: 2000, // poll every 2s — cheap in-memory read
  });

  // Fetch source config table.
  const sourcesQuery = useQuery<{
    sources: ScraperSourceView[];
    total: number;
    active: number;
    registeredScrapers: string[];
    summary: { totalRuns: number; totalSuccess: number; totalFailed: number; avgSuccessRate: number };
  }>({
    queryKey: ["bg-scraper-sources"],
    queryFn: () => fetcher("/api/v1/scraper-sources"),
    refetchInterval: 5000, // less frequent — config doesn't change as often
  });

  const worker = statusQuery.data?.worker;
  const jobs = statusQuery.data?.jobs ?? [];
  const sources = sourcesQuery.data?.sources ?? [];
  const summary = sourcesQuery.data?.summary;
  const isAnyJobRunning = jobs.some((j) => j.status === "running" || j.status === "queued");

  // Auto-expand the currently-running job so the user sees live progress.
  useEffect(() => {
    const running = jobs.find((j) => j.status === "running");
    if (running && expandedJob !== running.jobId) {
      setExpandedJob(running.jobId);
    }
  }, [jobs, expandedJob]);

  // Cleanup poller on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function triggerBackground(forceFail = false) {
    setTriggering(true);
    try {
      const res = await fetch("/api/v1/ingest/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggeredBy: "manual",
          forceOneFailure: forceFail,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast.success(t("bgEnqueued", { jobId: data.jobId }));
      // Immediately refetch so the new job appears.
      qc.invalidateQueries({ queryKey: ["bg-scraper-status"] });
    } catch (e) {
      toast.error(t("bgTriggerError") + ": " + String((e as Error).message));
    } finally {
      setTriggering(false);
    }
  }

  async function toggleSource(sourceName: string, nextActive: boolean) {
    setToggling((s) => ({ ...s, [sourceName]: true }));
    try {
      const res = await fetch(`/api/v1/scraper-sources/${encodeURIComponent(sourceName)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      qc.invalidateQueries({ queryKey: ["bg-scraper-sources"] });
    } catch (e) {
      toast.error(t("bgToggleError") + ": " + String((e as Error).message));
    } finally {
      setToggling((s) => ({ ...s, [sourceName]: false }));
    }
  }

  async function syncSources() {
    setSyncing(true);
    try {
      const res = await fetch("/api/v1/scraper-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t("bgSyncDone"));
      qc.invalidateQueries({ queryKey: ["bg-scraper-sources"] });
    } catch (e) {
      toast.error(t("bgToggleError") + ": " + String((e as Error).message));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        {/* Header + actions */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Server className="h-5 w-5 text-primary" />
              {t("admin.bgScraper")}
            </h2>
            <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
              {t("admin.bgScraperSubtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => syncSources()}
              disabled={syncing}
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("bgSyncSources")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
              onClick={() => triggerBackground(true)}
              disabled={triggering}
            >
              {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ZapOff className="h-3.5 w-3.5" />}
              {t("admin.bgTriggerFail")}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => triggerBackground(false)}
              disabled={triggering}
            >
              {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {t("admin.bgTrigger")}
            </Button>
          </div>
        </div>

        {/* Worker status card */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-primary" />
              {t("admin.bgWorkerStatus")}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["bg-scraper-status"] });
                qc.invalidateQueries({ queryKey: ["bg-scraper-sources"] });
              }}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatusTile
              label={t("admin.bgWorkerStatus")}
              value={worker ? (worker.state === "running" ? t("admin.bgWorkerRunning") : t("admin.bgWorkerIdle")) : "—"}
              icon={worker?.state === "running" ? Loader2 : CheckCircle2}
              iconCls={worker?.state === "running" ? "animate-spin text-sky-500" : "text-emerald-500"}
            />
            <StatusTile
              label={t("admin.bgCurrentJob")}
              value={worker?.currentJobId ?? "—"}
              icon={Zap}
              iconCls="text-amber-500"
              mono
            />
            <StatusTile
              label={t("admin.bgQueueDepth")}
              value={String(worker?.queueDepth ?? 0)}
              icon={Database}
              iconCls="text-violet-500"
            />
            <StatusTile
              label={t("admin.bgUptime")}
              value={worker ? formatUptime(worker.uptimeMs) : "—"}
              icon={Clock}
              iconCls="text-cyan-500"
            />
          </div>
          {worker && worker.registeredScrapers.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
              <span className="text-xs text-muted-foreground">{t("admin.bgRegisteredScrapers")}:</span>
              {worker.registeredScrapers.map((s) => (
                <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                  {s}
                </Badge>
              ))}
            </div>
          )}
        </Card>

        {/* Recent jobs */}
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" />
            {t("admin.bgRecentJobs")}
            {isAnyJobRunning && (
              <Badge variant="outline" className="ml-1 gap-1 border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                live
              </Badge>
            )}
          </h3>
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <Database className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("admin.bgNoJobs")}</p>
            </div>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {jobs.map((job) => {
                const variant = STATUS_VARIANT[job.status];
                const Icon = variant.icon;
                const pct = job.sourcesTotal > 0 ? (job.sourcesDone / job.sourcesTotal) * 100 : 0;
                const isExpanded = expandedJob === job.jobId;
                return (
                  <div
                    key={job.jobId}
                    className="rounded-lg border border-border/60 bg-card/50"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/30"
                      onClick={() => setExpandedJob(isExpanded ? null : job.jobId)}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          variant.cls.includes("emerald") && "text-emerald-500",
                          variant.cls.includes("sky") && "text-sky-500 animate-spin",
                          variant.cls.includes("amber") && "text-amber-500",
                          variant.cls.includes("rose") && "text-rose-500",
                          variant.cls.includes("slate") && "text-slate-400"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium">{job.jobId}</span>
                          <Badge variant="secondary" className={cn("h-5 px-1.5 text-[10px]", variant.cls)}>
                            {t(variant.label)}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {job.triggeredBy}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span>
                            {t("bgLiveProgress", {
                              done: job.sourcesDone,
                              total: job.sourcesTotal,
                              failed: job.sourcesFailed,
                            })}
                          </span>
                          <span>·</span>
                          <span>{t("bgRowsFetched")}: {job.rowsFetched}</span>
                          <span>·</span>
                          <span>{formatDuration(job.durationMs)}</span>
                        </div>
                        {(job.status === "running" || job.status === "queued") && (
                          <Progress value={pct} className="mt-1.5 h-1" />
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {relativeTime(job.queuedAt)}
                      </span>
                    </button>
                    {isExpanded && job.sources.length > 0 && (
                      <div className="border-t bg-muted/20 p-2">
                        <div className="max-h-64 space-y-1 overflow-y-auto">
                          {job.sources.map((s, idx) => (
                            <div
                              key={`${s.configId}-${idx}`}
                              className="flex items-center gap-2 rounded px-2 py-1 text-[11px]"
                            >
                              {s.status === "success" ? (
                                <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                              ) : (
                                <XCircle className="h-3 w-3 shrink-0 text-rose-500" />
                              )}
                              <span className="w-24 shrink-0 truncate font-medium">
                                {s.sourceName}
                              </span>
                              <span className="w-20 shrink-0 truncate text-muted-foreground">
                                {s.city}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {s.fetched}→{s.normalized}
                              </span>
                              {s.error && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="min-w-0 flex-1 truncate text-rose-600 dark:text-rose-400">
                                      {s.error}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-md">
                                    <p className="text-xs">{s.error}</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              <span className="ml-auto shrink-0 text-muted-foreground">
                                {formatDuration(s.durationMs)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Source configuration table */}
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ToggleLeft className="h-4 w-4 text-primary" />
              {t("bgSourcesTable")}
            </h3>
            {summary && (
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span>{t("bgSources")}: <strong className="text-foreground">{sourcesQuery.data?.total ?? 0}</strong></span>
                <span>{t("bgActive")}: <strong className="text-emerald-600 dark:text-emerald-400">{sourcesQuery.data?.active ?? 0}</strong></span>
                <span>{t("bgRuns")}: <strong className="text-foreground">{summary.totalRuns}</strong></span>
                <span>{t("bgSuccessRate")}: <strong className="text-foreground">{summary.avgSuccessRate}%</strong></span>
              </div>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 font-medium">{t("bgSourceName")}</th>
                  <th className="px-2 py-2 font-medium">{t("bgCity")}</th>
                  <th className="px-2 py-2 font-medium">{t("bgParserType")}</th>
                  <th className="px-2 py-2 text-center font-medium">{t("bgActive")}</th>
                  <th className="px-2 py-2 font-medium">{t("bgLastSuccess")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("bgRuns")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("bgSuccessRate")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("bgRows")}</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr
                    key={s.id}
                    className={cn(
                      "border-t border-border/40 hover:bg-accent/20",
                      !s.isActive && "opacity-50"
                    )}
                  >
                    <td className="px-2 py-2">
                      <div className="font-medium">{s.sourceName}</div>
                      <div className="truncate text-[10px] text-muted-foreground" style={{ maxWidth: 180 }}>
                        {s.clinicName}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{s.city}</td>
                    <td className="px-2 py-2">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {s.parserType}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Switch
                        checked={s.isActive}
                        disabled={toggling[s.sourceName]}
                        onCheckedChange={(v) => toggleSource(s.sourceName, v)}
                        aria-label={t("bgToggleSource")}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {s.lastSuccessfulAt ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-muted-foreground">
                              {relativeTime(s.lastSuccessfulAt)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs">{new Date(s.lastSuccessfulAt).toLocaleString()}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {s.consecutiveFailures > 0 && (
                        <div className="text-[10px] text-rose-600 dark:text-rose-400">
                          {s.consecutiveFailures} fails
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{s.totalRuns}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      <span
                        className={cn(
                          s.successRate >= 90
                            ? "text-emerald-600 dark:text-emerald-400"
                            : s.successRate >= 50
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-rose-600 dark:text-rose-400"
                        )}
                      >
                        {s.successRate}%
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {s.totalRowsParsed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Status tile subcomponent
// ---------------------------------------------------------------------------

function StatusTile({
  label,
  value,
  icon: Icon,
  iconCls,
  mono,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  iconCls?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className={cn("h-3 w-3", iconCls)} />
        {label}
      </div>
      <div className={cn("mt-1 truncate text-sm font-semibold", mono && "font-mono text-xs")}>
        {value}
      </div>
    </div>
  );
}
