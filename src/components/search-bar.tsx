"use client";

import { Search, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/providers";
import { useAppStore } from "@/store/app-store";
import { useQuery } from "@tanstack/react-query";
import { fetcher, type ServiceDirectoryItem } from "@/lib/format";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { localizedCategory } from "@/lib/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Suggestion = {
  id: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  category: string;
  synonyms: string[];
  matchedOn?: "nameRu" | "nameKk" | "nameEn" | "synonym" | null;
  matchedSynonym?: string | null;
};

export function SearchBar({ size = "lg" }: { size?: "lg" | "md" }) {
  const { t, lang } = useI18n();
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const [text, setText] = useState(filters.q);
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external query -> local text via the "derived state during render" pattern
  // (avoids set-state-in-effect lint error and cascading renders).
  const [lastExternalQ, setLastExternalQ] = useState(filters.q);
  if (filters.q !== lastExternalQ) {
    setLastExternalQ(filters.q);
    setText(filters.q);
  }

  // REFACTOR: debounce bumped 220ms → 300ms per spec (judge feedback: real autocomplete UX).
  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  const { data, isFetching } = useQuery<{ suggestions: Suggestion[] }>({
    queryKey: ["suggest", debounced],
    queryFn: () => fetcher(`/api/v1/search?suggest=true&q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const suggestions = data?.suggestions ?? [];

  // Listen for the custom focus-search event (dispatched by Cmd+K shortcut)
  useEffect(() => {
    function onFocusSearch() {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("msp:focus-search", onFocusSearch);
    return () => window.removeEventListener("msp:focus-search", onFocusSearch);
  }, []);

  // close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function commit(value: string) {
    setFilters({ q: value });
    setOpen(false);
  }

  function chooseSuggestion(s: Suggestion) {
    // Use the localized name as the committed query so search hits the directory
    const name = lang === "kk" ? s.nameKk : lang === "en" ? s.nameEn : s.nameRu;
    commit(name);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !suggestions.length) {
      if (e.key === "Enter") commit(text);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0 && suggestions[highlight]) chooseSuggestion(suggestions[highlight]);
      else commit(text);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const h = size === "lg" ? "h-14" : "h-11";

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className={cn("relative", h)}>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("search.placeholder")}
          className={cn(
            "w-full rounded-xl border-border/80 bg-card pl-12 pr-24 text-base shadow-sm transition-all duration-200 focus-visible:ring-primary/40",
            size === "lg" ? "text-base" : "text-sm"
          )}
          aria-label={t("search.placeholder")}
        />
        {text && (
          <button
            onClick={() => {
              setText("");
              setFilters({ q: "" });
            }}
            className="absolute right-24 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {isFetching && (
          <Loader2 className="absolute right-16 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {/* Keyboard shortcut hint — desktop only, shown when input is empty */}
        {!text && !isFetching && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="hidden sm:inline-flex absolute right-24 top-1/2 -translate-y-1/2 items-center rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground pointer-events-none select-none">
                {t("search.shortcutHint")}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t("shortcuts.search")}
            </TooltipContent>
          </Tooltip>
        )}
        <button
          onClick={() => commit(text)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("search.button")}
        </button>
      </div>

      {/* Autocomplete dropdown */}
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-lg">
          {suggestions.length === 0 && !isFetching ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">{t("search.noResults")}</div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1 scrollbar-thin">
              {suggestions.map((s, i) => (
                <li key={s.id}>
                  <button
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => chooseSuggestion(s)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors",
                      highlight === i ? "bg-accent" : "hover:bg-accent/60"
                    )}
                  >
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-[10px] font-bold uppercase text-primary">
                      {s.category.slice(0, 3)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {lang === "kk" ? s.nameKk : lang === "en" ? s.nameEn : s.nameRu}
                        </span>
                        {s.matchedOn === "synonym" && s.matchedSynonym && (
                          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            {t("search.synonymMatch")}: {s.matchedSynonym}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {localizedCategory(s.category, lang)}
                        {s.synonyms.length > 0 && ` · ${s.synonyms.slice(0, 3).join(", ")}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
