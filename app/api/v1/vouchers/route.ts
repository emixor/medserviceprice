/**
 * POST /api/v1/vouchers
 * Price Lock Voucher — create a printable price-snapshot voucher.
 *
 * Lets a user "lock in" a clinic+service+listed price as a downloadable,
 * shareable confirmation artifact with a unique `confirmationId` of the form
 * `MSP-XXXXXX` (6 uppercase alphanumeric chars, ambiguous chars 0/O/1/I/L
 * excluded). The voucher is a PRICE SNAPSHOT — it never queries the live
 * `NormalizedPrice` table; only what the user submitted + what the DB lookup
 * returned for clinic/service names is persisted.
 *
 * Body:
 *   {
 *     "clinicId":  "cuid",          // required, must exist in `clinics`
 *     "serviceId": "cuid",          // required, must exist in `service_directory`
 *     "priceKzt":  1550,            // required, finite number
 *     "city":      "Алматы",        // required, non-empty string
 *     "sourceUrl": "https://...",   // required, non-empty string
 *     "parsedAt":  "2026-06-28T05:13:08.694Z"  // required, ISO string
 *   }
 *
 * Response (201):
 *   {
 *     "id":             "cuid",
 *     "confirmationId": "MSP-AB12CD",
 *     "clinicId":       "...",
 *     "serviceId":      "...",
 *     "clinicName":     "<from DB>",   // authoritative — user input is ignored
 *     "serviceName":    "<from DB>",
 *     "priceKzt":       1550,
 *     "city":           "Алматы",
 *     "sourceUrl":      "https://...",
 *     "parsedAt":       "2026-06-28T05:13:08.694Z",
 *     "createdAt":      "2026-...",
 *     "isStale":        false,
 *     "elapsedMs":      7
 *   }
 *
 * Algorithm:
 *   1. Parse & validate body — 400 on invalid JSON, missing required fields,
 *      non-finite `priceKzt`, invalid `parsedAt` date, or empty strings.
 *   2. Compute `isStale = (Date.now() - parsedAt.getTime()) > 30d`.
 *   3. Generate `confirmationId` = `MSP-` + 6 uppercase alphanumeric chars
 *      derived from `crypto.randomBytes(4).toString("base64url").slice(0,6)`,
 *      with ambiguous characters (0/O, 1/I/L) filtered out. A single attempt
 *      is generated; on a rare `@unique` conflict, return 500 with a clear
 *      error message (acceptable at this scale — see constraints in the task
 *      spec).
 *   4. Verify the `clinicId` and `serviceId` exist in the DB. If either is
 *      missing, return 404 with a clear error message. Use the DB row's
 *      `clinicName`/`serviceName` (NOT user input) as the source of truth.
 *   5. Insert the voucher row.
 *   6. Return 201 with the full voucher object + `elapsedMs`.
 *
 * Non-goals / safety:
 *   - The voucher is informational only — the UI MUST render
 *     `t("voucher.disclaimer")` next to it. The persisted price is NOT
 *     guaranteed by the clinic.
 *   - No live NormalizedPrice lookup is performed. The voucher persists
 *     EXACTLY what the user submitted (price, city, sourceUrl, parsedAt) +
 *     the authoritative clinic/service names from the DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stale threshold: 30 days in milliseconds. */
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** Voucher confirmationId prefix. */
const CONFIRMATION_PREFIX = "MSP-";
/** Length of the random suffix after the prefix (e.g. MSP-AB12CD → 6). */
const CONFIRMATION_SUFFIX_LEN = 6;

/**
 * Characters allowed in the confirmation suffix. Ambiguous characters
 * (0/O, 1/I/L) are excluded to make the code readable when printed, read
 * aloud over the phone, or hand-typed from a screenshot.
 */
const CONFIRMATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Generate a short, shareable confirmation id of the form `MSP-XXXXXX` where
 * XXXXXX is 6 uppercase alphanumeric chars drawn from `CONFIRMATION_ALPHABET`
 * (ambiguous chars 0/O/1/I/L excluded). Uses `crypto.randomBytes` for
 * entropy; rejects any character outside the alphabet (e.g. base64url `-`/`_`
 * or ambiguous chars that survive base64 encoding) and tries again until it
 * has 6 valid chars.
 */
function generateConfirmationId(): string {
  let out = "";
  // Pull fresh entropy in chunks until we've collected 6 valid chars.
  while (out.length < CONFIRMATION_SUFFIX_LEN) {
    const buf = randomBytes(8); // 8 bytes ≈ 64 bits — plenty of entropy
    for (const b of buf) {
      // Map each byte to the alphabet (32-char alphabet — clean modulo since
      // 256 is divisible by 32, so no modulo bias).
      const ch = CONFIRMATION_ALPHABET[b % CONFIRMATION_ALPHABET.length]!;
      out += ch;
      if (out.length === CONFIRMATION_SUFFIX_LEN) break;
    }
  }
  return CONFIRMATION_PREFIX + out;
}

type VoucherRequestBody = {
  clinicId?: unknown;
  serviceId?: unknown;
  priceKzt?: unknown;
  city?: unknown;
  sourceUrl?: unknown;
  parsedAt?: unknown;
};

