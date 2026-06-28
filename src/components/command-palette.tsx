"use client";

import * as React from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  useAppStore,
  MAX_COMPARE,
  type View,
  type Currency,
} from "@/store/app-store";
import { useI18n } from "@/components/providers";
import { useTheme } from "next-themes";
import {
  Search as SearchIcon,
  GitCompareArrows,
  Map as MapIcon,
  LineChart,
  ShieldCheck,
  Moon,
  Languages,
  Coins,
  Keyboard,
  Plus,
  Activity,
  Microscope,
  Syringe,
  Stethoscope,
  HeartPulse,
} from "lucide-react";
import { toast } from "sonner";
import { fetcher } from "@/lib/format";
import type { Lang } from "@/lib/i18n";

/* -------------------------------------------------------------------------- */
/* Static command definitions                                                 */
/* -------------------------------------------------------------------------- */

type QuickSearch = { query: string; icon: typeof Activity };

const QUICK_SEARCHES: QuickSearch[] = [
  { query: "CBC", icon: Activity },
  { query: "MRI", icon: Microscope },
  { query: "blood test", icon: Activity },
  { query: "ultrasound", icon: HeartPulse },
  { query: "dentist", icon: Stethoscope },
  { query: "vaccination", icon: Syringe },
];

const NAV_ITEMS: {
  view: View;
  icon: typeof SearchIcon;
  key: string;
  shortcut: string;
}[] = [
  { view: "search", icon: SearchIcon, key: "nav.search", shortcut: "G S" },
  { view: "compare", icon: GitCompareArrows, key: "nav.compare", shortcut: "G C" },
  { view: "map", icon: MapIcon, key: "nav.map", shortcut: "G M" },
  { view: "history", icon: LineChart, key: "nav.history", shortcut: "G H" },
  { view: "admin", icon: ShieldCheck, key: "nav.admin", shortcut: "G A" },
];

const LANG_OPTIONS: { code: Lang; native: string; label: string }[] = [
  { code: "kk", native: "Қазақша", label: "Kazakh" },
  { code: "ru", native: "Русский", label: "Russian" },
  { code: "en", native: "English", label: "English" },
];

const CURRENCY_OPTIONS: { code: Currency; symbol: string; label: string }[] = [
  { code: "KZT", symbol: "₸", label: "KZT" },
  { code: "USD", symbol: "$", label: "USD" },
  { code: "RUB", symbol: "₽", label: "RUB" },
];

