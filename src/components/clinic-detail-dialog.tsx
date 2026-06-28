"use client";

import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetcher,
  type ClinicDetail,
  formatPrice,
  cityName,
  svcName,
  relativeDate,
  shortDate,
  isStale,
  clinicAvatar,
} from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  X,
  Star,
  MapPin,
  Phone,
  Clock,
  Globe,
  CheckCircle2,
  ExternalLink,
  TrendingDown,
  BarChart3,
  TrendingUp,
  ArrowUpDown,
  Search,
  Navigation,
  Loader2,
  Send,
  MessageSquare,
  Share2,
  Check,
  Hash,
} from "lucide-react";
import { localizedCategory } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ──────────── Types ────────────

type NearbyClinic = {
  id: string;
  name: string;
  city: string;
  address: string;
  rating: number;
  onlineBooking: boolean;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  minPrice: number | null;
  avgPrice: number | null;
  serviceCount: number;
  cheaper: boolean | null;
};

type NearbyData = {
  nearby: NearbyClinic[];
  city: string;
  thisClinicMinPrice: number | null;
  thisClinicAvgPrice: number | null;
};

type Review = {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  lang: string;
  createdAt: string;
};

type ReviewsData = {
  avgRating: number;
  count: number;
  distribution: Record<string, number>;
  reviews: Review[];
};

// ──────────── Hash sync hook ────────────

function useClinicHashSync() {
  const clinicId = useAppStore((s) => s.selectedClinicId);
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);

  useEffect(() => {
    function apply() {
      const m = window.location.hash.match(/^#\/clinic\/(.+)$/);
      if (m && m[1]) {
        const id = decodeURIComponent(m[1]);
        if (useAppStore.getState().selectedClinicId !== id) {
          setSelectedClinic(id);
        }
      }
    }
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [setSelectedClinic]);

  useEffect(() => {
    if (clinicId) {
      const target = `#/clinic/${encodeURIComponent(clinicId)}`;
      if (window.location.hash !== target) {
        window.history.replaceState(null, "", target);
      }
    } else {
      if (window.location.hash.startsWith("#/clinic/")) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
  }, [clinicId]);
}

// ──────────── Price distribution buckets ────────────

const PRICE_BUCKETS = [
  { label: "< 3K", lo: 0, hi: 3000 },
  { label: "3–6K", lo: 3000, hi: 6000 },
  { label: "6–10K", lo: 6000, hi: 10000 },
  { label: "10–15K", lo: 10000, hi: 15000 },
  { label: "> 15K", lo: 15000, hi: Infinity },
];

const BUCKET_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-6)",
  "var(--chart-3)",
  "var(--chart-4)",
];

// ──────────── Category color map ────────────