/** Final voucher row shape returned to the client. */
type VoucherResponse = {
  id: string;
  confirmationId: string;
  clinicId: string;
  serviceId: string;
  clinicName: string;
  serviceName: string;
  priceKzt: number;
  city: string;
  sourceUrl: string;
  parsedAt: string;
  createdAt: string;
  isStale: boolean;
  elapsedMs: number;
};

export async function POST(
  req: NextRequest
): Promise<NextResponse<VoucherResponse | { error: string }>> {
  const t0 = Date.now();

  // ---- 1. Parse & validate body --------------------------------------
  let body: VoucherRequestBody;
  try {
    body = (await req.json()) as VoucherRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (body == null || typeof body !== "object") {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const { clinicId, serviceId, priceKzt, city, sourceUrl, parsedAt } = body;

  // Required field presence + primitive type checks.
  if (typeof clinicId !== "string" || clinicId.trim() === "") {
    return NextResponse.json(
      { error: "clinicId is required and must be a non-empty string" },
      { status: 400 }
    );
  }
  if (typeof serviceId !== "string" || serviceId.trim() === "") {
    return NextResponse.json(
      { error: "serviceId is required and must be a non-empty string" },
      { status: 400 }
    );
  }
  if (
    typeof priceKzt !== "number" ||
    !Number.isFinite(priceKzt) ||
    priceKzt < 0
  ) {
    return NextResponse.json(
      { error: "priceKzt is required and must be a finite, non-negative number" },
      { status: 400 }
    );
  }
  if (typeof city !== "string" || city.trim() === "") {
    return NextResponse.json(
      { error: "city is required and must be a non-empty string" },
      { status: 400 }
    );
  }
  if (typeof sourceUrl !== "string" || sourceUrl.trim() === "") {
    return NextResponse.json(
      { error: "sourceUrl is required and must be a non-empty string" },
      { status: 400 }
    );
  }
  if (typeof parsedAt !== "string" || parsedAt.trim() === "") {
    return NextResponse.json(
      { error: "parsedAt is required and must be an ISO date string" },
      { status: 400 }
    );
  }

  const parsedAtDate = new Date(parsedAt);
  if (Number.isNaN(parsedAtDate.getTime())) {
    return NextResponse.json(
      { error: "parsedAt must be a valid ISO date string" },
      { status: 400 }
    );
  }

  // ---- 2. Compute staleness ------------------------------------------
  const isStale = Date.now() - parsedAtDate.getTime() > STALE_MS;

  // ---- 3. Generate confirmationId ------------------------------------
  const confirmationId = generateConfirmationId();

  // ---- 4. Verify clinic + service exist (DB lookup) ------------------
  // Use the DB row's authoritative name — never trust user-supplied
  // clinicName / serviceName.
  const [clinic, service] = await Promise.all([
    db.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true, clinicName: true },
    }),
    db.serviceDirectory.findUnique({
      where: { id: serviceId },
      select: { id: true, nameRu: true, nameKk: true, nameEn: true },
    }),
  ]);

  if (!clinic) {
    return NextResponse.json(
      { error: `Clinic not found for clinicId="${clinicId}"` },
      { status: 404 }
    );
  }
  if (!service) {
    return NextResponse.json(
      { error: `Service not found for serviceId="${serviceId}"` },
      { status: 404 }
    );
  }

  // Authoritative service name — prefer nameRu, fall back to nameKk/nameEn.
  // (The voucher is a snapshot of a price the user saw on a Russian-first
  // Kazakhstan medical site, so nameRu is the right canonical choice here.)
  const serviceName = service.nameRu || service.nameKk || service.nameEn || service.id;
  const clinicName = clinic.clinicName || clinic.id;

  // ---- 5. Insert the voucher row -------------------------------------
  let voucher;
  try {
    voucher = await db.priceVoucher.create({
      data: {
        confirmationId,
        clinicId: clinic.id,
        serviceId: service.id,
        clinicName,
        serviceName,
        priceKzt,
        city,
        sourceUrl,
        parsedAt: parsedAtDate,
        isStale,
      },
    });
  } catch (err: unknown) {
    // The most likely recoverable error here is a @unique conflict on
    // `confirmationId` (extremely rare with a 32-char alphabet and 6 chars
    // → 32^6 ≈ 1 billion combinations, but possible). Surface a clear error
    // so the client can retry.
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|constraint|confirmation_id/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Confirmation ID collision — please retry the request (this is rare).",
        },
        { status: 500 }
      );
    }
    console.error("[vouchers/POST] create failed", err);
    return NextResponse.json(
      { error: "Failed to create voucher" },
      { status: 500 }
    );
  }

  // ---- 6. Return 201 with the full voucher object --------------------
  return NextResponse.json<VoucherResponse>(
    {
      id: voucher.id,
      confirmationId: voucher.confirmationId,
      clinicId: voucher.clinicId,
      serviceId: voucher.serviceId,
      clinicName: voucher.clinicName,
      serviceName: voucher.serviceName,
      priceKzt: voucher.priceKzt,
      city: voucher.city,
      sourceUrl: voucher.sourceUrl,
      parsedAt: voucher.parsedAt.toISOString(),
      createdAt: voucher.createdAt.toISOString(),
      isStale: voucher.isStale,
      elapsedMs: Date.now() - t0,
    },
    { status: 201 }
  );
}