/* -------------------------------------------------------------------------- */
/* CommandPalette                                                             */
/* -------------------------------------------------------------------------- */

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, setLang } = useI18n();
  const setView = useAppStore((s) => s.setView);
  const setFilters = useAppStore((s) => s.setFilters);
  const setCurrency = useAppStore((s) => s.setCurrency);
  const toggleCompare = useAppStore((s) => s.toggleCompare);
  const { setTheme } = useTheme();
  const [search, setSearch] = React.useState("");

  // Clear the search input shortly after the palette closes so stale text
  // doesn't flash the next time it opens.
  React.useEffect(() => {
    if (!open) {
      const id = window.setTimeout(() => setSearch(""), 150);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  function close() {
    onOpenChange(false);
  }

  function runNav(view: View) {
    setView(view);
    close();
  }

  function runQuickSearch(query: string) {
    setFilters({ q: query });
    setView("search");
    close();
    // Focus the search input after the view swaps so the user can refine.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("msp:focus-search"));
    }, 60);
  }

  async function runAddFirstToCompare() {
    close();
    try {
      const data = await fetcher<{ services: { id: string }[] }>(
        "/api/v1/services"
      );
      if (!data.services?.length) {
        toast.error(t("commandPalette.noResults"));
        return;
      }
      const ok = toggleCompare(data.services[0].id);
      if (!ok) {
        toast.error(t("toast.compareFull", { max: MAX_COMPARE }));
        return;
      }
      toast.success(t("toast.compareAdded"));
      setView("compare");
    } catch {
      toast.error(t("commandPalette.noResults"));
    }
  }

  function runToggleTheme() {
    const isDark =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
    close();
  }

  function runSetLang(code: Lang) {
    setLang(code);
    close();
  }

  function runSetCurrency(code: Currency) {
    setCurrency(code);
    close();
  }

  function runShowShortcuts() {
    close();
    toast.info(
      `${t("shortcuts.title")}\n\n⌘K — ${t(
        "commandPalette.title"
      )}\nEsc — ${t("shortcuts.close")}\n⌘/ — ${t("shortcuts.help")}`,
      { duration: 5000 }
    );
  }

  const trimmed = search.trim();
  const showDynamicSearch = trimmed.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("commandPalette.title")}
      description={t("commandPalette.placeholder")}
      className="sm:max-w-xl"
    >
      <CommandInput
        placeholder={t("commandPalette.placeholder")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>{t("commandPalette.noResults")}</CommandEmpty>

        {/* Dynamic "Search for {query}" — appears whenever the user types anything */}
        {showDynamicSearch && (
          <CommandGroup heading={t("commandPalette.quickSearch")}>
            <CommandItem
              value={`dynamic-search ${trimmed}`}
              onSelect={() => runQuickSearch(trimmed)}
            >
              <SearchIcon className="h-4 w-4 text-primary" />
              <span className="flex-1 truncate">
                {t("commandPalette.searchFor", { query: trimmed })}
              </span>
              <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading={t("commandPalette.navigation")}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.view}
                value={`nav ${item.view} ${t(item.key)}`}
                onSelect={() => runNav(item.view)}
              >
                <Icon className="h-4 w-4" />
                <span>{t(item.key)}</span>
                <CommandShortcut>{item.shortcut}</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("commandPalette.quickSearch")}>
          {QUICK_SEARCHES.map((qs) => {
            const Icon = qs.icon;
            return (
              <CommandItem
                key={qs.query}
                value={`qs ${qs.query}`}
                onSelect={() => runQuickSearch(qs.query)}
              >
                <Icon className="h-4 w-4" />
                <span>{t("commandPalette.searchFor", { query: qs.query })}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("commandPalette.actions")}>
          <CommandItem
            value={`action ${t("commandPalette.addFirstToCompare")} compare first`}
            onSelect={runAddFirstToCompare}
          >
            <Plus className="h-4 w-4" />
            <span>{t("commandPalette.addFirstToCompare")}</span>
          </CommandItem>
          <CommandItem
            value={`action ${t("commandPalette.toggleTheme")} dark light theme`}
            onSelect={runToggleTheme}
          >
            <Moon className="h-4 w-4" />
            <span>{t("commandPalette.toggleTheme")}</span>
          </CommandItem>
          {LANG_OPTIONS.map((l) => (
            <CommandItem
              key={`lang-${l.code}`}
              value={`lang ${l.code} ${l.native} ${l.label} ${t(
                "commandPalette.switchLanguage"
              )}`}
              onSelect={() => runSetLang(l.code)}
            >
              <Languages className="h-4 w-4" />
              <span>
                {t("commandPalette.switchLanguage")} — {l.native}
              </span>
            </CommandItem>
          ))}
          {CURRENCY_OPTIONS.map((c) => (
            <CommandItem
              key={`cur-${c.code}`}
              value={`currency ${c.code} ${c.label} ${c.symbol} ${t(
                "commandPalette.switchCurrency"
              )}`}
              onSelect={() => runSetCurrency(c.code)}
            >
              <Coins className="h-4 w-4" />
              <span>
                {t("commandPalette.switchCurrency")} — {c.label} ({c.symbol})
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("commandPalette.help")}>
          <CommandItem
            value={`help ${t("commandPalette.shortcuts")} ${t(
              "shortcuts.title"
            )} keyboard shortcuts`}
            onSelect={runShowShortcuts}
          >
            <Keyboard className="h-4 w-4" />
            <span>{t("commandPalette.shortcuts")}</span>
            <CommandShortcut>⌘/</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
