"use client";

import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  fetcher,
  type CompareMatrix,
  type ServiceDirectoryItem,
  formatPrice,
  svcName,
  relativeDate,
  cityName,
} from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitCompareArrows, Plus, X, Star, Trophy, Trash2, Download, PiggyBank, MoveHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { localizedCategory } from "@/lib/i18n";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";

export function CompareView() {
  const { t, lang } = useI18n();
  const compareIds = useAppStore((s) => s.compareServiceIds);
  const removeFromCompare = useAppStore((s) => s.removeFromCompare);
  const clearCompare = useAppStore((s) => s.clearCompare);
  const currency = useAppStore((s) => s.currency);

  const [picker, setPicker] = useState<string>("");

  // Load full services directory for the picker
  const { data: dirData } = useQuery<{ services: ServiceDirectoryItem[] }>({
    queryKey: ["services-dir"],
    queryFn: () => fetcher("/api/v1/services"),
    staleTime: 60_000,
  });

  // Load selected services' details (for header chips with localized names)
  const selectedDetails = useQueries({
    queries: compareIds.map((id) => ({
      queryKey: ["svc", id],
      queryFn: () => fetcher<{ id: string; nameRu: string; nameKk: string; nameEn: string; category: string }>(`/api/v1/services/${id}/history`).then((h) => h.service).catch(() => null),
      staleTime: 60_000,
    })),
  });

  // POST fetcher bound to the current compareIds selection
  function postFetcher<T>(url: string): Promise<T> {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceIds: compareIds }),
    }).then((r) => {
      if (!r.ok) throw new Error(`compare failed ${r.status}`);
      return r.json() as Promise<T>;
    });
  }

  const matrixQ = useQuery<CompareMatrix>({
    queryKey: ["compare", compareIds.join(",")],
    queryFn: () => postFetcher<CompareMatrix>("/api/v1/compare"),
    enabled: compareIds.length > 0,
    staleTime: 20_000,
  });

  const matrix = matrixQ.data;
  const rows = matrix?.matrix ?? [];
  const clinics = matrix?.clinics ?? [];

  // Build a map of best price per service for highlighting
  const bestPriceByService = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const prices = r.cells.filter((c) => c.found).map((c) => c.priceKzt!);
      if (prices.length) m.set(r.service.id, Math.min(...prices));
    }
    return m;
  }, [rows]);

  // Build a map of worst (most expensive) price per service for "savings" calculation
  const worstPriceByService = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const prices = r.cells.filter((c) => c.found).map((c) => c.priceKzt!);
      if (prices.length) m.set(r.service.id, Math.max(...prices));
    }
    return m;
  }, [rows]);

  // Average price per clinic across all services in the matrix — used for the
  // summary row at the bottom of the table. Clinics with no prices are treated
  // as having a null average (rendered as "—").
  const clinicAverages = useMemo(() => {
    const tally = new Map<string, { sum: number; count: number }>();
    for (const r of rows) {
      for (const cell of r.cells) {
        if (cell.found && cell.priceKzt != null) {
          const cur = tally.get(cell.clinicId) ?? { sum: 0, count: 0 };
          cur.sum += cell.priceKzt;
          cur.count += 1;
          tally.set(cell.clinicId, cur);
        }
      }
    }
    const out = new Map<string, { avg: number | null; count: number }>();
    for (const [id, { sum, count }] of tally) {
      out.set(id, { avg: count > 0 ? Math.round(sum / count) : null, count });
    }
    return out;
  }, [rows]);

  // The clinic with the lowest average price — gets the "best overall" trophy.
  const bestClinicId = useMemo(() => {
    let bestId: string | null = null;
    let bestAvg = Infinity;
    for (const [id, { avg }] of clinicAverages) {
      if (avg != null && avg < bestAvg) {
        bestAvg = avg;
        bestId = id;
      }
    }
    return bestId;
  }, [clinicAverages]);

  // The clinic that wins the most "cheapest in row" cells — gets a column-level
  // "winner" trophy badge in the table header.
  const mostWinsClinicId = useMemo(() => {
    const tally = new Map<string, number>();
    for (const r of rows) {
      const prices = r.cells.filter((c) => c.found).map((c) => c.priceKzt!);
      if (!prices.length) continue;
      const min = Math.min(...prices);
      for (const c of r.cells) {
        if (c.found && c.priceKzt === min) {
          tally.set(c.clinicId, (tally.get(c.clinicId) ?? 0) + 1);
        }
      }
    }
    let bestId: string | null = null;
    let bestCount = 0;
    for (const [id, count] of tally) {
      if (count > bestCount) {
        bestCount = count;
        bestId = id;
      }
    }
    return bestCount > 0 ? bestId : null;
  }, [rows]);

  const availableForPicker = (dirData?.services ?? []).filter(
    (s) => !compareIds.includes(s.id)
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 msp-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <GitCompareArrows className="h-6 w-6 text-primary" />
            {t("compare.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("compare.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {compareIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                const a = document.createElement("a");
                a.href = `/api/v1/export/compare-csv?serviceIds=${compareIds.join(",")}`;
                a.download = `comparison_${Date.now()}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                toast.success(t("toast.exported"));
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {t("export.compareCsv")}
            </Button>
          )}
          {compareIds.length > 0 && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-destructive" onClick={clearCompare}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("compare.clearAll")}
            </Button>
          )}
        </div>
      </div>

      {/* Selected service chips + picker */}
      <Card className="card-premium mb-5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("compare.title")}:
          </span>
          {compareIds.length === 0 && (
            <span className="text-sm text-muted-foreground">{t("compare.empty")}</span>
          )}
          {selectedDetails.map((q, i) => {
            const svc = q.data;
            if (!svc) return <SkeletonChip key={compareIds[i]} />;
            return (
              <Badge
                key={svc.id}
                variant="secondary"
                className="gap-1.5 bg-primary/10 py-1.5 pl-2.5 pr-1.5 text-primary"
              >
                <span className="text-xs font-medium">{svcName(svc, lang)}</span>
                <button
                  onClick={() => {
                    removeFromCompare(svc.id);
                    toast.success(t("toast.compareRemoved"));
                  }}
                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          <Select
            value={picker}
            onValueChange={(v) => {
              if (v && !compareIds.includes(v)) {
                useAppStore.getState().toggleCompare(v);
                toast.success(t("toast.compareAdded"));
              }
              setPicker("");
            }}
          >
            <SelectTrigger className="h-8 w-[220px] gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" />
              <SelectValue placeholder={t("compare.addService")} />
            </SelectTrigger>
            <SelectContent>
              {availableForPicker.length === 0 ? (
                <SelectItem value="__none" disabled>
                  {t("compare.empty")}
                </SelectItem>
              ) : (
                availableForPicker.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="text-xs">{svcName(s, lang)}</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Comparison matrix */}
      {compareIds.length === 0 ? (
        <EmptyCompare
          services={dirData?.services ?? []}
          onAddService={(id) => {
            useAppStore.getState().toggleCompare(id);
            toast.success(t("toast.compareAdded"));
          }}
          onGoSearch={() => useAppStore.getState().setView("search")}
        />
      ) : matrixQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : matrixQ.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {String(matrixQ.error?.message ?? "Error")}
        </div>
      ) : rows.length === 0 ? (
        <EmptyCompare
          services={dirData?.services ?? []}
          onAddService={(id) => {
            useAppStore.getState().toggleCompare(id);
            toast.success(t("toast.compareAdded"));
          }}
          onGoSearch={() => useAppStore.getState().setView("search")}
        />
      ) : (
        <Card className="card-premium overflow-hidden p-0">
          {/* Mobile scroll hint */}
          <div className="flex items-center gap-1.5 border-b border-border/60 bg-gradient-to-r from-primary/8 to-cyan-500/5 px-4 py-2 text-[11px] font-medium text-primary sm:hidden">
            <MoveHorizontal className="h-3 w-3" />
            {t("compare.mobileHint")}
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky left-0 z-20 min-w-[200px] border-r border-border/60 bg-muted/40 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-[1px_0_8px_-2px_rgba(0,0,0,0.08)] backdrop-blur-sm [box-shadow:6px_0_12px_-6px_rgba(0,0,0,0.18)]">
                    {t("compare.price")}
                  </th>
                  {clinics.map((c) => {
                    const isMostWins = c.id === mostWinsClinicId;
                    return (
                      <th key={c.id} className="min-w-[150px] px-4 py-3 text-left align-top">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold leading-tight">{c.name}</span>
                          {isMostWins && (
                            <Badge
                              variant="outline"
                              className="gap-0.5 border-amber-400/50 bg-gradient-to-r from-amber-400/15 to-yellow-500/15 px-1.5 py-0 text-[9px] font-bold text-amber-600 dark:text-amber-400"
                              title={t("compare.bestClinic")}
                            >
                              <Trophy className="h-2.5 w-2.5" />
                              {t("compare.cheapest")}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                          {c.rating.toFixed(1)} · {cityName(c.city, lang)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, rowIdx) => {
                  const best = bestPriceByService.get(r.service.id);
                  const worst = worstPriceByService.get(r.service.id);
                  const isZebra = rowIdx % 2 === 1;
                  return (
                    <tr
                      key={r.service.id}
                      className={cn(
                        "group border-b border-border/60 last:border-0 transition-colors hover:bg-accent/30",
                        isZebra && "bg-muted/30"
                      )}
                    >
                      <td
                        className={cn(
                          "sticky left-0 z-10 border-r border-border/60 px-4 py-3 align-top transition-colors group-hover:bg-accent/30 [box-shadow:6px_0_12px_-6px_rgba(0,0,0,0.18)]",
                          isZebra ? "bg-muted/30" : "bg-card"
                        )}
                      >
                        <div className="text-sm font-semibold leading-tight">
                          {svcName(r.service, lang)}
                        </div>
                        <div className="mt-0.5">
                          <Badge variant="outline" className="text-[9px] uppercase">
                            {localizedCategory(r.service.category, lang)}
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Trophy className="h-3 w-3 text-amber-500" />
                          {best != null ? formatPrice(best, currency) : "—"}
                          <span className="opacity-70">· {r.stats.clinicCount} {t("compare.clinics")}</span>
                        </div>
                        {/* Savings vs most expensive */}
                        {best != null && worst != null && worst > best && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <PiggyBank className="h-3 w-3" />
                            {t("compare.savings")}: {formatPrice(worst - best, currency)}
                          </div>
                        )}
                      </td>
                      {r.cells.map((c) => {
                        const isBest = c.found && c.priceKzt === best;
                        const isWorst = c.found && c.priceKzt === worst && worst !== best;
                        const savings = isBest && worst != null ? worst - c.priceKzt! : null;
                        return (
                          <td
                            key={c.clinicId}
                            className={cn(
                              "px-4 py-3 align-top transition-colors",
                              isBest && "msp-best-cell",
                              isWorst && "bg-rose-500/5"
                            )}
                          >
                            {c.found ? (
                              <div className="space-y-0.5">
                                <div
                                  className={cn(
                                    "flex items-center gap-1 text-base font-bold tabular-nums",
                                    isBest && "gradient-text",
                                    isBest && "text-base",
                                    isWorst && "text-rose-600 dark:text-rose-400",
                                    !isBest && !isWorst && "text-foreground"
                                  )}
                                >
                                  {isBest && <Trophy className="h-3 w-3 shrink-0 text-amber-500" />}
                                  {formatPrice(c.priceKzt!, currency)}
                                </div>
                                {c.durationDays != null && (
                                  <div className="text-[10px] text-muted-foreground">
                                    {c.durationDays === 0
                                      ? t("result.sameDay")
                                      : `${c.durationDays} ${t("result.days")}`}
                                  </div>
                                )}
                                <div className="text-[10px] text-muted-foreground">
                                  {relativeDate(c.parsedAt!, lang)}
                                </div>
                                {isBest && (
                                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">
                                    {t("compare.cheapest")}
                                  </Badge>
                                )}
                                {isWorst && (
                                  <Badge variant="outline" className="border-rose-400/40 px-1.5 py-0 text-[9px] text-rose-600 dark:text-rose-400">
                                    {t("insight.highest")}
                                  </Badge>
                                )}
                                {savings != null && savings > 0 && (
                                  <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                    −{formatPrice(savings, currency)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {t("compare.notFound")}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {/* Summary row — average price per clinic across all services,
                    with a trophy badge for the clinic with the lowest average. */}
                <tr className="border-t-2 border-primary/30 bg-gradient-to-r from-primary/10 to-cyan-500/5 font-bold">
                  <td className="sticky left-0 z-10 border-r border-border/60 bg-gradient-to-r from-primary/15 to-primary/10 px-4 py-3 align-top [box-shadow:6px_0_12px_-6px_rgba(0,0,0,0.18)]">
                    <div className="flex items-center gap-1.5 text-sm font-bold text-primary">
                      <Trophy className="h-3.5 w-3.5 text-amber-500" />
                      {t("compare.avgPrice")}
                    </div>
                    <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("compare.bestClinic")}
                    </div>
                  </td>
                  {clinics.map((c) => {
                    const stats = clinicAverages.get(c.id);
                    const avg = stats?.avg ?? null;
                    const isWinner = c.id === bestClinicId && avg != null;
                    return (
                      <td
                        key={c.id}
                        className={cn(
                          "px-4 py-3 align-top",
                          isWinner && "bg-amber-400/10"
                        )}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "text-base font-bold tabular-nums",
                                isWinner ? "msp-gradient-emerald" : "text-primary"
                              )}
                            >
                              {avg != null ? formatPrice(avg, currency) : "—"}
                            </span>
                            {isWinner && (
                              <Badge
                                variant="outline"
                                className="gap-0.5 border-amber-400/50 bg-amber-400/15 px-1.5 py-0 text-[9px] font-bold text-amber-600 dark:text-amber-400"
                              >
                                <Trophy className="h-2.5 w-2.5" />
                                {t("compare.bestClinic")}
                              </Badge>
                            )}
                          </div>
                          {stats && stats.count > 0 && (
                            <div className="text-[10px] font-medium text-muted-foreground">
                              {stats.count} {t("compare.clinics")}
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function SkeletonChip() {
  return <div className="h-6 w-32 animate-pulse rounded-full bg-muted" />;
}

function EmptyCompare({
  services,
  onAddService,
  onGoSearch,
}: {
  services: ServiceDirectoryItem[];
  onAddService: (id: string) => void;
  onGoSearch: () => void;
}) {
  const { t, lang } = useI18n();
  // Pick up to 4 popular services (take first 4 from directory as "popular")
  const popularServices = services.slice(0, 4);

  return (
    <div className="space-y-5">
      {/* Premium empty state — gradient icon, title, description, CTA */}
      <EmptyState
        variant="compare"
        actionLabel={t("empty.cta.compare")}
        onAction={onGoSearch}
      />

      {/* Popular service suggestion pills — kept as a nice UX touch below */}
      {popularServices.length > 0 && (
        <div className="mx-auto max-w-md space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("compare.popular")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {popularServices.map((s) => (
              <Button
                key={s.id}
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full border-border/70 bg-card/80 px-3.5 text-xs font-medium transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-emerald-500/10"
                onClick={() => onAddService(s.id)}
              >
                <Plus className="h-3 w-3" />
                {svcName(s, lang)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
