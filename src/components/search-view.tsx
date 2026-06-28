"use client";

import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { fetcher, filtersToQuery, type SearchResult } from "@/lib/format";
import { SearchBar } from "@/components/search-bar";
import { FilterSidebar } from "@/components/filter-sidebar";
import { ResultCard } from "@/components/result-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { localizedServiceName, localizedCategory } from "@/lib/i18n";
import {
  TrendingUp,
  Building2,
  Stethoscope,
  MapPin,
  Activity,
  Download,
  SlidersHorizontal,
  Droplet,
  Brain,
  Stethoscope as StethoIcon,
  Syringe,
  UserRound,
  Clock,
  X,
  Sparkles,
  FileText,
  Loader2,
  ChevronDown,
  GitCompareArrows,
  PiggyBank,
  Search as SearchIcon,
  ArrowRight,
  Heart,
  LayoutGrid,
  List as ListIcon,
  BarChart3,
  Crown,
  ArrowUpDown,
  Eye,
  Quote,
  Calculator,
  Star,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MAX_COMPARE } from "@/store/app-store";
import { cityName, formatKzt, formatPrice, svcName } from "@/lib/format";
import { TrendingServices } from "@/components/trending-services";
import { TrustBand } from "@/components/trust-band";
import { PriceDrops } from "@/components/price-drops";
import { EmptyState as EmptyStatePremium } from "@/components/empty-state";
import { FilterChipsRail } from "@/components/filter-chips-rail";

const PAGE_SIZE = 30;

/** Export current search results as CSV. */
function ExportCsvButton() {
  const { t } = useI18n();
  const filters = useAppStore((s) => s.filters);

  function exportCsv() {
    const qs = filtersToQuery(filters);
    // Trigger download via direct navigation
    const a = document.createElement("a");
    a.href = `/api/v1/export/csv?${qs}`;
    a.download = `medserviceprice_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(t("toast.exported"));
  }

  return (
    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportCsv}>
      <Download className="h-3.5 w-3.5" />
      {t("export.csv")}
    </Button>
  );
}

/** Export current search results as PDF. */
function ExportPdfButton() {
  const { t } = useI18n();
  const filters = useAppStore((s) => s.filters);
  const [loading, setLoading] = useState(false);

  async function exportPdf() {
    setLoading(true);
    try {
      const qs = filtersToQuery(filters);
      const res = await fetch(`/api/v1/export/pdf?${qs}`);
      if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `medserviceprice_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("toast.exported"));
    } catch {
      toast.error(t("export.pdfError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs"
      onClick={exportPdf}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileText className="h-3.5 w-3.5" />
      )}
      {t("export.pdf")}
    </Button>
  );
}

const QUICK_LINKS: { key: string; q: string; icon: typeof Droplet }[] = [
  { key: "quicklinks.bloodTest", q: "анализ крови", icon: Droplet },
  { key: "quicklinks.mri", q: "МРТ", icon: Brain },
  { key: "quicklinks.ultrasound", q: "УЗИ", icon: Activity },
  { key: "quicklinks.dentist", q: "стоматолог", icon: StethoIcon },
  { key: "quicklinks.vaccination", q: "прививк", icon: Syringe },
  { key: "quicklinks.doctor", q: "приём врача", icon: UserRound },
];

