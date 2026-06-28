/**
 * Ingestion / Scraper Engine
 * -------------------------------------------------------------
 * Simulates 3+ scraping sources (KDL, Invitro, Olymp, Helix, Medel, Aksai, MCK).
 *
 * In a production deployment, each source's `fetch()` would perform a real
 * HTTP fetch + BeautifulSoup/Cheerio parse. Here we generate realistic raw
 * payloads from `seed-data.ts` so the full pipeline (dedup -> normalize ->
 * freshness -> price history) is exercised end-to-end.
 *
 * Guarantees implemented:
 *  - Politeness delays between sources (async sleep).
 *  - Fault tolerance: a failing source is logged with full stack trace and
 *    does NOT abort the remaining sources.
 *  - Deterministic dedup via composite key (clinic_name + city + service_name_raw)
 *    using upsert semantics on raw_parsed_data and normalized_prices.
 *  - Data freshness engine: rows not parsed within 30 days are marked is_active=false.
 *  - Currency normalization: USD -> KZT at runtime.
 *  - Raw layer retention: raw rows kept (90+ days) for audit.
 *  - Price history: every upsert that changes the price writes a price_history row.
 */

import { db } from "@/lib/db";
import {
  CLINIC_SOURCES,
  generateRawEntriesForClinic,
  USD_TO_KZT_RATE,
  type ClinicSourceDef,
  type RawPriceEntry,
} from "@/lib/seed-data";
import { findBestMatch, type ServiceCandidate } from "@/lib/normalize";
import { withRetry } from "@/lib/parser/retry";

const FRESHNESS_DAYS = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type IngestSourceResult = {
  sourceName: string;
  clinicName: string;
  city: string;
  fetched: number;
  normalized: number;
  unmatched: number;
  errors: string[];
};

export type IngestReport = {
  startedAt: string;
  finishedAt: string;
  totalFetched: number;
  totalNormalized: number;
  totalUnmatched: number;
  totalErrors: number;
  sources: IngestSourceResult[];
  faultTolerant: boolean;
};

/**
 * Simulate an HTTP fetch of a clinic's price page.
 * In production this would be `httpx.get(source.sourceUrl)` + HTML parsing.
 * Returns a list of raw price entries.
 *
 * We deterministically seed per-source so reruns are reproducible unless the
 * `simulateFailure` flag is set (used to demonstrate fault tolerance).
 *
 * The entire fetch core (politeness delay + simulated failure + deterministic
 * payload generation) is wrapped in `withRetry` (maxAttempts: 3, full jitter,
 * base 150ms). This means transient errors (network resets, timeouts) are
 * retried up to 3 times with exponential backoff + jitter BEFORE the per-source
 * fault-tolerance try/catch in `runIngestion` kicks in. When `simulateFailure`
 * is true, the retry wrapper exhausts all 3 attempts and rethrows — the outer
 * try/catch in `runIngestion` then logs the stack trace and isolates the
 * failing source so the remaining sources still run.
 *
 * REFACTOR: previously this function had no retry layer at all; a single
 * transient network blip would surface as a hard per-source failure. The
 * retry wrapper now absorbs those, leaving the outer try/catch for genuine
 * structural failures only.
 */
