"use client";

import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { fetcher } from "@/lib/format";
import { CITY_LABELS, localizedCategory, type Lang } from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Star, Filter as FilterIcon, RotateCcw, Navigation, Loader2, X, Save, Trash2, FolderHeart, Clock, Archive } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const CATEGORIES = ["laboratory", "doctor_appointment", "diagnostics", "procedure"];

export function FilterSidebar() {
  const { t, lang } = useI18n();
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const resetFilters = useAppStore((s) => s.resetFilters);
  const geo = useAppStore((s) => s.geo);
  const setGeo = useAppStore((s) => s.setGeo);
  const savedPresets = useAppStore((s) => s.savedPresets);
  const savePreset = useAppStore((s) => s.savePreset);
  const loadPreset = useAppStore((s) => s.loadPreset);
  const deletePreset = useAppStore((s) => s.deletePreset);

  const [locating, setLocating] = useState(false);

  const { data: statsData } = useQuery<{ cities: string[] }>({
    queryKey: ["stats-cities"],
    queryFn: () => fetcher("/api/v1/stats"),
    staleTime: 60_000,
  });

  // Sorted city list (RU labels as stored, displayed via localizedCity)
  const cities = useMemo(() => {
    const set = new Set<string>(statsData?.cities ?? []);
    // Ensure known KZ cities always appear even if DB lacks one
    Object.keys(CITY_LABELS.ru).forEach((c) => set.add(c));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [statsData]);

  const priceRange: [number, number] = [
    filters.priceMin ? Number(filters.priceMin) : 0,
    filters.priceMax ? Number(filters.priceMax) : 70000,
  ];

  const [range, setRange] = useState<[number, number]>(priceRange);

  function applyRange(v: [number, number]) {
    setRange(v);
    setFilters({ priceMin: v[0] > 0 ? String(v[0]) : "", priceMax: v[1] < 70000 ? String(v[1]) : "" });
  }

  function findNearMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error(t("geo.unsupported"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFilters({ sort: "distance_asc" });
        setLocating(false);
        toast.success(t("sort.distance_asc"));
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          toast.error(t("geo.denied"));
        } else {
          toast.error(t("geo.unsupported"));
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }

  function clearGeo() {
    setGeo(null);
    if (filters.sort === "distance_asc") {
      setFilters({ sort: "price_asc" });
    }
  }

  function handleSavePreset() {
    // Use a simple browser prompt for the preset name (per spec, no custom dialog).
    const name = window.prompt(t("filters.presetName"));
    if (!name || !name.trim()) return;
    savePreset(name);
    toast.success(t("filters.savePreset"));
  }

  function handleLoadPreset(id: string) {
    loadPreset(id);
    toast.success(t("filters.load"));
  }

  function handleDeletePreset(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    deletePreset(id);
  }

  return (
    <aside className="sticky top-20 h-fit w-full space-y-5 rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FilterIcon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">{t("filters.title")}</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={resetFilters}
        >
          <RotateCcw className="h-3 w-3" />
          {t("filters.reset")}
        </Button>
      </div>

      {/* Find near me — geolocation */}
      {geo ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Navigation className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate font-medium text-primary">
              {geo.lat.toFixed(3)}, {geo.lng.toFixed(3)}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={clearGeo}
            aria-label="Clear location"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-full gap-2 border-dashed"
          onClick={findNearMe}
          disabled={locating}
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="h-4 w-4" />
          )}
          {locating ? t("geo.locating") : t("geo.findNearMe")}
        </Button>
      )}

      {/* City */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("filters.city")}
        </Label>
        <Select value={filters.city || "__all__"} onValueChange={(v) => setFilters({ city: v === "__all__" ? "" : v })}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder={t("filters.allCities")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("filters.allCities")}</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>
                {cityLabel(c, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Category */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("filters.category")}
        </Label>
        <Select
          value={filters.category || "__all__"}
          onValueChange={(v) => setFilters({ category: v === "__all__" ? "" : v })}
        >
          <SelectTrigger className="h-10">
            <SelectValue placeholder={t("filters.allCategories")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("filters.allCategories")}</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {localizedCategory(c, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Price range */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("filters.priceRange")}
          </Label>
          <span className="text-xs font-medium tabular-nums text-foreground">
            {range[0].toLocaleString("ru-RU")} – {range[1].toLocaleString("ru-RU")} ₸
          </span>
        </div>
        <Slider
          value={range}
          onValueChange={(v) => applyRange([v[0], v[1]] as [number, number])}
          min={0}
          max={70000}
          step={500}
          className="py-1"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>0 ₸</span>
          <span>70 000 ₸</span>
        </div>
      </div>

      {/* Rating */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("filters.rating")}
        </Label>
        <Select
          value={filters.ratingMin || "__all__"}
          onValueChange={(v) => setFilters({ ratingMin: v === "__all__" ? "" : v })}
        >
          <SelectTrigger className="h-10">
            <SelectValue placeholder={t("filters.rating")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("filters.rating")}</SelectItem>
            {[4.5, 4.0, 3.5, 3.0].map((r) => (
              <SelectItem key={r} value={String(r)}>
                <span className="flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {r.toFixed(1)}+
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Online booking toggle */}
      <label
        htmlFor="online-booking"
        className="flex cursor-pointer items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
      >
        <span className="text-sm font-medium">{t("filters.onlineBooking")}</span>
        <Switch
          id="online-booking"
          checked={filters.onlineBooking}
          onCheckedChange={(v) => setFilters({ onlineBooking: v })}
        />
      </label>

      {/* Hide stale data toggle — filters out rows older than 30 days */}
      <label
        htmlFor="exclude-stale"
        className="flex cursor-pointer items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Archive className="h-3.5 w-3.5 text-amber-500" />
          {t("filters.excludeStale")}
        </span>
        <Switch
          id="exclude-stale"
          checked={filters.excludeStale}
          onCheckedChange={(v) => setFilters({ excludeStale: v })}
        />
      </label>
      {filters.excludeStale && (
        <p className="-mt-2 flex items-center gap-1 px-1 text-[10px] text-amber-600 dark:text-amber-400">
          <Clock className="h-3 w-3" />
          {t("filters.excludeStaleHint")}
        </p>
      )}

      {/* Sort */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("filters.sort")}
        </Label>
        <Select
          value={filters.sort}
          onValueChange={(v) => setFilters({ sort: v as typeof filters.sort })}
        >
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="price_asc">{t("sort.price_asc")}</SelectItem>
            <SelectItem value="price_desc">{t("sort.price_desc")}</SelectItem>
            <SelectItem value="rating_desc">{t("sort.rating_desc")}</SelectItem>
            <SelectItem value="parsed_desc">{t("sort.parsed_desc")}</SelectItem>
            <SelectItem value="distance_asc" disabled={!geo}>
              {t("sort.distance_asc")}
            </SelectItem>
          </SelectContent>
        </Select>
        {!geo && (
          <p className="text-[10px] text-muted-foreground/70">
            {t("geo.findNearMe")} →
          </p>
        )}
      </div>

      {/* Saved presets — snapshot current filters + geo for one-click recall */}
      <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <FolderHeart className="h-3.5 w-3.5 text-primary" />
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("filters.presets")}
          </h4>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5 text-xs"
          onClick={handleSavePreset}
        >
          <Save className="h-3.5 w-3.5" />
          {t("filters.savePreset")}
        </Button>
        {savedPresets.length === 0 ? (
          <p className="px-1 text-[11px] text-muted-foreground/70">
            {t("filters.noPresets")}
          </p>
        ) : (
          <ul className="space-y-1">
            {savedPresets.map((preset) => (
              <li
                key={preset.id}
                className="group flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => handleLoadPreset(preset.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium hover:text-primary"
                  title={t("filters.load")}
                >
                  <span className="truncate">{preset.name}</span>
                  {preset.geo && (
                    <Navigation className="h-3 w-3 shrink-0 text-primary/60" />
                  )}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-rose-500"
                  onClick={(e) => handleDeletePreset(preset.id, e)}
                  aria-label={`Delete preset ${preset.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function cityLabel(city: string, lang: Lang): string {
  return CITY_LABELS[lang]?.[city] ?? city;
}
