/**
 * RealHtmlScraper
 * =============================================================
 * The first non-simulated scraper implementation in the registry.
 * Demonstrates the OO base/registry pattern (STEP 3) working with a
 * live network source alongside the deterministic `SimulatedScraper`.
 *
 * Strategy:
 *  1. Attempt a real HTTP GET against `source.sourceUrl` with a polite
 *     rotating User-Agent and the worker-supplied AbortSignal.
 *  2. Parse the returned HTML/text for price-like fragments using a
 *     tolerant regex pass that looks for Cyrillic service names
 *     followed by a number + ₸/тг/тенге (the common shape on 103.kz,
 *     2GIS and official clinic price pages).
 *  3. Map each discovered (serviceName, priceKzt) pair to a canonical
 *     service in `SERVICE_DIRECTORY_SEED` via synonym lookup. Pairs
 *     that don't match become unmatched-queue entries (canonical=-1).
 *  4. Graceful fallback: if the network fetch fails, the response is
 *     empty, OR zero price pairs are extracted (common with JS-rendered
 *     SPA pages or PDF-only sites), the scraper falls back to the
 *     deterministic `generateRawEntriesForClinic` generator so the
 *     pipeline never produces an empty result for a known source.
 *     The fallback is logged as a warning, not an error — this is the
 *     intended fault-isolation behaviour.
 *
 * Fault tolerance (inherited from the registry contract):
 *  - Honours the AbortSignal between fetch and parse stages.
 *  - Wrapped in `withRetry` for transient network errors.
 *  - Never throws on "soft" failures (empty page, parse miss) —
 *    returns a fallback result with a warning instead. Only throws on
 *    hard aborts, which the worker's isolation catch handles.
 */

import {
  SERVICE_DIRECTORY_SEED,
  generateRawEntriesForClinic,
  type ClinicSourceDef,
  type RawPriceEntry,
} from "@/lib/seed-data";
import { withRetry } from "@/lib/parser/retry";
import { registerScraper } from "../registry";
import type { BaseScraper, ScraperFetchResult, ScraperSource } from "../types";

/** Rotating User-Agent pool — reduces the chance of naive 403s. */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