async function fetchSourcePricePage(
  source: ClinicSourceDef,
  opts: { simulateFailure?: boolean } = {}
): Promise<RawPriceEntry[]> {
  return withRetry(
    async () => {
      // Politeness delay to avoid overloading target websites
      await sleep(120 + Math.random() * 180);

      if (opts.simulateFailure) {
        throw new Error(
          `Simulated network failure for ${source.sourceName} (${source.sourceUrl}): connection reset by peer`
        );
      }

      // Deterministic seed derived from clinic name + city for reproducible runs
      const seedStr = `${source.clinicName}|${source.city}|${source.sourceName}`;
      let seed = 0;
      for (let i = 0; i < seedStr.length; i++) {
        seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
      }
      return generateRawEntriesForClinic(source, seed);
    },
    {
      maxAttempts: 3,
      baseDelayMs: 150,
      jitter: "full",
      onRetry: (err, attempt, delayMs) => {
        console.warn(
          `[ingest][retry] ${source.sourceName} attempt ${attempt} failed (${delayMs}ms backoff): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      },
    }
  );
}

/** Load the services directory as normalization candidates. */
async function loadDirectory(): Promise<ServiceCandidate[]> {
  const services = await db.serviceDirectory.findMany();
  return services.map((s) => ({
    id: s.id,
    nameRu: s.nameRu,
    nameKk: s.nameKk,
    nameEn: s.nameEn,
    synonyms: safeParseArr(s.synonyms),
    category: s.category,
  }));
}

function safeParseArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Convert a price to KZT if needed. */
function toKzt(price: number, currency: string): number {
  if (currency === "USD") return Math.round(price * USD_TO_KZT_RATE);
  return Math.round(price);
}

/** Find or create a clinic by composite key (name + city). */
async function upsertClinic(source: ClinicSourceDef): Promise<string> {
  const existing = await db.clinic.findFirst({
    where: { clinicName: source.clinicName, city: source.city },
  });
  if (existing) {
    // refresh metadata
    await db.clinic.update({
      where: { id: existing.id },
      data: {
        address: source.address,
        phone: source.phone,
        workingHours: source.workingHours,
        sourceUrl: source.sourceUrl,
        website: source.website,
        rating: source.rating,
        onlineBooking: source.onlineBooking,
        latitude: source.lat,
        longitude: source.lng,
      },
    });
    return existing.id;
  }
  const created = await db.clinic.create({
    data: {
      clinicName: source.clinicName,
      city: source.city,
      address: source.address,
      phone: source.phone,
      workingHours: source.workingHours,
      sourceUrl: source.sourceUrl,
      website: source.website,
      rating: source.rating,
      onlineBooking: source.onlineBooking,
      latitude: source.lat,
      longitude: source.lng,
    },
  });
  return created.id;
}

/** Upsert a raw_parsed_data row by composite key (dedup). Returns its id. */
async function upsertRaw(
  clinicId: string,
  source: ClinicSourceDef,
  entry: RawPriceEntry,
  serviceId: string | null,
  confidence: number,
  now: Date
): Promise<string> {
  const existing = await db.rawParsedData.findFirst({
    where: {
      clinicNameRaw: source.clinicName,
      cityNameRaw: source.city,
      serviceNameRaw: entry.serviceNameRaw,
    },
  });
  const data = {
    clinicId,
    clinicNameRaw: source.clinicName,
    cityNameRaw: source.city,
    serviceNameRaw: entry.serviceNameRaw,
    priceRaw: entry.price,
    currencyRaw: entry.currency,
    durationDays: entry.durationDays,
    sourceUrl: source.sourceUrl,
    sourceName: source.sourceName,
    parsedAt: now,
    serviceId,
    normalized: serviceId !== null,
    confidence,
    rawData: JSON.stringify({
      price: entry.price,
      currency: entry.currency,
      durationDays: entry.durationDays,
      source: source.sourceName,
      url: source.sourceUrl,
    }),
  };
  if (existing) {
    await db.rawParsedData.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await db.rawParsedData.create({ data });
  return created.id;
}

/** Upsert a normalized_prices row; if price changed, append to price_history. */
async function upsertNormalized(
  clinicId: string,
  serviceId: string,
  serviceNameRaw: string,
  priceKzt: number,
  currency: string,
  durationDays: number,
  rawId: string,
  clinicName: string,
  now: Date
): Promise<void> {
  const existing = await db.normalizedPrice.findUnique({
    where: { clinicId_serviceId: { clinicId, serviceId } },
  });
  if (existing) {
    const priceChanged = existing.priceKzt !== priceKzt;
    await db.normalizedPrice.update({
      where: { id: existing.id },
      data: {
        serviceNameRaw,
        priceKzt,
        currency,
        durationDays,
        parsedAt: now,
        isActive: true,
        rawId,
        updatedAt: now,
      },
    });
    if (priceChanged) {
      await db.priceHistory.create({
        data: {
          serviceId,
          clinicId,
          clinicName,
          priceKzt,
          recordedAt: now,
        },
      });
    }
  } else {
    await db.normalizedPrice.create({
      data: {
        clinicId,
        serviceId,
        serviceNameRaw,
        priceKzt,
        currency,
        durationDays,
        parsedAt: now,
        isActive: true,
        rawId,
      },
    });
    // Seed a baseline history point so charts have data immediately
    await db.priceHistory.create({
      data: {
        serviceId,
        clinicId,
        clinicName,
        priceKzt,
        recordedAt: now,
      },
    });
  }
}

/** Route a low-confidence entry to the unmatched queue. */
async function routeToUnmatched(
  source: ClinicSourceDef,
  entry: RawPriceEntry,
  confidence: number,
  suggestedServiceId: string | null,
  now: Date
): Promise<void> {
  const existing = await db.unmatchedQueue.findFirst({
    where: {
      serviceNameRaw: entry.serviceNameRaw,
      clinicNameRaw: source.clinicName,
      cityNameRaw: source.city,
      status: "pending",
    },
  });
  if (existing) {
    await db.unmatchedQueue.update({
      where: { id: existing.id },
      data: {
        priceRaw: entry.price,
        currencyRaw: entry.currency,
        sourceName: source.sourceName,
        confidence,
        parsedAt: now,
        suggestedServiceId,
      },
    });
  } else {
    await db.unmatchedQueue.create({
      data: {
        serviceNameRaw: entry.serviceNameRaw,
        clinicNameRaw: source.clinicName,
        cityNameRaw: source.city,
        priceRaw: entry.price,
        currencyRaw: entry.currency,
        sourceName: source.sourceName,
        confidence,
        parsedAt: now,
        suggestedServiceId,
      },
    });
  }
}

/**
 * Data Freshness Engine: mark normalized_prices rows that haven't been parsed
 * within FRESHNESS_DAYS as inactive.
 */
async function applyFreshness(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.normalizedPrice.updateMany({
    where: { parsedAt: { lt: cutoff }, isActive: true },
    data: { isActive: false },
  });
  return result.count;
}

/**
 * Run a full ingestion cycle across all configured sources.
 * Fault-tolerant: failures in one source do not abort others.
 *
 * @param opts.forceOneFailure When true, the second source will be made to fail
 *   to demonstrate the fault-tolerance guarantee (used by tests + admin demo).
 */
export async function runIngestion(
  opts: { forceOneFailure?: boolean } = {}
): Promise<IngestReport> {
  const startedAt = new Date();
  const directory = await loadDirectory();
  const now = new Date();
  const sources: IngestSourceResult[] = [];
  let totalFetched = 0;
  let totalNormalized = 0;
  let totalUnmatched = 0;
  let totalErrors = 0;

  for (let i = 0; i < CLINIC_SOURCES.length; i++) {
    const source = CLINIC_SOURCES[i];
    const res: IngestSourceResult = {
      sourceName: source.sourceName,
      clinicName: source.clinicName,
      city: source.city,
      fetched: 0,
      normalized: 0,
      unmatched: 0,
      errors: [],
    };
    try {
      const simulateFailure = opts.forceOneFailure && i === 1;
      const entries = await fetchSourcePricePage(source, { simulateFailure });
      res.fetched = entries.length;
      totalFetched += entries.length;

      const clinicId = await upsertClinic(source);

      for (const entry of entries) {
        const match = findBestMatch(entry.serviceNameRaw, directory);
        const rawId = await upsertRaw(
          clinicId,
          source,
          entry,
          match.serviceId,
          match.confidence,
          now
        );
        if (match.serviceId) {
          const priceKzt = toKzt(entry.price, entry.currency);
          await upsertNormalized(
            clinicId,
            match.serviceId,
            entry.serviceNameRaw,
            priceKzt,
            "KZT",
            entry.durationDays,
            rawId,
            source.clinicName,
            now
          );
          res.normalized++;
          totalNormalized++;
        } else {
          await routeToUnmatched(source, entry, match.confidence, match.serviceId, now);
          res.unmatched++;
          totalUnmatched++;
        }
      }
    } catch (err) {
      // Fault tolerance: log full stack trace, continue with remaining sources
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack ?? msg : msg;
      console.error(
        `[ingest] Source ${source.sourceName} (${source.city}) FAILED:\n${stack}`
      );
      res.errors.push(msg);
      totalErrors++;
    }
    sources.push(res);
  }

  await applyFreshness(now);

  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalFetched,
    totalNormalized,
    totalUnmatched,
    totalErrors,
    sources,
    faultTolerant: true,
  };
}
