"use client";

import { useI18n } from "@/components/providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetcher, relativeDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Star, MessageSquare, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Review = {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  lang: string;
  createdAt: string;
};

type ReviewsData = {
  avgRating: number;
  count: number;
  distribution: Record<string, number>;
  reviews: Review[];
};

/** Interactive 5-star selector */
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(0)}
          className="cursor-pointer p-0.5"
          aria-label={`${s} stars`}
        >
          <Star
            className={cn(
              "h-5 w-5 transition-colors",
              s <= active
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40 hover:text-amber-300"
            )}
          />
        </button>
      ))}
    </span>
  );
}

/** Read-only star display */
function StarDisplay({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const sz = size === "md" ? "h-4 w-4" : "h-3 w-3";
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={cn(
            sz,
            s <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
          )}
        />
      ))}
    </span>
  );
}

export function ClinicReviews({ clinicId }: { clinicId: string }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  const { data, isLoading } = useQuery<ReviewsData>({
    queryKey: ["reviews", clinicId],
    queryFn: () => fetcher(`/api/v1/clinics/${clinicId}/reviews`),
    staleTime: 30_000,
  });

  async function submit() {
    if (!author.trim() || !comment.trim()) {
      toast.error(t("reviews.empty"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/clinics/${clinicId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName: author, rating, comment, lang }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(t("clinic.reviewSubmitted"));
      setAuthor("");
      setComment("");
      setRating(5);
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["reviews", clinicId] });
    } catch {
      toast.error(t("reviews.empty"));
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="shimmer h-24 w-full rounded-lg" />
        <div className="shimmer h-32 w-full rounded-lg" />
      </div>
    );
  }

  const reviews = data?.reviews ?? [];
  const avg = data?.avgRating ?? 0;
  const count = data?.count ?? 0;

  return (
    <div className="space-y-4">
      {/* Rating summary with distribution */}
      <div className="card-premium flex flex-wrap items-center gap-5 p-4">
        <div className="text-center">
          <div className="gradient-text text-4xl font-extrabold tabular-nums">
            {avg.toFixed(1)}
          </div>
          <div className="mt-1">
            <StarDisplay rating={avg} size="md" />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {count} {t("clinic.reviewsCount")}
          </div>
        </div>

        {count > 0 && (
          <div className="flex-1 space-y-1.5">
            {[5, 4, 3, 2, 1].map((star) => {
              const c = data?.distribution?.[String(star)] ?? 0;
              const pct = count ? (c / count) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs">
                  <span className="flex w-8 items-center gap-0.5 tabular-nums">
                    {star} <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right tabular-nums text-muted-foreground">{c}</span>
                </div>
              );
            })}
          </div>
        )}

        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setShowForm((v) => !v)}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {t("clinic.writeReview")}
        </Button>
      </div>

      {/* Write review form */}
      {showForm && (
        <div className="card-premium space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("clinic.yourName")}</Label>
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="h-9"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("clinic.yourRating")}</Label>
              <StarPicker value={rating} onChange={setRating} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("clinic.yourComment")}</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={1000}
              className="resize-none"
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t("clinic.submitReview")}
            </Button>
          </div>
        </div>
      )}

      {/* Reviews list */}
      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          {t("clinic.noReviews")}
        </div>
      ) : (
        <ul className="space-y-2">
          {reviews.slice(0, visibleCount).map((r) => (
            <li key={r.id} className="card-premium p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {r.authorName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold">{r.authorName}</span>
                  {r.lang && (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[9px] uppercase text-muted-foreground"
                    >
                      {r.lang}
                    </Badge>
                  )}
                </div>
                <StarDisplay rating={r.rating} />
              </div>
              <p className="mt-2 text-sm text-foreground/90">{r.comment}</p>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {relativeDate(r.createdAt, lang)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Load more */}
      {reviews.length > visibleCount && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((v) => v + 10)}
            className="text-xs"
          >
            {t("clinic.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
