"use client";

/**
 * ClinicProfileView — full clinic profile page (Workstream 12, Task 6d).
 *
 * Replaces the prior stub. Fetches the full clinic profile from
 * `/api/v1/clinics/[id]` via react-query and renders:
 *
 *   1. Header card — clinic name, city, rating, online-booking badge, contact
 *      info (address / phone / working hours / website), source URL, "View on
 *      Map" button.
 *   2. Badges row — "Best Price" / "Fair Price" badges (computed server-side).
 *   3. Stats summary card — totalServices, min/avg/max price, freshness
 *      breakdown (fresh <7d, recent 7–30d, stale >30d).
 *   4. Top 10 cheapest services table — localized service name, price
 *      (formatPrice), category badge, OSMS badge (emerald/rose/sky by
 *      coverage), parsedAt relative date.
 *   5. Price history mini-chart — Recharts AreaChart with avg/min/max over
 *      the last 30 days. Empty state when no history.
 *
 * States handled: loading skeleton, error with retry button, empty state
 * (no active prices), not-found state (no selectedClinicId). Fully
 * responsive (1 col mobile, 2 col desktop for stats+chart). Never crashes on
 * sparse data.
 */
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { fetcher, formatPrice, relativeDate } from "@/lib/format";
import {
  localizedCategory,
  localizedCity,
  localizedServiceName,
  type Lang,
} from "@/lib/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Clock,
  Globe,
  Star,
  Check,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Trophy,
  Scale,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ExternalLink,
  Activity,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ------------------------------ API types ------------------------------ */

type Clinic = {
  id: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  workingHours: string;
  sourceUrl: string;
  website: string | null;
  rating: number;
  onlineBooking: boolean;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
};

type Stats = {
  totalServices: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  freshCount: number;
  recentCount: number;
  staleCount: number;
};

type TopCheapestItem = {
  serviceId: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  category: string;
  priceKzt: number;
  durationDays: number;
  parsedAt: string;
  osmsCoverage: "likely" | "unlikely" | "unknown";
};

type PriceHistoryPoint = {
  date: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  count: number;
};

type ClinicProfileResponse = {
  clinic: Clinic;
  stats: Stats;
  topCheapest: TopCheapestItem[];
  priceHistory: PriceHistoryPoint[];
  badges: string[];
  elapsedMs: number;
};

/* ------------------------------ constants ------------------------------ */

const RETRY_LABEL: Record<Lang, string> = {
  en: "Retry",
  ru: "Повторить",
  kk: "Қайталау",
};

const FRESH_LABEL: Record<Lang, string> = {
  en: "Fresh (<7d)",
  ru: "Свежие (<7д)",
  kk: "Жаңа (<7к)",
};

const RECENT_LABEL: Record<Lang, string> = {
  en: "Recent (7–30d)",
  ru: "Недавние (7–30д)",
  kk: "Жуырдағы (7–30к)",
};

const STALE_LABEL: Record<Lang, string> = {
  en: "Stale (>30d)",
  ru: "Устаревшие (>30д)",
  kk: "Ескірген (>30к)",
};

const PRICE_HISTORY_EMPTY: Record<Lang, string> = {
  en: "No price history available for the last 30 days.",
  ru: "Нет истории цен за последние 30 дней.",
  kk: "Соңғы 30 күнде баға тарихы жоқ.",
};

const TOTAL_LABEL: Record<Lang, string> = {
  en: "Services",
  ru: "Услуги",
  kk: "Қызметтер",
};

const MAX_LABEL: Record<Lang, string> = {
  en: "Max",
  ru: "Макс.",
  kk: "Макс.",
};

const SOURCE_LABEL: Record<Lang, string> = {
  en: "Source",
  ru: "Источник",
  kk: "Дереккөз",
};

const UPDATED_LABEL: Record<Lang, string> = {
  en: "Updated",
  ru: "Обновлено",
  kk: "Жаңартылған",
};

const CATEGORY_LABEL: Record<Lang, string> = {
  en: "Category",
  ru: "Категория",
  kk: "Санат",
};

const PRICE_LABEL: Record<Lang, string> = {
  en: "Price",
  ru: "Цена",
  kk: "Баға",
};

const COLOR_AVG = "var(--chart-1, #2563eb)";
const COLOR_MIN = "var(--chart-2, #10b981)";
const COLOR_MAX = "var(--chart-3, #f43f5e)";

/* ------------------------------ helpers ------------------------------ */

type Currency = "KZT" | "USD" | "RUB";

function safeHostname(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/* ------------------------------ tooltip ------------------------------ */

type PriceTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: PriceHistoryPoint }>;
  currency: Currency;
  t: (k: string, vars?: Record<string, string | number>) => string;
};

