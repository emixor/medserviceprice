"use client";

import { useState } from "react";
import { useAppStore, MAX_FAVORITES } from "@/store/app-store";
import { useI18n } from "@/components/providers";
import { useQuery } from "@tanstack/react-query";
import { fetcher } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Heart, Star, Trash2, BookmarkPlus, Clock, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Favorites & Saved Searches Dialog — Workstream 10.
 *
 * Shows:
 *  - Favorite services (with min-price + clinic-count preview)
 *  - Saved search presets (load / delete)
 *  - Recently viewed services
 *
 * All state is read from the global app store (persisted to localStorage).
 */
type Service = {
  id: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  category: string;
  synonyms: string[];
};

type ServiceStats = {
  serviceId: string;
  clinicCount: number;
  minPrice: number;
  avgPrice: number;
  maxPrice: number;
};

export function FavoritesDialog() {
  const { t, lang } = useI18n();
  const open = useAppStore((s) => s.favoritesOpen);
  const setOpen = useAppStore((s) => s.setFavoritesOpen);
  const favoriteServiceIds = useAppStore((s) => s.favoriteServiceIds);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const recentServiceIds = useAppStore((s) => s.recentServiceIds);
  const clearRecent = useAppStore((s) => s.clearRecent);
  const savedPresets = useAppStore((s) => s.savedPresets);
  const savePreset = useAppStore((s) => s.savePreset);
  const loadPreset = useAppStore((s) => s.loadPreset);
  const deletePreset = useAppStore((s) => s.deletePreset);
  const setView = useAppStore((s) => s.setView);
  const setFilters = useAppStore((s) => s.setFilters);
  const setSelectedServiceDetail = useAppStore((s) => s.setSelectedServiceDetail);
  const [presetName, setPresetName] = useState("");

  // Load all services to find favorite + recent ones by ID
  const { data: servicesData } = useQuery<{ services: Service[] }>({
    queryKey: ["services-all"],
    queryFn: () => fetcher("/api/v1/services?limit=200"),
    staleTime: 5 * 60 * 1000,
  });

  // Load price stats per service — uses the existing /api/v1/insights endpoint
  const { data: insights } = useQuery<{ stats: ServiceStats[] }>({
    queryKey: ["insights"],
    queryFn: () => fetcher("/api/v1/insights"),
    staleTime: 60 * 1000,
  });

  const servicesById = new Map<string, Service>();
  for (const s of servicesData?.services ?? []) servicesById.set(s.id, s);

  const statsByService = new Map<string, ServiceStats>();
  for (const s of insights?.stats ?? []) statsByService.set(s.serviceId, s);

  function nameOf(s: Service): string {
    if (lang === "kk") return s.nameKk || s.nameRu || s.nameEn;
    if (lang === "en") return s.nameEn || s.nameRu || s.nameKk;
    return s.nameRu || s.nameKk || s.nameEn;
  }

  function openService(serviceId: string) {
    setSelectedServiceDetail(serviceId);
    setOpen(false);
  }

  function openFavoriteInSearch(serviceId: string) {
    const svc = servicesById.get(serviceId);
    if (!svc) return;
    setFilters({ q: svc.nameRu, category: svc.category });
    setView("search");
    setOpen(false);
  }

  function handleSavePreset() {
    if (!presetName.trim()) return;
    savePreset(presetName);
    setPresetName("");
    toast.success(t("favorites.presets") + " ✓");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-amber-500" />
            {t("favorites.title")}
          </DialogTitle>
          <DialogDescription>{t("favorites.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Favorite services */}
          <section>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t("favorites.services")} ({favoriteServiceIds.length}/{MAX_FAVORITES})
            </h3>
            {favoriteServiceIds.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                {t("favorites.empty")}
              </p>
            ) : (
              <ul className="space-y-2">
                {favoriteServiceIds.map((id) => {
                  const svc = servicesById.get(id);
                  if (!svc) return null;
                  const stats = statsByService.get(id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                    >
                      <button onClick={() => openService(id)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium">{nameOf(svc)}</p>
                        {stats && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {t("heatmap.minPrice")}: {new Intl.NumberFormat("ru-RU").format(stats.minPrice)} ₸
                            {" · "}
                            {t("heatmap.samples", { count: stats.clinicCount })}
                          </p>
                        )}
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openFavoriteInSearch(id)}
                        className="text-xs"
                      >
                        {t("favorites.load")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-rose-500 hover:text-rose-600"
                        onClick={() => {
                          toggleFavorite(id);
                          toast.success(t("favorites.removed"));
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Saved searches */}
          <section>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t("favorites.presets")} ({savedPresets.length})
            </h3>
            <div className="mb-3 flex gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t("favorites.presetName")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSavePreset();
                }}
              />
              <Button onClick={handleSavePreset} disabled={!presetName.trim()} className="gap-2 shrink-0">
                <BookmarkPlus className="h-4 w-4" />
                {t("favorites.savePreset")}
              </Button>
            </div>
            {savedPresets.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                {t("favorites.presetsEmpty")}
              </p>
            ) : (
              <ul className="space-y-2">
                {savedPresets.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.filters.city && <Badge variant="secondary" className="text-[10px]">{p.filters.city}</Badge>}
                        {p.filters.category && <Badge variant="secondary" className="text-[10px]">{p.filters.category}</Badge>}
                        {p.filters.priceMin && <Badge variant="outline" className="text-[10px]">≥ {p.filters.priceMin} ₸</Badge>}
                        {p.filters.priceMax && <Badge variant="outline" className="text-[10px]">≤ {p.filters.priceMax} ₸</Badge>}
                        {p.filters.ratingMin && <Badge variant="outline" className="text-[10px]">★ ≥ {p.filters.ratingMin}</Badge>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        loadPreset(p.id);
                        setView("search");
                        setOpen(false);
                      }}
                      className="text-xs"
                    >
                      {t("favorites.load")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-rose-500 hover:text-rose-600"
                      onClick={() => deletePreset(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recently viewed */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {t("favorites.recent")} ({recentServiceIds.length})
              </h3>
              {recentServiceIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearRecent} className="text-xs">
                  {t("favorites.clearRecent")}
                </Button>
              )}
            </div>
            {recentServiceIds.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                {t("favorites.recentEmpty")}
              </p>
            ) : (
              <ul className="space-y-2">
                {recentServiceIds.map((id) => {
                  const svc = servicesById.get(id);
                  if (!svc) return null;
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                    >
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <button onClick={() => openService(id)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium">{nameOf(svc)}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
