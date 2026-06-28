"use client";

import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { fetcher, type ServiceDirectoryItem } from "@/lib/format";
import { localizedCategory } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, Search, AlertCircle, Brain, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";

type AISearchResult = {
  id: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  category: string;
  synonyms: string[];
  aiReason: string;
  aiScore: number;
};

type AIResponse = {
  query: string;
  services: AISearchResult[];
  elapsedMs: number;
  warning?: string;
};

const EXAMPLE_QUERIES = {
  ru: [
    "Мне нужен полный чекап крови и щитовидки",
    "Болит спина — к какому врачу?",
    "Хочу проверить сердце перед спортом",
    "Сдать анализы перед беременностью",
  ],
  en: [
    "I need a full health checkup with blood work",
    "My back hurts — which doctor should I see?",
    "Heart checkup before starting sports",
    "Fertility prep blood tests",
  ],
  kk: [
    "Маған толық қан тексеруі керек",
    "Белім ауырады — қай дәрігерге баруым керек?",
    "Спорт бастамас бұрын жүректі тексеру",
    "Қан анализі және қалқанша безі",
  ],
};

export function AiSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const setFilters = useAppStore((s) => s.setFilters);
  const [query, setQuery] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AIResponse>({
    queryKey: ["ai-search", query],
    queryFn: () =>
      fetcher("/api/v1/ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      }),
    enabled: false, // manual trigger only
    staleTime: 5 * 60_000,
  });

  function handleSearch() {
    if (query.trim().length < 3) {
      toast.error(t("ai.error"));
      return;
    }
    refetch();
  }

  function handleExample(q: string) {
    setQuery(q);
  }

  function chooseService(s: AISearchResult) {
    const name = lang === "kk" ? s.nameKk : lang === "en" ? s.nameEn : s.nameRu;
    setFilters({ q: name });
    onOpenChange(false);
    toast.success(t("ai.results", { count: 1 }));
  }

  const results = data?.services ?? [];
  const examples = EXAMPLE_QUERIES[lang as keyof typeof EXAMPLE_QUERIES] ?? EXAMPLE_QUERIES.en;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0 sm:rounded-2xl">
        <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-cyan-500/5 to-transparent p-5">
          <DialogTitle className="flex items-center gap-2 text-lg font-black">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-primary to-cyan-600 text-primary-foreground shadow-md">
              <Brain className="h-4 w-4" />
            </span>
            <span className="gradient-text">{t("ai.title")}</span>
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-sm">
            {t("ai.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-5">
          {/* Input */}
          <div className="space-y-2">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ai.placeholder")}
              className="min-h-[80px] resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSearch();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground/70">
                ⌘+Enter to search
              </p>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSearch}
                disabled={isLoading || isFetching || query.trim().length < 3}
              >
                {isLoading || isFetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                {isLoading || isFetching ? t("ai.searching") : t("ai.search")}
              </Button>
            </div>
          </div>

          {/* Example queries */}
          {!data && !isLoading && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/70">
                {t("quicklinks.title")}:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {examples.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleExample(q)}
                    className="search-tag-pill text-[11px]"
                  >
                    <Sparkles className="h-2.5 w-2.5 opacity-60" />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {isError && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-300/50 bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {t("ai.error")}
            </div>
          )}

          {data && results.length === 0 && !isError && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("ai.noResults")}</p>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  {t("ai.results", { count: results.length })}
                </p>
                <span className="text-[10px] text-muted-foreground/60">
                  {data.elapsedMs} ms
                </span>
              </div>
              <ul className="max-h-[320px] space-y-1.5 overflow-y-auto scrollbar-thin">
                {results.map((s, i) => (
                  <li key={s.id}>
                    <button
                      onClick={() => chooseService(s)}
                      className="msp-card-hover flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card p-3 text-left transition-all hover:border-primary/40 hover:shadow-sm"
                      style={{ animationDelay: `${i * 35}ms` }}
                    >
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-[10px] font-bold uppercase text-primary">
                        {s.category.slice(0, 3)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">
                            {lang === "kk" ? s.nameKk : lang === "en" ? s.nameEn : s.nameRu}
                          </span>
                          {s.aiScore >= 0.9 && (
                            <Badge className="shrink-0 bg-emerald-500/15 px-1.5 py-0 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
                              {Math.round(s.aiScore * 100)}%
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {localizedCategory(s.category, lang)}
                        </span>
                        {s.aiReason && (
                          <span className="mt-1 block text-[11px] italic text-muted-foreground/80">
                            “{s.aiReason}”
                          </span>
                        )}
                      </span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Disclaimer */}
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground/60">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            {t("ai.disclaimer")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
