"use client";

import { useAppStore } from "@/store/app-store";
import { useI18n } from "@/components/providers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Share2, Copy, Check } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

/**
 * Share Dialog — Workstream 11.
 *
 * Generates a shareable URL for the current view state (compare/basket/search filters).
 * Encodes state into URL query params so the recipient sees the same view.
 */
export function ShareDialog() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.shareOpen);
  const setOpen = useAppStore((s) => s.setShareOpen);
  const view = useAppStore((s) => s.view);
  const compareServiceIds = useAppStore((s) => s.compareServiceIds);
  const basketServiceIds = useAppStore((s) => s.basketServiceIds);
  const filters = useAppStore((s) => s.filters);
  const [copied, setCopied] = useState(false);

  // Compute the share URL purely from current state — no effect, no setState.
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      const url = new URL(window.location.href);
      url.search = ""; // clear existing params
      url.searchParams.set("v", view);
      if (view === "compare" && compareServiceIds.length > 0) {
        url.searchParams.set("cmp", compareServiceIds.join(","));
      }
      if (view === "basket" && basketServiceIds.length > 0) {
        url.searchParams.set("bsk", basketServiceIds.join(","));
      }
      if (view === "search") {
        if (filters.q) url.searchParams.set("q", filters.q);
        if (filters.city) url.searchParams.set("city", filters.city);
        if (filters.category) url.searchParams.set("cat", filters.category);
        if (filters.priceMin) url.searchParams.set("pmin", filters.priceMin);
        if (filters.priceMax) url.searchParams.set("pmax", filters.priceMax);
        if (filters.ratingMin) url.searchParams.set("rmin", filters.ratingMin);
        if (filters.onlineBooking) url.searchParams.set("ob", "1");
        if (filters.excludeStale) url.searchParams.set("xs", "1");
        if (filters.sort) url.searchParams.set("sort", filters.sort);
      }
      return url.toString();
    } catch {
      return "";
    }
  }, [view, compareServiceIds, basketServiceIds, filters]);

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success(t("share.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("share.copyFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            {t("share.title")}
          </DialogTitle>
          <DialogDescription>{t("share.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input value={shareUrl} readOnly className="font-mono text-xs" />
            <Button onClick={copyLink} className="shrink-0 gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t("share.copied") : t("share.copy")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("share.subtitle")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
