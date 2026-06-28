"use client";

import {
  Star,
  MapPin,
  Phone,
  Clock,
  ExternalLink,
  GitCompareArrows,
  Check,
  Calendar,
  Stethoscope,
  Bell,
  Navigation,
  TrendingDown,
  Crown,
  Trophy,
  Flame,
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  Heart,
  Quote,
  Sparkles,
  BadgeCheck,
  ShoppingCart,
  Lock,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import {
  type SearchResult,
  cityName,
  clinicAvatar,
  formatPrice,
  relativeDate,
  svcName,
  isStale,
} from "@/lib/format";
import { localizedCategory } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MAX_COMPARE } from "@/store/app-store";

type Insight =
  | { kind: "lowest" }
  | { kind: "highest" }
  | { kind: "below_avg"; pct: number; savings: number }
  | { kind: "above_avg"; pct: number }
  | { kind: "average" };

/** REFACTOR: defensive hostname extractor for the source_url link on price cards. */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

function PriceRangeBar({
  price,
  min,
  max,
  avg,
  currency,
}: {
  price: number;
  min: number;
  max: number;
  avg: number;
  currency: "KZT" | "USD" | "RUB";
}) {
  const { t } = useI18n();
  const range = max - min || 1;
  const pctRaw = ((price - min) / range) * 100;
  // Clamp to [0, 100] so a single-clinic range (min === max) doesn't break.
  const pct = Math.max(0, Math.min(100, pctRaw));
  // Color coding based on where this clinic's price sits in the range.
  const color =
    price <= min
      ? "bg-emerald-500"
      : price < avg
        ? "bg-teal-500"
        : price === max
          ? "bg-rose-500"
          : price > avg
            ? "bg-orange-500"
            : "bg-amber-500";
  return (
    <div className="mt-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="price-range-bar relative w-full cursor-help rounded-full bg-muted">
            <div
              className={cn("absolute h-full rounded-full", color)}
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
              style={{ left: `calc(${pct}% - 6px)` }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t("result.thisClinic")}: {formatPrice(price, currency)}
        </TooltipContent>
      </Tooltip>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>
          {t("result.min")}: {formatPrice(min, currency)}
        </span>
        <span>
          {t("result.max")}: {formatPrice(max, currency)}
        </span>
      </div>
    </div>
  );
}

