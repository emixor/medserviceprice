/**
 * GET /api/v1/vouchers/[id]
 * Fetch a Price Lock Voucher by its short, shareable `confirmationId`
 * (e.g. `MSP-AB12CD`) — NOT the cuid primary key.
 *
 * Returns the full voucher object plus the related `clinic` and `service`
 * relation rows when present (the relations are NOT NULL by schema, but
 * cascade-deletes on clinics/services could orphan a voucher, so we guard
 * for nullability in the response shape).
 *
 * Response (200):
 *   {
 *     "id":             "cuid",
 *     "confirmationId": "MSP-AB12CD",
 *     "clinicId":       "...",
 *     "serviceId":      "...",
 *     "clinicName":     "...",
 *     "serviceName":    "...",
 *     "priceKzt":       1550,
 *     "city":           "Алматы",
 *     "sourceUrl":      "https://...",
 *     "parsedAt":       "2026-06-28T05:13:08.694Z",
 *     "createdAt":      "2026-...",
 *     "isStale":        false,
 *     "elapsedMs":      3,
 *     "clinic":         { "id": "...", "clinicName": "...", "city": "...", ... } | null,
 *     "service":        { "id": "...", "nameRu": "...", "nameKk": "...", "nameEn": "...", "category": "..." } | null
 *   }
 *
 * 404: `{ "error": "Voucher not found" }` when no voucher matches the
 * confirmationId.
 *
 * Non-goals / safety:
 *   - This endpoint is read-only and never queries the live NormalizedPrice
 *     table. It returns the persisted snapshot exactly as it was stored.
 *   - The voucher is informational only — the UI MUST render
 *     `t("voucher.disclaimer")` next to it.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VoucherDetailResponse = {
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
  clinic: {
    id: string;
    clinicName: string;
    city: string;
    address: string;
    phone: string;
    sourceUrl: string;
    website: string | null;
    rating: number;
    onlineBooking: boolean;
  } | null;
  service: {
    id: string;
    nameRu: string;
    nameKk: string;
    nameEn: string;
    category: string;
  } | null;
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse<VoucherDetailResponse | { error: string }>> {
  const t0 = Date.now();
  const { id } = await ctx.params;

  // The `id` URL segment is the confirmationId (e.g. "MSP-AB12CD"), NOT the
  // cuid primary key. Lookup via findFirst on `confirmationId` (case-sensitive
  // — the prefix is always uppercase by spec).
  const voucher = await db.priceVoucher.findFirst({
    where: { confirmationId: id },
    include: {
      clinic: {
        select: {
          id: true,
          clinicName: true,
          city: true,
          address: true,
          phone: true,
          sourceUrl: true,
          website: true,
          rating: true,
          onlineBooking: true,
        },
      },
      service: {
        select: {
          id: true,
          nameRu: true,
          nameKk: true,
          nameEn: true,
          category: true,
        },
      },
    },
  });

  if (!voucher) {
    return NextResponse.json(
      { error: "Voucher not found" },
      { status: 404 }
    );
  }

  // The schema declares both relations as NOT NULL (onDelete: Cascade), but
  // cascade-deletes could orphan a voucher row if a clinic/service was
  // hard-deleted; guard for nullability defensively.
  const clinic = voucher.clinic
    ? {
        id: voucher.clinic.id,
        clinicName: voucher.clinic.clinicName,
        city: voucher.clinic.city,
        address: voucher.clinic.address,
        phone: voucher.clinic.phone,
        sourceUrl: voucher.clinic.sourceUrl,
        website: voucher.clinic.website,
        rating: voucher.clinic.rating,
        onlineBooking: voucher.clinic.onlineBooking,
      }
    : null;

  const service = voucher.service
    ? {
        id: voucher.service.id,
        nameRu: voucher.service.nameRu,
        nameKk: voucher.service.nameKk,
        nameEn: voucher.service.nameEn,
        category: voucher.service.category,
      }
    : null;

  return NextResponse.json<VoucherDetailResponse>(
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
      clinic,
      service,
    },
    { status: 200 }
  );
}
