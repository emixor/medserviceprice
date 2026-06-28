"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type View =
  | "search"
  | "compare"
  | "basket"
  | "map"
  | "history"
  | "admin"
  | "clinic" // Clinic Profile Pages (Workstream 12)
  | "heatmap"; // Price Volatility Heatmap (Workstream 6)

export type Currency = "KZT" | "USD" | "RUB";

/** How the search results list is rendered. */
export type ResultView = "card" | "list";

export type SortKey =
  | "price_asc"
  | "price_desc"
  | "rating_desc"
  | "parsed_desc"
  | "distance_asc";

export type SearchFilters = {
  q: string;
  city: string; // "" = all
  category: string; // "" = all
  priceMin: string;
  priceMax: string;
  ratingMin: string;
  onlineBooking: boolean;
  excludeStale: boolean; // hide rows older than 30 days
  sort: SortKey;
};

const defaultFilters: SearchFilters = {
  q: "",
  city: "",
  category: "",
  priceMin: "",
  priceMax: "",
  ratingMin: "",
  onlineBooking: false,
  excludeStale: false,
  sort: "price_asc",
};

export type GeoLocation = { lat: number; lng: number };

/** Input for the Price Lock Voucher dialog — populated by the result card
 * when the user clicks "Lock Price". Carries everything the voucher API needs
 * to snapshot the price.
 */
export type VoucherPriceInput = {
  clinicId: string;
  serviceId: string;
  clinicName: string;
  serviceName: string;
  priceKzt: number;
  city: string;
  sourceUrl: string;
  parsedAt: string; // ISO string
};

/** A saved snapshot of the user's filters + geolocation, with a friendly name. */
export type SavedPreset = {
  id: string;
  name: string;
  filters: SearchFilters;
  geo: GeoLocation | null;
};

type AppState = {
  view: View;
  setView: (v: View) => void;

  // Result list rendering mode (card grid vs compact list)
  resultView: ResultView;
  setResultView: (v: ResultView) => void;

  // Doctor Mode — dense, compact layout for power users / consultations (Workstream 13)
  doctorMode: boolean;
  setDoctorMode: (on: boolean) => void;
  toggleDoctorMode: () => void;

  filters: SearchFilters;
  setFilters: (f: Partial<SearchFilters>) => void;
  resetFilters: () => void;

  compareServiceIds: string[];
  toggleCompare: (id: string) => boolean; // returns false if capped
  removeFromCompare: (id: string) => void;
  clearCompare: () => void;
  inCompare: (id: string) => boolean;
  // Direct setter for shareable-link state restoration (Workstream 11).
  setCompareServiceIds: (ids: string[]) => void;

  // Smart Basket / Split-Saver Optimizer — user adds multiple services, the
  // app finds the cheapest single-clinic option vs the cheapest split across
  // clinics. Capped at MAX_BASKET services.
  basketServiceIds: string[];
  toggleBasket: (id: string) => boolean; // returns false if capped
  removeFromBasket: (id: string) => void;
  clearBasket: () => void;
  inBasket: (id: string) => boolean;
  // Direct setter for shareable-link state restoration (Workstream 11).
  setBasketServiceIds: (ids: string[]) => void;

  selectedClinicId: string | null;
  setSelectedClinic: (id: string | null) => void;

  selectedServiceId: string | null;
  setSelectedService: (id: string | null) => void;

  // Service detail dialog (separate from history's selectedServiceId)
  selectedServiceDetailId: string | null;
  setSelectedServiceDetail: (id: string | null) => void;

  // Subscribe dialog
  subscribeService:
    | {
        id: string;
        nameRu: string;
        nameKk: string;
        nameEn: string;
        category: string;
        synonyms: string[];
        description: string | null;
        unit: string | null;
      }
    | null;
  setSubscribeService: (s: AppState["subscribeService"] | null) => void;

  // Geolocation — set when the user clicks "Find near me"
  geo: GeoLocation | null;
  setGeo: (g: GeoLocation | null) => void;

  // Recently viewed services — capped at 8, newest first
  recentServiceIds: string[];
  pushRecentService: (id: string) => void;
  clearRecent: () => void;

  // Favorites / Bookmarks — capped at 20, persisted
  favoriteServiceIds: string[];
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;

  // Display currency for price formatting — persisted
  currency: Currency;
  setCurrency: (c: Currency) => void;

  // Saved filter presets — capped at 10, persisted
  savedPresets: SavedPreset[];
  savePreset: (name: string) => void;
  loadPreset: (id: string) => void;
  deletePreset: (id: string) => void;

  // Price-alert email + last-seen notification timestamp (for the bell badge)
  userEmail: string | null;
  setUserEmail: (email: string | null) => void;
  lastSeenNotifiedAt: string | null; // ISO timestamp
  setLastSeenNotifiedAt: (ts: string) => void;

  // "My Alerts" panel open state (transient — not persisted)
  myAlertsOpen: boolean;
  setMyAlertsOpen: (open: boolean) => void;

  // --- Workstream additions (Task 14 / Incremental upgrade) ---

  // Clinic Profile view — set when user clicks "View clinic" deep-link from
  // a result card, the map, or a voucher. The ClinicProfileView reads this.
  // (Transients — not persisted across reloads.)

  // Voucher dialog open state + the price snapshot to lock (Workstream 14).
  // `voucherPrice` carries the clinic+service+price+parsedAt info needed to
  // call POST /api/v1/vouchers and render the printable voucher.
  voucherOpen: boolean;
  voucherPrice: VoucherPriceInput | null;
  openVoucher: (input: VoucherPriceInput) => void;
  closeVoucher: () => void;
  // After a voucher is created, the confirmationId is stored here so the
  // dialog can render the printable view.
  voucherConfirmationId: string | null;
  setVoucherConfirmationId: (id: string | null) => void;

  // Symptom Mapper dialog (Workstream 7)
  symptomOpen: boolean;
  setSymptomOpen: (open: boolean) => void;

  // OCR Upload dialog (Workstream 3)
  ocrOpen: boolean;
  setOcrOpen: (open: boolean) => void;

  // Share dialog (Workstream 11) — opens a modal with a shareable URL for
  // the current view (compare/basket/search filters).
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;

  // Favorites & Saved Searches panel (Workstream 10) — opens a side panel / dialog
  favoritesOpen: boolean;
  setFavoritesOpen: (open: boolean) => void;
};

