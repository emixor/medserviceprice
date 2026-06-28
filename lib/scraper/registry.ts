/**
 * Scraper Registry
 * =============================================================
 * Implements the "abstract or object-oriented structural base layout that
 * allows developers to easily register new target scrapers/parsers" from
 * the pipeline spec (STEP 3 — Data Sources Expansion).
 *
 * The registry is a simple in-memory `Map<string, BaseScraper>`. Scrapers
 * register themselves at module-load time via `registerScraper()`, and the
 * worker resolves the implementation for a given source by looking up
 * `source.parserType` in the registry.
 *
 * Convention: a scraper module (e.g. `src/lib/scraper/scrapers/kdl.ts`)
 * should call `registerScraper(new KdlScraper())` at the bottom of its
 * file, and the worker entry point (`worker.ts`) imports the module for
 * its side effect. This keeps the registry open for extension without
 * modifying the worker.
 *
 * The default `SimulatedScraper` (registered under "simulated") delegates
 * to the existing `generateRawEntriesForClinic` helper so the production
 * pipeline keeps working against the deterministic seed-data generator
 * until real external scrapers are wired in.
 */

import {
  CLINIC_SOURCES,
  generateRawEntriesForClinic,
  type ClinicSourceDef,
  type RawPriceEntry,
} from "@/lib/seed-data";
import { withRetry } from "@/lib/parser/retry";
import type { BaseScraper, ScraperFetchResult, ScraperSource } from "./types";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY = new Map<string, BaseScraper>();

/**
 * Register a scraper implementation under its `type` key.
 * Idempotent — re-registering the same type replaces the prior instance
 * (useful for hot-reload during development).
 */
export function registerScraper(scraper: BaseScraper): void {
  if (!scraper.type || typeof scraper.type !== "string") {
    throw new Error(`Scraper ${scraper.constructor.name} has no valid type`);
  }
  REGISTRY.set(scraper.type, scraper);
}

/**
 * Resolve a scraper implementation by its registry key.
 * Falls back to the `SimulatedScraper` (type "simulated") when the
 * requested type is unknown — this guarantees the pipeline never crashes
 * on a stale config row that references a since-removed scraper module.
 */
export function getScraper(parserType: string): BaseScraper {
  const found = REGISTRY.get(parserType);
  if (found) return found;
  const fallback = REGISTRY.get("simulated");
  if (fallback) return fallback;
  // Should be unreachable — SimulatedScraper is registered at the bottom
  // of this file and imported by the worker. If we get here, the worker
  // forgot to import this module.
  throw new Error(
    `Scraper registry is empty — no scraper registered for type "${parserType}" and no fallback available`
  );
}

/** List all registered scraper types (for the admin UI). */
export function listRegisteredScrapers(): string[] {
  return Array.from(REGISTRY.keys()).sort();
}

// ---------------------------------------------------------------------------
// Default SimulatedScraper
// ---------------------------------------------------------------------------

/**
 * The default scraper implementation — generates realistic raw price
 * payloads deterministically from `seed-data.ts`. This is the same logic
 * the original `fetchSourcePricePage()` in `src/lib/scraper.ts` used; it
 * has been extracted into a scraper-class shape so the worker can treat
 * all sources uniformly via the registry.
 *
 * In a production deployment, this would be replaced (or supplemented) by
 * real HTTP scrapers (e.g. `KdlHtmlScraper`, `InvitroJsonScraper`) that
 * each implement `BaseScraper.run()` and register themselves at import time.
 *
 * Fault tolerance:
 *   - Politeness delay (120–300ms) before generating the payload.
 *   - Optional `simulateFailure` flag (set by the worker when the operator
 *     passes `forceOneFailure`) to demonstrate per-source fault isolation.
 *   - Wrapped in `withRetry` (3 attempts, full-jitter backoff) so transient
 *     errors are absorbed before the worker's isolation catch handles them.
 *   - Honours the AbortSignal: rejects immediately with `signal.reason`
 *     when the worker cancels (timeout / shutdown).
 */
export class SimulatedScraper implements BaseScraper {
  readonly type = "simulated";

  async run(
    source: ScraperSource,
    signal: AbortSignal
  ): Promise<ScraperFetchResult> {
    const t0 = Date.now();
    // Determine whether this run should be forced to fail (operator demo).
    // The worker stashes the "force fail" flag in `parserConfig.__forceFail`.
    const forceFail = Boolean(
      source.parserConfig && (source.parserConfig as Record<string, unknown>).__forceFail
    );

    const entries = await withRetry<RawPriceEntry[]>(
      async () => {
        // Honour abort between retry attempts.
        if (signal.aborted) {
          throw signal.reason ?? new Error("Aborted");
        }
        // Politeness delay — simulates network round-trip + parse time.
        await sleep(120 + Math.random() * 180, signal);

        if (signal.aborted) {
          throw signal.reason ?? new Error("Aborted");
        }

        if (forceFail) {
          throw new Error(
            `Simulated network failure for ${source.sourceName} (${source.sourceUrl}): connection reset by peer`
          );
        }

        // Deterministic seed derived from clinic name + city + source for
        // reproducible runs — same as the original scraper.ts logic.
        const seedStr = `${source.clinicName}|${source.city}|${source.sourceName}`;
        let seed = 0;
        for (let i = 0; i < seedStr.length; i++) {
          seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
        }
        return generateRawEntriesForClinic(source as ClinicSourceDef, seed);
      },
      {
        maxAttempts: 3,
        baseDelayMs: 150,
        jitter: "full",
        signal,
        onRetry: (err, attempt, delayMs) => {
          console.warn(
            `[scraper:simulated][retry] ${source.sourceName} attempt ${attempt} failed (${delayMs}ms backoff): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        },
      }
    );

    return {
      sourceName: source.sourceName,
      clinicName: source.clinicName,
      city: source.city,
      fetched: entries.length,
      entries,
      durationMs: Date.now() - t0,
      warnings: [],
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

// Auto-register the default scraper so the worker only needs to import
// this module to have a working "simulated" parserType.
registerScraper(new SimulatedScraper());

// Re-export the source list for the worker's convenience (it already
// lives in seed-data.ts; this just saves the worker an extra import).
export { CLINIC_SOURCES };