function PriceHistoryTooltip({ active, payload, currency, t }: PriceTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-semibold text-foreground">{p.date}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">{t("clinicProfile.avgPrice")}</span>
        <span className="text-right font-medium text-foreground">
          {formatPrice(p.avgPrice, currency)}
        </span>
        <span className="text-muted-foreground">{t("clinicProfile.minPrice")}</span>
        <span className="text-right font-medium" style={{ color: COLOR_MIN }}>
          {formatPrice(p.minPrice, currency)}
        </span>
        <span className="text-muted-foreground">{MAX_LABEL[lang]}</span>
        <span className="text-right font-medium" style={{ color: COLOR_MAX }}>
          {formatPrice(p.maxPrice, currency)}
        </span>
        <span className="text-muted-foreground">N</span>
        <span className="text-right font-medium text-foreground">{p.count}</span>
      </div>
    </div>
  );
}

/* ------------------------------ skeleton ------------------------------ */

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-32" />
      <Card>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------ main component ------------------------------ */

export function ClinicProfileView() {
  const { t, lang } = useI18n();
  const selectedClinicId = useAppStore((s) => s.selectedClinicId);
  const setView = useAppStore((s) => s.setView);
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);
  const currency = useAppStore((s) => s.currency);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ClinicProfileResponse>({
    queryKey: ["clinic-profile", selectedClinicId],
    queryFn: () => fetcher<ClinicProfileResponse>(`/api/v1/clinics/${selectedClinicId}`),
    enabled: !!selectedClinicId,
    staleTime: 60_000,
  });

  /* ---------- not-found state: no clinic selected ---------- */
  if (!selectedClinicId) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <p className="text-sm text-muted-foreground">{t("clinicProfile.notFound")}</p>
        <Button variant="outline" className="mt-4" onClick={() => setView("search")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("clinicProfile.back")}
        </Button>
      </section>
    );
  }

  /* ---------- loading state ---------- */
  if (isLoading) {
    return (
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <ProfileSkeleton />
      </section>
    );
  }

  /* ---------- error state ---------- */
  if (isError || !data) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("clinicProfile.notFound")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {RETRY_LABEL[lang]}
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  const { clinic, stats, topCheapest, priceHistory, badges } = data;
  const hasPrices = stats.totalServices > 0;

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Back */}
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 gap-1.5"
        onClick={() => {
          setSelectedClinic(null);
          setView("search");
        }}
      >
        <ArrowLeft className="h-4 w-4" />
        {t("clinicProfile.back")}
      </Button>

      {/* Header card */}
      <Card>
        <CardContent className="gap-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {clinic.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {localizedCity(clinic.city, lang)}
                </span>
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="font-semibold tabular-nums">
                    {clinic.rating.toFixed(1)}
                  </span>
                </span>
                {clinic.onlineBooking && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                  >
                    <Check className="h-3 w-3" />
                    {t("clinicProfile.onlineBooking")}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => setView("map")}>
                <MapPin className="mr-2 h-4 w-4" />
                {t("clinicProfile.viewOnMap")}
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("clinicProfile.address")}
              </p>
              <p className="mt-1 text-sm">{clinic.address}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("clinicProfile.phone")}
              </p>
              <p className="mt-1 text-sm tabular-nums">{clinic.phone}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("clinicProfile.workingHours")}
              </p>
              <p className="mt-1 text-sm">{clinic.workingHours}</p>
            </div>
            {clinic.website && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("clinicProfile.website")}
                </p>
                <a
                  href={clinic.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Globe className="h-4 w-4" />
                  {safeHostname(clinic.website)}
                </a>
              </div>
            )}
            {clinic.sourceUrl && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {SOURCE_LABEL[lang]}
                </p>
                <a
                  href={clinic.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  {safeHostname(clinic.sourceUrl)}
                </a>
              </div>
            )}
            {clinic.description && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 lg:col-span-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("clinicProfile.title")}
                </p>
                <p className="mt-1 text-sm">{clinic.description}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Badges row */}
      {badges.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("clinicProfile.badges")}:
          </span>
          {badges.includes("best_price") && (
            <Badge className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <Trophy className="h-3 w-3" />
              {t("clinicProfile.bestPrice")}
            </Badge>
          )}
          {badges.includes("fair_price") && (
            <Badge className="gap-1 border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400">
              <Scale className="h-3 w-3" />
              {t("clinicProfile.fairPrice")}
            </Badge>
          )}
        </div>
      )}

      {/* Stats summary + Price history (2-col on desktop) */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Stats summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              {t("clinicProfile.services")}
            </CardTitle>
            <CardDescription>{t("clinicProfile.sourceFreshness")}</CardDescription>
          </CardHeader>
          <CardContent>
            {!hasPrices ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("clinicProfile.noPrices")}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {TOTAL_LABEL[lang]}
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {stats.totalServices}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("clinicProfile.minPrice")}
                    </p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatPrice(stats.minPrice, currency)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("clinicProfile.avgPrice")}
                    </p>
                    <p className="mt-1 text-sm font-bold tabular-nums">
                      {formatPrice(stats.avgPrice, currency)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {MAX_LABEL[lang]}
                    </p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {formatPrice(stats.maxPrice, currency)}
                    </p>
                  </div>
                </div>

                {/* Freshness breakdown */}
                <div className="mt-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("clinicProfile.sourceFreshness")}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-center">
                      <p className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {stats.freshCount}
                      </p>
                      <p className="text-[10px] font-medium text-muted-foreground">
                        {FRESH_LABEL[lang]}
                      </p>
                    </div>
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-center">
                      <p className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">
                        {stats.recentCount}
                      </p>
                      <p className="text-[10px] font-medium text-muted-foreground">
                        {RECENT_LABEL[lang]}
                      </p>
                    </div>
                    <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-center">
                      <p className="text-lg font-bold tabular-nums text-rose-700 dark:text-rose-400">
                        {stats.staleCount}
                      </p>
                      <p className="text-[10px] font-medium text-muted-foreground">
                        {STALE_LABEL[lang]}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Price history chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t("clinicProfile.priceHistory")}
            </CardTitle>
            <CardDescription>
              {priceHistory.length > 0
                ? t("clinicProfile.priceHistory") + ` · ${priceHistory.length}d`
                : PRICE_HISTORY_EMPTY[lang]}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {priceHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {PRICE_HISTORY_EMPTY[lang]}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    <span
                      className="h-2.5 w-3 rounded-sm"
                      style={{ background: COLOR_AVG }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-muted-foreground">
                      {t("clinicProfile.avgPrice")}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="h-2.5 w-3 rounded-sm"
                      style={{ background: COLOR_MIN }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-muted-foreground">
                      {t("clinicProfile.minPrice")}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="h-2.5 w-3 rounded-sm"
                      style={{ background: COLOR_MAX }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-muted-foreground">{MAX_LABEL[lang]}</span>
                  </span>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={priceHistory}
                      margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="gradAvg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLOR_AVG} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={COLOR_AVG} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: "var(--muted-foreground, #6b7280)" }}
                        tickFormatter={(v: string) => {
                          // Show MM-DD only
                          const parts = v.split("-");
                          return parts.length === 3 ? `${parts[1]}-${parts[2]}` : v;
                        }}
                        minTickGap={24}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        width={56}
                        tick={{ fontSize: 10, fill: "var(--muted-foreground, #6b7280)" }}
                        tickFormatter={(v: number) => {
                          if (v >= 1000) return `${Math.round(v / 1000)}k`;
                          return String(v);
                        }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        content={<PriceHistoryTooltip currency={currency} t={t} />}
                      />
                      <Area
                        type="monotone"
                        dataKey="maxPrice"
                        stroke={COLOR_MAX}
                        strokeWidth={1.5}
                        fill="transparent"
                        dot={false}
                        name="Max"
                      />
                      <Area
                        type="monotone"
                        dataKey="minPrice"
                        stroke={COLOR_MIN}
                        strokeWidth={1.5}
                        fill="transparent"
                        dot={false}
                        name="Min"
                      />
                      <Area
                        type="monotone"
                        dataKey="avgPrice"
                        stroke={COLOR_AVG}
                        strokeWidth={2}
                        fill="url(#gradAvg)"
                        dot={false}
                        name="Avg"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top 10 cheapest services table */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-amber-500" />
            {t("clinicProfile.cheapestServices")}
          </CardTitle>
          <CardDescription>
            {hasPrices
              ? t("clinicProfile.totalServices", { count: stats.totalServices })
              : t("clinicProfile.noPrices")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topCheapest.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("clinicProfile.noPrices")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">
                      {t("clinicProfile.services")}
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      {CATEGORY_LABEL[lang]}
                    </TableHead>
                    <TableHead className="hidden md:table-cell">OSMS</TableHead>
                    <TableHead className="text-right">{PRICE_LABEL[lang]}</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">
                      {UPDATED_LABEL[lang]}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCheapest.map((item) => {
                    const osms = item.osmsCoverage;
                    const OsmsIcon =
                      osms === "likely"
                        ? ShieldCheck
                        : osms === "unlikely"
                          ? ShieldAlert
                          : ShieldQuestion;
                    const osmsLabel =
                      osms === "likely"
                        ? t("osms.likely")
                        : osms === "unlikely"
                          ? t("osms.unlikely")
                          : t("osms.unknown");
                    const osmsClass =
                      osms === "likely"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : osms === "unlikely"
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                          : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400";
                    return (
                      <TableRow key={item.serviceId}>
                        <TableCell className="font-medium">
                          {localizedServiceName(
                            {
                              nameRu: item.nameRu,
                              nameKk: item.nameKk,
                              nameEn: item.nameEn,
                            },
                            lang
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="outline" className="text-[11px]">
                            {localizedCategory(item.category, lang)}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge
                            variant="outline"
                            className={`gap-1 text-[11px] ${osmsClass}`}
                            title={osmsLabel}
                          >
                            <OsmsIcon className="h-3 w-3" />
                            {osmsLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums">
                          {formatPrice(item.priceKzt, currency)}
                        </TableCell>
                        <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                          {relativeDate(item.parsedAt, lang)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
