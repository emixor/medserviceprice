/**
 * POST /api/v1/basket/optimize
 *
 * Smart Basket / Split-Saver Optimizer.
 *
 * Given a basket of 1–10 medical service IDs, computes the cheapest way to
 * obtain every service — either at a single clinic (one-stop, more convenient)
 * or split across multiple clinics (each service at its cheapest provider).
 * Returns both options side-by-side, a recommendation, and the potential
 * savings amount + percentage so the UI can render a "Split-Saver" badge.
 *
 * Body: { "serviceIds": ["id1", "id2", ...] }  (1–10 IDs)
 *
 * Algorithm:
 *   1. Validate input (1–10 IDs after dedup + coercion to strings).
 *   2. Fetch all active NormalizedPrice rows for the requested services in
 *      ONE query — the composite index `@@index([serviceId, priceKzt])`
 *      makes this an indexed range scan.
 *   3. Split-optimal: for each service, the cheapest active price across all
 *      clinics. Sum them. Always computable if the service has ≥1 price.
 *   4. Single-clinic: among clinics that have active prices for ALL requested
 *      services, pick the one with the lowest total. Null if no clinic covers
 *      every service.
 *   5. Recommendation: "single" when singleClinic ≤ split (cheaper-or-equal
 *      AND more convenient — one trip instead of N), otherwise "split" with
 *      the savings delta.
 *
 * Edge cases:
 *   - Service IDs with zero active prices are excluded from BOTH computations
 *     and surfaced in a `warnings` array; the remaining services are still
 *     optimized.
 *   - Duplicate IDs in input are deduped (first-seen order preserved).
 *   - If every requested service has no prices, singleClinic is null and
 *     splitOptimal has an empty services array.
 *
 * Response shape: see `BasketOptimizeResponse` below.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard limit on basket size to keep the combinatorial search trivial. */
const MAX_SERVICES = 10;

type OptimizerBody = {
  serviceIds?: unknown;
};

/** One service entry inside the `splitOptimal.services` array. */
type SplitService = {
  serviceId: string;
  clinicId: string;
  clinicName: string;
  city: string;
  priceKzt: number;
  serviceNameRaw: string;
};

/** One service entry inside `singleClinic.services`. */
type SingleService = {
  serviceId: string;
  priceKzt: number;
  serviceNameRaw: string;
};

/** Best single-clinic option (null when no clinic covers every service). */
type SingleClinic = {
  clinicId: string;
  clinicName: string;
  city: string;
  totalPrice: number;
  services: SingleService[];
};

/** Best split-across-clinics option (cheapest per service). */
type SplitOptimal = {
  totalPrice: number;
  clinicCount: number;
  services: SplitService[];
};

/** Full API response. */
type BasketOptimizeResponse = {
  serviceIds: string[];
  singleClinic: SingleClinic | null;
  splitOptimal: SplitOptimal;
  recommendation: "single" | "split";
  savingsKzt: number;
  savingsPct: number;
  elapsedMs: number;
  warnings: string[];
};

/**
 * Round a possibly-fractional KZT value to an integer. KZT is an integer
 * currency in practice; the underlying Float column only exists because
 * USD→KZT conversion can yield fractional intermediates.
 */
function roundKzt(n: number): number {
  return Math.round(n);
}

