"use client";

import { useState } from "react";
import { useAppStore } from "@/store/app-store";
import { useI18n } from "@/components/providers";
import { useMutation } from "@tanstack/react-query";
import { fetcher } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, HeartPulse, AlertTriangle, AlertCircle, Sparkles } from "lucide-react";

/**
 * Symptom Mapper Dialog — Workstream 6a.
 *
 * Backed by POST /api/v1/symptoms/match which uses the deterministic,
 * LLM-free rule engine in `src/lib/symptom-map.ts`. The user describes a
 * symptom (RU/EN/KK), the API resolves hand-curated rules against the
 * live `ServiceDirectory`, and the dialog renders up to 5 suggested
 * services with confidence badges, reasons, and cheapest-known prices.
 *
 * Clicking a suggestion closes the dialog and drops the user into the main
 * search view with that service's localized name as the search query.
 *
 * The disclaimer (`t("symptom.disclaimer")`) is ALWAYS visible — this tool
 * is informational only and NOT a medical diagnosis.
 */
type SymptomSuggestion = {
  serviceId: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  category: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  minPriceKzt?: number;
};

type SymptomResponse = {
  query: string;
  suggestions: SymptomSuggestion[];
  elapsedMs: number;
  warning?: string;
};

/**
 * Example queries per language. Hardcoded (not i18n keys) to match the
 * pattern used by `ai-search-dialog.tsx`. Each example is chosen to
 * deterministically match at least one rule in `src/lib/symptom-map.ts`
 * so the user immediately sees the value of the tool.
 */
const EXAMPLE_QUERIES: Record<string, string[]> = {
  ru: [
    "Боль в груди",
    "Температура и кашель",
    "Головная боль",
    "Усталость и слабость",
  ],
  en: [
    "Chest pain",
    "Fever and cough",
    "Headache",
    "Fatigue and weakness",
  ],
  kk: [
    "Кеуде ауырсынуы",
    "Қызба және жөтел",
    "Бас ауыруы",
    "Шаршау",
  ],
};

export function SymptomDialog() {
  const { t, lang } = useI18n();
  const open = useAppStore((s) => s.symptomOpen);
  const setOpen = useAppStore((s) => s.setSymptomOpen);
  const setView = useAppStore((s) => s.setView);
  const setFilters = useAppStore((s) => s.setFilters);
  const [query, setQuery] = useState("");

  const mutation = useMutation({
    mutationFn: async (q: string) => {
      return fetcher<SymptomResponse>("/api/v1/symptoms/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
    },
  });

  function handleSubmit() {
    if (query.trim().length < 3) return;
    mutation.mutate(query.trim());
  }

  function pickService(s: SymptomSuggestion) {
    const name = lang === "kk" ? s.nameKk : lang === "en" ? s.nameEn : s.nameRu;
    setFilters({ q: name });
    setView("search");
    setOpen(false);
  }

  const examples =
    EXAMPLE_QUERIES[lang] ?? EXAMPLE_QUERIES.en;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-rose-500" />
            {t("symptom.title")}
          </DialogTitle>
          <DialogDescription>{t("symptom.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("symptom.placeholder")}
            rows={3}
            disabled={mutation.isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground/70">
              ⌘+Enter
            </p>
            <Button
              onClick={handleSubmit}
              disabled={mutation.isPending || query.trim().length < 3}
              className="gap-2"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <HeartPulse className="h-4 w-4" />
              )}
              {mutation.isPending ? t("symptom.searching") : t("symptom.search")}
            </Button>
          </div>

          {/* Example queries — only show before the first search to keep the
              post-search UI focused on results. Clicking fills the textarea
              (does NOT auto-submit) so the user can edit before searching. */}
          {!mutation.data && !mutation.isPending && !mutation.isError && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/70">
                {t("symptom.placeholder")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {examples.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setQuery(q)}
                    className="search-tag-pill text-[11px]"
                  >
                    <Sparkles className="h-2.5 w-2.5 opacity-60" />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error state — never crashes the UI; shows a retry-friendly
              message and lets the user submit again. */}
          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-300/50 bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("symptom.error")}</span>
            </div>
          )}

          {mutation.data && (
            <div className="space-y-2">
              {mutation.data.suggestions.length === 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1">
                    <p>{t("symptom.noResults")}</p>
                    {mutation.data.warning && (
                      <p className="text-[11px] opacity-80">{mutation.data.warning}</p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {t("symptom.results", { count: mutation.data.suggestions.length })}
                    </p>
                    <span className="text-[10px] text-muted-foreground/60">
                      {mutation.data.elapsedMs} ms
                    </span>
                  </div>
                  <ul className="max-h-72 space-y-2 overflow-y-auto">
                    {mutation.data.suggestions.map((s) => (
                      <li
                        key={s.serviceId}
                        className="rounded-lg border border-border/60 bg-muted/30 p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
                      >
                        <button
                          onClick={() => pickService(s)}
                          className="w-full text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">
                                {lang === "kk" ? s.nameKk : lang === "en" ? s.nameEn : s.nameRu}
                              </p>
                              <p className="mt-0.5 text-xs italic text-muted-foreground">{s.reason}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                s.confidence === "high"
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : s.confidence === "medium"
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                    : "border-muted-foreground/40 bg-muted text-muted-foreground"
                              }
                            >
                              {t(`symptom.confidence.${s.confidence}`)}
                            </Badge>
                          </div>
                          {s.minPriceKzt != null && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("heatmap.minPrice")}: {new Intl.NumberFormat("ru-RU").format(s.minPriceKzt)} ₸
                            </p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Disclaimer — ALWAYS visible, regardless of state. This tool is
              informational only and NOT a medical diagnosis. */}
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>{t("symptom.disclaimer")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
