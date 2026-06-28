"use client";

import { useI18n } from "@/components/providers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, Loader2, Mail, TrendingDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type ServiceDirectoryItem, svcName, formatKzt } from "@/lib/format";
import { localizedCategory } from "@/lib/i18n";
import { useAppStore } from "@/store/app-store";

export function SubscribeDialog({
  service,
  open,
  onOpenChange,
}: {
  service: ServiceDirectoryItem | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const userEmail = useAppStore((s) => s.userEmail);
  const setUserEmail = useAppStore((s) => s.setUserEmail);
  const [email, setEmail] = useState("");
  const [threshold, setThreshold] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [minPrice, setMinPrice] = useState<number | null>(null);

  // Seed the email input from the persisted store value when the dialog opens.
  useEffect(() => {
    if (open && userEmail && !email) setEmail(userEmail);
  }, [open, userEmail, email]);

  // Fetch the current minimum price for this service to suggest a threshold
  useEffect(() => {
    if (!service?.id) return;
    let cancelled = false;
    setMinPrice(null);
    fetch(`/api/v1/services/${service.id}/history`)
      .then((r) => r.json())
      .then((h: { overallSeries: { min: number | null }[] }) => {
        if (cancelled) return;
        const pts = h.overallSeries ?? [];
        const mins = pts.map((p) => p.min).filter((v): v is number => v != null);
        const m = mins.length ? Math.min(...mins) : null;
        setMinPrice(m);
        if (m != null) setThreshold(String(Math.round(m * 0.8)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [service?.id]);

  async function submit() {
    if (!service) return;
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      toast.error(t("subscribe.error"));
      return;
    }
    if (!threshold || Number(threshold) <= 0) {
      toast.error(t("subscribe.error"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          serviceId: service.id,
          thresholdKzt: Number(threshold),
        }),
      });
      if (!res.ok) throw new Error("failed");
      // Persist the email so the bell + my-alerts panel can use it next time.
      setUserEmail(email);
      toast.success(t("subscribe.created"));
      onOpenChange(false);
      setEmail("");
    } catch {
      toast.error(t("subscribe.error"));
    } finally {
      setSubmitting(false);
    }
  }

  const suggested = minPrice ? Math.round(minPrice * 0.8) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Bell className="h-4 w-4" />
            </span>
            {t("subscribe.title")}
          </DialogTitle>
          <DialogDescription>{t("subscribe.subtitle")}</DialogDescription>
        </DialogHeader>

        {service && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {localizedCategory(service.category, lang)}
            </div>
            <div className="text-sm font-semibold">{svcName(service, lang)}</div>
            {minPrice != null && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingDown className="h-3 w-3 text-emerald-500" />
                min {formatKzt(minPrice)} → {t("subscribe.threshold")}: {formatKzt(suggested!)}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <Mail className="h-3 w-3" />
              {t("subscribe.email")}
            </Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("subscribe.threshold")}</Label>
            <Input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={suggested ? String(suggested) : "5000"}
              className="h-10"
              min={0}
              step={500}
            />
            {suggested != null && (
              <button
                onClick={() => setThreshold(String(suggested))}
                className="text-[11px] text-primary hover:underline"
              >
                {t("subscribe.threshold")}: {formatKzt(suggested)}
              </button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("clinic.close")}
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-1.5">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            {t("subscribe.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
