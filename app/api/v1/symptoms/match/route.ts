/**
 * POST /api/v1/symptoms/match
 * Symptom → Service mapper (deterministic, LLM-free).
 *
 * Lets a user describe a symptom in plain language (RU/EN/KK) and returns a
 * short, deterministic list of relevant medical services (tests, imaging,
 * consultations) drawn EXCLUSIVELY from the live `ServiceDirectory` table.
 * No AI / LLM calls. Matching is rule-based via `src/lib/symptom-map.ts`.
 *
 * Body:  { "query": "боль в груди" }   (3–500 chars)
 * Response:
 * {
 *   "query": "боль в груди",
 *   "suggestions": [
 *     {
 *       "serviceId": "...",
 *       "nameRu": "ЭКГ (электрокардиограмма)",
 *       "nameKk": "...", "nameEn": "...",
 *       "category": "diagnostics",
 *       "confidence": "high" | "medium" | "low",
 *       "reason": "ЭКГ — первичная оценка сердечной деятельности при боли в груди.",
 *       "minPriceKzt": 3500   // cheapest active NormalizedPrice for this service
 *     }, ...
 *   ],
 *   "elapsedMs": 4,
 *   "warning": "..."          // present only when the matcher returned 0 rules
 * }
 *
 * Algorithm:
 *   1. Validate body — 400 on invalid JSON, missing query, or length <3 / >500.
 *   2. `matchSymptoms(query, 5)` → up to 5 deterministic `SymptomRule` objects.
 *      If 0 rules match → return 200 with empty `suggestions` + a friendly
 *      `warning` string (NOT an error — caller shows a "no results" message).
 *   3. Load the full `ServiceDirectory` in one query (the dataset is small —
 *      ~120 rows) and resolve each rule's `nameRuContains` substrings against
 *      `service.nameRu.toLowerCase()` in JavaScript. SQLite's native LIKE /
 *      LOWER() only handle ASCII correctly, so Cyrillic case-insensitivity
 *      MUST be done in JS (Unicode-aware `.toLowerCase()`) — same pattern used
 *      by `/api/v1/search` and `/api/v1/ai/search`.
 *   4. For each suggestion, if multiple services match the substring, prefer
 *      the one with the cheapest active `NormalizedPrice` (orderBy priceKzt
 *      asc, take 1). If no service matches, the suggestion is dropped — never
 *      invented.
 *   5. Batch the price lookups: collect every serviceId that any suggestion
 *      matched, fire ONE `normalizedPrice.findMany` with `serviceId IN (...)`
 *      AND `isActive = true`, ordered by `priceKzt asc`, and reduce in JS to
 *      the per-service minimum.
 *   6. Dedup the final suggestion list by `serviceId`. When the same service
 *      is reached via multiple rules, keep the entry with the HIGHEST
 *      confidence (high > medium > low); ties keep first-seen order.
 *
 * Non-goals / safety:
 *   - This is an informational tool, NOT a medical diagnosis. The UI MUST
 *     always render `t("symptom.disclaimer")` next to the results.
 *   - All matching is DETERMINISTIC. No LLM, no randomness, no telemetry.
 *   - Suggestions are real ServiceDirectory rows only — never fabricated.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { matchSymptoms, type SymptomConfidence } from "@/lib/symptom-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Minimum user-input length (chars, after trim). */
const MIN_QUERY_LEN = 3;
/** Maximum user-input length (chars). */
const MAX_QUERY_LEN = 500;
/** Upper bound on the number of rules considered. */
const MAX_RULES = 5;

type SymptomRequestBody = {
  query?: unknown;
};

/** One resolved suggestion in the response. `minPriceKzt` is optional because
 *  some services may have zero active prices in the database. */
type SymptomSuggestion = {
  serviceId: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  category: string;
  confidence: SymptomConfidence;
  reason: string;
  minPriceKzt?: number;
};

type SymptomMatchResponse = {
  query: string;
  suggestions: SymptomSuggestion[];
  elapsedMs: number;
  warning?: string;
};

/** Confidence ranking for dedup tie-breaking (higher = more specific). */
const CONFIDENCE_RANK: Record<SymptomConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Friendly hint shown when the matcher recognizes zero rules. */
const NO_RULES_WARNING =
  "Symptom not recognized — try more common terms like 'fever', 'headache', 'chest pain'.";

