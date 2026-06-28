"use client";

/**
 * ParserRunsPanel — Admin "Source Health & Parser History" dashboard.
 *
 * Surfaces:
 *  - Summary tiles (total runs, success rate, rows parsed/upserted, avg duration, last run)
 *  - Per-source health table (success rate, last status, last rows, avg duration, clinic count)
 *  - "Run parser now" button that triggers a new simulated run across all sources
 *  - Recent runs list with status badges, row counts, duration, and error messages
 *  - Expandable error log for failed/partial runs
 *
 * Data source: GET /api/v1/admin/parser-runs
 * Trigger:     POST /api/v1/admin/parser-runs
 * Backfill:    POST /api/v1/admin/parser-runs/backfill (one-time, idempotent)
 */
import { useI18n } from "@/components/providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetcher, relativeDate } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Play,
  RefreshCw,
  Loader2,
  Server,
  Zap,
  Database,
  TrendingUp,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

type RunItem = {
  id: string;
  sourceName: string;
  sourceUrl: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "partial" | "failed";
  rowsParsed: number;
  rowsNormalized: number;
  rowsUnmatched: number;
  rowsUpserted: number;
  errorsCount: number;
  errorMessage: string | null;
  errorDetails: Array<{ url: string; error: string; ts: string }>;
  triggeredBy: string;
  durationMs: number | null;
};

type SourceHealth = {
  sourceName: string;
  sourceUrl: string;
  totalRuns: number;
  successRuns: number;
  partialRuns: number;
  failedRuns: number;
  successRate: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastRowsParsed: number;
  totalRowsParsed: number;
  avgDurationMs: number;
  clinicCount: number;
};

type Summary = {
  totalRuns: number;
  successRuns: number;
  partialRuns: number;
  failedRuns: number;
  successRate: number;
  totalRowsParsed: number;
  totalRowsUpserted: number;
  avgDurationMs: number;
  lastRunAt: string | null;
  activeSources: number;
  totalSources: number;
};

type ParserRunsResponse = {
  runs: RunItem[];
  sourceHealth: SourceHealth[];
  summary: Summary;
};

const STATUS_STYLES: Record<
  RunItem["status"],
  { icon: typeof CheckCircle2; label: string; cls: string; dot: string }
> = {
  running: {
    icon: Loader2,
    label: "Running",
    cls: "border-sky-400/60 bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  success: {
    icon: CheckCircle2,
    label: "Success",
    cls: "border-emerald-400/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  partial: {
    icon: AlertTriangle,
    label: "Partial",
    cls: "border-amber-400/60 bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    cls: "border-rose-400/60 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
    dot: "bg-rose-500",
  },
};

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("ru-RU");
}

