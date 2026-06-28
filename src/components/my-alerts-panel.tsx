"use client";

/**
 * MyAlertsPanel — a Dialog (rendered via the `myAlertsOpen` flag in the store)
 * that lists the user's active price-drop subscriptions with live status.
 *
 * - Requires an email — if not set, the panel shows an email entry form first.
 * - Fetches GET /api/v1/subscriptions/manage?email=xxx via react-query.
 * - Each subscription renders as a card row: service name, category badge,
 *   clinic name (or "Any clinic"), threshold, current best price with status
 *   pill, savings (when triggered), a mini progress bar, and delete / search
 *   buttons.
 * - "Refresh" button re-fetches; empty state shows a friendly CTA to switch
 *   to the Search view and create the first alert.
 */
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "@/lib/format";
import { localizedCategory } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell,
  Mail,
  Trash2,
  RefreshCw,
  Search,
  TrendingDown,
  Loader2,
  BellOff,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Lang } from "@/lib/i18n";

type AlertStatus = "triggered" | "watching" | "waiting" | "unavailable";

type ManagedSubscription = {
  id: string;
  serviceId: string;
  serviceName: string;
  serviceNameEn: string;
  serviceNameKk: string;
  category: string;
  clinicId: string | null;
  clinicName: string | null;
  thresholdKzt: number;
  currentPrice: number | null;
  status: AlertStatus;
  savingsKzt: number;
  savingsPct: number;
  createdAt: string;
  lastNotifiedAt: string | null;
};