export async function POST(req: NextRequest): Promise<NextResponse<BasketOptimizeResponse | { error: string }>> {
  const t0 = Date.now();

  // ---- 1. Parse & validate body ---------------------------------------
  let body: OptimizerBody;
  try {
    body = (await req.json()) as OptimizerBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || !Array.isArray(body.serviceIds) || body.serviceIds.length === 0) {
    return NextResponse.json(
      { error: "serviceIds must be a non-empty array of 1–10 service IDs" },
      { status: 400 }
    );
  }

  // Coerce to trimmed strings, drop empties, dedupe (preserve first-seen order).
  const seen = new Set<string>();
  const requestedIds: string[] = [];
  for (const raw of body.serviceIds) {
    if (raw === null || raw === undefined) continue;
    const id = String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    requestedIds.push(id);
  }

  if (requestedIds.length === 0) {
    return NextResponse.json(
      { error: "serviceIds must contain at least one non-empty ID" },
      { status: 400 }
    );
  }
  if (requestedIds.length > MAX_SERVICES) {
    return NextResponse.json(
      { error: `serviceIds must contain at most ${MAX_SERVICES} IDs` },
      { status: 400 }
    );
  }

  // ---- 2. Fetch all active prices for requested services --------------
  // Single query — the composite @@index([serviceId, priceKzt]) turns the
  // `serviceId IN (...)` predicate into N indexed range scans (N ≤ 10) and
  // the `ORDER BY price_kzt` into a cheap in-index sort. The dataset is small
  // (~864 active rows), so we eagerly load everything and group in JS rather
  // than firing N+1 queries. Only the `clinic` relation is joined — it's the
  // only side-data the response needs (clinicName, city).
  const prices = await db.normalizedPrice.findMany({
    where: {
      serviceId: { in: requestedIds },
      isActive: true,
    },
    include: { clinic: true },
    orderBy: { priceKzt: "asc" },
  });

  type PriceRow = (typeof prices)[number];

  // ---- 3. Group by serviceId (cheapest-per-service for split) ---------
  const pricesByService = new Map<string, PriceRow[]>();
  for (const p of prices) {
    const arr = pricesByService.get(p.serviceId);
    if (arr) arr.push(p);
    else pricesByService.set(p.serviceId, [p]);
  }

  // Identify requested services that had zero active prices → warnings,
  // and compute the "available" subset used for both optimizations.
  const warnings: string[] = [];
  const availableServiceIds: string[] = [];
  for (const id of requestedIds) {
    if (pricesByService.has(id)) {
      availableServiceIds.push(id);
    } else {
      warnings.push(`Service "${id}" has no active prices and was excluded.`);
    }
  }

  // ---- 4. Split-optimal (cheapest-per-service across all clinics) -----
  let splitOptimal: SplitOptimal;
  if (availableServiceIds.length === 0) {
    splitOptimal = { totalPrice: 0, clinicCount: 0, services: [] };
  } else {
    const splitServices: SplitService[] = [];
    let splitTotal = 0;
    const splitClinics = new Set<string>();
    for (const svcId of availableServiceIds) {
      const rows = pricesByService.get(svcId);
      if (!rows || rows.length === 0) continue; // defensive; shouldn't happen
      // `prices` is ordered by priceKzt asc, so rows[0] is the cheapest.
      const best = rows[0];
      splitServices.push({
        serviceId: svcId,
        clinicId: best.clinicId,
        clinicName: best.clinic.clinicName,
        city: best.clinic.city,
        priceKzt: roundKzt(best.priceKzt),
        serviceNameRaw: best.serviceNameRaw,
      });
      splitTotal += best.priceKzt;
      splitClinics.add(best.clinicId);
    }
    splitOptimal = {
      totalPrice: roundKzt(splitTotal),
      clinicCount: splitClinics.size,
      services: splitServices,
    };
  }

  // ---- 5. Single-clinic (clinic that offers ALL available services) --
  let singleClinic: SingleClinic | null = null;
  if (availableServiceIds.length > 0) {
    // Group prices by clinicId for the single-clinic search.
    const pricesByClinic = new Map<string, PriceRow[]>();
    for (const p of prices) {
      const arr = pricesByClinic.get(p.clinicId);
      if (arr) arr.push(p);
      else pricesByClinic.set(p.clinicId, [p]);
    }

    const requiredServiceSet = new Set(availableServiceIds);
    const requiredCount = requiredServiceSet.size;

    let bestClinicId: string | null = null;
    let bestClinicTotal = Number.POSITIVE_INFINITY;
    let bestClinicPicked: SingleService[] | null = null;
    let bestClinicRow: PriceRow | null = null; // any row from the winning clinic (for clinic meta)

    for (const [clinicId, rows] of pricesByClinic) {
      // Quickly check coverage: does this clinic have ≥1 active price for
      // every required service? The @@unique([clinicId, serviceId]) constraint
      // guarantees at most one row per (clinic, service), so we can sum
      // directly without re-deduping.
      const covered = new Set<string>();
      for (const r of rows) {
        if (requiredServiceSet.has(r.serviceId)) {
          covered.add(r.serviceId);
        }
      }
      if (covered.size !== requiredCount) continue;

      // Sum the price per required service for this clinic.
      let total = 0;
      let allFound = true;
      const picked: SingleService[] = [];
      for (const svcId of availableServiceIds) {
        const row = rows.find((r) => r.serviceId === svcId);
        if (!row) {
          allFound = false;
          break;
        }
        total += row.priceKzt;
        picked.push({
          serviceId: svcId,
          priceKzt: roundKzt(row.priceKzt),
          serviceNameRaw: row.serviceNameRaw,
        });
      }
      if (!allFound) continue;

      if (total < bestClinicTotal) {
        bestClinicTotal = total;
        bestClinicId = clinicId;
        bestClinicPicked = picked;
        bestClinicRow = rows[0]; // any row carries the joined clinic meta
      }
    }

    if (bestClinicId !== null && bestClinicPicked !== null && bestClinicRow !== null) {
      singleClinic = {
        clinicId: bestClinicId,
        clinicName: bestClinicRow.clinic.clinicName,
        city: bestClinicRow.clinic.city,
        totalPrice: roundKzt(bestClinicTotal),
        services: bestClinicPicked,
      };
    }
  }

  // ---- 6. Recommendation + savings -----------------------------------
  let recommendation: "single" | "split";
  let savingsKzt = 0;
  if (singleClinic === null) {
    recommendation = "split";
  } else if (singleClinic.totalPrice <= splitOptimal.totalPrice) {
    // Single clinic is cheaper-or-equal AND more convenient → recommend it.
    recommendation = "single";
  } else {
    recommendation = "split";
    savingsKzt = singleClinic.totalPrice - splitOptimal.totalPrice;
  }

  const savingsPct =
    savingsKzt > 0 && singleClinic !== null && singleClinic.totalPrice > 0
      ? Math.round((savingsKzt / singleClinic.totalPrice) * 100)
      : 0;

  const elapsedMs = Date.now() - t0;

  return NextResponse.json({
    serviceIds: requestedIds,
    singleClinic,
    splitOptimal,
    recommendation,
    savingsKzt,
    savingsPct,
    elapsedMs,
    warnings,
  });
}
