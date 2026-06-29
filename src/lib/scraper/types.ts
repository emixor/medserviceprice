/**
 * Scraper pipeline — shared types
 * =============================================================
 * Centralised type definitions for the background scraping pipeline.
 * Kept separate from the registry implementation so that scraper
 * authors can import the interface contract without pulling in the
 * registry's side effects (DB writes, logging, etc.).
 *
 * Design goals:
 *  - Decoupled: scrapers depend only on `ScraperSource` + `RawPriceEntry`,
 *    never on the worker or the DB client.
 *  - Idiomatic: matches the existing `ClinicSourceDef` shape from
 *    `src/lib/seed-data.ts` so the simulated scraper can delegate to the
 *    existing `generateRawEntriesForClinic` helper without adaptation.
 *  - Extensible: new scrapers (KDL, Invitro, etc.) implement `BaseScraper`
 *    and register themselves via `registerScraper()` in `registry.ts`.
 */

import type { ClinicSourceDef, RawPriceEntry } from "@/lib/seed-data";

/**
 * A fully-resolved scrape target — the union of the static
 * `ClinicSourceDef` (from `CLINIC_SOURCES`) and the operator-configurable
 * fields from the `ScraperSourceConfig` DB row. The worker builds one of
 * these per active source before handing it to the registry-selected
 * scraper implementation.
 */
export type ScraperSource = ClinicSourceDef & {
  /** DB primary key of the `ScraperSourceConfig` row (for telemetry writes). */
  configId: string;
  /** Parser module key — selects the scraper implementation from the registry. */
  parserType: string;
  /** Per-source execution timeout in ms (enforced via Promise.race). */
  timeoutMs: number;
  /** Politeness delay between requests to this source (ms). */
  politenessMs: number;
  /** Optional parser config (parsed JSON object, or null). */
  parserConfig: Record<string, unknown> | null;
};

/** Result of a single source's fetch+parse cycle. */
export type ScraperFetchResult = {
  sourceName: string;
  clinicName: string;
  city: string;
  /** Number of raw price entries fetched from the source. */
  fetched: number;
  /** The raw entries themselves (pre-normalization). */
  entries: RawPriceEntry[];
  /** Wall-clock duration of the fetch+parse, in ms. */
  durationMs: number;
  /** Non-fatal warnings (e.g. partial page parse) — logged but not fatal. */
  warnings: string[];
};

/**
 * Abstract base contract for a scraper implementation.
 *
 * Each concrete scraper (e.g. `SimulatedScraper`, a future `KdlHtmlScraper`,
 * `InvitroJsonScraper`, etc.) implements this interface and registers an
 * instance under a unique `parserType` key via `registerScraper()`.
 *
 * The worker looks up the scraper by `source.parserType` and calls `run()`.
 * Scrapers MUST:
 *   - honour the `signal` argument (abort promptly when the worker cancels
 *     a run — e.g. on timeout or shutdown);
 *   - throw on hard failure (network error, layout change, etc.) — the
 *     worker's per-source fault-isolation try/catch will log + isolate;
 *   - NEVER write to the DB directly — that is the worker's responsibility
 *     (keeps scrapers pure and testable).
 */
export interface BaseScraper {
  /** Registry key — matches `ScraperSourceConfig.parserType`. */
  readonly type: string;
  /**
   * Execute the fetch+parse cycle for one source.
   *
   * @param source  The resolved scrape target (static def + DB config).
   * @param signal  AbortSignal — scrapers MUST check this between long
   *                operations and abort promptly when fired.
   * @returns       The fetched raw entries + telemetry.
   * @throws        On any unrecoverable failure (network, parse, layout).
   */
  run(source: ScraperSource, signal: AbortSignal): Promise<ScraperFetchResult>;
}

/** Per-source outcome recorded by the worker after each attempt. */
export type SourceRunOutcome = {
  configId: string;
  sourceName: string;
  clinicName: string;
  city: string;
  sourceUrl: string;
  status: "success" | "failed";
  fetched: number;
  normalized: number;
  unmatched: number;
  upserted: number;
  durationMs: number;
  error: string | null;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
};

/** Aggregate result of one background ingestion job. */
export type IngestionJobReport = {
  jobId: string;
  status: "success" | "partial" | "failed";
  triggeredBy: string;
  sourcesTotal: number;
  sourcesDone: number;
  sourcesFailed: number;
  rowsFetched: number;
  rowsNormalized: number;
  rowsUnmatched: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  sources: SourceRunOutcome[];
  errorMessage: string | null;
};

/** Options accepted by `enqueueIngestion` and `runIngestionInBackground`. */
export type IngestionOptions = {
  /** Originator of the run — recorded in `triggeredBy` for audit. */
  triggeredBy?: "manual" | "schedule" | "api";
  /** Restrict the run to a single source name (e.g. "KDL"). Default: all active. */
  sourceName?: string;
  /** Restrict the run to a single city. Default: all cities. */
  city?: string;
  /** When true, the second source is forced to fail (demo of fault tolerance). */
  forceOneFailure?: boolean;
};
