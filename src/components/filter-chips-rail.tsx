"use client";

/**
 * FilterChipsRail — horizontally scrollable rail of one-tap quick filter
 * chips, rendered above the search results list. Each chip is a toggle:
 * clicking applies the filter, clicking again removes it.
 *
 * Chip groups:
 *  - Price buckets (mutually exclusive — Under 3K, 3K–10K, 10K+)
 *  - Quality (Top rated 4.5+)
 *  - Booking (Online booking)
 *  - Categories (Laboratory, Diagnostics, Doctor visit, Procedures)
 *
 * Active chips show a checkmark + emerald background. Inactive chips use a
 * neutral muted look. Rail is horizontally scrollable on mobile (hidden
 * scrollbar via `.quick-chips-scroll`).
 */
import { useI18n } from "@/components/providers";
import { useAppStore, type SearchFilters } from "@/store/app-store";
import {
  Coins,
  Star,
  CalendarCheck,
  FlaskConical,
  Brain,
  Stethoscope,
  Syringe,
  Check,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, type ReactNode } from "react";

type ChipDef = {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  /** Returns true when this chip is currently active given the filters. */
  isActive: (f: SearchFilters) => boolean;
  /** Apply (or remove) this chip's effect on the filters. */
  toggle: (f: SearchFilters, setFilters: (next: Partial<SearchFilters>) => void) => void;
};

/** Build the full chip list. Price chips replace any existing price range. */
function useChips(): ChipDef[] {
  return useMemo(
    () => [
      // --- Price buckets (mutually exclusive) ---
      {
        key: "price-under-3k",
        labelKey: "quickFilters.under3k",
        icon: Coins,
        isActive: (f) => f.priceMin === "" && f.priceMax === "3000",
        toggle: (_f, setFilters) =>
          setFilters({ priceMin: "", priceMax: "3000" }),
      },
      {
        key: "price-3k-10k",
        labelKey: "quickFilters.3to10k",
        icon: Coins,
        isActive: (f) => f.priceMin === "3000" && f.priceMax === "10000",
        toggle: (_f, setFilters) =>
          setFilters({ priceMin: "3000", priceMax: "10000" }),
      },
      {
        key: "price-over-10k",
        labelKey: "quickFilters.over10k",
        icon: Coins,
        isActive: (f) => f.priceMin === "10000" && f.priceMax === "",
        toggle: (_f, setFilters) =>
          setFilters({ priceMin: "10000", priceMax: "" }),
      },
      // --- Quality ---
      {
        key: "rating-top",
        labelKey: "quickFilters.topRated",
        icon: Star,
        isActive: (f) => f.ratingMin === "4.5",
        toggle: (f, setFilters) =>
          setFilters({ ratingMin: f.ratingMin === "4.5" ? "" : "4.5" }),
      },
      // --- Booking ---
      {
        key: "online-booking",
        labelKey: "quickFilters.onlineBooking",
        icon: CalendarCheck,
        isActive: (f) => f.onlineBooking === true,
        toggle: (f, setFilters) =>
          setFilters({ onlineBooking: !f.onlineBooking }),
      },
      // --- Categories (toggle category; turning off clears it) ---
      {
        key: "cat-lab",
        labelKey: "quickFilters.lab",
        icon: FlaskConical,
        isActive: (f) => f.category === "laboratory",
        toggle: (f, setFilters) =>
          setFilters({ category: f.category === "laboratory" ? "" : "laboratory" }),
      },
      {
        key: "cat-diagnostics",
        labelKey: "quickFilters.diagnostics",
        icon: Brain,
        isActive: (f) => f.category === "diagnostics",
        toggle: (f, setFilters) =>
          setFilters({ category: f.category === "diagnostics" ? "" : "diagnostics" }),
      },
      {
        key: "cat-doctor",
        labelKey: "quickFilters.doctor",
        icon: Stethoscope,
        isActive: (f) => f.category === "doctor_appointment",
        toggle: (f, setFilters) =>
          setFilters({ category: f.category === "doctor_appointment" ? "" : "doctor_appointment" }),
      },
      {
        key: "cat-procedures",
        labelKey: "quickFilters.procedures",
        icon: Syringe,
        isActive: (f) => f.category === "procedure",
        toggle: (f, setFilters) =>
          setFilters({ category: f.category === "procedure" ? "" : "procedure" }),
      },
    ],
    []
  );
}

/** A single chip button. */
function Chip({
  chip,
  active,
  onClick,
  label,
  icon,
  index,
}: {
  chip: ChipDef;
  active: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
  index: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-active={active || undefined}
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
      className={cn(
        "msp-card-in inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200",
        active
          ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
      {active && <Check className="h-3 w-3 shrink-0" />}
    </button>
  );
}

export function FilterChipsRail() {
  const { t } = useI18n();
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const chips = useChips();

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        {/* Label — hidden on small screens */}
        <span className="hidden shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 sm:inline-flex">
          {t("quickFilters.title")}
        </span>

        {/* Scrollable chip rail */}
        <div className="quick-chips-scroll flex-1 overflow-x-auto">
          <div className="flex items-center gap-1.5 pb-1">
            {chips.map((chip, i) => {
              const active = chip.isActive(filters);
              const Icon = chip.icon;
              return (
                <Chip
                  key={chip.key}
                  chip={chip}
                  index={i}
                  active={active}
                  label={t(chip.labelKey)}
                  icon={<Icon className="h-3 w-3" />}
                  onClick={() => chip.toggle(filters, setFilters)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
