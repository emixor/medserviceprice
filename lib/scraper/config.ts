/**
 * Scraper Source Config sync
 * =============================================================
 * STEP 4 (Automated Monitoring & Control Tracking) requires the worker
 * to "read from your existing configurations or tables to determine active
 * target locations, cities, and URLs". This module is the bridge between
 * the static `CLINIC_SOURCES` constant (the developer-curated source list)
 * and the `ScraperSourceConfig` DB table (the operator-mutable routing
 * table).
 *
 * `ensureScraperSourceConfigs()` is idempotent: on first run it inserts a
 * row per `CLINIC_SOURCES` entry; on subsequent runs it refreshes mutable
 * metadata (clinicName, website, parserType, timeout, politeness) while
 * PRESERVING operator-set fields (isActive, lastSuccessfulAt, error
 * counters, parserConfig). This means deploying new code with new clinic
 * entries never wipes operator toggles.
 *
 * `loadActiveScraperSources()` returns the fully-resolved `ScraperSource[]`
 * list — the join of static def + DB config — filtered to `isActive=true`.
 * The worker iterates this list on every run.
 */

import { db } from "@/lib/db";
import { CLINIC_SOURCES, type ClinicSourceDef } from "@/lib/seed-data";
import type { ScraperSource } from "./types";

/** Result of a config-sync pass. */
export type ConfigSyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  total: number;
};

/**
 * Idempotently sync `CLINIC_SOURCES` into the `ScraperSourceConfig` table.
 * Safe to call on every worker boot — uses upsert-by-composite-key.
 *
 * Preserves operator-mutable fields:
 *   - isActive (routing switch)
 *   - parserConfig (per-source JSON config)
 *   - lastAttemptedAt / lastSuccessfulAt / lastErrorAt / lastErrorMessage
 *   - consecutiveFailures / totalRuns / totalSuccess / totalFailed
 *   - totalRowsParsed / totalRowsUpserted
 *
 * Refreshes from the static def:
 *   - clinicName, website (display metadata)
 *   - parserType (set to "simulated" if the row is new; existing rows keep
 *     their operator-chosen parserType unless `forceParserType` is true)
 *   - timeoutMs, politenessMs (reset to defaults only on new rows)
 */
export async function ensureScraperSourceConfigs(
  opts: { forceParserType?: string } = {}
): Promise<ConfigSyncResult> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const src of CLINIC_SOURCES) {
    const existing = await db.scraperSourceConfig.findUnique({
      where: {
        sourceName_city_sourceUrl: {
          sourceName: src.sourceName,
          city: src.city,
          sourceUrl: src.sourceUrl,
        },
      },
    });

    if (!existing) {
      // Insert a fresh row with defaults from the static def.
      await db.scraperSourceConfig.create({
        data: {
          sourceName: src.sourceName,
          clinicName: src.clinicName,
          city: src.city,
          sourceUrl: src.sourceUrl,
          website: src.website,
          isActive: true,
          parserType: opts.forceParserType ?? "simulated",
          timeoutMs: 15000,
          politenessMs: 200,
        },
      });
      created++;
      continue;
    }

    // Row exists — refresh display metadata + (optionally) parserType.
    const nextParserType = opts.forceParserType ?? existing.parserType;
    const needsUpdate =
      existing.clinicName !== src.clinicName ||
      existing.website !== src.website ||
      existing.parserType !== nextParserType;

    if (!needsUpdate) {
      unchanged++;
      continue;
    }

    await db.scraperSourceConfig.update({
      where: { id: existing.id },
      data: {
        clinicName: src.clinicName,
        website: src.website,
        parserType: nextParserType,
      },
    });
    updated++;
  }

  const total = await db.scraperSourceConfig.count();
  return { created, updated, unchanged, total };
}

/**
 * Parse the `parserConfig` JSON column into a plain object (or null on
 * parse failure / empty). Never throws.
 */
function safeParseConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Load all ACTIVE scraper sources, fully resolved (static def + DB config).
 * The worker iterates this list on every run. Inactive sources are skipped.
 *
 * @param filter Optional filter — restrict to a single sourceName or city.
 */