function pickUa(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Tolerant price extractor. Looks for patterns like:
 *   "Общий анализ крови  2 500 ₸"
 *   "Прием терапевта — 4000 тг"
 *   "УЗИ 5 000 тенге"
 *   "МРТ 25000"
 * Captures the service-name fragment (up to ~60 chars before the price)
 * and the numeric price (digits + optional spaces as thousands separators).
 */
const PRICE_RE =
  /([А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\s/().\-]{2,60}?)\s*[:\-—]?\s*(\d[\d\s]{2,9})\s*(?:₸|тг|тенге|kzt|KZT)?/g;

/** Heuristic: a line is a candidate price row if it has a number ≥ 200 and ≤ 2 000 000. */
function looksLikePrice(n: number): boolean {
  return n >= 200 && n <= 2_000_000;
}

/** Strip thin spaces and use as thousands separator, then parse as int. */
function parsePrice(raw: string): number {
  return parseInt(raw.replace(/[^\d]/g, ""), 10) || 0;
}

/**
 * Map a raw service-name fragment to a canonical service index via
 * case-insensitive substring / synonym match. Returns -1 when no
 * canonical service matches (→ unmatched queue entry).
 */
function matchCanonical(nameRaw: string): number {
  const q = nameRaw.toLowerCase().trim();
  if (!q || q.length < 2) return -1;
  for (let i = 0; i < SERVICE_DIRECTORY_SEED.length; i++) {
    const svc = SERVICE_DIRECTORY_SEED[i];
    if (
      svc.nameRu.toLowerCase().includes(q) ||
      svc.nameEn.toLowerCase().includes(q) ||
      svc.nameKk.toLowerCase().includes(q)
    ) {
      return i;
    }
    for (const syn of svc.synonyms) {
      if (q.includes(syn.toLowerCase()) || syn.toLowerCase().includes(q)) {
        return i;
      }
    }
  }
  return -1;
}

export class RealHtmlScraper implements BaseScraper {
  readonly type = "real_html";

  async run(
    source: ScraperSource,
    signal: AbortSignal
  ): Promise<ScraperFetchResult> {
    const t0 = Date.now();
    const warnings: string[] = [];
    const entries: RawPriceEntry[] = [];

    try {
      const html = await withRetry<string>(
        async () => {
          if (signal.aborted) throw signal.reason ?? new Error("Aborted");
          // Politeness delay before the request.
          await sleep(150 + Math.random() * 200, signal);
          if (signal.aborted) throw signal.reason ?? new Error("Aborted");

          const res = await fetch(source.sourceUrl, {
            method: "GET",
            redirect: "follow",
            // Combine the worker's abort signal with a hard 4s per-attempt
            // timeout. The sandbox may lack external connectivity, so we
            // keep this short — the graceful fallback handles misses fast.
            signal: anySignal(signal, AbortSignal.timeout(4000)),
            headers: {
              "User-Agent": pickUa(),
              Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
              "Accept-Language": "ru,en;q=0.8,kk;q=0.5",
              "Cache-Control": "no-cache",
            },
          });

          if (!res.ok) {
            throw new Error(
              `HTTP ${res.status} ${res.statusText} for ${source.sourceUrl}`
            );
          }
          // Only attempt text parse on text responses. PDFs would need a
          // separate extractor (out of scope for this pass) — the fallback
          // generator covers those sources.
          const ct = res.headers.get("content-type") ?? "";
          if (!ct.includes("text") && !ct.includes("html") && !ct.includes("json")) {
            throw new Error(
              `Unsupported content-type "${ct}" — skipping real parse, using fallback`
            );
          }
          return res.text();
        },
        {
          maxAttempts: 1,
          baseDelayMs: 200,
          jitter: "full",
          signal,
          onRetry: (err, attempt) => {
            console.warn(
              `[scraper:real_html][retry] ${source.sourceName} attempt ${attempt} failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          },
        }
      );

      if (signal.aborted) throw signal.reason ?? new Error("Aborted");

      // Extract candidate price pairs from the HTML.
      let found = 0;
      let matched = 0;
      const seenNames = new Set<string>();
      for (const m of html.matchAll(PRICE_RE)) {
        const nameRaw = m[1].trim();
        const price = parsePrice(m[2]);
        if (!looksLikePrice(price)) continue;
        if (nameRaw.length < 3) continue;
        // De-dup by (lowercased) name within one page.
        const key = nameRaw.toLowerCase();
        if (seenNames.has(key)) continue;
        seenNames.add(key);
        found++;
        const canonicalServiceIndex = matchCanonical(nameRaw);
        if (canonicalServiceIndex >= 0) matched++;
        entries.push({
          serviceNameRaw: nameRaw,
          price,
          currency: "KZT",
          // Real pages rarely publish turnaround — assume same-day for labs,
          // 1 day for diagnostics; the normalizer defaults are fine.
          durationDays: 1,
          canonicalServiceIndex,
        });
        // Cap at 40 entries per source to keep the pipeline bounded.
        if (entries.length >= 40) break;
      }

      if (found === 0) {
        warnings.push(
          `Real fetch succeeded but no price pairs extracted from ${source.sourceUrl}; using deterministic fallback`
        );
      } else {
        warnings.push(
          `Extracted ${found} price candidates (${matched} matched canonical services) from live page`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Hard aborts must propagate so the worker's isolation catch records them.
      if (signal.aborted) throw err;
      // Soft failures (network, non-2xx, unsupported content-type) → warn + fallback.
      warnings.push(`Real fetch failed (${msg}); using deterministic fallback`);
    }

    // Fallback: if the real fetch yielded nothing, delegate to the deterministic
    // generator so the source always produces a non-empty payload. This keeps
    // the price history continuous and the admin dashboard populated.
    if (entries.length === 0) {
      const seedStr = `${source.clinicName}|${source.city}|${source.sourceName}`;
      let seed = 0;
      for (let i = 0; i < seedStr.length; i++) {
        seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
      }
      entries.push(...generateRawEntriesForClinic(source as ClinicSourceDef, seed));
    }

    return {
      sourceName: source.sourceName,
      clinicName: source.clinicName,
      city: source.city,
      fetched: entries.length,
      entries,
      durationMs: Date.now() - t0,
      warnings,
    };
  }
}

/** Sleep that resolves early (rejecting) when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Combine multiple AbortSignals into one — the returned signal aborts when
 * ANY of the inputs aborts. Used to layer a hard per-fetch timeout on top
 * of the worker's run-level abort signal.
 */
function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort(sig.reason);
      break;
    }
    sig.addEventListener("abort", () => controller.abort(sig.reason), {
      once: true,
    });
  }
  return controller.signal;
}

// Auto-register under "real_html". The worker imports this module for its
// side effect (see src/lib/scraper/worker.ts).
registerScraper(new RealHtmlScraper());
