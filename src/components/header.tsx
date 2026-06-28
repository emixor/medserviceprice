"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Stethoscope, Search, GitCompareArrows, Map, LineChart, ShieldCheck, Languages, Check, Coins, ShoppingCart, Brain, Activity, Heart, Stethoscope as StethoscopeIcon, Upload, Share2, HeartPulse, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/components/providers";
import { LANGS } from "@/lib/i18n";
import { useAppStore, type Currency, type View } from "@/store/app-store";
import { NotificationBell } from "@/components/notification-bell";
import { AiSearchDialog } from "@/components/ai-search-dialog";
import { cn } from "@/lib/utils";

/** Display symbol + label for each supported currency. */
const CURRENCY_OPTIONS: { code: Currency; symbol: string; label: string }[] = [
  { code: "KZT", symbol: "₸", label: "KZT" },
  { code: "USD", symbol: "$", label: "USD" },
  { code: "RUB", symbol: "₽", label: "RUB" },
];

function symbolFor(c: Currency): string {
  return CURRENCY_OPTIONS.find((o) => o.code === c)?.symbol ?? "₸";
}

const NAV_ITEMS: { view: View; icon: typeof Search; key: string }[] = [
  { view: "search", icon: Search, key: "nav.search" },
  { view: "compare", icon: GitCompareArrows, key: "nav.compare" },
  { view: "basket", icon: ShoppingCart, key: "nav.basket" },
  { view: "map", icon: Map, key: "nav.map" },
  { view: "heatmap", icon: Activity, key: "nav.heatmap" },
  { view: "history", icon: LineChart, key: "nav.history" },
  { view: "admin", icon: ShieldCheck, key: "nav.admin" },
];

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { setTheme } = useTheme();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const compareCount = useAppStore((s) => s.compareServiceIds.length);
  const basketCount = useAppStore((s) => s.basketServiceIds.length);
  const favoritesCount = useAppStore((s) => s.favoriteServiceIds.length);
  const currency = useAppStore((s) => s.currency);
  const setCurrency = useAppStore((s) => s.setCurrency);
  const doctorMode = useAppStore((s) => s.doctorMode);
  const toggleDoctorMode = useAppStore((s) => s.toggleDoctorMode);
  const setSymptomOpen = useAppStore((s) => s.setSymptomOpen);
  const setOcrOpen = useAppStore((s) => s.setOcrOpen);
  const setFavoritesOpen = useAppStore((s) => s.setFavoritesOpen);
  const setShareOpen = useAppStore((s) => s.setShareOpen);
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
        {/* Logo */}
        <button
          onClick={() => setView("search")}
          className="group flex shrink-0 items-center gap-2.5"
          aria-label="MedServicePrice.kz home"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-105">
            <Stethoscope className="h-5 w-5" />
          </span>
          <span className="hidden flex-col items-start leading-none sm:flex">
            <span className="text-[15px] font-bold tracking-tight">
              MedServicePrice<span className="text-primary">.kz</span>
            </span>
            <span className="text-[10px] text-muted-foreground">{t("app.tagline")}</span>
          </span>
        </button>

        {/* Desktop nav */}
        <nav className="mx-auto hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = view === item.view;
            const badge =
              item.view === "compare" ? compareCount :
              item.view === "basket" ? basketCount : 0;
            return (
              <button
                key={item.view}
                onClick={() => setView(item.view)}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {t(item.key)}
                {badge > 0 && (
                  <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                    {badge}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-x-2 -bottom-[1px] h-0.5 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          {/* AI Smart Search — natural-language service finder */}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2.5"
            onClick={() => setAiOpen(true)}
            title={t("ai.tooltip")}
          >
            <Brain className="h-4 w-4 text-primary" />
            <span className="hidden text-xs font-semibold sm:inline">{t("ai.button")}</span>
          </Button>

          {/* Symptom Mapper (Workstream 7) */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden gap-1.5 px-2.5 sm:inline-flex"
            onClick={() => setSymptomOpen(true)}
            title={t("symptom.tooltip")}
          >
            <HeartPulse className="h-4 w-4 text-rose-500" />
            <span className="hidden text-xs font-semibold lg:inline">{t("symptom.button")}</span>
          </Button>

          {/* OCR Upload (Workstream 3) */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden gap-1.5 px-2.5 sm:inline-flex"
            onClick={() => setOcrOpen(true)}
            title={t("ocr.tooltip")}
          >
            <Upload className="h-4 w-4 text-emerald-600" />
            <span className="hidden text-xs font-semibold lg:inline">{t("ocr.button")}</span>
          </Button>

          {/* Favorites & Saved Searches (Workstream 10) */}
          <Button
            variant="ghost"
            size="sm"
            className="relative hidden gap-1.5 px-2.5 sm:inline-flex"
            onClick={() => setFavoritesOpen(true)}
            title={t("favorites.tooltip")}
          >
            <Heart className="h-4 w-4 text-amber-500" />
            {favoritesCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                {favoritesCount}
              </span>
            )}
            <span className="hidden text-xs font-semibold lg:inline">{t("favorites.button")}</span>
          </Button>

          {/* Share current view (Workstream 11) */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden gap-1.5 px-2.5 md:inline-flex"
            onClick={() => setShareOpen(true)}
            title={t("share.tooltip")}
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden text-xs font-semibold xl:inline">{t("share.button")}</span>
          </Button>

          {/* Doctor Mode toggle (Workstream 13) */}
          <Button
            variant={doctorMode ? "default" : "ghost"}
            size="sm"
            className="hidden gap-1.5 px-2.5 md:inline-flex"
            onClick={toggleDoctorMode}
            title={t("doctorMode.tooltip")}
            aria-pressed={doctorMode}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden text-xs font-semibold xl:inline">{t("doctorMode.button")}</span>
          </Button>

          {/* Notification bell — price drop alerts */}
          <NotificationBell />

          {/* Language switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 px-2.5">
                <Languages className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase">{lang}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              {LANGS.map((l) => (
                <DropdownMenuItem
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className="justify-between"
                >
                  <span>
                    <span className="font-medium">{l.native}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{l.label}</span>
                  </span>
                  {lang === l.code && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Currency switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 px-2.5"
                aria-label={t("currency.title")}
                title={t("currency.title")}
              >
                <Coins className="h-4 w-4" />
                <span className="text-xs font-bold tabular-nums">
                  {symbolFor(currency)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("currency.title")}
              </div>
              {CURRENCY_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.code}
                  onClick={() => setCurrency(o.code)}
                  className="justify-between"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-4 text-center text-sm font-bold">{o.symbol}</span>
                    <span className="text-xs font-medium">{o.label}</span>
                  </span>
                  {currency === o.code && <Check className="h-4 w-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Theme toggle — CSS-driven to avoid hydration mismatch */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "light" : "dark")}
            aria-label={t("theme.toggle")}
          >
            <Sun className="hidden h-4 w-4 dark:block" />
            <Moon className="block h-4 w-4 dark:hidden" />
          </Button>
        </div>
      </div>

      {/* AI Smart Search dialog */}
      <AiSearchDialog open={aiOpen} onOpenChange={setAiOpen} />
    </header>
  );
}

/** Fixed mobile bottom navigation bar */
export function MobileBottomNav() {
  const { t } = useI18n();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const compareCount = useAppStore((s) => s.compareServiceIds.length);
  const basketCount = useAppStore((s) => s.basketServiceIds.length);
  const hasAlerts = useAppStore((s) => !!s.userEmail);

  return (
    <nav className="slide-up-nav fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/80 backdrop-blur-lg md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="flex items-center justify-around px-1 pt-1.5 pb-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = view === item.view;
          const badge =
            item.view === "compare" ? compareCount :
            item.view === "basket" ? basketCount : 0;
          return (
            <button
              key={item.view}
              onClick={() => setView(item.view)}
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-medium transition-all duration-200 active:scale-95",
                active
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {badge > 0 && (
                  <span className="absolute -right-2.5 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                    {badge}
                  </span>
                )}
              </span>
              <span className="truncate">{t(item.key)}</span>
              {/* Active pill indicator — emerald dot below active item */}
              {active && (
                <span className="absolute -bottom-0.5 left-1/2 h-1 w-5 -translate-x-1/2 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
