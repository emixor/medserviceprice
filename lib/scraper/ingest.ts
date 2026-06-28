/**
 * Idempotent ingestion primitives
 * =============================================================
 * STEP 2 (Live Idempotent Ingestion Pipeline) — extracted from the
 * original `src/lib/scraper.ts` so the worker can reuse the exact same
 * atomic upsert logic without duplicating it. The original `runIngestion`
 * in `scraper.ts` now delegates here, keeping backward compatibility for
 * the existing `/api/v1/ingest` and `/api/v1/seed` endpoints.
 *
 * Idempotency guarantees (unchanged from the original implementation):
 *   - `upsertClinic`     — composite key (clinicName + city). Updates
 *                          metadata on existing rows; inserts on miss.
 *   - `upsertRaw`        — composite key (clinicNameRaw + cityNameRaw +
 *                          serviceNameRaw). Updates parsedAt + serviceId
 *                          + confidence on existing rows.
 *   - `upsertNormalized` — unique constraint (clinicId, serviceId). On
 *                          hit: updates price + parsedAt + isActive;
 *                          appends to price_history IF the price changed.
 *                          On miss: inserts + seeds a baseline history
 *                          point so charts have data immediately.
 *   - `routeToUnmatched` — composite key (serviceNameRaw + clinicNameRaw
 *                          + cityNameRaw + status="pending"). Updates
 *                          price + confidence on existing pending rows.
 *
 * All operations are single-statement Prisma calls — SQLite serialises
 * them under its default journal mode, so concurrent worker jobs cannot
 * corrupt each other. The worker additionally serialises jobs via an
 * in-memory mutex (see `worker.ts`) to avoid redundant parallel runs.
 */

import { db } from "@/lib/db";
import {
  USD_TO_KZT_RATE,
  type ClinicSourceDef,
  type RawPriceEntry,
} from "@/lib/seed-data";
import { findBestMatch, type ServiceCandidate } from "@/lib/normalize";

const FRESHNESS_DAYS = 30;

/** Load the services directory as normalization candidates. */
export async function loadDirectory(): Promise<ServiceCandidate[]> {
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
export async function upsertClinic(source: ClinicSourceDef): Promise<string> {
  const existing = await db.clinic.findFirst({
    where: { clinicName: source.clinicName, city: source.city },
  });
  if (existing) {
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
export async function upsertRaw(
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
export async function upsertNormalized(
  clinicId: string,
  serviceId: string,
  serviceNameRaw: string,
  priceKzt: number,
  currency: string,
  durationDays: number,
  rawId: string,
  clinicName: string,
  now: Date
): Promise<{ priceChanged: boolean; previousPrice: number | null }> {
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
    return { priceChanged, previousPrice: existing.priceKzt };
  }
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
  return { priceChanged: true, previousPrice: null };
}

/** Route a low-confidence entry to the unmatched queue. */
export async function routeToUnmatched(
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
 * Data Freshness Engine: mark normalized_prices rows that haven't been
 * parsed within FRESHNESS_DAYS as inactive.
 */
export async function applyFreshness(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - FRESHNESS_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.normalizedPrice.updateMany({
    where: { parsedAt: { lt: cutoff }, isActive: true },
    data: { isActive: false },
  });
  return result.count;
}

/**
 * Process a batch of raw entries for a single source through the
 * normalization pipeline. Returns per-source counters.
 *
 * This is the core idempotent ingestion step — called by the worker
 * after each scraper's `run()` returns. All upserts are atomic and
 * safe to retry.
 */
export async function processSourceEntries(
  source: ClinicSourceDef,
  entries: RawPriceEntry[],
  directory: ServiceCandidate[],
  now: Date
): Promise<{
  fetched: number;
  normalized: number;
  unmatched: number;
  upserted: number;
  priceChanges: number;
}> {
  let normalized = 0;
  let unmatched = 0;
  let upserted = 0;
  let priceChanges = 0;

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
      const result = await upsertNormalized(
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
      if (result.priceChanged) priceChanges++;
      normalized++;
      upserted++;
    } else {
      await routeToUnmatched(source, entry, match.confidence, match.serviceId, now);
      unmatched++;
    }
  }

  return {
    fetched: entries.length,
    normalized,
    unmatched,
    upserted,
    priceChanges,
  };
}
