"use client";

import { useEffect, useState } from "react";
import {
  Search,
  SlidersHorizontal,
  GitCompareArrows,
  MapPin,
  Bell,
  Coins,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/components/providers";
import { cn } from "@/lib/utils";

/** localStorage flag set once the user has seen (or skipped) the tour. */
const ONBOARDING_KEY = "msp.onboardingCompleted";

type Step = {
  /** i18n key suffix, e.g. "step1" → onboarding.step1.title / .desc */
  key: string;
  icon: LucideIcon;
  /** Tailwind classes controlling the accent color of the icon tile + glow. */
  accent: string;
};

const STEPS: Step[] = [
  {
    key: "step1",
    icon: Search,
    accent: "from-primary/15 to-primary/5 text-primary ring-primary/20",
  },
  {
    key: "step2",
    icon: SlidersHorizontal,
    accent: "from-cyan-500/15 to-cyan-500/5 text-cyan-600 ring-cyan-500/20 dark:text-cyan-400",
  },
  {
    key: "step3",
    icon: GitCompareArrows,
    accent: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400",
  },
  {
    key: "step4",
    icon: MapPin,
    accent: "from-amber-500/15 to-amber-500/5 text-amber-600 ring-amber-500/20 dark:text-amber-400",
  },
  {
    key: "step5",
    icon: Bell,
    accent: "from-rose-500/15 to-rose-500/5 text-rose-600 ring-rose-500/20 dark:text-rose-400",
  },
  {
    key: "step6",
    icon: Coins,
    accent: "from-violet-500/15 to-violet-500/5 text-violet-600 ring-violet-500/20 dark:text-violet-400",
  },
];

export function OnboardingTour() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  // Auto-open the tour on the very first visit — i.e. when the
  // `msp.onboardingCompleted` flag is not yet present in localStorage.
  // The open() call is scheduled via setTimeout so we never call setState
  // synchronously inside the effect body (avoids cascading-render warnings
  // and lets the page paint before the modal pops up).
  useEffect(() => {
    let id: number | undefined;
    try {
      const done = window.localStorage.getItem(ONBOARDING_KEY);
      if (!done) {
        id = window.setTimeout(() => setOpen(true), 400);
      }
    } catch {
      // localStorage may throw in private-mode browsers — fail silently.
    }
    return () => {
      if (id !== undefined) window.clearTimeout(id);
    };
  }, []);

  function complete() {
    try {
      window.localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  function handleNext() {
    if (stepIdx < STEPS.length - 1) {
      setStepIdx((i) => i + 1);
    } else {
      complete();
    }
  }

  function handleSkip() {
    complete();
  }

  // On Escape (handled by Radix Dialog), treat as skip — only mark complete
  // so it doesn't immediately re-open on the next page load.
  function handleOpenChange(next: boolean) {
    if (!next) {
      complete();
    } else {
      setOpen(true);
    }
  }

  const step = STEPS[stepIdx];
  const Icon = step.icon;
  const isLast = stepIdx === STEPS.length - 1;
  const progressPct = Math.round(((stepIdx + 1) / STEPS.length) * 100);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="msp-onboarding-tour msp-dialog-in w-[92vw] max-w-md gap-0 overflow-hidden p-0 sm:w-[420px]"
        showCloseButton={false}
      >
        {/* Screen-reader-only title/description (required by Radix Dialog). */}
        <DialogTitle className="sr-only">{t("onboarding.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t(`onboarding.${step.key}.desc`)}
        </DialogDescription>

        {/* Progress strip */}
        <div className="space-y-1.5 border-b border-border/60 bg-muted/30 px-5 pb-3 pt-4">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span className="uppercase tracking-wide">
              {t("onboarding.title")}
            </span>
            <span className="tabular-nums">
              {stepIdx + 1} / {STEPS.length}
            </span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        {/* Body */}
        <div className="px-5 pb-2 pt-6">
          <div
            className={cn(
              "mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br ring-1",
              step.accent
            )}
          >
            <Icon className="h-8 w-8" strokeWidth={1.75} />
          </div>

          <h2 className="mt-4 text-center text-lg font-bold leading-tight text-foreground">
            {t(`onboarding.${step.key}.title`)}
          </h2>
          <p className="mx-auto mt-2 max-w-[320px] text-center text-sm leading-relaxed text-muted-foreground">
            {t(`onboarding.${step.key}.desc`)}
          </p>

          {/* Step dots */}
          <div className="mt-5 flex items-center justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === stepIdx
                    ? "w-6 bg-primary"
                    : i < stepIdx
                      ? "w-1.5 bg-primary/40"
                      : "w-1.5 bg-border"
                )}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={handleSkip}
          >
            {t("onboarding.skip")}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs font-semibold"
            onClick={handleNext}
          >
            {isLast ? t("onboarding.finish") : t("onboarding.next")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