type ManageResponse = { subscriptions: ManagedSubscription[]; email: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pick the localized service name from a managed subscription.
 *  The backend returns `serviceName` (= nameRu) plus En/Kk variants. */
function localizedManagedName(s: ManagedSubscription, lang: Lang): string {
  if (lang === "kk") return s.serviceNameKk || s.serviceName || s.serviceNameEn || "";
  if (lang === "en") return s.serviceNameEn || s.serviceName || s.serviceNameKk || "";
  return s.serviceName || s.serviceNameEn || s.serviceNameKk || "";
}

const STATUS_STYLES: Record<AlertStatus, { pill: string; bar: string; label: string }> = {
  triggered: {
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-500",
    label: "alerts.triggered",
  },
  watching: {
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    bar: "bg-amber-500",
    label: "alerts.watching",
  },
  waiting: {
    pill: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    bar: "bg-slate-400",
    label: "alerts.waiting",
  },
  unavailable: {
    pill: "bg-muted text-muted-foreground",
    bar: "bg-muted-foreground/40",
    label: "alerts.unavailable",
  },
};

const CATEGORY_BADGE_STYLES: Record<string, string> = {
  laboratory: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  diagnostics: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  doctor_appointment: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  procedure: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function MyAlertsPanel() {
  const { t, lang } = useI18n();
  const userEmail = useAppStore((s) => s.userEmail);
  const setUserEmail = useAppStore((s) => s.setUserEmail);
  const open = useAppStore((s) => s.myAlertsOpen);
  const setOpen = useAppStore((s) => s.setMyAlertsOpen);
  const setView = useAppStore((s) => s.setView);
  const setFilters = useAppStore((s) => s.setFilters);
  const currency = useAppStore((s) => s.currency);
  const queryClient = useQueryClient();

  const [emailDraft, setEmailDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<ManageResponse>({
    queryKey: ["alerts-manage", userEmail],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/subscriptions/manage?email=${encodeURIComponent(userEmail!)}`
      );
      if (!res.ok) throw new Error(`manage failed (${res.status})`);
      return (await res.json()) as ManageResponse;
    },
    enabled: !!userEmail && open,
    staleTime: 30_000,
  });

  const subs = data?.subscriptions ?? [];

  // Summary counts
  const summary = useMemo(() => {
    const triggered = subs.filter((s) => s.status === "triggered").length;
    const watching = subs.filter((s) => s.status === "watching").length;
    return { total: subs.length, triggered, watching };
  }, [subs]);

  function saveEmail() {
    const trimmed = emailDraft.trim();
    if (!EMAIL_RE.test(trimmed)) {
      toast.error(t("alerts.enterEmail"));
      return;
    }
    setUserEmail(trimmed);
    toast.success(t("alerts.save"));
  }

  async function deleteSub(id: string) {
    if (!userEmail) return;
    if (!window.confirm(t("alerts.deleteConfirm"))) return;
    setDeletingId(id);
    try {
      const res = await fetch(
        `/api/v1/subscriptions?id=${encodeURIComponent(id)}&email=${encodeURIComponent(userEmail)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      toast.success(t("alerts.deleted"));
      // Invalidate both the manage list and the bell's check endpoint.
      void queryClient.invalidateQueries({ queryKey: ["alerts-manage"] });
      void queryClient.invalidateQueries({ queryKey: ["alerts-check"] });
    } catch {
      toast.error(t("alerts.deleteConfirm"));
    } finally {
      setDeletingId(null);
    }
  }

  function searchService(svcName: string) {
    setFilters({ q: svcName });
    setView("search");
    setOpen(false);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Bell className="h-4 w-4" />
            </span>
            {t("alerts.title")}
            {userEmail && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                · {userEmail}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("alerts.manageAll")}
          </DialogDescription>
        </DialogHeader>

        {/* Email entry — when no email is set */}
        {!userEmail && (
          <div className="px-5 py-6">
            <div className="mb-4 flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Mail className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">{t("alerts.enterEmail")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("alerts.noAlertsDesc")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder={t("alerts.emailPlaceholder")}
                className="h-10"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEmail();
                }}
              />
              <Button className="h-10 shrink-0" onClick={saveEmail}>
                {t("alerts.save")}
              </Button>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {userEmail && isLoading && (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {userEmail && !isLoading && subs.length === 0 && (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <BellOff className="h-8 w-8" />
            </div>
            <p className="text-sm font-semibold">{t("alerts.noAlerts")}</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              {t("alerts.noAlertsDesc")}
            </p>
            <Button
              className="mt-4 gap-1.5"
              onClick={() => {
                setOpen(false);
                setView("search");
                if (typeof window !== "undefined") {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            >
              <Sparkles className="h-4 w-4" />
              {t("alerts.createFirst")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Summary header + list */}
        {userEmail && !isLoading && subs.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-5 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium">
                <span className="text-foreground">
                  <span className="font-bold">{summary.total}</span>{" "}
                  <span className="text-muted-foreground">{t("alerts.activeCount")}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {summary.triggered} {t("alerts.triggered")}
                </span>
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {summary.watching} {t("alerts.watching")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                disabled={isFetching}
                onClick={() => refetch()}
              >
                {isFetching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {t("alerts.refresh")}
              </Button>
            </div>

            <ul className="max-h-[60vh] space-y-3 overflow-y-auto p-3">
              {subs.map((s) => {
                const statusStyle = STATUS_STYLES[s.status];
                const catStyle =
                  CATEGORY_BADGE_STYLES[s.category] ?? "bg-muted text-muted-foreground";
                const progress =
                  s.currentPrice == null
                    ? 0
                    : Math.max(
                        0,
                        Math.min(
                          100,
                          (1 - (s.currentPrice - s.thresholdKzt) / s.thresholdKzt) * 100
                        )
                      );
                return (
                  <li key={s.id} className="card-premium p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="line-clamp-2 text-sm font-semibold leading-tight">
                            {localizedManagedName(s, lang)}
                          </span>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                              catStyle
                            )}
                          >
                            {localizedCategory(s.category, lang)}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {s.clinicName ?? t("alerts.anyClinic")}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                          statusStyle.pill
                        )}
                      >
                        {t(statusStyle.label)}
                      </span>
                    </div>

                    {/* Price row */}
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("alerts.currentPrice")}
                        </div>
                        <div className="mt-0.5 text-sm font-bold">
                          {s.currentPrice != null
                            ? formatPrice(s.currentPrice, currency)
                            : "—"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("alerts.threshold")}
                        </div>
                        <div className="mt-0.5 text-sm font-medium text-foreground/80">
                          {formatPrice(s.thresholdKzt, currency)}
                        </div>
                      </div>
                    </div>

                    {/* Mini progress bar */}
                    <div className="mt-2.5">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            statusStyle.bar
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Savings row (only when triggered) */}
                    {s.status === "triggered" && s.savingsKzt > 0 && (
                      <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        <TrendingDown className="h-3.5 w-3.5" />
                        {t("alerts.savings")}: {formatPrice(s.savingsKzt, currency)}
                        <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px]">
                          −{s.savingsPct}%
                        </span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() =>
                          searchService(localizedManagedName(s, lang))
                        }
                      >
                        <Search className="h-3 w-3" />
                        {t("alerts.searchService")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-8 gap-1.5 px-2 text-xs text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                        disabled={deletingId === s.id}
                        onClick={() => deleteSub(s.id)}
                      >
                        {deletingId === s.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
