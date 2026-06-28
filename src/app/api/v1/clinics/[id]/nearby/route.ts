/**
 * GET /api/v1/clinics/[id]/nearby
 * Returns clinics in the same city, sorted by price competitiveness.
 * Each result includes the clinic's min price, rating, and distance (if geo available).
 * Used by the clinic detail dialog to suggest alternatives.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const clinic = await db.clinic.findUnique({ where: { id } });
  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }

  // Find clinics in the same city, excluding this one
  const sameCityClinics = await db.clinic.findMany({
    where: {
      city: clinic.city,
      id: { not: id },
    },
    select: {
      id: true,
      clinicName: true,
      city: true,
      address: true,
      rating: true,
      onlineBooking: true,
      latitude: true,
      longitude: true,
    },
  });

  if (!sameCityClinics.length) {
    return NextResponse.json({ nearby: [], city: clinic.city });
  }

  // Get min price for each clinic
  const clinicIds = sameCityClinics.map((c) => c.id);
  const priceStats = await db.normalizedPrice.groupBy({
    by: ["clinicId"],
    _min: { priceKzt: true },
    _count: { _all: true },
    _avg: { priceKzt: true },
    where: { clinicId: { in: clinicIds }, isActive: true },
  });

  const priceMap = new Map(clinicIds.map((cid, i) => {
    const stat = priceStats.find((s) => s.clinicId === cid);
    return [cid, {
      minPrice: stat?._min.priceKzt ?? null,
      avgPrice: stat?._avg.priceKzt ? Math.round(stat._avg.priceKzt) : null,
      serviceCount: stat?._count._all ?? 0,
    }];
  }));

  // Also get this clinic's min price for comparison
  const thisClinicStats = await db.normalizedPrice.aggregate({
    _min: { priceKzt: true },
    _avg: { priceKzt: true },
    _count: { _all: true },
    where: { clinicId: id, isActive: true },
  });

  const nearby = sameCityClinics
    .map((c) => {
      const ps = priceMap.get(c.id) ?? { minPrice: null, avgPrice: null, serviceCount: 0 };
      // Compute rough distance if both have coordinates
      let distanceKm: number | null = null;
      if (clinic.latitude && clinic.longitude && c.latitude && c.longitude) {
        const R = 6371;
        const dLat = ((c.latitude - clinic.latitude) * Math.PI) / 180;
        const dLon = ((c.longitude - clinic.longitude) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((clinic.latitude * Math.PI) / 180) *
            Math.cos((c.latitude * Math.PI) / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        distanceKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
      }
      return {
        id: c.id,
        name: c.clinicName,
        city: c.city,
        address: c.address,
        rating: c.rating,
        onlineBooking: c.onlineBooking,
        latitude: c.latitude,
        longitude: c.longitude,
        distanceKm,
        minPrice: ps.minPrice,
        avgPrice: ps.avgPrice,
        serviceCount: ps.serviceCount,
        cheaper: ps.minPrice != null && thisClinicStats._min.priceKzt != null
          ? ps.minPrice < thisClinicStats._min.priceKzt
          : null,
      };
    })
    // Sort: cheaper first, then by distance
    .sort((a, b) => {
      if (a.cheaper && !b.cheaper) return -1;
      if (!a.cheaper && b.cheaper) return 1;
      if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .slice(0, 8);

  return NextResponse.json({
    nearby,
    city: clinic.city,
    thisClinicMinPrice: thisClinicStats._min.priceKzt ?? null,
    thisClinicAvgPrice: thisClinicStats._avg.priceKzt ? Math.round(thisClinicStats._avg.priceKzt) : null,
  });
}