export const MAX_COMPARE = 6;
export const MAX_RECENT = 8;
export const MAX_FAVORITES = 20;
export const MAX_PRESETS = 10;
export const MAX_BASKET = 10;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      view: "search",
      setView: (v) => set({ view: v }),

      resultView: "card",
      setResultView: (v) => set({ resultView: v }),

      doctorMode: false,
      setDoctorMode: (on) => set({ doctorMode: on }),
      toggleDoctorMode: () => set((s) => ({ doctorMode: !s.doctorMode })),

      filters: defaultFilters,
      setFilters: (f) => set({ filters: { ...get().filters, ...f } }),
      resetFilters: () =>
        set({
          filters: defaultFilters,
          geo: null,
        }),

      compareServiceIds: [],
      toggleCompare: (id) => {
        const cur = get().compareServiceIds;
        if (cur.includes(id)) {
          set({ compareServiceIds: cur.filter((x) => x !== id) });
          return true;
        }
        if (cur.length >= MAX_COMPARE) return false;
        set({ compareServiceIds: [...cur, id] });
        return true;
      },
      removeFromCompare: (id) =>
        set({ compareServiceIds: get().compareServiceIds.filter((x) => x !== id) }),
      clearCompare: () => set({ compareServiceIds: [] }),
      inCompare: (id) => get().compareServiceIds.includes(id),
      setCompareServiceIds: (ids) => set({ compareServiceIds: ids.slice(0, MAX_COMPARE) }),

      basketServiceIds: [],
      toggleBasket: (id) => {
        const cur = get().basketServiceIds;
        if (cur.includes(id)) {
          set({ basketServiceIds: cur.filter((x) => x !== id) });
          return true;
        }
        if (cur.length >= MAX_BASKET) return false;
        set({ basketServiceIds: [...cur, id] });
        return true;
      },
      removeFromBasket: (id) =>
        set({ basketServiceIds: get().basketServiceIds.filter((x) => x !== id) }),
      clearBasket: () => set({ basketServiceIds: [] }),
      inBasket: (id) => get().basketServiceIds.includes(id),
      setBasketServiceIds: (ids) => set({ basketServiceIds: ids.slice(0, MAX_BASKET) }),

      selectedClinicId: null,
      setSelectedClinic: (id) => set({ selectedClinicId: id }),

      selectedServiceId: null,
      setSelectedService: (id) => set({ selectedServiceId: id }),

      selectedServiceDetailId: null,
      setSelectedServiceDetail: (id) => set({ selectedServiceDetailId: id }),

      subscribeService: null,
      setSubscribeService: (s) => set({ subscribeService: s }),

      geo: null,
      setGeo: (g) => set({ geo: g }),

      recentServiceIds: [],
      pushRecentService: (id) =>
        set({
          recentServiceIds: [
            id,
            ...get().recentServiceIds.filter((x) => x !== id),
          ].slice(0, MAX_RECENT),
        }),
      clearRecent: () => set({ recentServiceIds: [] }),

      favoriteServiceIds: [],
      toggleFavorite: (id) =>
        set({
          favoriteServiceIds: get().favoriteServiceIds.includes(id)
            ? get().favoriteServiceIds.filter((x) => x !== id)
            : [...get().favoriteServiceIds, id].slice(0, MAX_FAVORITES),
        }),
      isFavorite: (id) => get().favoriteServiceIds.includes(id),

      currency: "KZT",
      setCurrency: (c) => set({ currency: c }),

      savedPresets: [],
      savePreset: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const preset: SavedPreset = {
          id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: trimmed,
          // Snapshot current filters (excluding the transient `q` query text)
          filters: { ...get().filters, q: "" },
          geo: get().geo,
        };
        set({
          savedPresets: [preset, ...get().savedPresets].slice(0, MAX_PRESETS),
        });
      },
      loadPreset: (id) => {
        const preset = get().savedPresets.find((p) => p.id === id);
        if (!preset) return;
        set({ filters: { ...preset.filters }, geo: preset.geo });
      },
      deletePreset: (id) =>
        set({ savedPresets: get().savedPresets.filter((p) => p.id !== id) }),

      userEmail: null,
      setUserEmail: (email) =>
        set({ userEmail: email ? email.trim().toLowerCase() : null }),
      lastSeenNotifiedAt: null,
      setLastSeenNotifiedAt: (ts) => set({ lastSeenNotifiedAt: ts }),

      myAlertsOpen: false,
      setMyAlertsOpen: (open) => set({ myAlertsOpen: open }),

      // --- Workstream additions (Task 14 / Incremental upgrade) ---
      voucherOpen: false,
      voucherPrice: null,
      openVoucher: (input) => set({ voucherOpen: true, voucherPrice: input, voucherConfirmationId: null }),
      closeVoucher: () => set({ voucherOpen: false, voucherPrice: null, voucherConfirmationId: null }),
      voucherConfirmationId: null,
      setVoucherConfirmationId: (id) => set({ voucherConfirmationId: id }),

      symptomOpen: false,
      setSymptomOpen: (open) => set({ symptomOpen: open }),

      ocrOpen: false,
      setOcrOpen: (open) => set({ ocrOpen: open }),

      shareOpen: false,
      setShareOpen: (open) => set({ shareOpen: open }),

      favoritesOpen: false,
      setFavoritesOpen: (open) => set({ favoritesOpen: open }),
    }),
    {
      name: "msp.app",
      partialize: (s) => ({
        compareServiceIds: s.compareServiceIds,
        basketServiceIds: s.basketServiceIds,
        // don't persist the query text, only the filter selections
        filters: { ...s.filters, q: "" },
        recentServiceIds: s.recentServiceIds,
        favoriteServiceIds: s.favoriteServiceIds,
        resultView: s.resultView,
        currency: s.currency,
        savedPresets: s.savedPresets,
        userEmail: s.userEmail,
        lastSeenNotifiedAt: s.lastSeenNotifiedAt,
        // Persist Doctor Mode so the user's layout preference sticks across reloads.
        doctorMode: s.doctorMode,
      }),
    }
  )
);
