"use client";

/**
 * NotificationBell — header bell icon that polls POST /api/v1/subscriptions/check
 * every 60s for the user's email and surfaces triggered price-drop alerts.
 *
 * - Red badge with count of *new* alerts (triggered after the user's last view).
 * - Pulse animation on the bell icon when new alerts exist.
 * - Clicking opens a popover with: triggered alerts list, an email entry form
 *   (when no email is set), and an empty state when no alerts are active.
 * - "Manage all alerts" link opens the MyAlertsPanel dialog (controlled via
 *   the `myAlertsOpen` flag in the app store).
 * - "View deals" on each alert sets the search query to that service and
 *   switches to the Search view.
 */
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { formatPrice } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MyAlertsPanel } from "@/components/my-alerts-panel";
import { Bell, Mail, TrendingDown, Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Shape returned by POST /api/v1/subscriptions/check */
type TriggeredAlert = {
  id: string;
  email: string;
  serviceId: string;
  serviceName: string;
  clinicId: string | null;
  clinicName: string | null;
  thresholdKzt: number;
  currentPrice: number;
  savingsKzt: number;
  savingsPct: number;
  triggeredAt: string;
};

type CheckResponse = {
  triggered: TriggeredAlert[];
  checked: number;
  triggeredCount: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POLL_MS = 60_000;

export function NotificationBell() {
  const { t } = useI18n();
  const userEmail = useAppStore((s) => s.userEmail);
  const setUserEmail = useAppStore((s) => s.setUserEmail);
  const lastSeenNotifiedAt = useAppStore((s) => s.lastSeenNotifiedAt);
  const setLastSeenNotifiedAt = useAppStore((s) => s.setLastSeenNotifiedAt);
  const setMyAlertsOpen = useAppStore((s) => s.setMyAlertsOpen);
  const setView = useAppStore((s) => s.setView);
  const setFilters = useAppStore((s) => s.setFilters);
  const currency = useAppStore((s) => s.currency);

  const [open, setOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");

  // Poll the check endpoint every 60s when the user has an email set.
  const { data, isLoading, isFetching, refetch } = useQuery<CheckResponse>({
    queryKey: ["alerts-check", userEmail],
    queryFn: async () => {
      const res = await fetch("/api/v1/subscriptions/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });
      if (!res.ok) throw new Error(`check failed (${res.status})`);
      return (await res.json()) as CheckResponse;
    },
    enabled: !!userEmail,
    refetchInterval: POLL_MS,
    staleTime: POLL_MS,
    // Don't retry aggressively — a failed poll just means we'll try again next tick.
    retry: 0,
  });

  const triggered = data?.triggered ?? [];

  // "New" alerts = those with triggeredAt newer than the lastSeenNotifiedAt stamp.
  const newAlerts = useMemo(() => {
    if (!lastSeenNotifiedAt) return triggered;
    const cutoff = new Date(lastSeenNotifiedAt).getTime();
    return triggered.filter((a) => new Date(a.triggeredAt).getTime() > cutoff);
  }, [triggered, lastSeenNotifiedAt]);

  const newCount = newAlerts.length;
  const hasNew = newCount > 0;

  // When the popover opens, stamp lastSeenNotifiedAt to "consume" the badge.
  useEffect(() => {
    if (!open) return;
    if (triggered.length === 0) return;
    const latest = triggered.reduce((max, a) => {
      const ts = new Date(a.triggeredAt).getTime();
      return ts > max ? ts : max;
    }, 0);
    if (latest > 0) setLastSeenNotifiedAt(new Date(latest).toISOString());
  }, [open, triggered, setLastSeenNotifiedAt]);

  function saveEmail() {
    const trimmed = emailDraft.trim();
    if (!EMAIL_RE.test(trimmed)) {
      toast.error(t("alerts.enterEmail"));
      return;
    }
    setUserEmail(trimmed);
    toast.success(t("alerts.save"));
    // refetch immediately for the new email
    void refetch();
  }

  function viewDeals(svcName: string) {
    setFilters({ q: svcName });
    setView("search");
    setOpen(false);
    // Scroll to top so the user sees the search results fresh
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9"
            aria-label={t("alerts.title")}
          >
            <span className="relative inline-flex">
              <Bell
                className={cn(
                  "h-4 w-4 transition-transform",
                  hasNew && "animate-[msp-bell-ring_0.6s_ease-in-out_infinite]"
                )}
              />
              {hasNew && (
                <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                </span>
              )}
            </span>
            {newCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-background">
                {newCount > 9 ? "9+" : newCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[min(92vw,360px)] rounded-2xl border-border/70 p-0 shadow-lg"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
                <Bell className="h-3.5 w-3.5" />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-bold">{t("alerts.title")}</div>
                {userEmail ? (
                  <div className="text-[10px] text-muted-foreground">{userEmail}</div>
                ) : (
                  <div className="text-[10px] text-muted-foreground">{t("alerts.checking")}</div>
                )}
              </div>
            </div>
            {isFetching && (
              <span className="text-[10px] font-medium text-muted-foreground">
                {t("alerts.checking")}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="max-h-[60vh] overflow-y-auto">
            {/* No email set — show inline entry form */}
            {!userEmail && (
              <div className="px-4 py-4">
                <div className="mb-3 flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Mail className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-medium leading-snug">
                    {t("alerts.enterEmail")}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Input
                    type="email"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    placeholder={t("alerts.emailPlaceholder")}
                    className="h-9 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEmail();
                    }}
                  />
                  <Button size="sm" className="h-9 shrink-0" onClick={saveEmail}>
                    {t("alerts.save")}
                  </Button>
                </div>
              </div>
            )}

            {/* Email set — render triggered list or empty state */}
            {userEmail && isLoading && (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-xl" />
                ))}
              </div>
            )}

            {userEmail && !isLoading && triggered.length === 0 && (
              <div className="px-6 py-8 text-center">
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold">{t("alerts.noAlerts")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("alerts.noAlertsDesc")}
                </p>
              </div>
            )}

            {userEmail && !isLoading && triggered.length > 0 && (
              <ul className="divide-y divide-border/50">
                {triggered.map((a) => (
                  <li
                    key={a.id}
                    className="px-4 py-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">
                          {a.serviceName}
                        </div>
                        {a.clinicName && (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {a.clinicName}
                          </div>
                        )}
                      </div>
                      {a.savingsPct > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                          <TrendingDown className="h-3 w-3" />
                          −{a.savingsPct}%
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-baseline gap-2 text-xs">
                      <span className="text-muted-foreground">{t("alerts.currentPrice")}:</span>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {formatPrice(a.currentPrice, currency)}
                      </span>
                      <span className="ml-auto text-muted-foreground">
                        {t("alerts.threshold")}:{" "}
                        <span className="font-medium text-foreground/80">
                          {formatPrice(a.thresholdKzt, currency)}
                        </span>
                      </span>
                    </div>

                    {a.savingsKzt > 0 && (
                      <div className="mt-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        {t("alerts.savings")}: {formatPrice(a.savingsKzt, currency)}
                      </div>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2.5 h-7 w-full gap-1.5 text-xs"
                      onClick={() => viewDeals(a.serviceName)}
                    >
                      <Sparkles className="h-3 w-3 text-primary" />
                      {t("alerts.viewDeals")}
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer — manage all alerts */}
          {userEmail && (
            <div className="border-t border-border/60 px-3 py-2.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center gap-1.5 text-xs font-medium"
                onClick={() => {
                  setOpen(false);
                  setMyAlertsOpen(true);
                }}
              >
                {t("alerts.manageAll")}
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* The My Alerts panel is rendered here so it can be opened from anywhere
          via the store flag (e.g. the "Manage all alerts" link above). */}
      <MyAlertsPanel />
    </>
  );
}