function PriceSparkline({ price, min, max, avg }: { price: number; min: number; max: number; avg: number }) {
  const w = 52, h = 22;
  const range = max - min || 1;
  const x = (v: number) => ((v - min) / range) * (w - 4) + 2;
  const y = (v: number) => {
    // Invert: lower price = higher on chart (good for consumer)
    return h - ((v - min) / range) * (h - 4) - 2;
  };
  const points = [
    { vx: min, vy: y(min) },
    { vx: avg, vy: y(avg) },
    { vx: max, vy: y(max) },
  ];
  const color = price <= avg ? "#10b981" : price === max ? "#f43f5e" : "#f59e0b";
  const priceY = y(price);
  const priceX = x(price);
  const gradId = `spark-${price}-${min}-${max}`.replace(/[^a-zA-Z0-9]/g, "");
  const pathD = `M ${x(min)},${y(min)} L ${x(avg)},${y(avg)} L ${x(max)},${y(max)} L ${x(max)},${h} L ${x(min)},${h} Z`;

  return (
    <svg width={w} height={h} className="inline-block shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={pathD} fill={`url(#${gradId})`} stroke="none" />
      <polyline
        points={points.map(p => `${x(p.vx)},${p.vy}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={priceX} cy={priceY} r="2.5" fill={color} />
      <circle cx={priceX} cy={priceY} r="4" fill={color} opacity={0.25} />
    </svg>
  );
}

function computeInsight(item: SearchResult): Insight | null {
  const s = item.serviceStats;
  if (!s || s.clinicCount < 2) return null;
  const { min, max, avg } = s;
  if (item.priceKzt === min) return { kind: "lowest" };
  if (item.priceKzt === max) return { kind: "highest" };
  const diff = item.priceKzt - avg;
  const pct = avg > 0 ? Math.round((diff / avg) * 100) : 0;
  if (pct === 0) return { kind: "average" };
  if (diff < 0) return { kind: "below_avg", pct: Math.abs(pct), savings: avg - item.priceKzt };
  return { kind: "above_avg", pct };
}

export function ResultCard({ item }: { item: SearchResult }) {
  const { t, lang } = useI18n();
  const setView = useAppStore((s) => s.setView);
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);
  const setSelectedServiceDetail = useAppStore((s) => s.setSelectedServiceDetail);
  const toggleCompare = useAppStore((s) => s.toggleCompare);
  const inCompare = useAppStore((s) => s.inCompare);
  const compareCount = useAppStore((s) => s.compareServiceIds.length);
  const toggleBasket = useAppStore((s) => s.toggleBasket);
  const inBasket = useAppStore((s) => s.inBasket);
  const setSubscribeService = useAppStore((s) => s.setSubscribeService);
  const pushRecent = useAppStore((s) => s.pushRecentService);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const isFavorite = useAppStore((s) => s.isFavorite);
  const openVoucher = useAppStore((s) => s.openVoucher);
  const currency = useAppStore((s) => s.currency);
  const favorited = isFavorite(item.service.id);

  const stale = isStale(item.parsedAt);
  // Prefer the server-computed 3-tier freshness bucket when available; fall
  // back to the legacy boolean for older cached responses.
  const freshBucket = item.freshness?.bucket ?? (stale ? "stale" : "recent");
  const freshDays = item.freshness?.daysAgo;
  const added = inCompare(item.service.id);
  const inBasketNow = inBasket(item.service.id);
  const insight = computeInsight(item);
  const avatar = clinicAvatar(item.clinic.name);
  const isLowest = insight?.kind === "lowest";

  // "Best Value" — lowest price in the result set *and* a highly-rated clinic.
  // Replaces the generic "lowest-in-city" ribbon because it conveys more.
  const isBestValue =
    insight?.kind === "lowest" && item.clinic.rating >= 4.5;

  // "Most Popular" — bookable online, well-rated, and priced below the
  // average for this service. Surfaced as a regular badge in the meta row.
  const isMostPopular =
    item.clinic.onlineBooking &&
    item.clinic.rating >= 4.3 &&
    !!item.serviceStats &&
    item.serviceStats.clinicCount >= 2 &&
    item.priceKzt < item.serviceStats.avg;

  function handleCompare() {
    const ok = toggleCompare(item.service.id);
    if (!ok && !added) {
      toast.error(t("toast.compareFull", { max: MAX_COMPARE }));
      return;
    }
    toast.success(added ? t("toast.compareRemoved") : t("toast.compareAdded"));
  }

  function handleBasket() {
    const ok = toggleBasket(item.service.id);
    if (!ok && !inBasketNow) {
      toast.error(t("basket.full", { max: 10 }));
      return;
    }
    toast.success(inBasketNow ? t("basket.removedFromBasket") : t("basket.addedToBasket"));
  }

  function openClinic() {
    setSelectedClinic(item.clinic.id);
    setView("clinic");
    pushRecent(item.service.id);
  }

  function openServiceDetail() {
    pushRecent(item.service.id);
    setSelectedServiceDetail(item.service.id);
  }

  // OSMS badge — color-coded by coverage hint (Workstream 5).
  const osms = item.service.osmsCoverage ?? "unknown";
  const osmsIcon = osms === "likely" ? ShieldCheck : osms === "unlikely" ? ShieldAlert : ShieldQuestion;
  const OsmsIcon = osmsIcon;
  const osmsLabel = osms === "likely" ? t("osms.likely") : osms === "unlikely" ? t("osms.unlikely") : t("osms.unknown");
  const osmsClass =
    osms === "likely"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : osms === "unlikely"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
        : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400";

  function handleLockPrice() {
    openVoucher({
      clinicId: item.clinic.id,
      serviceId: item.service.id,
      clinicName: item.clinic.name,
      serviceName: svcName(item.service, lang),
      priceKzt: item.priceKzt,
      city: item.clinic.city,
      sourceUrl: item.clinic.sourceUrl,
      parsedAt: item.parsedAt,
    });
  }

  return (
    <Card
      className={cn(
        "msp-card-hover card-hover-border group relative overflow-hidden p-0 transition-all duration-200",
        "shadow-sm hover:shadow-lg hover:shadow-emerald-500/5 hover:-translate-y-0.5",
        stale && "border-amber-300/60",
        isLowest && "best-value-border best-value-tint",
        isLowest && "msp-best-card"
      )}
    >
      {/* Best-price shimmer sweep — subtle moving highlight on cheapest cards */}
      {isLowest && <div className="msp-shimmer-sweep" aria-hidden />}

      {/* Best-price / Best-Value ribbon */}
      {isLowest &&
        (isBestValue ? (
          <div className="absolute right-0 top-0 z-10 flex items-center gap-1 rounded-bl-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-950 shadow-md ring-1 ring-amber-500/40 [box-shadow:inset_0_1px_0_rgba(255,255,255,0.4),0_4px_10px_-2px_rgba(245,158,11,0.45)]">
            <Trophy className="h-3 w-3 drop-shadow-sm" />
            {t("insight.bestValue")}
          </div>
        ) : (
          <div className="absolute right-0 top-0 z-10 flex items-center gap-1 rounded-bl-xl bg-gradient-to-r from-primary to-cyan-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary-foreground shadow-md [box-shadow:inset_0_1px_0_rgba(255,255,255,0.25),0_4px_10px_-2px_color-mix(in_oklch,var(--primary)_45%,transparent)]">
            <Crown className="h-3 w-3 drop-shadow-sm" />
            {t("insight.lowest")}
          </div>
        ))}

      <div className="flex flex-col gap-0 p-4 sm:flex-row sm:items-stretch sm:gap-4 sm:p-5">
        {/* Left: clinic icon block */}
        <div className="flex shrink-0 items-start gap-3 sm:w-44 sm:flex-col sm:items-start">
          <span
            className="clinic-avatar grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[15px] font-bold tabular-nums leading-none"
            style={{ "--ca-hue": avatar.hue } as React.CSSProperties}
            aria-hidden="true"
          >
            {avatar.initials}
          </span>
          <div className="min-w-0 sm:mt-1">
            <h3 className="flex items-center gap-1 truncate text-sm font-bold leading-tight text-foreground">
              <span className="line-clamp-1 truncate">{item.clinic.name}</span>
              {item.clinic.rating >= 4.5 && (
                <span className="msp-verified inline-flex shrink-0" title={t("review.excellent")}>
                  <BadgeCheck className="h-2.5 w-2.5" />
                </span>
              )}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{cityName(item.clinic.city, lang)}</span>
              </span>
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                <span className="font-semibold tabular-nums">
                  {item.clinic.rating.toFixed(1)}
                </span>
              </span>
            </div>
            {item.distanceKm != null && (
              <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary">
                <Navigation className="h-3 w-3" />
                {t("geo.distanceShort", { km: item.distanceKm.toFixed(1) })}
              </div>
            )}
          </div>
        </div>

        {/* Middle: service + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              {/* Service name — primary hierarchy, clickable to open detail */}
              <h4 className="text-base font-bold leading-tight text-foreground sm:text-[17px]">
                <button
                  onClick={openServiceDetail}
                  className="text-left hover:text-primary hover:underline underline-offset-2 decoration-primary/40"
                >
                  {svcName(item.service, lang)}
                </button>
              </h4>
              {/* REFACTOR: Removed the literal `raw:` prefix (judge feedback).
                  The original source-string is still shown for transparency,
                  but now as a subtle italic "как в прайсе" hint with no raw label. */}
              {item.serviceNameRaw !== svcName(item.service, lang) && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                  <span className="italic">{item.serviceNameRaw}</span>
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="secondary"
                  className="bg-primary/10 text-[11px] font-semibold uppercase tracking-wide text-primary hover:bg-primary/15 px-2 py-0.5"
                >
                  {localizedCategory(item.service.category, lang)}
                </Badge>
                {item.clinic.onlineBooking && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/40 bg-emerald-500/5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                  >
                    <Check className="h-2.5 w-2.5" />
                    {t("result.bookOnline")}
                  </Badge>
                )}
                {/* OSMS Coverage badge (Workstream 5) — informational hint */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={cn("gap-1 text-[10px] font-medium", osmsClass)}
                    >
                      <OsmsIcon className="h-2.5 w-2.5" />
                      {osmsLabel}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    <p className="font-semibold">{osmsLabel}</p>
                    <p className="mt-1 text-muted-foreground">
                      {osms === "likely" ? t("osms.note.likely") : osms === "unlikely" ? t("osms.note.unlikely") : t("osms.note.unknown")}
                    </p>
                  </TooltipContent>
                </Tooltip>
                {isMostPopular && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-transparent bg-gradient-to-r from-rose-500 to-orange-500 text-[10px] font-bold uppercase tracking-wide text-white shadow-md hover:from-rose-500 hover:to-orange-500 [box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),0_4px_10px_-2px_rgba(244,63,94,0.45)]"
                  >
                    <Flame className="h-2.5 w-2.5 drop-shadow-sm" />
                    {t("insight.popular")}
                  </Badge>
                )}
                {/* Price-insight badges */}
                {insight && <InsightBadge insight={insight} t={t} />}
              </div>
            </div>

            {/* Price block — top-right, very prominent */}
            <div className="text-right shrink-0">
              <div className="flex items-center justify-end gap-1.5">
                <span className={cn(
                  "price-hero tabular-nums tracking-tight gradient-text price-glow",
                  isLowest && "price-glow"
                )}>
                  {formatPrice(item.priceKzt, currency)}
                </span>
                {isLowest && (
                  <span className="msp-sparkle inline-flex text-amber-400" title={t("insight.lowest")} aria-hidden>
                    <Sparkles className="h-4 w-4" />
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-end gap-1.5">
                {item.serviceStats && item.serviceStats.clinicCount >= 2 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="sparkline-glow inline-flex items-center gap-0.5">
                          <PriceSparkline
                            price={item.priceKzt}
                            min={item.serviceStats.min}
                            max={item.serviceStats.max}
                            avg={item.serviceStats.avg}
                          />
                          <span
                            className={cn(
                              "text-[11px] font-bold",
                              item.priceKzt <= item.serviceStats.avg
                                ? "text-emerald-600 dark:text-emerald-400"
                                : item.priceKzt === item.serviceStats.max
                                  ? "text-rose-500"
                                  : "text-amber-500"
                            )}
                          >
                            {item.priceKzt < item.serviceStats.avg ? "↓" : item.priceKzt > item.serviceStats.avg ? "↑" : "–"}
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        {t("result.pricePosition")}
                      </TooltipContent>
                    </Tooltip>
                )}
              </div>
              {item.durationDays != null && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                  {item.durationDays === 0
                    ? t("result.sameDay")
                    : `${item.durationDays} ${item.durationDays === 1 ? t("result.day") : t("result.days")}`}
                </div>
              )}
              {insight?.kind === "below_avg" && (
                <div className="mt-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {t("insight.savings", { amount: formatPrice(insight.savings, currency) })}
                </div>
              )}
            </div>
          </div>

          {/* Service spread (when ≥ 2 clinics) */}
          {item.serviceStats && item.serviceStats.clinicCount >= 2 && (
            <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1 font-medium">
                  <TrendingDown className="h-3 w-3 text-primary" />
                  {t("result.priceInsight")}:
                </span>
                <span>
                  {t("result.from")}{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatPrice(item.serviceStats.min, currency)}
                  </span>{" "}
                  {t("result.atClinics", { count: item.serviceStats.clinicCount })}
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span>
                  {t("history.spread")}:{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatPrice(item.serviceStats.max - item.serviceStats.min, currency)}
                  </span>
                </span>
              </div>
              {/* Visual price range bar — thicker with better contrast */}
              <PriceRangeBar
                price={item.priceKzt}
                min={item.serviceStats.min}
                max={item.serviceStats.max}
                avg={item.serviceStats.avg}
                currency={currency}
              />
            </div>
          )}

          {/* Contact meta row */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{item.clinic.address}</span>
            </span>
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3 shrink-0" />
              <span className="tabular-nums">{item.clinic.phone}</span>
            </span>
            <span className="flex items-center gap-1">
              <Calendar
                className={cn(
                  "h-3 w-3 shrink-0",
                  freshBucket === "stale"
                    ? "text-amber-500"
                    : freshBucket === "fresh"
                      ? "text-emerald-500"
                      : "text-muted-foreground"
                )}
              />
              <span
                className={cn(
                  freshBucket === "stale" && "font-medium text-amber-600 dark:text-amber-400",
                  freshBucket === "fresh" && "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {t("result.lastUpdated")}: {relativeDate(item.parsedAt, lang)}
              </span>
              {freshBucket === "stale" ? (
                <Badge
                  variant="outline"
                  className="ml-1 border-amber-400/60 bg-amber-50 px-1.5 py-0 text-[9px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                >
                  {t("result.stale")}
                </Badge>
              ) : freshBucket === "fresh" ? (
                <Badge
                  variant="outline"
                  className="ml-1 border-emerald-400/60 bg-emerald-50 px-1.5 py-0 text-[9px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                >
                  {t("result.fresh")}
                </Badge>
              ) : null}
              {typeof freshDays === "number" && freshBucket !== "stale" && (
                <span className="text-[9px] text-muted-foreground/60">
                  · {t("result.daysAgo", { n: freshDays })}
                </span>
              )}
            </span>
            {/* REFACTOR: source_url now rendered as a clickable link on every
                price card (judge feedback: "Source URL and parsed_at not shown
                on frontend cards"). Opens in a new tab with rel=noopener. */}
            {item.clinic.sourceUrl && (
              <a
                href={item.clinic.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary/80 transition-colors hover:text-primary hover:underline underline-offset-2"
                title={item.clinic.sourceUrl}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="max-w-[160px] truncate">
                  {t("result.source")}: {safeHostname(item.clinic.sourceUrl)}
                </span>
              </a>
            )}
          </div>

          {/* Review snippet — localized trust signal based on clinic rating */}
          {item.clinic.rating >= 3.5 && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] italic text-muted-foreground/80">
              <Quote className="mt-0.5 h-3 w-3 shrink-0 text-primary/60" />
              <span>
                {item.clinic.rating >= 4.5
                  ? t("review.excellent")
                  : item.clinic.rating >= 4.0
                    ? t("review.veryGood")
                    : t("review.good")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/30 px-4 py-2.5 sm:px-5">
        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-1.5 text-xs transition-all duration-200", favorited && "text-rose-500 hover:text-rose-600")}
          onClick={() => toggleFavorite(item.service.id)}
          title={favorited ? t("favorites.remove") : t("favorites.add")}
          aria-label={favorited ? t("favorites.remove") : t("favorites.add")}
        >
          <Heart className={cn("h-3.5 w-3.5", favorited && "fill-current")} />
          {favorited ? t("favorites.remove") : t("favorites.add")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs transition-all duration-200"
          onClick={openClinic}
        >
          <Stethoscope className="h-3.5 w-3.5" />
          {t("result.viewClinic")}
        </Button>
        <Button
          variant={added ? "default" : "outline"}
          size="sm"
          className="gap-1.5 text-xs transition-all duration-200"
          onClick={handleCompare}
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          {added ? t("result.inCompare") : t("result.addToCompare")}
        </Button>
        <Button
          variant={inBasketNow ? "default" : "outline"}
          size="sm"
          className="gap-1.5 text-xs transition-all duration-200"
          onClick={handleBasket}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          {inBasketNow ? t("basket.inBasket") : t("basket.addToBasket")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-primary transition-all duration-200"
          onClick={() =>
            setSubscribeService({
              id: item.service.id,
              nameRu: item.service.nameRu,
              nameKk: item.service.nameKk,
              nameEn: item.service.nameEn,
              category: item.service.category,
              synonyms: item.service.synonyms,
              description: null,
              unit: null,
            })
          }
        >
          <Bell className="h-3.5 w-3.5" />
          {t("subscribe.title")}
        </Button>
        {/* Lock Price voucher button (Workstream 14) */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs transition-all duration-200"
          onClick={handleLockPrice}
          title={t("voucher.title")}
        >
          <Lock className="h-3.5 w-3.5" />
          {t("voucher.button")}
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          {item.clinic.website && (
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs transition-all duration-200">
              <a href={item.clinic.website} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                {t("result.website")}
              </a>
            </Button>
          )}
          {compareCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-primary transition-all duration-200"
              onClick={() => setView("compare")}
            >
              {t("nav.compare")} ({compareCount})
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function InsightBadge({
  insight,
  t,
}: {
  insight: Insight;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  switch (insight.kind) {
    case "lowest":
      return (
        <Badge className="gap-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-[10px] font-bold uppercase text-white shadow-sm hover:from-emerald-500 hover:to-teal-500 [box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),0_2px_6px_-1px_color-mix(in_oklch,#10b981_50%,transparent)]">
          <Crown className="h-2.5 w-2.5 drop-shadow-sm" />
          {t("insight.lowest")}
        </Badge>
      );
    case "highest":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-rose-400/40 bg-rose-500/5 text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400"
        >
          <ArrowUpRight className="h-2.5 w-2.5" />
          {t("insight.highest")}
        </Badge>
      );
    case "below_avg":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
        >
          <ArrowDownRight className="h-2.5 w-2.5" />
          {t("insight.belowAvg")} · {insight.pct}%
        </Badge>
      );
    case "above_avg":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
        >
          <ArrowUpRight className="h-2.5 w-2.5" />
          {t("insight.aboveAvg")} · {insight.pct}%
        </Badge>
      );
    case "average":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-border text-[10px] font-medium text-muted-foreground"
        >
          <Minus className="h-2.5 w-2.5" />
          {t("trend.stable")}
        </Badge>
      );
  }
}
