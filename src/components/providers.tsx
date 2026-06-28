"use client";

import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster as SonnerToaster } from "sonner";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANGS, translate, type Lang } from "@/lib/i18n";

/* ---------------- i18n context ---------------- */
type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};
const I18nContext = createContext<I18nCtx | null>(null);

export function useI18n(): I18nCtx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within Providers");
  return ctx;
}

const LANG_KEY = "msp.lang";

function detectInitialLang(): Lang {
  if (typeof window === "undefined") return "ru";
  const stored = window.localStorage.getItem(LANG_KEY) as Lang | null;
  if (stored && LANGS.some((l) => l.code === stored)) return stored;
  const nav = window.navigator.language.toLowerCase();
  if (nav.startsWith("kk")) return "kk";
  if (nav.startsWith("en")) return "en";
  return "ru";
}

function I18nProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage synchronously to avoid hydration flash; falls back to "ru".
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "ru";
    return detectInitialLang();
  });

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") window.localStorage.setItem(LANG_KEY, l);
  }, []);

  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/* ---------------- root providers ---------------- */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          {children}
          <SonnerToaster position="top-right" richColors closeButton />
        </I18nProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