export async function loadActiveScraperSources(filter: {
  sourceName?: string;
  city?: string;
} = {}): Promise<ScraperSource[]> {
  const rows = await db.scraperSourceConfig.findMany({
    where: {
      isActive: true,
      ...(filter.sourceName ? { sourceName: filter.sourceName } : {}),
      ...(filter.city ? { city: filter.city } : {}),
    },
    orderBy: { sourceName: "asc" },
  });

  // Build a quick lookup of static defs by composite key so we can join
  // without an N+1 query against the in-memory CLINIC_SOURCES array.
  const staticByKey = new Map<string, ClinicSourceDef>();
  for (const s of CLINIC_SOURCES) {
    staticByKey.set(`${s.sourceName}|${s.city}|${s.sourceUrl}`, s);
  }

  const out: ScraperSource[] = [];
  for (const row of rows) {
    const key = `${row.sourceName}|${row.city}|${row.sourceUrl}`;
    const def = staticByKey.get(key);
    if (!def) {
      // Orphan row — operator added a source that isn't in the static def.
      // We still run it; the scraper implementation must handle unknown
      // sources gracefully (e.g. the SimulatedScraper falls back to a
      // generic generator). Log a warning so operators notice.
      console.warn(
        `[scraper-config] Source ${row.sourceName} (${row.city}) is not in CLINIC_SOURCES — using DB-only config`
      );
      // Synthesize a minimal ClinicSourceDef from the DB row.
      out.push({
        sourceName: row.sourceName,
        clinicName: row.clinicName,
        city: row.city,
        address: "", // unknown — operator can add via the static def later
        phone: "",
        workingHours: "",
        sourceUrl: row.sourceUrl,
        website: row.website ?? row.sourceUrl,
        rating: 0,
        onlineBooking: false,
        lat: 0,
        lng: 0,
        configId: row.id,
        parserType: row.parserType,
        timeoutMs: row.timeoutMs,
        politenessMs: row.politenessMs,
        parserConfig: safeParseConfig(row.parserConfig),
      });
      continue;
    }
    out.push({
      ...def,
      configId: row.id,
      parserType: row.parserType,
      timeoutMs: row.timeoutMs,
      politenessMs: row.politenessMs,
      parserConfig: safeParseConfig(row.parserConfig),
    });
  }
  return out;
}

/**
 * Update a source's telemetry after a run attempt. Called by the worker
 * after each source completes (success or failure). Atomic: a single
 * `update()` call writes all telemetry fields at once.
 */
export async function recordSourceOutcome(
  configId: string,
  outcome: {
    success: boolean;
    fetched: number;
    upserted: number;
    durationMs: number;
    error: string | null;
  }
): Promise<void> {
  const now = new Date();
  const existing = await db.scraperSourceConfig.findUnique({
    where: { id: configId },
    select: {
      consecutiveFailures: true,
      totalRuns: true,
      totalSuccess: true,
      totalFailed: true,
      totalRowsParsed: true,
      totalRowsUpserted: true,
    },
  });
  if (!existing) return; // row deleted mid-run — nothing to update

  await db.scraperSourceConfig.update({
    where: { id: configId },
    data: {
      lastAttemptedAt: now,
      lastSuccessfulAt: outcome.success ? now : existing.lastSuccessfulAt,
      lastErrorAt: outcome.success ? existing.lastErrorAt : now,
      lastErrorMessage: outcome.success
        ? existing.lastErrorMessage
        : (outcome.error ?? "Unknown error").slice(0, 500),
      consecutiveFailures: outcome.success
        ? 0
        : existing.consecutiveFailures + 1,
      totalRuns: existing.totalRuns + 1,
      totalSuccess: existing.totalSuccess + (outcome.success ? 1 : 0),
      totalFailed: existing.totalFailed + (outcome.success ? 0 : 1),
      totalRowsParsed: existing.totalRowsParsed + outcome.fetched,
      totalRowsUpserted: existing.totalRowsUpserted + outcome.upserted,
    },
  });
}