export function ParserRunsPanel() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<ParserRunsResponse>({
    queryKey: ["parser-runs"],
    queryFn: () => fetcher("/api/v1/admin/parser-runs?limit=50"),
    staleTime: 15_000,
  });

  const { data: backfillData } = useQuery<{ created: number; skipped: boolean; total: number }>({
    queryKey: ["parser-runs-backfill"],
    queryFn: async () => {
      const res = await fetch("/api/v1/admin/parser-runs/backfill", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: Infinity,
    retry: false,
  });

  async function triggerRun() {
    setRunning(true);
    try {
      const res = await fetch("/api/v1/admin/parser-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      toast.success(t("parserRuns.runTriggered", { count: body.count }));
      await refetch();
    } catch (e) {
      toast.error(t("parserRuns.runFailed") + ": " + (e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const summary = data?.summary;
  const sources = data?.sourceHealth ?? [];
  const runs = data?.runs ?? [];

  // Summary tiles
  const tiles: Array<{
    icon: typeof Activity;
    label: string;
    value: string;
    sub?: string;
    color: string;
  }> = [
    {
      icon: Activity,
      label: t("parserRuns.totalRuns"),
      value: summary ? fmtNum(summary.totalRuns) : "—",
      sub: summary ? `${summary.activeSources}/${summary.totalSources} ${t("parserRuns.sources")}` : "",
      color: "text-primary bg-primary/10",
    },
    {
      icon: CheckCircle2,
      label: t("parserRuns.successRate"),
      value: summary ? `${summary.successRate}%` : "—",
      sub: summary
        ? `${summary.successRuns}✓ / ${summary.partialRuns}⚠ / ${summary.failedRuns}✗`
        : "",
      color: "text-emerald-600 bg-emerald-500/10",
    },
    {
      icon: Database,
      label: t("parserRuns.rowsParsed"),
      value: summary ? fmtNum(summary.totalRowsParsed) : "—",
      sub: summary ? `${fmtNum(summary.totalRowsUpserted)} ${t("parserRuns.upserted")}` : "",
      color: "text-violet-600 bg-violet-500/10",
    },
    {
      icon: Zap,
      label: t("parserRuns.avgDuration"),
      value: summary ? fmtDuration(summary.avgDurationMs) : "—",
      sub: summary?.lastRunAt
        ? `${t("parserRuns.lastRun")}: ${relativeDate(summary.lastRunAt, lang)}`
        : t("parserRuns.never"),
      color: "text-amber-600 bg-amber-500/10",
    },
  ];

  return (
    <Card className="card-premium overflow-hidden p-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-r from-primary/5 via-transparent to-violet-500/5 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold leading-tight">{t("parserRuns.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("parserRuns.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            {t("parserRuns.refresh")}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={triggerRun}
            disabled={running}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {t("parserRuns.runNow")}
          </Button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/60 bg-card p-3 transition-colors hover:border-border"
            >
              <div className="flex items-center gap-2">
                <div className={cn("grid h-7 w-7 place-items-center rounded-md", tile.color)}>
                  <tile.icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {tile.label}
                </span>
              </div>
              <div className="mt-2 text-xl font-bold tabular-nums">{tile.value}</div>
              {tile.sub && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">{tile.sub}</div>
              )}
            </div>
          ))}
        </div>

        {/* Backfill notice */}
        {backfillData && backfillData.created > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t("parserRuns.backfilled", { n: backfillData.created })}
            </span>
          </div>
        )}

        {/* Source health table */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-bold">{t("parserRuns.sourceHealth")}</h4>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">{t("parserRuns.source")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("parserRuns.clinics")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("parserRuns.runs")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("parserRuns.successRate")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("parserRuns.lastRows")}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t("parserRuns.avgDur")}</th>
                  <th className="px-3 py-2 font-semibold">{t("parserRuns.lastStatus")}</th>
                  <th className="px-3 py-2 font-semibold">{t("parserRuns.lastRun")}</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((src) => {
                  const lastStatus = src.lastStatus as RunItem["status"] | null;
                  const statusStyle = lastStatus ? STATUS_STYLES[lastStatus] : null;
                  const rateColor =
                    src.successRate >= 90
                      ? "text-emerald-600"
                      : src.successRate >= 70
                        ? "text-amber-600"
                        : "text-rose-600";
                  return (
                    <tr
                      key={src.sourceName}
                      className="border-b border-border/40 transition-colors last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{src.sourceName}</span>
                          <a
                            href={src.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {src.clinicCount}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{src.totalRuns}</td>
                      <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", rateColor)}>
                        {src.totalRuns ? `${src.successRate}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {fmtNum(src.lastRowsParsed)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {fmtDuration(src.avgDurationMs)}
                      </td>
                      <td className="px-3 py-2.5">
                        {statusStyle ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                              statusStyle.cls
                            )}
                          >
                            <statusStyle.icon className="h-2.5 w-2.5" />
                            {statusStyle.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {src.lastRunAt ? relativeDate(src.lastRunAt, lang) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent runs list with expandable error log */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-bold">{t("parserRuns.recentRuns")}</h4>
            <span className="text-[10px] text-muted-foreground">({runs.length})</span>
          </div>
          <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
            {runs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                {t("parserRuns.noRuns")}
              </div>
            ) : (
              runs.map((run) => {
                const style = STATUS_STYLES[run.status];
                const hasError = run.errorsCount > 0 && run.errorMessage;
                const isExpanded = expandedRun === run.id;
                return (
                  <div
                    key={run.id}
                    className="rounded-lg border border-border/50 bg-card transition-colors hover:border-border/80"
                  >
                    <button
                      type="button"
                      onClick={() => hasError && setExpandedRun(isExpanded ? null : run.id)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left",
                        hasError && "cursor-pointer"
                      )}
                    >
                      {hasError ? (
                        isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", style.dot)} />
                      <span className="w-20 shrink-0 font-medium">{run.sourceName}</span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold",
                          style.cls
                        )}
                      >
                        <style.icon className={cn("h-2.5 w-2.5", run.status === "running" && "animate-spin")} />
                        {style.label}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Database className="h-3 w-3" />
                          {fmtNum(run.rowsParsed)}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <TrendingUp className="h-3 w-3" />
                          {fmtNum(run.rowsUpserted)}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {fmtDuration(run.durationMs)}
                        </span>
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {relativeDate(run.startedAt, lang)}
                      </span>
                      {run.triggeredBy === "schedule" && (
                        <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px]">
                          {t("parserRuns.scheduled")}
                        </Badge>
                      )}
                    </button>
                    {hasError && isExpanded && (
                      <div className="border-t border-border/40 bg-rose-500/5 px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                          <div className="min-w-0 flex-1">
                            <code className="block break-words text-[11px] text-rose-700 dark:text-rose-300">
                              {run.errorMessage}
                            </code>
                            {run.errorDetails.length > 0 && (
                              <div className="mt-1.5 space-y-1">
                                {run.errorDetails.map((e, i) => (
                                  <div key={i} className="text-[10px] text-muted-foreground">
                                    <span className="font-mono">{e.url}</span>
                                    <span className="mx-1">·</span>
                                    <span>{relativeDate(e.ts, lang)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Methodology note */}
        <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
          {t("parserRuns.methodNote")}
        </div>
      </div>
    </Card>
  );
}
