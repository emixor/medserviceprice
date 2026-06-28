"use client";

/**
 * PriceDrops — full-width homepage section showing the biggest recent price
 * decreases captured by the price_history tracker. Surfaces real savings
 * opportunities and gives users a reason to come back to the platform.
 */
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { fetcher, relativeDate } from "@/lib/format";
import { localizedCategory, type Lang } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingDown,
  ArrowRight,
  Sparkles,
  Loader2,
  PiggyBank,
} from "lucide-react";
import { cn } from "@/lib/utils";

type PriceDrop = {
  serviceId: string;
  serviceName: string;
  serviceNameRu: string;
  serviceNameKk: string;
  category: string;
  clinicId: string;
  clinicName: string;
  city: string;
  oldPrice: number;
  newPrice: number;
  dropKzt: number;
  dropPct: number;
  recordedAt: string;
};

type PriceDropsResponse = {
  drops: PriceDrop[];
  generatedAt: string;
};

const CATEGORY_TINT: Record<string, string> = {
  laboratory: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  diagnostics: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  doctor_appointment: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  procedure: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function svcName(d: PriceDrop, lang: Lang): string {
  if (lang === "ru") return d.serviceNameRu || d.serviceName;
  if (lang === "kk") return d.serviceNameKk || d.serviceNameRu || d.serviceName;
  return d.serviceName || d.serviceNameRu;
}

export function PriceDrops() {
  const { t, lang } = useI18n();
  const setFilters = useAppStore((s) => s.setFilters);
  const currency = useAppStore((s) => s.currency);

  const { data, isLoading } = useQuery<PriceDropsResponse>({
    queryKey: ["price-drops"],
    queryFn: () => fetcher<PriceDropsResponse>("/api/v1/price-drops?limit=8"),
    staleTime: 5 * 60_000,
  });

  const drops = data?.drops ?? [];

  // Hide the whole section if there's nothing to show (after loading).
  if (!isLoading && drops.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <TrendingDown className="h-4 w-4" />
            </span>
            {t("priceDrops.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {t("priceDrops.subtitle")}
          </p>
        </div>
        <Badge
          variant="outline"
          className="hidden border-emerald-400/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 sm:inline-flex"
        >
          <Sparkles className="mr-1 h-3 w-3" />
          {drops.length} {drops.length === 1 ? "deal" : "deals"}
        </Badge>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {drops.map((d) => (
            <PriceDropCard
              key={`${d.serviceId}-${d.clinicId}`}
              d={d}
              t={t}
              lang={lang}
              currency={currency}
              onSearch={() => setFilters({ q: svcName(d, lang) })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PriceDropCard({
  d,
  t,
  lang,
  currency,
  onSearch,
}: {
  d: PriceDrop;
  t: (k: string, v?: Record<string, string | number>) => string;
  lang: Lang;
  currency: "KZT" | "USD" | "RUB";
  onSearch: () => void;
}) {
  const catTint = CATEGORY_TINT[d.category] ?? "bg-muted text-muted-foreground";
  const name = svcName(d, lang);
  const savingsLabel = currency === "KZT"
    ? `₸${d.dropKzt.toLocaleString()}`
    : `$${(d.dropKzt / 470).toFixed(2)}`;
  const newPriceLabel = currency === "KZT"
    ? `₸${d.newPrice.toLocaleString()}`
    : `$${(d.newPrice / 470).toFixed(2)}`;
  const oldPriceLabel = currency === "KZT"
    ? `₸${d.oldPrice.toLocaleString()}`
    : `$${(d.oldPrice / 470).toFixed(2)}`;

  return (
    <Card className="card-premium card-hover-border group relative flex h-full flex-col gap-2.5 overflow-hidden p-4 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-emerald-500/10">
      {/* Decorative diagonal gradient ribbon (top-right corner) */}
      <div
        className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full bg-emerald-500/15 blur-2xl transition-all duration-300 group-hover:scale-150 group-hover:bg-emerald-500/25"
        aria-hidden="true"
      />

      {/* Top-right large discount stamp */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-center rounded-xl border-2 border-emerald-400/50 bg-emerald-500/10 px-2 py-1 backdrop-blur-sm">
        <span className="text-base font-black leading-none text-emerald-600 dark:text-emerald-400 tabular-nums">
          −{d.dropPct}%
        </span>
        <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-700/80 dark:text-emerald-300/80">
          off
        </span>
      </div>

      {/* Top row: category badge */}
      <div className="flex items-start">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
            catTint,
          )}
        >
          {localizedCategory(d.category, lang)}
        </span>
      </div>

      {/* Service name */}
      <button
        onClick={onSearch}
        className="line-clamp-2 max-w-[80%] text-left text-sm font-semibold leading-tight text-foreground transition-colors hover:text-emerald-600 dark:hover:text-emerald-400"
        title={name}
      >
        {name}
      </button>

      {/* Clinic + city */}
      <div className="truncate text-xs text-muted-foreground" title={`${d.clinicName} · ${d.city}`}>
        {d.clinicName} · {d.city}
      </div>

      {/* Price comparison */}
      <div className="mt-auto space-y-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("priceDrops.oldPrice")}
            </span>
            <span className="text-xs font-medium text-muted-foreground line-through tabular-nums">
              {oldPriceLabel}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("priceDrops.newPrice")}
            </span>
            <span className="gradient-text text-2xl font-black leading-none tabular-nums">
              {newPriceLabel}
            </span>
          </div>
        </div>

        {/* Savings pill — prominent */}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-400/30 bg-gradient-to-r from-emerald-500/15 to-teal-500/10 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5">
            <PiggyBank className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              {t("priceDrops.savings")}
            </span>
          </div>
          <span className="text-sm font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
            {savingsLabel}
          </span>
        </div>

        {/* Footer: timestamp + CTA */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-[10px] text-muted-foreground">
            {t("priceDrops.recordedAt", { when: relativeDate(d.recordedAt, lang) })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSearch}
            className="h-7 gap-1 px-2 text-[11px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            {t("priceDrops.cta")}
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Compact loading skeleton. */
export function PriceDropsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex h-40 animate-pulse flex-col gap-3 rounded-2xl bg-muted p-4"
        >
          <div className="h-3 w-12 rounded bg-muted-foreground/20" />
          <div className="h-3 w-3/4 rounded bg-muted-foreground/20" />
          <div className="mt-auto h-6 w-1/2 rounded bg-muted-foreground/20" />
        </div>
      ))}
    </div>
  );
}