export function SearchView() {
  const { t, lang } = useI18n();
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const geo = useAppStore((s) => s.geo);
  const recentIds = useAppStore((s) => s.recentServiceIds);
  const clearRecent = useAppStore((s) => s.clearRecent);
  const favoriteIds = useAppStore((s) => s.favoriteServiceIds);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const resultView = useAppStore((s) => s.resultView);
  const doctorMode = useAppStore((s) => s.doctorMode);
  // Doctor Mode (Workstream 13): force the dense list layout regardless of the
  // user's saved resultView preference. The toggle is sticky (persisted) so a
  // doctor using the app during consultations sees a consistent dense layout.
  const effectiveView = doctorMode ? "list" : resultView;

  // Reset page to 1 whenever filters/geo change (derived-state pattern, no effect)
  const filtersSig = `${filters.q}|${filters.city}|${filters.category}|${filters.priceMin}|${filters.priceMax}|${filters.ratingMin}|${filters.onlineBooking}|${filters.excludeStale}|${filters.sort}|${geo?.lat ?? ""}|${geo?.lng ?? ""}`;
  const [prevSig, setPrevSig] = useState(filtersSig);
  if (prevSig !== filtersSig) {
    setPrevSig(filtersSig);
    setPage(1);
  }

  const qs = useMemo(
    () => filtersToQuery({ ...filters, geo, limit: page * PAGE_SIZE }),
    [filters, geo, page]
  );

  const { data, isLoading, isError, error } = useQuery<{ items: SearchResult[]; total: number; elapsedMs: number }>({
    queryKey: ["search", qs],
    queryFn: () => fetcher(`/api/v1/search?${qs}`),
    staleTime: 20_000,
  });

  const { data: stats } = useQuery<{
    clinics: number;
    services: number;
    normalized: number;
    cities: string[];
    avgSpreadPct: number;
  }>({
    queryKey: ["stats"],
    queryFn: () => fetcher("/api/v1/stats"),
    staleTime: 60_000,
  });

  // Fetch recently-viewed service directory entries (so we can show their names)
  const { data: recentServices } = useQuery<{
    services: { id: string; nameRu: string; nameKk: string; nameEn: string; category: string }[];
  }>({
    queryKey: ["services-directory"],
    queryFn: () => fetcher("/api/v1/services?limit=200"),
    staleTime: 5 * 60_000,
  });

  const recentList = useMemo(() => {
    if (!recentServices?.services) return [];
    return recentIds
      .map((id) => recentServices.services.find((s) => s.id === id))
      .filter(Boolean)
      .slice(0, 6) as { id: string; nameRu: string; nameKk: string; nameEn: string; category: string }[];
  }, [recentServices, recentIds]);

  const favoriteList = useMemo(() => {
    if (!recentServices?.services) return [];
    return favoriteIds
      .map((id) => recentServices.services.find((s) => s.id === id))
      .filter(Boolean) as { id: string; nameRu: string; nameKk: string; nameEn: string; category: string }[];
  }, [recentServices, favoriteIds]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasQuery = !!filters.q || !!filters.city || !!filters.category;

  return (
    <div className="msp-fade-in">
      {/* Hero */}
      <section className="hero-gradient hero-mesh-gradient noise-overlay relative overflow-hidden border-b border-border/60">
        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary shadow-sm shadow-primary/10">
              <Sparkles className="h-3 w-3" />
              {t("app.tagline")}
            </div>
            <h1 className="text-balance text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl lg:leading-[1.1]">
              <span className="gradient-text">MedServicePrice.kz</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-balance text-base font-medium text-foreground/70 sm:text-lg">
              {t("app.subtitle")}
            </p>
            <div className="mx-auto mt-6 max-w-2xl">
              <div className="search-glow msp-hero-search rounded-2xl bg-card shadow-sm">
                <SearchBar size="lg" />
              </div>
            </div>

            {/* Popular search chips — premium pill styling */}
            <div className="mx-auto mt-5 flex max-w-2xl flex-wrap items-center justify-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t("quicklinks.title")}:
              </span>
              {QUICK_LINKS.map((ql) => {
                const Icon = ql.icon;
                const active = filters.q.toLowerCase() === ql.q.toLowerCase();
                return (
                  <button
                    key={ql.key}
                    className={`search-tag-pill ${active ? "text-primary" : ""}`}
                    data-active={active || undefined}
                    onClick={() =>
                      setFilters({ q: active ? "" : ql.q })
                    }
                  >
                    <Sparkles className="h-3 w-3 opacity-60" />
                    <Icon className="h-3 w-3" />
                    {t(ql.key)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stats strip — with animated count-up */}
          <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
            <AnimatedStatCard
              icon={<Building2 className="h-5 w-5" />}
              label={t("stats.clinics")}
              value={stats?.clinics}
            />
            <AnimatedStatCard
              icon={<Stethoscope className="h-5 w-5" />}
              label={t("stats.services")}
              value={stats?.services}
            />
            <AnimatedStatCard
              icon={<TrendingUp className="h-5 w-5" />}
              label={t("stats.prices")}
              value={stats?.normalized}
            />
            <AnimatedStatCard
              icon={<MapPin className="h-5 w-5" />}
              label={t("stats.cities")}
              value={stats?.cities?.length}
            />
          </div>

          {/* Divider */}
          <div className="mx-auto mt-8 max-w-4xl">
            <div className="h-px bg-border/60" />
          </div>

          {/* Trust Band — real platform data replacing the static "Why Use Us" cards */}
          <TrustBand />

          {/* How It Works */}
          <div className="mx-auto mt-10 max-w-4xl msp-fade-in">
            <h2 className="mb-6 text-center text-lg font-bold tracking-tight sm:text-xl">
              {t("howItWorks.title")}
            </h2>
            <div className="grid gap-6 sm:grid-cols-3">
              <HowItWorksStep
                number={1}
                icon={<SearchIcon className="h-5 w-5" />}
                title={t("howItWorks.step1.title")}
                desc={t("howItWorks.step1.desc")}
              />
              <HowItWorksStep
                number={2}
                icon={<GitCompareArrows className="h-5 w-5" />}
                title={t("howItWorks.step2.title")}
                desc={t("howItWorks.step2.desc")}
              />
              <HowItWorksStep
                number={3}
                icon={<PiggyBank className="h-5 w-5" />}
                title={t("howItWorks.step3.title")}
                desc={t("howItWorks.step3.desc")}
              />
            </div>
          </div>

          {/* What Users Say — testimonials */}
          <div className="mx-auto mt-10 max-w-5xl msp-fade-in">
            <div className="mb-6 text-center">
              <h2 className="flex items-center justify-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
                <Quote className="h-5 w-5 text-primary" />
                {t("testimonials.title")}
              </h2>
              <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground sm:text-sm">
                {t("testimonials.subtitle")}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((i) => {
                const author = t(`testimonials.t${i}.author`);
                const firstName = author.split(",")[0]?.trim() ?? author;
                const initials = firstName.slice(0, 2).toUpperCase();
                return (
                  <div
                    key={i}
                    className="msp-card-hover group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-sm backdrop-blur"
                  >
                    <Quote className="pointer-events-none absolute right-3 top-3 h-8 w-8 text-primary/10 transition-transform group-hover:scale-110" />
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, s) => (
                        <Star
                          key={s}
                          className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
                        />
                      ))}
                    </div>
                    <p className="text-sm italic leading-relaxed text-foreground/90">
                      &ldquo;{t(`testimonials.t${i}.quote`)}&rdquo;
                    </p>
                    <div className="mt-auto flex items-center gap-2.5 pt-1">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                        {initials}
                      </span>
                      <span className="text-xs font-semibold text-foreground">
                        {author}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Savings Calculator */}
          <div className="mx-auto mt-10 max-w-3xl msp-fade-in">
            <SavingsCalculator />
          </div>
        </div>
      </section>

      {/* Trending services — full-width section between hero and body */}
      <TrendingServices />

      {/* Recent price drops — real savings from the price history tracker */}
      <PriceDrops />

      {/* Body: filters + results */}
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Mobile filter toggle */}
        <div className="mb-4 flex items-center justify-between gap-2 lg:hidden">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setMobileFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t("filters.title")}
          </Button>
          <div className="flex items-center gap-2">
            <ExportPdfButton />
            <ExportCsvButton />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Sidebar: collapsible on mobile */}
          <div className={mobileFiltersOpen ? "block" : "hidden lg:block"}>
            <FilterSidebar />

            {/* Recently viewed (desktop) */}
            {recentList.length > 0 && (
              <div className="mt-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {t("recent.title")}
                    </h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-muted-foreground"
                    onClick={clearRecent}
                  >
                    {t("recent.clear")}
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {recentList.map((s) => (
                    <button
                      key={s.id}
                      className="msp-recent-pill w-full"
                      onClick={() => setFilters({ q: localizedServiceName(s, lang) })}
                    >
                      <span>{localizedServiceName(s, lang)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Favorites widget */}
            {favoriteList.length > 0 && (
              <div className="mt-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Heart className="h-3.5 w-3.5 text-rose-500" />
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {t("favorites.title")}
                    </h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-muted-foreground"
                    onClick={() => {
                      // Clear all favorites by toggling each one off
                      const ids = useAppStore.getState().favoriteServiceIds.slice();
                      ids.forEach((id) => useAppStore.getState().toggleFavorite(id));
                    }}
                  >
                    {t("favorites.clear")}
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {favoriteList.map((s) => (
                    <button
                      key={s.id}
                      className="msp-recent-pill w-full"
                      onClick={() => setFilters({ q: localizedServiceName(s, lang) })}
                    >
                      <Heart className="h-3 w-3 shrink-0 fill-rose-500 text-rose-500" />
                      <span>{localizedServiceName(s, lang)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0">
            {/* Results header */}
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight">
                  {total > 0 ? (
                    <>
                      <span className="tabular-nums">{total}</span>{" "}
                      <span className="text-base font-medium text-muted-foreground">
                        {t("search.results")}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </h2>
                {data && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70 tabular-nums">{data.elapsedMs} ms</span>
                    {" · "}
                    {geo && (
                      <>
                        <span className="text-primary">●</span> {t("geo.findNearMe")}{" · "}
                      </>
                    )}
                    {lang === "en"
                      ? "English"
                      : lang === "kk"
                      ? "Қазақша"
                      : "Русский"}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <ResultViewToggle />
                {doctorMode && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                    <Stethoscope className="h-3 w-3" />
                    {t("doctorMode.on")}
                  </span>
                )}
                {filters.q && (
                  <button
                    onClick={() => useAppStore.getState().setFilters({ q: "" })}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                    «{filters.q}»
                  </button>
                )}
                <div className="hidden items-center gap-2 lg:flex">
                  <ExportPdfButton />
                  <ExportCsvButton />
                </div>
              </div>
            </div>

            <FilterChipsRail />
            <ActiveFilterChips />

            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full rounded-2xl" />
                ))}
              </div>
            ) : isError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
                {String(error?.message ?? "Error")}
              </div>
            ) : items.length === 0 ? (
              <EmptyStatePremium
                variant="search"
                actionLabel={t("empty.cta.search")}
                onAction={() => useAppStore.getState().resetFilters()}
              />
            ) : (
              <>
                <PriceComparisonSummary items={items} />
                <PriceDistributionPanel items={items} total={total} />
                {effectiveView === "card" ? (
                  <div className={doctorMode ? "space-y-2" : "space-y-3"}>
                    {items.map((item, i) => (
                      <div
                        key={item.id}
                        className="msp-card-in"
                        style={{ animationDelay: `${Math.min(i * (doctorMode ? 15 : 35), doctorMode ? 200 : 400)}ms` }}
                      >
                        <ResultCard item={item} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={doctorMode ? "space-y-1" : "space-y-1.5"}>
                    {/* Column headers — desktop only, keeps the table-like layout dense */}
                    <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_120px_140px_120px] gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground/70 sm:grid">
                      <span>{t("stats.services")}</span>
                      <span>{t("stats.clinics")}</span>
                      <span>{t("filters.city")}</span>
                      <span className="text-right">{t("compare.price")}</span>
                      <span className="text-right">·</span>
                    </div>
                    {items.map((item, i) => (
                      <div
                        key={item.id}
                        className="msp-card-in"
                        style={{ animationDelay: `${Math.min(i * (doctorMode ? 12 : 25), doctorMode ? 150 : 300)}ms` }}
                      >
                        <ResultRow item={item} />
                      </div>
                    ))}
                  </div>
                )}
                {/* Load more pagination */}
                {total > items.length && (
                  <div className="mt-6 flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {t("search.showing", { shown: items.length, total })}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                      {t("search.loadMore")}
                      <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] font-bold tabular-nums">
                        +{Math.min(PAGE_SIZE, total - items.length)}
                      </span>
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Animated stat card with count-up effect and glow */
function AnimatedStatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
}) {
  return (
    <div className="count-up rounded-2xl border border-border/70 bg-card/80 p-3 shadow-sm backdrop-blur transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1 text-3xl font-black tabular-nums msp-gradient-text stat-glow sm:text-4xl">
        {value != null ? value : "—"}
      </div>
    </div>
  );
}

/**
 * Active filter chips — small rounded pills shown above the results list
 * summarizing every filter that's currently applied (other than the default
 * sort). Each chip has an X to dismiss just that one filter. Hidden entirely
 * when no filters are active.
 */
function ActiveFilterChips() {
  const { t, lang } = useI18n();
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const geo = useAppStore((s) => s.geo);
  const setGeo = useAppStore((s) => s.setGeo);
  const currency = useAppStore((s) => s.currency);

  type Chip = {
    key: string;
    label: string;
    onRemove: () => void;
  };

  const chips: Chip[] = useMemo(() => {
    const list: Chip[] = [];
    if (filters.city) {
      list.push({
        key: "city",
        label: `${t("filters.city")}: ${cityName(filters.city, lang)}`,
        onRemove: () => setFilters({ city: "" }),
      });
    }
    if (filters.category) {
      list.push({
        key: "category",
        label: `${t("filters.category")}: ${localizedCategory(filters.category, lang)}`,
        onRemove: () => setFilters({ category: "" }),
      });
    }
    if (filters.priceMin || filters.priceMax) {
      const min = filters.priceMin ? Number(filters.priceMin) : 0;
      const max = filters.priceMax ? Number(filters.priceMax) : 70000;
      list.push({
        key: "price",
        label: `${t("filters.priceRange")}: ${formatPrice(min, currency)}–${formatPrice(max, currency)}`,
        onRemove: () => setFilters({ priceMin: "", priceMax: "" }),
      });
    }
    if (filters.ratingMin) {
      list.push({
        key: "rating",
        label: `${t("filters.rating")}: ${filters.ratingMin}+`,
        onRemove: () => setFilters({ ratingMin: "" }),
      });
    }
    if (filters.onlineBooking) {
      list.push({
        key: "onlineBooking",
        label: t("filters.onlineBooking"),
        onRemove: () => setFilters({ onlineBooking: false }),
      });
    }
    // Sort chip — only when not on the default sort.
    if (filters.sort !== "price_asc") {
      list.push({
        key: "sort",
        label: `${t("filters.sort")}: ${t(`sort.${filters.sort}`)}`,
        onRemove: () => {
          // If the active sort relies on geo (distance_asc), clear geo too.
          if (filters.sort === "distance_asc" && geo) {
            setGeo(null);
          }
          setFilters({ sort: "price_asc" });
        },
      });
    }
    return list;
  }, [
    filters.city,
    filters.category,
    filters.priceMin,
    filters.priceMax,
    filters.ratingMin,
    filters.onlineBooking,
    filters.sort,
    geo,
    lang,
    currency,
    t,
    setFilters,
    setGeo,
  ]);

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {t("filters.activeFilters")}:
      </span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs font-medium text-foreground"
        >
          <span className="max-w-[220px] truncate">{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label={`Remove filter ${chip.label}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

function HowItWorksStep({
  number,
  icon,
  title,
  desc,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card/80 p-5 text-center shadow-sm backdrop-blur transition-colors hover:border-primary/30">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {number}
        </span>
        <span className="text-primary">{icon}</span>
      </div>
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
      {number < 3 && (
        <ArrowRight className="mt-1 hidden h-4 w-4 text-primary/40 sm:block sm:absolute sm:right-[-1rem] sm:top-1/2 sm:-translate-y-1/2" />
      )}
    </div>
  );
}

/**
 * Savings Calculator — small interactive widget embedded in the hero section.
 * Lets the visitor type what they currently pay for a service and instantly see
 * how much they could save by using the platform average (default 3 500 ₸).
 */
function SavingsCalculator() {
  const { t } = useI18n();
  const currency = useAppStore((s) => s.currency);
  // The stats endpoint does not expose an overall average price; the spec
  // provides a sensible default of 3 500 ₸ which matches a typical blood test.
  const PLATFORM_AVG_KZT = 3500;
  const [userPrice, setUserPrice] = useState<string>("");

  const parsed = Number(userPrice.replace(/[^\d.]/g, ""));
  const hasInput = userPrice !== "" && Number.isFinite(parsed) && parsed > 0;
  const savingsKzt = hasInput ? Math.max(0, parsed - PLATFORM_AVG_KZT) : 0;
  const pct = hasInput && parsed > 0
    ? Math.round((savingsKzt / parsed) * 100)
    : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-primary/5 to-cyan-500/10 p-5 sm:p-7">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Calculator className="h-5 w-5" />
        </span>
        <h2 className="text-lg font-bold tracking-tight sm:text-xl">
          {t("savings.title")}
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <div>
          <label
            htmlFor="savings-price-input"
            className="mb-1.5 block text-xs font-semibold text-muted-foreground"
          >
            {t("savings.yourPrice")} (₸)
          </label>
          <input
            id="savings-price-input"
            type="number"
            inputMode="numeric"
            min={0}
            value={userPrice}
            onChange={(e) => setUserPrice(e.target.value)}
            placeholder="0"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold tabular-nums outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("savings.avgPrice")}
          </div>
          <div className="mt-0.5 text-sm font-bold tabular-nums text-foreground">
            {formatPrice(PLATFORM_AVG_KZT, currency)}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-card/70 p-4 sm:p-5">
        {hasInput ? (
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">
                {t("savings.youSave")}
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <PiggyBank className="h-6 w-6 shrink-0 self-center text-emerald-500" />
                <span className="text-3xl font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatPrice(savingsKzt, currency)}
                </span>
                <span className="text-sm font-semibold text-emerald-600/80 dark:text-emerald-400/80">
                  ({pct}%)
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <PiggyBank className="h-4 w-4 text-muted-foreground/60" />
            {t("savings.enterPrice")}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Task 4-b additions
 * ------------------------------------------------------------------ */

/** Two-button toggle: switch the search results between card and compact list view. */
function ResultViewToggle() {
  const { t } = useI18n();
  const resultView = useAppStore((s) => s.resultView);
  const setResultView = useAppStore((s) => s.setResultView);
  // Doctor Mode forces the dense list layout, so disable the toggle when active
  // and show the dense-list button as pressed.
  const doctorMode = useAppStore((s) => s.doctorMode);
  const activeView = doctorMode ? "list" : resultView;

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
      role="group"
      aria-label={t("search.viewCard")}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={activeView === "card" ? "default" : "ghost"}
            size="icon"
            className="size-7"
            onClick={() => !doctorMode && setResultView("card")}
            disabled={doctorMode}
            aria-label={t("search.viewCard")}
            aria-pressed={activeView === "card"}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {doctorMode ? t("doctorMode.on") : t("search.viewCard")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={activeView === "list" ? "default" : "ghost"}
            size="icon"
            className="size-7"
            onClick={() => !doctorMode && setResultView("list")}
            disabled={doctorMode}
            aria-label={t("search.viewList")}
            aria-pressed={activeView === "list"}
          >
            <ListIcon className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {doctorMode ? t("doctorMode.on") : t("search.viewList")}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * Compact table-like row for the "list" result view.
 *
 * Uses a 2-cell flex layout on mobile (service+clinic+city stacked on the
 * left, price + actions on the right) and a 5-column CSS grid on sm+ screens
 * (Service | Clinic | City | Price | Actions). The `sm:contents` trick on the
 * price/actions wrapper makes its children participate in the parent grid on
 * desktop while still stacking them as a flex column on mobile.
 */
function ResultRow({ item }: { item: SearchResult }) {
  const { t, lang } = useI18n();
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);
  const setSelectedServiceDetail = useAppStore((s) => s.setSelectedServiceDetail);
  const pushRecent = useAppStore((s) => s.pushRecentService);
  const toggleCompare = useAppStore((s) => s.toggleCompare);
  const inCompare = useAppStore((s) => s.inCompare);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const isFavorite = useAppStore((s) => s.isFavorite);

  const favorited = isFavorite(item.service.id);
  const added = inCompare(item.service.id);

  // Compute the same "lowest" insight as ResultCard uses for the Crown badge.
  const isLowest =
    !!item.serviceStats &&
    item.serviceStats.clinicCount >= 2 &&
    item.priceKzt === item.serviceStats.min;

  function openClinic(e?: React.MouseEvent) {
    e?.stopPropagation();
    setSelectedClinic(item.clinic.id);
    pushRecent(item.service.id);
  }

  function openServiceDetail(e?: React.MouseEvent) {
    e?.stopPropagation();
    pushRecent(item.service.id);
    setSelectedServiceDetail(item.service.id);
  }

  function handleCompare(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = toggleCompare(item.service.id);
    if (!ok && !added) {
      toast.error(t("toast.compareFull", { max: MAX_COMPARE }));
      return;
    }
    toast.success(added ? t("toast.compareRemoved") : t("toast.compareAdded"));
  }

  function handleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    toggleFavorite(item.service.id);
  }

  return (
    <div
      role="row"
      className={cn(
        "group flex min-h-[48px] items-center gap-3 rounded-lg border px-3 py-1.5 transition-colors hover:bg-muted/40",
        "sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_120px_140px_120px] sm:items-center sm:gap-3",
        isLowest
          ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
          : "border-border/60 bg-card"
      )}
    >
      {/* Service cell — flex-1 on mobile, col 1 on desktop */}
      <div className="min-w-0 flex-1 sm:min-w-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={openServiceDetail}
            className="truncate text-left text-sm font-bold leading-tight text-foreground underline-offset-2 hover:text-primary hover:underline"
            title={svcName(item.service, lang)}
          >
            {svcName(item.service, lang)}
          </button>
          {isLowest && (
            <Badge className="shrink-0 gap-0.5 bg-primary/15 px-1.5 text-[9px] font-bold uppercase text-primary hover:bg-primary/20">
              <Crown className="h-2.5 w-2.5" />
            </Badge>
          )}
        </div>
        {/* Mobile: clinic · city stacked under the service name */}
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground sm:hidden">
          <button
            onClick={openClinic}
            className="truncate text-left underline-offset-2 hover:text-foreground hover:underline"
            title={item.clinic.name}
          >
            {item.clinic.name}
          </button>
          <span className="text-muted-foreground/40">·</span>
          <span className="flex shrink-0 items-center gap-0.5">
            <MapPin className="h-2.5 w-2.5" />
            {cityName(item.clinic.city, lang)}
          </span>
        </div>
      </div>

      {/* Clinic cell — hidden on mobile, col 2 on desktop */}
      <div className="hidden min-w-0 sm:block">
        <button
          onClick={openClinic}
          className="block w-full truncate text-left text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          title={item.clinic.name}
        >
          {item.clinic.name}
        </button>
      </div>

      {/* City cell — hidden on mobile, col 3 on desktop */}
      <div className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
        <MapPin className="h-3 w-3 shrink-0 text-primary/60" />
        <span className="truncate">{cityName(item.clinic.city, lang)}</span>
      </div>

      {/* Price + Actions wrapper — flex column on mobile, contents on desktop */}
      <div className="flex flex-col items-end gap-1 sm:contents">
        {/* Price (right-aligned) */}
        <div className="text-right">
          <span className="whitespace-nowrap text-[15px] font-extrabold tabular-nums tracking-tight text-foreground">
            {formatKzt(item.priceKzt)}
          </span>
        </div>
        {/* Action icons */}
        <div className="flex items-center justify-end gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-8",
                  favorited
                    ? "text-rose-500 hover:text-rose-600"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={handleFavorite}
                aria-label={favorited ? t("favorites.remove") : t("favorites.add")}
              >
                <Heart className={cn("h-3.5 w-3.5", favorited && "fill-current")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {favorited ? t("favorites.remove") : t("favorites.add")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={added ? "default" : "ghost"}
                size="icon"
                className={cn(
                  "size-8",
                  !added && "text-muted-foreground hover:text-foreground"
                )}
                onClick={handleCompare}
                aria-label={added ? t("result.inCompare") : t("result.addToCompare")}
              >
                <GitCompareArrows className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {added ? t("result.inCompare") : t("result.addToCompare")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-primary hover:text-primary"
                onClick={openServiceDetail}
                aria-label={t("serviceDetail.title")}
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t("serviceDetail.title")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

/**
 * Collapsible analytics panel showing a price-distribution histogram of the
 * currently loaded search results. Computed entirely client-side from the
 * `items` array. Collapsed by default on mobile, expanded on desktop (≥1024px).
 */
function PriceDistributionPanel({
  items,
  total,
}: {
  items: SearchResult[];
  total: number;
}) {
  const { t } = useI18n();
  // Collapsed by default on mobile; expanded on desktop.
  //
  // We use a lazy initializer so the viewport check runs only once on the
  // client. This panel is only rendered once `items.length > 0`, which happens
  // after the search query resolves on the client — so there is no SSR
  // hydration mismatch to worry about (the panel isn't in the server HTML).
  const [open, setOpen] = useState(
    () =>
      typeof window !== "undefined" && window.innerWidth >= 1024
  );

  // 6 fixed price buckets (₸). Items priced at exactly a bucket boundary
  // fall into the higher bucket (left-closed, right-open intervals).
  const buckets = [
    { label: "0–1K", min: 0, max: 1_000 },
    { label: "1K–5K", min: 1_000, max: 5_000 },
    { label: "5K–10K", min: 5_000, max: 10_000 },
    { label: "10K–25K", min: 10_000, max: 25_000 },
    { label: "25K–50K", min: 25_000, max: 50_000 },
    { label: "50K+", min: 50_000, max: Infinity },
  ];

  const counts = buckets.map(
    (b) => items.filter((i) => i.priceKzt >= b.min && i.priceKzt < b.max).length
  );
  const maxCount = Math.max(...counts, 1);
  const minPrice = items.length ? Math.min(...items.map((i) => i.priceKzt)) : 0;
  const bestBucketIdx = buckets.findIndex(
    (b) => minPrice >= b.min && minPrice < b.max
  );

  if (items.length === 0) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mb-4 rounded-xl border border-border/60 bg-card shadow-sm"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
          aria-expanded={open}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold">{t("analytics.priceDistribution")}</h3>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              · {t("analytics.results")}:{" "}
              <span className="font-semibold tabular-nums">{items.length}</span>
            </span>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/60 px-4 py-3">
          {/* "Based on N loaded results" note when not all results loaded yet */}
          {items.length < total && (
            <p className="mb-3 text-xs text-muted-foreground">
              {t("analytics.basedOn", { count: items.length })}
            </p>
          )}
          <div className="space-y-1.5">
            {buckets.map((b, i) => {
              const count = counts[i];
              const widthPct = (count / maxCount) * 100;
              const isBestBucket = i === bestBucketIdx;
              // Always render a tiny sliver for non-empty buckets so the bar is visible.
              const effectiveWidth = count > 0 ? Math.max(widthPct, 3) : 0;
              return (
                <div
                  key={b.label}
                  className="flex items-center gap-2 text-xs"
                  title={`${b.label}: ${count} ${t("analytics.results")}`}
                >
                  <span
                    className={cn(
                      "w-16 shrink-0 text-right tabular-nums",
                      isBestBucket
                        ? "font-bold text-primary"
                        : "text-muted-foreground"
                    )}
                  >
                    {b.label}
                  </span>
                  <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-muted/40">
                    <div
                      className={cn(
                        "h-full rounded-sm transition-all",
                        isBestBucket ? "bg-primary" : "bg-primary/40"
                      )}
                      style={{ width: `${effectiveWidth}%` }}
                    />
                    {isBestBucket && count > 0 && (
                      <span className="absolute inset-y-0 right-1.5 flex items-center">
                        <Crown className="h-3 w-3 text-primary-foreground" />
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "w-8 shrink-0 text-right tabular-nums",
                      count > 0
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground/50"
                    )}
                  >
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
          {bestBucketIdx >= 0 && counts[bestBucketIdx] > 0 && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Crown className="h-2.5 w-2.5 text-primary" />
              {t("analytics.bestPriceBucket")}:
              <span className="font-semibold text-primary">
                {buckets[bestBucketIdx].label}
              </span>
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Price Comparison Summary banner — a horizontal gradient card showing 4
 * key stats (best price, average price, price range, clinics compared)
 * computed from the currently loaded search results. Always visible above
 * the analytics panel whenever there are results. Responsive: 2x2 grid on
 * mobile, 4 columns on desktop, with subtle dividers between cells.
 */
function PriceComparisonSummary({ items }: { items: SearchResult[] }) {
  const { t } = useI18n();
  const currency = useAppStore((s) => s.currency);

  const prices = items.map((i) => i.priceKzt);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  const uniqueClinics = new Set(items.map((i) => i.clinic.id)).size;

  const cells: {
    Icon: typeof Crown;
    label: string;
    value: string;
    iconColor: string;
    cellBorder: string;
  }[] = [
    {
      Icon: Crown,
      label: t("summary.bestPrice"),
      value: formatPrice(minPrice, currency),
      iconColor: "text-emerald-600 dark:text-emerald-400",
      // Cell 1 (top-left on mobile, leftmost on desktop): right divider on
      // both layouts, bottom divider only on mobile.
      cellBorder: "border-r border-b lg:border-b-0 border-border/40",
    },
    {
      Icon: Activity,
      label: t("summary.avgPrice"),
      value: formatPrice(avgPrice, currency),
      iconColor: "text-primary",
      // Cell 2 (top-right on mobile, 2nd on desktop): right divider only on
      // desktop (where it sits between cells 2 and 3); bottom on mobile.
      cellBorder: "lg:border-r border-b lg:border-b-0 border-border/40",
    },
    {
      Icon: ArrowUpDown,
      label: t("summary.priceRange"),
      value: formatPrice(maxPrice - minPrice, currency),
      iconColor: "text-amber-600 dark:text-amber-400",
      // Cell 3 (bottom-left on mobile, 3rd on desktop): right divider on
      // both layouts (sits between cells 3 and 4).
      cellBorder: "border-r border-border/40",
    },
    {
      Icon: Building2,
      label: t("summary.clinicsCompared"),
      value: String(uniqueClinics),
      iconColor: "text-cyan-600 dark:text-cyan-400",
      // Cell 4 (bottom-right on mobile, rightmost on desktop): no borders.
      cellBorder: "",
    },
  ];

  return (
    <div className="mb-4 rounded-xl border border-border/60 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold">{t("summary.title")}</h3>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {cells.map(({ Icon, label, value, iconColor, cellBorder }) => (
          <div
            key={label}
            className={cn(
              "px-3 py-2 first:pl-0 last:pr-0 sm:px-4",
              cellBorder
            )}
          >
            <div
              className={cn(
                "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide",
                iconColor
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {label}
            </div>
            <div className="mt-1 text-xl font-extrabold tabular-nums sm:text-2xl">
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
