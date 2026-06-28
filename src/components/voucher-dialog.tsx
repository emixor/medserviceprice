"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store/app-store";
import { useI18n } from "@/components/providers";
import { useMutation } from "@tanstack/react-query";
import { fetcher, formatPrice } from "@/lib/format";
import { localizedCity } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, Printer, AlertTriangle, AlertCircle, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";

/**
 * Voucher Dialog — Price Lock voucher generator (Workstream 14).
 *
 * Calls POST /api/v1/vouchers to persist a price-snapshot voucher. On
 * success, renders a printable voucher card with confirmation ID, clinic,
 * service, listed price, city, source URL, parsed-at + issued-at timestamps,
 * and a clear disclaimer.
 *
 * Print behavior: when the user clicks "Print / Save PDF", a print stylesheet
 * injected by this component hides everything on the page except the portaled
 * `#voucher-print-area` (rendered as a direct child of `<body>` so the
 * `body > *:not(#voucher-print-area) { display: none !important; }` selector
 * can reliably target it). The portaled copy is hidden on screen by Tailwind's
 * `hidden` utility; on print, the injected stylesheet forces it to
 * `display: block` and positions it at the top-left of the page.
 *
 * Safety:
 *   - The disclaimer (`t("voucher.disclaimer")`) is ALWAYS visible, regardless
 *     of mutation state.
 *   - When `data.isStale` is true, a stale-price warning is shown.
 *   - On close, both `voucherConfirmationId` (store) and the mutation state
 *     are reset so the next open is fresh.
 */
type VoucherResponse = {
  id: string;
  confirmationId: string;
  clinicId: string;
  serviceId: string;
  clinicName: string;
  serviceName: string;
  priceKzt: number;
  city: string;
  sourceUrl: string;
  parsedAt: string;
  createdAt: string;
  isStale: boolean;
  elapsedMs?: number;
};

/**
 * Print stylesheet — injected only when a voucher has been created. Hides
 * every direct child of `<body>` except `#voucher-print-area` and forces the
 * print area to fill the page. The portaled `#voucher-print-area` is a direct
 * child of `<body>` via `createPortal(... , document.body)`, so this selector
 * reliably isolates it from the dialog portal, the page header, the search
 * results, etc.
 */
const PRINT_CSS = `
@media print {
  body > *:not(#voucher-print-area) {
    display: none !important;
  }
  #voucher-print-area {
    display: block !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 24px !important;
    border: none !important;
    box-shadow: none !important;
    background: white !important;
    color: black !important;
  }
  #voucher-print-area .voucher-print-header {
    border-bottom: 2px solid #000 !important;
    padding-bottom: 8px !important;
    margin-bottom: 16px !important;
  }
  #voucher-print-area .voucher-print-row {
    page-break-inside: avoid !important;
  }
}
`;

/** Format an ISO date as "DD.MM.YYYY HH:MM" (KZ-friendly, 24h). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

/** Defensive hostname extractor for the source-URL link. */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * The printable voucher card. Rendered twice when a voucher exists:
 *   1. Inside the dialog (for on-screen viewing).
 *   2. Inside a portaled `#voucher-print-area` (hidden on screen, shown on
 *      print).
 *
 * Keeping the markup in one place avoids drift between the on-screen and
 * printed versions.
 */
function VoucherCard({
  data,
  renderHeader,
}: {
  data: VoucherResponse;
  renderHeader: ReactNode;
}) {
  const { t, lang } = useI18n();
  return (
    <div
      id="voucher-print-area-content"
      className="voucher-card space-y-4 rounded-lg border-2 border-primary/30 bg-primary/5 p-5 print:border-black print:bg-white print:p-0"
    >
      <div className="voucher-print-header flex items-center justify-between gap-3">
        {renderHeader}
      </div>

      {/* Confirmation ID — large, monospaced, prominently centered. */}
      <div className="text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground print:text-black">
          {t("voucher.confirmationId")}
        </p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-[0.2em] text-primary print:text-black">
          {data.confirmationId}
        </p>
      </div>

      {/* Detail rows. */}
      <div className="voucher-print-row space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground print:text-black">{t("voucher.clinic")}</span>
          <span className="text-right font-semibold print:text-black">{data.clinicName}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground print:text-black">{t("voucher.service")}</span>
          <span className="text-right font-semibold print:text-black">{data.serviceName}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground print:text-black">{t("voucher.price")}</span>
          <span className="text-right font-bold tabular-nums print:text-black">
            {formatPrice(data.priceKzt, "KZT")}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground print:text-black">{t("voucher.city")}</span>
          <span className="text-right font-medium print:text-black">
            {localizedCity(data.city, lang)}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground print:text-black">{t("voucher.parsedAt")}</span>
          <span className="text-right tabular-nums print:text-black">
            {formatDateTime(data.parsedAt)}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground print:text-black">{t("voucher.issuedAt")}</span>
          <span className="text-right tabular-nums print:text-black">
            {formatDateTime(data.createdAt)}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground print:text-black">{t("voucher.sourceUrl")}</span>
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-right text-primary underline-offset-2 hover:underline print:text-black print:no-underline"
          >
            <span className="max-w-[200px] truncate">{safeHostname(data.sourceUrl)}</span>
            <ExternalLink className="h-3 w-3 shrink-0 print:hidden" />
          </a>
        </div>
      </div>

      {/* Stale-price warning — shown only when the API flagged the voucher. */}
      {data.isStale && (
        <div className="voucher-print-row flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 print:border-black print:bg-white print:text-black">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("voucher.staleWarning")}</span>
        </div>
      )}

      {/* Disclaimer — ALWAYS visible (the voucher is informational only). */}
      <p className="voucher-print-row text-[11px] leading-relaxed text-muted-foreground print:text-black">
        {t("voucher.disclaimer")}
      </p>
    </div>
  );
}

