"use client";

import { useState } from "react";
import { useI18n } from "@/components/providers";
import { useAppStore, MAX_BASKET } from "@/store/app-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetcher, formatPrice, svcName, cityName, type ServiceDirectoryItem } from "@/lib/format";
import { localizedCategory } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShoppingCart,
  Trash2,
  Sparkles,
  TrendingDown,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  PiggyBank,
  ArrowRight,
  Loader2,
  Calculator,
  Navigation,
  Car,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Response shape from POST /api/v1/basket/optimize */
type OptimizeResponse = {
  serviceIds: string[];
  singleClinic: {
    clinicId: string;
    clinicName: string;
    city: string;
    totalPrice: number;
    services: { serviceId: string; priceKzt: number; serviceNameRaw: string }[];
  } | null;
  splitOptimal: {
    totalPrice: number;
    clinicCount: number;
    services: {
      serviceId: string;
      clinicId: string;
      clinicName: string;
      city: string;
      priceKzt: number;
      serviceNameRaw: string;
    }[];
  };
  recommendation: "single" | "split";
  savingsKzt: number;
  savingsPct: number;
  elapsedMs: number;
  warnings: string[];
};

export function BasketView() {
  const { t, lang } = useI18n();
  const basketIds = useAppStore((s) => s.basketServiceIds);
  const removeFromBasket = useAppStore((s) => s.removeFromBasket);
  const clearBasket = useAppStore((s) => s.clearBasket);
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);
  const setFilters = useAppStore((s) => s.setFilters);
  const setView = useAppStore((s) => s.setView);
  const setGeo = useAppStore((s) => s.setGeo);
  const geo = useAppStore((s) => s.geo);
  const currency = useAppStore((s) => s.currency);
  const qc = useQueryClient();
  const [locating, setLocating] = useState(false);

  // Find-near-me: triggers geolocation, used for travel-cost-aware ranking
  function findNearMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error(t("travel.locationBlocked"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        toast.success(t("travel.useMyLocation"));
      },
      () => {
        setLocating(false);
        toast.error(t("travel.locationBlocked"));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  }
  function clearLocation() {
    setGeo(null);
  }

  // Fetch service directory entries so we can show names for the basket items
  const { data: servicesData } = useQuery<{
    services: ServiceDirectoryItem[];
  }>({
    queryKey: ["services-directory"],
    queryFn: () => fetcher("/api/v1/services?limit=200"),
    staleTime: 5 * 60_000,
  });

  const basketServices = (servicesData?.services ?? []).filter((s) =>
    basketIds.includes(s.id)
  );

  // Optimize query — only runs when there's at least 1 service in the basket
  const { data: optimizeResult, isLoading: optimizing, isError } = useQuery<OptimizeResponse>({
    queryKey: ["basket-optimize", basketIds.join(",")],
    queryFn: () =>
      fetcher("/api/v1/basket/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceIds: basketIds }),
      }),
    enabled: basketIds.length >= 1,
    staleTime: 30_000,
  });

  function handleRemove(id: string) {
    removeFromBasket(id);
    toast.success(t("basket.removedFromBasket"));
  }

  function handleClear() {
    clearBasket();
    qc.invalidateQueries({ queryKey: ["basket-optimize"] });
  }

  function searchForService(name: string) {
    setFilters({ q: name });
    setView("search");
  }

  // ── Empty state ──────────────────────────────────────────────
  if (basketIds.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="msp-fade-in text-center">
          <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-primary/20 to-cyan-500/10 text-primary shadow-inner">
            <ShoppingCart className="h-10 w-10" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">
            <span className="gradient-text">{t("basket.title")}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            {t("basket.subtitle")}
          </p>
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-dashed border-border/70 bg-muted/30 p-8">
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">{t("basket.empty")}</p>
            <Button
              className="mt-4 gap-2"
              onClick={() => setView("search")}
            >
              <Sparkles className="h-4 w-4" />
              {t("nav.search")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const showSplit = optimizeResult?.recommendation === "split";
  const savings = optimizeResult?.savingsKzt ?? 0;

  return (
    <div className="msp-fade-in mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight sm:text-3xl">
            <ShoppingCart className="h-7 w-7 text-primary" />
            <span className="gradient-text">{t("basket.title")}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("basket.items", { count: basketIds.length })} · {t("basket.subtitle")}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleClear}>
          <Trash2 className="h-3.5 w-3.5" />
          {t("basket.clear")}
        </Button>
      </div>

      {/* Travel-cost awareness banner (Workstream 4) — lets the user share
          location so the basket optimizer can factor in distance. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
        <Car className="h-4 w-4 shrink-0 text-primary" />
        {geo ? (
          <>
            <span className="text-muted-foreground">
              {t("travel.useMyLocation")}:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {geo.lat.toFixed(3)}, {geo.lng.toFixed(3)}
              </span>
            </span>
            <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={clearLocation}>
              {t("travel.clearLocation")}
            </Button>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">{t("travel.disclaimer", { perKm: 35 })}</span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 gap-1 text-xs"
              onClick={findNearMe}
              disabled={locating}
            >
              {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Navigation className="h-3 w-3" />}
              {locating ? t("travel.locating") : t("travel.findNearMe")}
            </Button>
          </>
        )}
      </div>

      {/* Basket items list */}
      <Card className="mb-6 overflow-hidden p-0">
        <div className="border-b border-border/60 bg-muted/40 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Calculator className="h-3.5 w-3.5" />
            {t("basket.items", { count: basketIds.length })}
          </h2>
        </div>
        <ul className="divide-y divide-border/60">
          {basketServices.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-[10px] font-bold uppercase text-primary">
                {s.category.slice(0, 3)}
              </span>
              <button
                onClick={() => searchForService(svcName(s, lang))}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-semibold hover:text-primary hover:underline">
                  {svcName(s, lang)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {localizedCategory(s.category, lang)}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-rose-500"
                onClick={() => handleRemove(s.id)}
                aria-label={t("basket.remove")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {/* Optimization results */}
      {optimizing && !optimizeResult ? (
        <Card className="p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("basket.optimizing")}</p>
          </div>
        </Card>
      ) : isError ? (
        <Card className="border-rose-300/60 p-6">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm font-medium">{t("ai.error")}</span>
          </div>
        </Card>
      ) : optimizeResult ? (
        <div className="space-y-4">
          {/* Recommendation banner */}
          {savings > 0 ? (
            <Card className="msp-card-hover overflow-hidden border-emerald-300/50 p-0">
              <div className="flex items-center gap-4 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent p-5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md">
                  <PiggyBank className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    {t("basket.recommendation")}
                  </p>
                  <p className="text-sm font-bold text-foreground sm:text-base">
                    {t("basket.splitRecommended", {
                      amount: formatPrice(savings, currency),
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                    −{optimizeResult.savingsPct}%
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("basket.savings")}
                  </div>
                </div>
              </div>
            </Card>
          ) : optimizeResult.recommendation === "single" ? (
            <Card className="msp-card-hover overflow-hidden border-primary/30 p-0">
              <div className="flex items-center gap-4 bg-gradient-to-r from-primary/10 to-transparent p-5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-cyan-600 text-primary-foreground shadow-md">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">
                    {t("basket.recommendation")}
                  </p>
                  <p className="text-sm font-bold text-foreground sm:text-base">
                    {t("basket.singleRecommended")}
                  </p>
                </div>
              </div>
            </Card>
          ) : null}

          {/* Two-column comparison: Single vs Split */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Single clinic */}
            <OptimizeColumn
              title={t("basket.singleClinic")}
              icon={<Building2 className="h-4 w-4" />}
              highlighted={optimizeResult.recommendation === "single"}
              empty={optimizeResult.singleClinic == null}
              emptyText={t("basket.notAvailable")}
            >
              {optimizeResult.singleClinic && (
                <SingleClinicDetail
                  data={optimizeResult.singleClinic}
                  currency={currency}
                  lang={lang}
                  onViewClinic={(id) => setSelectedClinic(id)}
                  tCity={(c: string) => cityName(c, lang)}
                />
              )}
            </OptimizeColumn>

            {/* Split optimal */}
            <OptimizeColumn
              title={t("basket.splitOptimal")}
              icon={<TrendingDown className="h-4 w-4" />}
              highlighted={optimizeResult.recommendation === "split"}
              badge={optimizeResult.splitOptimal.clinicCount > 1 ? t("basket.clinics", { count: optimizeResult.splitOptimal.clinicCount }) : undefined}
            >
              <SplitDetail
                data={optimizeResult.splitOptimal}
                currency={currency}
                lang={lang}
                onViewClinic={(id) => setSelectedClinic(id)}
                tCity={(c: string) => cityName(c, lang)}
              />
            </OptimizeColumn>
          </div>

          {/* Warnings */}
          {optimizeResult.warnings.length > 0 && (
            <Card className="border-amber-300/50 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
                  {optimizeResult.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function OptimizeColumn({
  title,
  icon,
  children,
  highlighted,
  empty,
  emptyText,
  badge,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  highlighted: boolean;
  empty?: boolean;
  emptyText?: string;
  badge?: string;
}) {
  return (
    <Card
      className={cn(
        "msp-card-hover overflow-hidden p-0 transition-all duration-200",
        highlighted
          ? "border-primary/50 shadow-lg shadow-primary/10 ring-1 ring-primary/20"
          : "border-border/70"
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <span className={cn(highlighted ? "text-primary" : "text-muted-foreground")}>
            {icon}
          </span>
          {title}
        </h3>
        {badge && (
          <Badge variant="secondary" className="text-[10px] font-semibold">
            {badge}
          </Badge>
        )}
        {highlighted && (
          <Badge className="gap-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-[9px] font-bold uppercase text-white">
            <Sparkles className="h-2.5 w-2.5" />
            Best
          </Badge>
        )}
      </div>
      <div className="p-4">
        {empty ? (
          <div className="flex items-center gap-2 py-6 text-center text-sm text-muted-foreground">
            <AlertCircle className="mx-auto h-5 w-5 text-muted-foreground/50" />
            <span>{emptyText}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

function SingleClinicDetail({
  data,
  currency,
  lang,
  onViewClinic,
  tCity,
}: {
  data: NonNullable<OptimizeResponse["singleClinic"]>;
  currency: "KZT" | "USD" | "RUB";
  lang: string;
  onViewClinic: (id: string) => void;
  tCity: (c: string) => string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <button
        onClick={() => onViewClinic(data.clinicId)}
        className="block w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="font-bold text-foreground hover:text-primary hover:underline">
            {data.clinicName}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {tCity(data.city)}
        </div>
      </button>
      <ul className="space-y-1">
        {data.services.map((s) => (
          <li key={s.serviceId} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">{s.serviceNameRaw}</span>
            <span className="shrink-0 font-semibold tabular-nums">
              {formatPrice(s.priceKzt, currency)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-border/60 pt-2">
        <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          {t("basket.total")}
        </span>
        <span className="text-xl font-black tabular-nums gradient-text">
          {formatPrice(data.totalPrice, currency)}
        </span>
      </div>
    </div>
  );
}

function SplitDetail({
  data,
  currency,
  lang,
  onViewClinic,
  tCity,
}: {
  data: OptimizeResponse["splitOptimal"];
  currency: "KZT" | "USD" | "RUB";
  lang: string;
  onViewClinic: (id: string) => void;
  tCity: (c: string) => string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {data.services.map((s) => (
          <li key={s.serviceId} className="rounded-lg bg-muted/40 p-2">
            <div className="truncate text-xs font-semibold text-foreground">
              {s.serviceNameRaw}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <button
                onClick={() => onViewClinic(s.clinicId)}
                className="flex min-w-0 items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{s.clinicName}</span>
                <span className="shrink-0 text-muted-foreground">· {tCity(s.city)}</span>
              </button>
              <span className="shrink-0 text-sm font-bold tabular-nums">
                {formatPrice(s.priceKzt, currency)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-border/60 pt-2">
        <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          {t("basket.total")}
        </span>
        <span className="text-xl font-black tabular-nums gradient-text">
          {formatPrice(data.totalPrice, currency)}
        </span>
      </div>
    </div>
  );
}
