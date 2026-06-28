"use client";

/**
 * EmptyState — reusable premium empty-state component for views that have no
 * data to display. Renders a centered hero-style card with a large gradient
 * icon circle, decorative radial glow + floating particles, a title,
 * description, and an optional CTA button.
 *
 * Variants:
 *  - "search"  : No search results found
 *  - "compare" : Comparison list is empty
 *  - "history" : No price history selected
 *  - "default" : Generic fallback
 *
 * Callers can override icon/title/description/action via props, or rely on
 * the variant defaults (which pull copy from i18n keys).
 */
import { useI18n } from "@/components/providers";
import {
  SearchX,
  GitCompareArrows,
  TrendingUp,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateVariant = "default" | "search" | "compare" | "history";

type EmptyStateProps = {
  variant?: EmptyStateVariant;
  icon?: LucideIcon;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

/** Variant → default icon mapping (Lucide components). */
const VARIANT_ICON: Record<EmptyStateVariant, LucideIcon> = {
  default: SearchX,
  search: SearchX,
  compare: GitCompareArrows,
  history: TrendingUp,
};

/** Floating decorative particles (3-4 small dots with animate-pulse). */
function FloatingParticles() {
  const dots = [
    { top: "12%", left: "18%", size: 6, delay: "0s", color: "#10b981" },
    { top: "68%", left: "82%", size: 8, delay: "0.4s", color: "#14b8a6" },
    { top: "78%", left: "12%", size: 5, delay: "0.8s", color: "#06b6d4" },
    { top: "20%", left: "78%", size: 7, delay: "1.2s", color: "#f59e0b" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {dots.map((d, i) => (
        <span
          key={i}
          className="absolute animate-pulse rounded-full"
          style={{
            top: d.top,
            left: d.left,
            width: d.size,
            height: d.size,
            background: d.color,
            opacity: 0.25,
            animationDelay: d.delay,
          }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  variant = "default",
  icon: IconProp,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  const { t } = useI18n();
  const Icon = IconProp ?? VARIANT_ICON[variant];

  // Variant → i18n key fallbacks (used only when caller didn't override).
  const fallbackTitle =
    title ??
    (variant === "search"
      ? t("empty.search.title")
      : variant === "compare"
      ? t("empty.compare.title")
      : variant === "history"
      ? t("empty.history.title")
      : t("search.noResults"));

  const fallbackDesc =
    description ??
    (variant === "search"
      ? t("empty.search.desc")
      : variant === "compare"
      ? t("empty.compare.desc")
      : variant === "history"
      ? t("empty.history.desc")
      : "");

  const fallbackAction =
    actionLabel ??
    (variant === "search"
      ? t("empty.cta.search")
      : variant === "compare"
      ? t("empty.cta.compare")
      : variant === "history"
      ? t("empty.cta.history")
      : undefined);

  return (
    <div
      className={cn(
        "card-premium relative overflow-hidden rounded-2xl px-6 py-10 text-center sm:p-12",
        className
      )}
    >
      {/* Radial glow + floating particles */}
      <div
        className="empty-state-glow pointer-events-none absolute inset-0"
        aria-hidden="true"
      />
      <FloatingParticles />

      <div className="relative z-10 flex flex-col items-center">
        {/* Large gradient icon circle */}
        <div className="relative mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 via-primary/15 to-cyan-500/15 shadow-lg [box-shadow:0_12px_32px_-8px_color-mix(in_oklch,var(--primary)_35%,transparent)]">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-cyan-500/25 shadow-inner [box-shadow:inset_0_1px_2px_rgba(255,255,255,0.3)]">
            <Icon className="h-7 w-7 text-white drop-shadow-sm" />
          </div>
        </div>

        {/* Title */}
        <h3 className="text-xl font-bold tracking-tight">{fallbackTitle}</h3>

        {/* Description */}
        {fallbackDesc && (
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {fallbackDesc}
          </p>
        )}

        {/* Optional CTA */}
        {fallbackAction && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-gradient-to-r from-primary to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/20 [box-shadow:0_6px_16px_-4px_color-mix(in_oklch,var(--primary)_45%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {fallbackAction}
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