const CATEGORY_COLORS: Record<string, string> = {
  laboratory: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  doctor_appointment: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  diagnostics: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  procedure: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

// ──────────── Star display helper ────────────

function StarRating({
  rating,
  size = "sm",
  interactive = false,
  value = 0,
  onChange,
}: {
  rating?: number;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  value?: number;
  onChange?: (v: number) => void;
}) {
  const sz =
    size === "lg" ? "h-5 w-5" : size === "md" ? "h-4 w-4" : "h-3 w-3";
  const r = interactive ? value : (rating ?? 0);
  const display = interactive ? value : Math.round(r);
  const [hover, setHover] = useState(0);
  const active = hover || display;

  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          disabled={!interactive}
          onClick={() => interactive && onChange?.(s)}
          onMouseEnter={() => interactive && setHover(s)}
          onMouseLeave={() => interactive && setHover(0)}
          className={cn(interactive && "cursor-pointer p-0.5")}
          aria-label={`${s} stars`}
        >
          <Star
            className={cn(
              sz,
              "transition-colors",
              s <= active
                ? "fill-amber-400 text-amber-400"
                : interactive
                  ? "text-muted-foreground/40 hover:text-amber-300"
                  : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
    </span>
  );
}

// ──────────── Shimmer skeleton ────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-lg", className)} />;
}

// ──────────── Main component ────────────

export function ClinicDetailDialog() {
  const { t, lang } = useI18n();
  const clinicId = useAppStore((s) => s.selectedClinicId);
  const view = useAppStore((s) => s.view);
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);
  const setView = useAppStore((s) => s.setView);
  const setSelectedService = useAppStore((s) => s.setSelectedService);
  const pushRecent = useAppStore((s) => s.pushRecentService);
  const setFilters = useAppStore((s) => s.setFilters);
  const currency = useAppStore((s) => s.currency);

  const [copied, setCopied] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  const [activeTab, setActiveTab] = useState("services");

  useClinicHashSync();

  // Suppress the dialog overlay when the user has navigated to the dedicated
  // Clinic Profile page (Workstream 12) — the profile view renders the same
  // info as a full page, so showing both would be redundant + jarring.
  const open = !!clinicId && view !== "clinic";

  // Reset tab/sort when clinic changes — derived during render, not in an effect
  const clinicChangeKey = clinicId;

  const { data, isLoading } = useQuery<ClinicDetail>({
    queryKey: ["clinic", clinicId],
    queryFn: () => fetcher(`/api/v1/clinics/${clinicId}`),
    enabled: !!clinicId,
    staleTime: 30_000,
  });

  // Reviews query
  const {
    data: reviewsData,
    isLoading: reviewsLoading,
  } = useQuery<ReviewsData>({
    queryKey: ["reviews", clinicId],
    queryFn: () => fetcher(`/api/v1/clinics/${clinicId}/reviews`),
    enabled: !!clinicId && activeTab === "reviews",
    staleTime: 30_000,
  });

  // Nearby clinics query
  const {
    data: nearbyData,
    isLoading: nearbyLoading,
  } = useQuery<NearbyData>({
    queryKey: ["nearby", clinicId],
    queryFn: () => fetcher(`/api/v1/clinics/${clinicId}/nearby`),
    enabled: !!clinicId && activeTab === "nearby",
    staleTime: 60_000,
  });

  function close() {
    setSelectedClinic(null);
  }

  async function shareClinic() {
    if (!clinicId) return;
    const url = `${window.location.origin}/#/clinic/${encodeURIComponent(clinicId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: data?.clinic.name ?? "Clinic", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("share.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // user dismissed share dialog
    }
  }

  function comparePrices(serviceName: string) {
    setFilters({ q: serviceName });
    setView("search");
    close();
  }

  // Sort services
  const services = data?.services;
  const sortedServices = useMemo(() => {
    if (!services) return [];
    const sorted = [...services].sort((a, b) =>
      sortAsc ? a.priceKzt - b.priceKzt : b.priceKzt - a.priceKzt
    );
    return sorted;
  }, [services, sortAsc]);

  // Price distribution data
  const priceDistData = useMemo(() => {
    if (!services) return [];
    return PRICE_BUCKETS.map((b, i) => ({
      name: b.label,
      count: services.filter(
        (s) => s.priceKzt >= b.lo && s.priceKzt < b.hi
      ).length,
      color: BUCKET_COLORS[i],
    }));
  }, [services]);

  const clinicRating = data?.clinic.rating ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">
          {data?.clinic.name ?? t("clinic.services")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {data?.clinic.address ?? t("clinic.contact")}
        </DialogDescription>

        {isLoading || !data ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <div className="section-divider" />
            <Skeleton className="h-10 w-full" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <>
            {/* ──── Header ──── */}
            <div className="border-b border-border/60 p-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <DialogTitle className="text-xl font-bold">
                      {(() => {
                        const avatar = clinicAvatar(data.clinic.name);
                        return (
                          <span
                            className="clinic-avatar mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[13px] font-bold tabular-nums leading-none inline-grid"
                            style={{ "--ca-hue": avatar.hue } as React.CSSProperties}
                            aria-hidden="true"
                          >
                            {avatar.initials}
                          </span>
                        );
                      })()}
                      {data.clinic.name}
                    </DialogTitle>
                    {/* Verified badge */}
                    {clinicRating >= 4.5 && (
                      <span className="msp-verified" title="Verified">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>

                  {/* City badge + Rating + Review count */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    <Badge variant="outline" className="gap-1 py-0.5 text-xs">
                      <MapPin className="h-3 w-3" />
                      {cityName(data.clinic.city, lang)}
                    </Badge>
                    <span className="flex items-center gap-1.5 font-medium">
                      <StarRating rating={clinicRating} size="sm" />
                      <span className="tabular-nums">{clinicRating.toFixed(1)}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">
                        {reviewsData?.count ?? 0} {t("clinic.reviewsCount")}
                      </span>
                    </span>
                  </div>

                  {/* Working hours + Online booking */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {data.clinic.workingHours && (
                      <Badge variant="secondary" className="gap-1 py-0.5 text-xs">
                        <Clock className="h-3 w-3" />
                        {data.clinic.workingHours}
                      </Badge>
                    )}
                    {data.clinic.onlineBooking && (
                      <Badge className="gap-1 bg-emerald-100 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        <Globe className="h-3 w-3" />
                        {t("result.bookOnline")}
                      </Badge>
                    )}
                  </div>

                  {/* Contact row */}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {data.clinic.phone && (
                      <a
                        href={`tel:${data.clinic.phone.replace(/[^+\d]/g, "")}`}
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        <Phone className="h-3 w-3" />
                        {data.clinic.phone}
                      </a>
                    )}
                    {data.clinic.website && (
                      <a
                        href={data.clinic.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        <Globe className="h-3 w-3" />
                        {t("result.website")}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={shareClinic}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Share2 className="h-3.5 w-3.5" />
                    )}
                    {t("share.title")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full hover:bg-muted"
                    onClick={close}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* ──── Tabs ──── */}
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex min-h-0 flex-1 flex-col"
              key={clinicChangeKey}
            >
              <div className="border-b border-border/60 px-5 pt-2">
                <TabsList className="bg-transparent p-0">
                  <TabsTrigger
                    value="services"
                    className="gap-1.5 rounded-b-none border-b-2 border-transparent px-3 py-2 text-sm data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    <Hash className="h-3.5 w-3.5" />
                    {t("clinic.servicesPrices")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="reviews"
                    className="gap-1.5 rounded-b-none border-b-2 border-transparent px-3 py-2 text-sm data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    <Star className="h-3.5 w-3.5" />
                    {t("clinic.reviewsTab")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="nearby"
                    className="gap-1.5 rounded-b-none border-b-2 border-transparent px-3 py-2 text-sm data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {t("clinic.nearbyTab")}
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* ──── Tab 1: Services & Prices ──── */}
              <TabsContent
                value="services"
                className="m-0 min-h-0 max-h-[65vh] flex-1 overflow-y-auto data-[state=inactive]:hidden scrollbar-thin"
              >
                <div className="p-5">
                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="card-premium p-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                          <TrendingDown className="h-4 w-4" />
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("clinic.minPrice")}
                        </span>
                      </div>
                      <div className="gradient-text mt-1 text-xl font-bold tabular-nums">
                        {formatPrice(data.stats.minPrice, currency)}
                      </div>
                    </div>
                    <div className="card-premium p-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400">
                          <BarChart3 className="h-4 w-4" />
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("clinic.avgPrice")}
                        </span>
                      </div>
                      <div className="gradient-text mt-1 text-xl font-bold tabular-nums">
                        {formatPrice(data.stats.avgPrice, currency)}
                      </div>
                    </div>
                    <div className="card-premium p-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400">
                          <TrendingUp className="h-4 w-4" />
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("clinic.maxPrice")}
                        </span>
                      </div>
                      <div className="gradient-text mt-1 text-xl font-bold tabular-nums">
                        {formatPrice(data.stats.maxPrice, currency)}
                      </div>
                    </div>
                  </div>

                  <div className="section-divider my-4" />

                  {/* Category breakdown */}
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("clinic.categoryBreakdown")}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(data.stats.byCategory).map(([cat, count]) => (
                        <Badge
                          key={cat}
                          variant="outline"
                          className={cn("gap-1.5 py-1.5", CATEGORY_COLORS[cat] ?? "")}
                        >
                          {localizedCategory(cat, lang)}
                          <span className="rounded-full bg-background/50 px-1.5 text-[10px] font-bold tabular-nums">
                            {count}
                          </span>
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="section-divider my-4" />

                  {/* Sort toggle + service list */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {data.stats.servicesCount} {t("clinic.servicesCount")}
                      </h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-xs"
                        onClick={() => setSortAsc((v) => !v)}
                      >
                        <ArrowUpDown className="h-3 w-3" />
                        {t("clinic.sortByPrice")}
                        {sortAsc ? " ↑" : " ↓"}
                      </Button>
                    </div>

                    {sortedServices.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        {t("search.noResults")}
                      </div>
                    ) : (
                      <div className="divide-y divide-border/50 rounded-xl border border-border/40">
                        {sortedServices.map((s, idx) => {
                          const stale = isStale(s.parsedAt);
                          return (
                            <div
                              key={s.id}
                              className={cn(
                                "flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/30",
                                idx % 2 === 1 && "bg-muted/30"
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      "px-1.5 py-0 text-[9px] uppercase",
                                      CATEGORY_COLORS[s.service.category] ?? "bg-primary/10 text-primary"
                                    )}
                                  >
                                    {localizedCategory(s.service.category, lang)}
                                  </Badge>
                                  <button
                                    onClick={() => {
                                      setSelectedService(s.service.id);
                                      pushRecent(s.service.id);
                                      setView("history");
                                      close();
                                    }}
                                    className="truncate text-left text-sm font-semibold hover:text-primary hover:underline"
                                  >
                                    {svcName(s.service, lang)}
                                  </button>
                                </div>
                                {s.serviceNameRaw !== svcName(s.service, lang) && (
                                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                    {s.serviceNameRaw}
                                  </div>
                                )}
                                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                  <Clock className="h-2.5 w-2.5" />
                                  {s.durationDays === 0
                                    ? t("result.sameDay")
                                    : `${s.durationDays} ${t("result.days")}`}
                                  <span className={cn(stale && "text-amber-600")}>
                                    · {relativeDate(s.parsedAt, lang)}
                                  </span>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <div className="text-right">
                                  <div className="text-base font-bold tabular-nums">
                                    {formatPrice(s.priceKzt, currency)}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1 text-[10px]"
                                  onClick={() =>
                                    comparePrices(svcName(s.service, lang))
                                  }
                                  title={t("clinic.comparePrices")}
                                >
                                  <Search className="h-3 w-3" />
                                  <span className="hidden sm:inline">
                                    {t("clinic.comparePrices")}
                                  </span>
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="section-divider my-4" />

                  {/* Price distribution mini-chart */}
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("clinic.priceDistribution")}
                    </h4>
                    <div className="h-32 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={priceDistData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                            axisLine={false}
                            tickLine={false}
                            width={30}
                            allowDecimals={false}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "var(--popover)",
                              border: "1px solid var(--border)",
                              borderRadius: "8px",
                              fontSize: "12px",
                            }}
                          />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                            {priceDistData.map((_, i) => (
                              <Cell key={i} fill={BUCKET_COLORS[i]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {data.stats.lastUpdated && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("result.lastUpdated")}: {shortDate(data.stats.lastUpdated)}
                    </p>
                  )}
                </div>
              </TabsContent>

              {/* ──── Tab 2: Reviews ──── */}
              <TabsContent
                value="reviews"
                className="m-0 min-h-0 max-h-[65vh] flex-1 overflow-y-auto data-[state=inactive]:hidden scrollbar-thin"
              >
                <div className="p-5">
                  {reviewsLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-24 w-full" />
                      <Skeleton className="h-32 w-full" />
                    </div>
                  ) : (
                    <ReviewsTabContent
                      clinicId={clinicId!}
                      reviewsData={reviewsData}
                    />
                  )}
                </div>
              </TabsContent>

              {/* ──── Tab 3: Nearby Clinics ──── */}
              <TabsContent
                value="nearby"
                className="m-0 min-h-0 max-h-[65vh] flex-1 overflow-y-auto data-[state=inactive]:hidden scrollbar-thin"
              >
                <div className="p-5">
                  {nearbyLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-12 w-full" />
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full" />
                      ))}
                    </div>
                  ) : (
                    <NearbyTabContent
                      nearbyData={nearbyData}
                      currentClinicMinPrice={data.stats.minPrice}
                      onViewClinic={(id) => setSelectedClinic(id)}
                    />
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ──────────── Reviews Tab Content ────────────

function ReviewsTabContent({
  clinicId,
  reviewsData,
}: {
  clinicId: string;
  reviewsData: ReviewsData | undefined;
}) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  const avg = reviewsData?.avgRating ?? 0;
  const count = reviewsData?.count ?? 0;
  const reviews = reviewsData?.reviews ?? [];

  async function submit() {
    if (!author.trim() || !comment.trim()) {
      toast.error(t("reviews.empty"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/clinics/${clinicId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName: author, rating, comment, lang }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(t("clinic.reviewSubmitted"));
      setAuthor("");
      setComment("");
      setRating(5);
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["reviews", clinicId] });
    } catch {
      toast.error(t("reviews.empty"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Rating summary */}
      <div className="card-premium flex flex-wrap items-center gap-5 p-4">
        <div className="text-center">
          <div className="gradient-text text-4xl font-extrabold tabular-nums">
            {avg.toFixed(1)}
          </div>
          <div className="mt-1">
            <StarRating rating={avg} size="md" />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {count} {t("clinic.reviewsCount")}
          </div>
        </div>

        {count > 0 && (
          <div className="flex-1 space-y-1.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const c = reviewsData?.distribution?.[String(star)] ?? 0;
              const pct = count ? (c / count) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs">
                  <span className="flex w-8 items-center gap-0.5 tabular-nums">
                    {star} <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right tabular-nums text-muted-foreground">{c}</span>
                </div>
              );
            })}
          </div>
        )}

        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setShowForm((v) => !v)}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {t("clinic.writeReview")}
        </Button>
      </div>

      {/* Write review form */}
      {showForm && (
        <div className="card-premium space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("clinic.yourName")}</Label>
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="h-9"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("clinic.yourRating")}</Label>
              <StarRating
                interactive
                value={rating}
                onChange={setRating}
                size="lg"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("clinic.yourComment")}</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={1000}
              className="resize-none"
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t("clinic.submitReview")}
            </Button>
          </div>
        </div>
      )}

      {/* Reviews list */}
      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          {t("clinic.noReviews")}
        </div>
      ) : (
        <ul className="space-y-2">
          {reviews.slice(0, visibleCount).map((r) => (
            <li key={r.id} className="card-premium p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {r.authorName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold">{r.authorName}</span>
                  {r.lang && (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[9px] uppercase text-muted-foreground"
                    >
                      {r.lang}
                    </Badge>
                  )}
                </div>
                <StarRating rating={r.rating} size="sm" />
              </div>
              <p className="mt-2 text-sm text-foreground/90">{r.comment}</p>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {relativeDate(r.createdAt, lang)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Load more */}
      {reviews.length > visibleCount && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((v) => v + 10)}
            className="text-xs"
          >
            {t("clinic.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ──────────── Nearby Tab Content ────────────

function NearbyTabContent({
  nearbyData,
  currentClinicMinPrice,
  onViewClinic,
}: {
  nearbyData: NearbyData | undefined;
  currentClinicMinPrice: number;
  onViewClinic: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const currency = useAppStore((s) => s.currency);

  if (!nearbyData || nearbyData.nearby.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        {t("clinic.noNearby")} {nearbyData?.city ?? ""} {t("clinic.sameCity")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* "This clinic from X" banner */}
      <div className="card-premium flex items-center gap-3 p-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
          <Navigation className="h-4 w-4" />
        </span>
        <div>
          <span className="text-xs text-muted-foreground">
            {t("clinic.fromPrice")}
          </span>
          <span className="gradient-text ml-1 text-lg font-bold tabular-nums">
            {formatPrice(currentClinicMinPrice, currency)}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">
            · {t("clinic.sameCity")}
          </span>
        </div>
      </div>

      {/* Nearby clinics list */}
      <div className="space-y-2">
        {nearbyData.nearby.map((nc) => (
          <div
            key={nc.id}
            className="card-premium group flex items-start gap-3 p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{nc.name}</span>
                {nc.cheaper !== null && (
                  <Badge
                    className={cn(
                      "py-0 text-[9px]",
                      nc.cheaper
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                    )}
                  >
                    {nc.cheaper ? t("clinic.cheaper") : t("clinic.moreExpensive")}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {cityName(nc.city, lang)}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Navigation className="h-3 w-3" />
                  {nc.distanceKm != null ? `${nc.distanceKm.toFixed(1)} km ${t("clinic.distanceAway")}` : cityName(nc.city, lang)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1">
                  <StarRating rating={nc.rating} size="sm" />
                  <span className="tabular-nums">{nc.rating.toFixed(1)}</span>
                </span>
                {nc.minPrice != null && (
                  <span className="tabular-nums font-medium">
                    {t("clinic.fromPrice")} {formatPrice(nc.minPrice, currency)}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {nc.serviceCount} {t("clinic.servicesCount")}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() => onViewClinic(nc.id)}
            >
              {t("clinic.viewClinic")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}