export function VoucherDialog() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.voucherOpen);
  const voucherPrice = useAppStore((s) => s.voucherPrice);
  const closeVoucher = useAppStore((s) => s.closeVoucher);
  const setVoucherConfirmationId = useAppStore((s) => s.setVoucherConfirmationId);

  // The print area is portaled to <body> so the print stylesheet can reliably
  // hide everything else on the page. This dialog only renders its content
  // when `voucherOpen` is true (set by user interaction post-hydration), so
  // by the time we reach `createPortal`, `document` is always defined. We
  // still guard with a `typeof document` check for defensive SSR safety.
  const canPortal = typeof document !== "undefined";

  const mutation = useMutation({
    mutationFn: async (input: NonNullable<typeof voucherPrice>) => {
      return fetcher<VoucherResponse>("/api/v1/vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId: input.clinicId,
          serviceId: input.serviceId,
          priceKzt: input.priceKzt,
          city: input.city,
          sourceUrl: input.sourceUrl,
          parsedAt: input.parsedAt,
        }),
      });
    },
    onSuccess: (data) => {
      setVoucherConfirmationId(data.confirmationId);
      toast.success(t("voucher.created", { id: data.confirmationId }));
    },
    onError: (err: unknown) => {
      toast.error(t("voucher.error"));
      console.error("[voucher] error", err);
    },
  });

  function handleCreate() {
    if (!voucherPrice) return;
    mutation.mutate(voucherPrice);
  }

  function handleClose() {
    // Reset both the store and the mutation state so the next open is fresh.
    mutation.reset();
    closeVoucher();
  }

  function handlePrint() {
    window.print();
  }

  const data = mutation.data;
  const showVoucher = !!data;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        {/* Inject the print stylesheet only when a voucher exists. */}
        {showVoucher && (
          <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
        )}

        {/* Header — hidden on print so only the voucher card shows. */}
        <DialogHeader className={showVoucher ? "print:hidden" : ""}>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            {t("voucher.title")}
          </DialogTitle>
          <DialogDescription>{t("voucher.subtitle")}</DialogDescription>
        </DialogHeader>

        {voucherPrice && (
          <div className="space-y-4">
            {/* Idle / pending: show the input preview + Lock-Price button. */}
            {!showVoucher && !mutation.isError && (
              <>
                <div className="rounded-lg border border-border/60 bg-muted/30 p-4 print:hidden">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("voucher.clinic")}</span>
                      <span className="font-medium">{voucherPrice.clinicName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("voucher.service")}</span>
                      <span className="font-medium">{voucherPrice.serviceName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("voucher.price")}</span>
                      <span className="font-bold tabular-nums">
                        {formatPrice(voucherPrice.priceKzt, "KZT")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("voucher.city")}</span>
                      <span className="font-medium">{voucherPrice.city}</span>
                    </div>
                  </div>
                </div>

                {/* Disclaimer — ALWAYS visible, even before locking. */}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("voucher.disclaimer")}
                </p>

                <Button
                  onClick={handleCreate}
                  disabled={mutation.isPending}
                  className="w-full gap-2"
                >
                  {mutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  {t("voucher.button")}
                </Button>
              </>
            )}

            {/* Error state — never crashes the UI; lets the user retry. */}
            {mutation.isError && (
              <div className="space-y-3 print:hidden">
                <div className="flex items-start gap-2 rounded-lg border border-rose-300/50 bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("voucher.error")}</span>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={mutation.isPending}
                  variant="outline"
                  className="w-full gap-2"
                >
                  {mutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  {t("voucher.button")}
                </Button>
              </div>
            )}

            {/* Success — show the printable voucher card + action buttons. */}
            {showVoucher && data && (
              <>
                {/* On-screen voucher card (inside the dialog). */}
                <VoucherCard
                  data={data}
                  renderHeader={
                    <div className="flex items-center gap-2 text-sm font-semibold text-primary print:text-black">
                      <Lock className="h-4 w-4" />
                      <span>{t("voucher.title")}</span>
                    </div>
                  }
                />

                {/* Portaled print area (hidden on screen, shown on print).
                    Rendered as a DIRECT CHILD of <body> so the
                    `body > *:not(#voucher-print-area)` selector in the print
                    stylesheet reliably hides everything else. */}
                {canPortal &&
                  createPortal(
                    <div id="voucher-print-area" className="hidden">
                      <VoucherCard
                        data={data}
                        renderHeader={
                          <div className="flex items-center gap-2 text-base font-bold">
                            <Lock className="h-5 w-5" />
                            <span>{t("voucher.title")}</span>
                          </div>
                        }
                      />
                    </div>,
                    document.body
                  )}

                {/* Action buttons — hidden on print. */}
                <div className="flex gap-2 print:hidden">
                  <Button onClick={handlePrint} className="flex-1 gap-2">
                    <Printer className="h-4 w-4" />
                    {t("voucher.print")}
                  </Button>
                  <Button onClick={handleClose} variant="outline" className="gap-2">
                    <X className="h-4 w-4" />
                    {t("voucher.close")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
