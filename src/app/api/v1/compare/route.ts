/**
 * POST /api/v1/compare
 * Body: { serviceIds: string[], clinicIds?: string[] }
 *
 * Returns a comparison matrix: rows = services, columns = clinics,
 * cells = { priceKzt, durationDays, parsedAt, found } so the frontend can
 * render a side-by-side grid.
 *
 * Also returns per-service price statistics (min/avg/max) across clinics.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompareBody = {
  serviceIds?: string[];
  clinicIds?: string[];
};

function safeArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  let body: CompareBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const serviceIds = (body.serviceIds ?? []).filter(Boolean);
  const clinicIds = (body.clinicIds ?? []).filter(Boolean);
  if (!serviceIds.length) {
    return NextResponse.json({ error: "serviceIds is required" }, { status: 400 });
  }

  const services = await db.serviceDirectory.findMany({
    where: { id: { in: serviceIds } },
  });
  // Preserve requested order
  const orderedServices = serviceIds
    .map((id) => services.find((s) => s.id === id))
    .filter(Boolean) as typeof services;

  const priceWhere: Record<string, unknown> = {
    serviceId: { in: serviceIds },
    isActive: true,
  };
  if (clinicIds.length) priceWhere.clinicId = { in: clinicIds };

  const prices = await db.normalizedPrice.findMany({
    where: priceWhere,
    include: { clinic: true, service: true },
  });

  // Distinct clinics that actually have at least one of these services
  const clinicMap = new Map<string, { id: string; name: string; city: string; rating: number; onlineBooking: boolean }>();
  for (const p of prices) {
    if (!clinicMap.has(p.clinicId)) {
      clinicMap.set(p.clinicId, {
        id: p.clinic.id,
        name: p.clinic.clinicName,
        city: p.clinic.city,
        rating: p.clinic.rating,
        onlineBooking: p.clinic.onlineBooking,
      });
    }
  }
  // If clinicIds explicitly requested, preserve that order; else order by name
  let clinics: { id: string; name: string; city: string; rating: number; onlineBooking: boolean }[];
  if (clinicIds.length) {
    clinics = clinicIds
      .map((id) => clinicMap.get(id))
      .filter(Boolean) as typeof clinics;
    // Append any clinics that have data but weren't in the explicit list
    for (const c of clinicMap.values()) {
      if (!clinics.find((x) => x.id === c.id)) clinics.push(c);
    }
  } else {
    clinics = [...clinicMap.values()].sort((a, b) =>
      a.name === b.name ? a.city.localeCompare(b.city) : a.name.localeCompare(b.name)
    );
  }

  // Build matrix: rows = services, cols = clinics
  const matrix = orderedServices.map((svc) => {
    const rowPrices = prices.filter((p) => p.serviceId === svc.id);
    const cells = clinics.map((c) => {
      const cell = rowPrices.find((p) => p.clinicId === c.id);
      if (!cell) {
        return { clinicId: c.id, found: false, priceKzt: null, durationDays: null, parsedAt: null };
      }
      return {
        clinicId: c.id,
        found: true,
        priceKzt: cell.priceKzt,
        durationDays: cell.durationDays,
        parsedAt: cell.parsedAt,
      };
    });
    const foundPrices = rowPrices.map((p) => p.priceKzt);
    return {
      service: {
        id: svc.id,
        nameRu: svc.nameRu,
        nameKk: svc.nameKk,
        nameEn: svc.nameEn,
        category: svc.category,
        synonyms: safeArr(svc.synonyms),
      },
      cells,
      stats: {
        min: foundPrices.length ? Math.min(...foundPrices) : null,
        max: foundPrices.length ? Math.max(...foundPrices) : null,
        avg: foundPrices.length
          ? Math.round(foundPrices.reduce((a, b) => a + b, 0) / foundPrices.length)
          : null,
        clinicCount: foundPrices.length,
      },
    };
  });

  return NextResponse.json({
    services: matrix.map((m) => m.service),
    clinics,
    matrix,
  });
}
