"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useI18n } from "@/components/providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "@/lib/format";
import { Header, MobileBottomNav } from "@/components/header";
import { Footer } from "@/components/footer";
import { SearchView } from "@/components/search-view";
import { CompareView } from "@/components/compare-view";
import { BasketView } from "@/components/basket-view";
import { MapView } from "@/components/map-view";
import { HistoryView } from "@/components/history-view";
import { AdminView } from "@/components/admin-view";
import { HeatmapView } from "@/components/heatmap-view";
import { ClinicProfileView } from "@/components/clinic-profile-view";
import { ClinicDetailDialog } from "@/components/clinic-detail-dialog";
import { ServiceDetailDialog } from "@/components/service-detail-dialog";
import { SubscribeDialog } from "@/components/subscribe-dialog";
import { CommandPalette } from "@/components/command-palette";
import { OnboardingTour } from "@/components/onboarding-tour";
import { VoucherDialog } from "@/components/voucher-dialog";
import { SymptomDialog } from "@/components/symptom-dialog";
import { OcrDialog } from "@/components/ocr-dialog";
import { FavoritesDialog } from "@/components/favorites-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { Button } from "@/components/ui/button";
import { Database, Loader2, Stethoscope } from "lucide-react";
import { toast } from "sonner";

export default function Home() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const setFilters = useAppStore((s) => s.setFilters);
  const setCompareServiceIds = useAppStore((s) => s.setCompareServiceIds);
  const setBasketServiceIds = useAppStore((s) => s.setBasketServiceIds);
  const { t } = useI18n();
  const qc = useQueryClient();
  const setSelectedClinic = useAppStore((s) => s.setSelectedClinic);
  const setSelectedServiceDetail = useAppStore((s) => s.setSelectedServiceDetail);
  const setSubscribeService = useAppStore((s) => s.setSubscribeService);

  // --- Shareable link state-sync (Workstream 11) ---
  // On mount: read URL params (?v=, ?cmp=, ?bsk=, ?q=, ?city=, ?cat=, ...) and
  // restore the corresponding view state. Invalid params are ignored — the page
  // never crashes on a malformed share link.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("v") as "search" | "compare" | "basket" | "map" | "heatmap" | "history" | "admin" | "clinic" | null;
    if (v && ["search", "compare", "basket", "map", "heatmap", "history", "admin", "clinic"].includes(v)) {
      setView(v);
    }
    const cmp = sp.get("cmp");
    if (cmp) {
      const ids = cmp.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
      if (ids.length > 0) setCompareServiceIds(ids);
    }
    const bsk = sp.get("bsk");
    if (bsk) {
      const ids = bsk.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
      if (ids.length > 0) setBasketServiceIds(ids);
    }
    // Restore search filters (only set those that are present — don't blow away persisted state)
    const filterUpdate: Partial<Record<string, unknown>> = {};
    const q = sp.get("q"); if (q) filterUpdate.q = q;
    const city = sp.get("city"); if (city) filterUpdate.city = city;
    const cat = sp.get("cat"); if (cat) filterUpdate.category = cat;
    const pmin = sp.get("pmin"); if (pmin) filterUpdate.priceMin = pmin;
    const pmax = sp.get("pmax"); if (pmax) filterUpdate.priceMax = pmax;
    const rmin = sp.get("rmin"); if (rmin) filterUpdate.ratingMin = rmin;
    const ob = sp.get("ob"); if (ob === "1") filterUpdate.onlineBooking = true;
    const xs = sp.get("xs"); if (xs === "1") filterUpdate.excludeStale = true;
    const sort = sp.get("sort"); if (sort) filterUpdate.sort = sort;
    if (Object.keys(filterUpdate).length > 0) setFilters(filterUpdate);
    // Clear the URL after applying so subsequent navigations don't re-trigger
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Command palette open state — kept here so the global keydown handler can
  // toggle it via Cmd/Ctrl+K. A ref mirrors the value so the Escape handler
  // can decide whether to close the palette (topmost) vs. close any open
  // dialog underneath it.
  const [cmdOpen, setCmdOpen] = useState(false);
  const cmdOpenRef = useRef(false);
  useEffect(() => {
    cmdOpenRef.current = cmdOpen;
  }, [cmdOpen]);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd+K / Ctrl+K → toggle command palette
      if (mod && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }

      // Escape → close palette first (it's on top); otherwise close any open dialog
      if (e.key === "Escape") {
        if (cmdOpenRef.current) {
          // Radix Dialog handles closing the palette; just bail out so we
          // don't also dismiss any underlying dialog.
          return;
        }
        setSelectedClinic(null);
        setSelectedServiceDetail(null);
        setSubscribeService(null);
        return;
      }

      // Cmd+/ / Ctrl+/ → show shortcuts help toast
      if (mod && e.key === "/") {
        e.preventDefault();
        toast.info(
          `${t("shortcuts.title")}\n\n⌘K — ${t(
            "commandPalette.title"
          )}\nEsc — ${t("shortcuts.close")}\n⌘/ — ${t("shortcuts.help")}`,
          { duration: 5000 }
        );
        return;
      }
    },
    [setSelectedClinic, setSelectedServiceDetail, setSubscribeService, t]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Check whether DB is seeded; if not, show a one-time initialize banner.
  const { data: stats, isLoading: statsLoading } = useQuery<{
    clinics: number;
    services: number;
    normalized: number;
  }>({ queryKey: ["stats"], queryFn: () => fetcher("/api/v1/stats"), staleTime: 30_000 });

  const [seeding, setSeeding] = useState(false);
  const needSeed = !statsLoading && (stats?.services ?? 0) === 0;

  async function initialize() {
    setSeeding(true);
    try {
      const res = await fetch("/api/v1/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runIngestion: true }),
      });
      if (!res.ok) throw new Error(`seed failed ${res.status}`);
      const data = await res.json();
      toast.success(t("toast.seeded"));
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      console.log("[seed] done", data.counts);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 pb-16 md:pb-0">
        {needSeed ? (
          <div className="mx-auto max-w-2xl px-4 py-20 text-center">
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Stethoscope className="h-8 w-8" />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight">MedServicePrice<span className="text-primary">.kz</span></h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{t("seed.notice")}</p>
            <Button size="lg" className="mt-6 gap-2" onClick={initialize} disabled={seeding}>
              {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              {seeding ? t("seed.seeding") : t("seed.button")}
            </Button>
          </div>
        ) : (
          <>
            {view === "search" && <SearchView />}
            {view === "compare" && <CompareView />}
            {view === "basket" && <BasketView />}
            {view === "map" && <MapView />}
            {view === "heatmap" && <HeatmapView />}
            {view === "clinic" && <ClinicProfileView />}
            {view === "history" && <HistoryView />}
            {view === "admin" && <AdminView />}
          </>
        )}
      </main>
      <Footer />
      <MobileBottomNav />
      <ClinicDetailDialog />
      <ServiceDetailDialog />
      <SubscribeDialogInline />
      <VoucherDialog />
      <SymptomDialog />
      <OcrDialog />
      <FavoritesDialog />
      <ShareDialog />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <OnboardingTour />
    </div>
  );
}

/** Subscribe dialog bound to the global store's subscribeService. */
function SubscribeDialogInline() {
  const subscribeService = useAppStore((s) => s.subscribeService);
  const setSubscribeService = useAppStore((s) => s.setSubscribeService);
  return (
    <SubscribeDialog
      service={subscribeService}
      open={!!subscribeService}
      onOpenChange={(o) => !o && setSubscribeService(null)}
    />
  );
}