export async function POST(
  req: NextRequest
): Promise<NextResponse<SymptomMatchResponse | { error: string }>> {
  const t0 = Date.now();

  // ---- 1. Parse & validate body --------------------------------------
  let body: SymptomRequestBody;
  try {
    body = (await req.json()) as SymptomRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (body == null || typeof body.query !== "string") {
    return NextResponse.json(
      { error: "Query must be a non-empty string between 3 and 500 characters" },
      { status: 400 }
    );
  }

  const query = body.query.trim();
  if (query.length < MIN_QUERY_LEN || query.length > MAX_QUERY_LEN) {
    return NextResponse.json(
      {
        error: `Query must be a non-empty string between ${MIN_QUERY_LEN} and ${MAX_QUERY_LEN} characters`,
      },
      { status: 400 }
    );
  }

  // ---- 2. Run the deterministic matcher ------------------------------
  const rules = matchSymptoms(query, MAX_RULES);

  if (rules.length === 0) {
    // Not an error — caller shows the "no results" message; the warning
    // surfaces a friendly hint about common terms.
    return NextResponse.json(
      {
        query,
        suggestions: [],
        elapsedMs: Date.now() - t0,
        warning: NO_RULES_WARNING,
      },
      { status: 200 }
    );
  }

  // ---- 3. Load the full ServiceDirectory (single query) --------------
  // The directory is small (~120 rows). Loading it once and matching in JS is
  // both faster than N+1 Prisma `contains` queries AND the only way to get
  // correct Unicode-aware case-insensitive matching on SQLite (its native
  // LIKE/LOWER only handle ASCII — see /api/v1/search route header comment).
  const allServices = await db.serviceDirectory.findMany({
    select: {
      id: true,
      nameRu: true,
      nameKk: true,
      nameEn: true,
      category: true,
    },
  });

  // Pre-lowercase nameRu once per service for cheap substring matching.
  const directory = allServices.map((s) => ({
    ...s,
    nameRuLower: s.nameRu.toLowerCase(),
  }));

  // ---- 4. First pass — resolve every (rule, suggestion) to a list of
  //         matched directory rows. Collect every unique matched serviceId
  //         for the batched price lookup in step 5.
  type SuggestionRef = {
    needle: string;
    confidence: SymptomConfidence;
    reason: string;
    matches: { id: string; nameRu: string; nameKk: string; nameEn: string; category: string }[];
  };

  const refs: SuggestionRef[] = [];
  const allMatchedIds = new Set<string>();

  for (const rule of rules) {
    for (const suggestion of rule.suggestions) {
      const needle = suggestion.nameRuContains.toLowerCase();
      const matches = directory.filter((s) => s.nameRuLower.includes(needle));
      if (matches.length === 0) continue; // drop — no real service found
      refs.push({
        needle,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        matches: matches.map((m) => ({
          id: m.id,
          nameRu: m.nameRu,
          nameKk: m.nameKk,
          nameEn: m.nameEn,
          category: m.category,
        })),
      });
      for (const m of matches) allMatchedIds.add(m.id);
    }
  }

  // ---- 5. Batch the cheapest-active-price lookup ---------------------
  // One indexed query against `@@index([serviceId, priceKzt])` covers every
  // serviceId that any suggestion matched. isActive=true is enforced. The
  // query is ordered by priceKzt asc, so the first row encountered for each
  // serviceId is its cheapest active price.
  const minPriceByService = new Map<string, number>();
  if (allMatchedIds.size > 0) {
    const cheapestPrices = await db.normalizedPrice.findMany({
      where: {
        serviceId: { in: Array.from(allMatchedIds) },
        isActive: true,
      },
      select: {
        serviceId: true,
        priceKzt: true,
      },
      orderBy: { priceKzt: "asc" },
    });
    for (const p of cheapestPrices) {
      if (!minPriceByService.has(p.serviceId)) {
        minPriceByService.set(p.serviceId, Math.round(p.priceKzt));
      }
    }
  }

  // ---- 6. Second pass — for each suggestion, pick the cheapest matched
  //         service (cheapest-active-price-wins; services with no active
  //         price sort last). Then dedup by serviceId across all
  //         suggestions, keeping the HIGHEST-confidence entry (ties keep
  //         first-seen order, which is rule order then declaration order).
  const finalByService = new Map<string, SymptomSuggestion>();

  for (const ref of refs) {
    if (ref.matches.length === 0) continue;

    // Cheapest-wins across the matched services for THIS suggestion.
    let best = ref.matches[0]!;
    let bestPrice = minPriceByService.get(best.id);
    for (let i = 1; i < ref.matches.length; i++) {
      const cand = ref.matches[i]!;
      const candPrice = minPriceByService.get(cand.id);
      if (candPrice != null && (bestPrice == null || candPrice < bestPrice)) {
        best = cand;
        bestPrice = candPrice;
      }
    }

    const entry: SymptomSuggestion = {
      serviceId: best.id,
      nameRu: best.nameRu,
      nameKk: best.nameKk,
      nameEn: best.nameEn,
      category: best.category,
      confidence: ref.confidence,
      reason: ref.reason,
      ...(bestPrice != null ? { minPriceKzt: bestPrice } : {}),
    };

    // Dedup by serviceId — keep the highest-confidence entry. Ties keep
    // first-seen (rule order, then suggestion order within rule).
    const existing = finalByService.get(entry.serviceId);
    if (
      !existing ||
      CONFIDENCE_RANK[entry.confidence] > CONFIDENCE_RANK[existing.confidence]
    ) {
      finalByService.set(entry.serviceId, entry);
    }
  }

  // Preserve first-seen order (rules iterate in SYMPTOM_RULES order, which
  // is deterministic; suggestions iterate in declared order within each rule).
  const suggestions = Array.from(finalByService.values());

  return NextResponse.json(
    {
      query,
      suggestions,
      elapsedMs: Date.now() - t0,
    },
    { status: 200 }
  );
}
