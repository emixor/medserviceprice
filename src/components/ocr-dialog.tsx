"use client";

import { useState, useRef, useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { useI18n } from "@/components/providers";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ShoppingCart,
  Lightbulb,
} from "lucide-react";
import { toast } from "sonner";

/**
 * OCR Upload Dialog — Workstream 3.
 *
 * Finalized implementation backed by POST /api/v1/ocr/extract. The user
 * uploads an image/PDF (handled by the VLM skill server-side) or a text/
 * CSV/JSON file (handled by the API directly), and the response is a list
 * of { extractedText, matchedServiceId, matchedServiceName, confidence }
 * items. The user reviews the list, ticks the items they want, and clicks
 * "Add all confirmed to basket" — which writes them to the app-store
 * basket and switches to the basket view.
 *
 * UX:
 *   • Hidden <input type="file"> with a styled drop-zone label.
 *   • Loading spinner while the VLM/file-extraction runs.
 *   • Results list with per-item checkbox + color-coded confidence badge.
 *     Items with no match are unchecked + amber "No match" note + checkbox
 *     disabled (you can't add an unmatched item to the basket).
 *   • Pre-selection: every item with confidence ≥ 0.6 AND a matched
 *     service is checked by default.
 *   • After a successful extraction, the results block is scrolled into
 *     view (so mobile users don't have to scroll past the upload area).
 *   • A short tip ("For best results, upload a clear photo or text file
 *     with one service name per line.") is shown above the upload area to
 *     encourage text-file uploads as the most reliable path.
 *   • The disclaimer ("Extraction is automatic and may contain errors.
 *     Always review before booking.") is ALWAYS visible at the bottom of
 *     the dialog, regardless of state.
 *   • Errors (4xx/5xx from the API, including the VLM-not-supported 501)
 *     surface as a toast via sonner, with the localized `ocr.error`
 *     template and the server's `error` string interpolated in.
 */
type OcrItem = {
  extractedText: string;
  matchedServiceId: string | null;
  matchedServiceName: string | null;
  confidence: number; // 0-1
};

type OcrResponse = {
  items: OcrItem[];
  elapsedMs: number;
  warning?: string;
};

export function OcrDialog() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.ocrOpen);
  const setOpen = useAppStore((s) => s.setOcrOpen);
  const toggleBasket = useAppStore((s) => s.toggleBasket);
  const setView = useAppStore((s) => s.setView);
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: async (f: File) => {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch("/api/v1/ocr/extract", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<OcrResponse>;
    },
    onSuccess: (data) => {
      // Pre-select items with confidence >= 0.6 and a matched service
      const initial = new Set<number>();
      data.items.forEach((item, idx) => {
        if (item.matchedServiceId && item.confidence >= 0.6) {
          initial.add(idx);
        }
      });
      setSelected(initial);
      if (data.warning) {
        toast.warning(data.warning);
      }
    },
    // After a successful extraction, scroll the results block into view so
    // the user immediately sees the review UI (esp. helpful on mobile where
    // the upload area is above the fold and the list is below it).
    // Implemented as a separate effect below to avoid running before render.
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("ocr.error", { message: msg }));
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // Keep this list in sync with the API route's ALLOWED_TYPES.
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/json",
    ];
    if (!allowed.includes(f.type)) {
      toast.error(t("ocr.unsupportedFile"));
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error(t("ocr.tooLarge"));
      return;
    }
    setFile(f);
    setSelected(new Set());
    mutation.mutate(f);
  }

  function toggleIdx(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function addSelectedToBasket() {
    if (!mutation.data) return;
    let added = 0;
    for (const idx of selected) {
      const item = mutation.data.items[idx];
      if (item?.matchedServiceId) {
        const ok = toggleBasket(item.matchedServiceId);
        if (ok) added++;
      }
    }
    if (added > 0) {
      toast.success(t("ocr.added", { count: added }));
      setOpen(false);
      setView("basket");
    } else {
      toast.error(t("ocr.noneAdded"));
    }
  }

  function reset() {
    setFile(null);
    setSelected(new Set());
    mutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Scroll results into view after a successful extraction. Runs after
  // render so the ref is attached. Skips when there are no items (the empty
  // state is shown inline and doesn't need scrolling).
  useEffect(() => {
    if (mutation.isSuccess && mutation.data && mutation.data.items.length > 0) {
      resultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [mutation.isSuccess, mutation.data]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-emerald-600" />
            {t("ocr.title")}
          </DialogTitle>
          <DialogDescription>{t("ocr.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 p-6 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,application/json"
              onChange={handleFileChange}
              className="hidden"
              id="ocr-file-input"
            />
            <label htmlFor="ocr-file-input" className="cursor-pointer">
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({(file.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{t("ocr.drop")}</p>
                  <p className="text-xs text-muted-foreground">{t("ocr.dropHint")}</p>
                </div>
              )}
            </label>
          </div>

          {/* Tip — text fallback hint. Hardcoded EN because no i18n key was
              added for this string and i18n.ts is out of scope. */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>
              For best results, upload a clear photo or text file with one
              service name per line.
            </span>
          </div>

          {/* Loading */}
          {mutation.isPending && (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/40 p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("ocr.analyzing")}
            </div>
          )}

          {/* Results */}
          {mutation.data && mutation.data.items.length > 0 && (
            <div ref={resultsRef} className="space-y-3">
              <div>
                <p className="text-sm font-semibold">{t("ocr.reviewTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("ocr.reviewHint")}</p>
              </div>
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {mutation.data.items.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                  >
                    <Checkbox
                      checked={selected.has(idx)}
                      onCheckedChange={() => toggleIdx(idx)}
                      disabled={!item.matchedServiceId}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.extractedText}</p>
                      {item.matchedServiceName ? (
                        <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="mr-1 inline h-3 w-3" />
                          {t("ocr.matchedService")}: {item.matchedServiceName}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                          {t("ocr.noMatch")}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        item.confidence >= 0.7
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : item.confidence >= 0.4
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                      }
                    >
                      {t("ocr.confidence")}: {Math.round(item.confidence * 100)}%
                    </Badge>
                  </li>
                ))}
              </ul>
              <Button
                onClick={addSelectedToBasket}
                disabled={selected.size === 0}
                className="w-full gap-2"
              >
                <ShoppingCart className="h-4 w-4" />
                {t("ocr.addAll")}
              </Button>
            </div>
          )}

          {mutation.data && mutation.data.items.length === 0 && (
            <p className="rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
              {t("symptom.noResults")}
            </p>
          )}

          {/* Disclaimer */}
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>{t("ocr.disclaimer")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
