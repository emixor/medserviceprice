"use client";

import { Stethoscope, Search, GitCompareArrows, Map, LineChart as LineChartIcon, Mail, Phone, RefreshCw, Heart } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useAppStore, type View } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { fetcher } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function Footer() {
  const { t } = useI18n();
  const setView = useAppStore((s) => s.setView);

  const { data: stats } = useQuery({
    queryKey: ["footer-stats"],
    queryFn: () =>
      fetcher<{
        raw: number;
        normalized: number;
        clinics: number;
        services: number;
      }>("/api/v1/stats"),
    staleTime: 60_000,
  });

  const quickLinks: { label: string; view: View; icon: React.ReactNode }[] = [
    { label: t("nav.search"), view: "search", icon: <Search className="h-3 w-3" /> },
    { label: t("nav.compare"), view: "compare", icon: <GitCompareArrows className="h-3 w-3" /> },
    { label: t("nav.map"), view: "map", icon: <Map className="h-3 w-3" /> },
    { label: t("nav.history"), view: "history", icon: <LineChartIcon className="h-3 w-3" /> },
  ];

  return (
    <footer className="relative mt-auto overflow-hidden border-t border-border/70 bg-muted/30">
      {/* Premium top gradient divider — emerald to teal to cyan sweep */}
      <div className="h-1 w-full bg-gradient-to-r from-emerald-500/0 via-teal-500/60 to-cyan-500/0" />

      {/* Faint radial accent glow for premium depth */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(900px 280px at 12% 0%, color-mix(in oklch, var(--primary) 8%, transparent), transparent 70%), radial-gradient(700px 240px at 92% 100%, color-mix(in oklch, var(--chart-2) 6%, transparent), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-8 md:grid-cols-4">
          {/* Brand + about */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-cyan-600 text-primary-foreground shadow-sm [box-shadow:0_2px_6px_-1px_color-mix(in_oklch,var(--primary)_45%,transparent)]">
                <Stethoscope className="h-4 w-4" />
              </span>
              <span className="text-sm font-bold tracking-tight">
                MedServicePrice<span className="gradient-text">.kz</span>
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("footer.about")}</p>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("footer.quickLinks")}
            </h4>
            <nav className="flex flex-col gap-1">
              {quickLinks.map((link) => (
                <button
                  key={link.view}
                  onClick={() => setView(link.view)}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-all duration-200 hover:translate-x-0.5 hover:bg-accent hover:text-primary"
                >
                  <span className="text-muted-foreground/70 transition-colors group-hover:text-primary">
                    {link.icon}
                  </span>
                  {link.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Data layer counters */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("footer.data")}
              </h4>
              <Badge
                variant="outline"
                className="gap-1.5 border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0 text-[9px] font-medium text-emerald-700 dark:text-emerald-400"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <RefreshCw className="h-2.5 w-2.5" />
                {t("footer.updatedDaily")}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-border/60 bg-card/80 p-2.5 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md">
                <div className="text-[10px] uppercase text-muted-foreground">{t("stats.clinics")}</div>
                <div className="mt-0.5 text-base font-bold tabular-nums">{stats?.clinics ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/80 p-2.5 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md">
                <div className="text-[10px] uppercase text-muted-foreground">{t("stats.services")}</div>
                <div className="mt-0.5 text-base font-bold tabular-nums">{stats?.services ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/80 p-2.5 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md">
                <div className="text-[10px] uppercase text-muted-foreground">{t("footer.raw")}</div>
                <div className="mt-0.5 text-base font-bold tabular-nums">{stats?.raw ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/80 p-2.5 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md">
                <div className="text-[10px] uppercase text-muted-foreground">{t("footer.normalized")}</div>
                <div className="mt-0.5 text-base font-bold tabular-nums">{stats?.normalized ?? "—"}</div>
              </div>
            </div>
          </div>

          {/* Contact + Disclaimer */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("footer.contact")}
            </h4>
            <div className="space-y-2 text-xs text-muted-foreground">
              <a
                href="mailto:info@medserviceprice.kz"
                className="group flex items-center gap-2 transition-all duration-200 hover:translate-x-0.5 hover:text-primary"
              >
                <Mail className="h-3.5 w-3.5 shrink-0 text-primary/70 transition-colors group-hover:text-primary" />
                <span>info@medserviceprice.kz</span>
              </a>
              <a
                href="tel:+77270000000"
                className="group flex items-center gap-2 transition-all duration-200 hover:translate-x-0.5 hover:text-primary"
              >
                <Phone className="h-3.5 w-3.5 shrink-0 text-primary/70 transition-colors group-hover:text-primary" />
                <span>+7 (727) 000-00-00</span>
              </a>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">{t("footer.disclaimer")}</p>
          </div>
        </div>

        {/* Subtle gradient divider above the copyright row */}
        <div className="section-divider my-5" />

        <div className="flex flex-col items-center justify-between gap-2 text-[11px] text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} MedServicePrice.kz — Aviasales for medicine</span>
          <span className="flex items-center gap-1.5">
            <span>
              Architecture: <span className="font-medium text-foreground">Raw → Normalize → Compare</span>
            </span>
            <span className="mx-1 text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1 text-muted-foreground/80">
              Made with
              <Heart className="h-3 w-3 fill-rose-500 text-rose-500" />
              in Kazakhstan
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}
