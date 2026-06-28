/**
 * GET /api/v1/clinics
 * Returns the list of clinics (for map + filter dropdowns).
 * Query: city=... to filter; with_stats=true to include price stats per clinic.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const city = sp.get("city");
  const withStats = sp.get("with_stats") === "true";

  const clinics = await db.clinic.findMany({
    where: city ? { city } : undefined,
    orderBy: [{ city: "asc" }, { clinicName: "asc" }],
    include: withStats
      ? {
          normalizedPrices: {
            where: { isActive: true },
            select: { priceKzt: true },
          },
        }
      : undefined,
  });

  return NextResponse.json({
    clinics: clinics.map((c) => {
      const base = {
        id: c.id,
        name: c.clinicName,
        city: c.city,
        address: c.address,
        phone: c.phone,
        workingHours: c.workingHours,
        sourceUrl: c.sourceUrl,
        website: c.website,
        rating: c.rating,
        onlineBooking: c.onlineBooking,
        latitude: c.latitude,
        longitude: c.longitude,
      };
      if (!withStats) return base;
      const prices = (c.normalizedPrices as unknown as { priceKzt: number }[]) ?? [];
      const priceArr = prices.map((p) => p.priceKzt);
      const min = priceArr.length ? Math.min(...priceArr) : null;
      const max = priceArr.length ? Math.max(...priceArr) : null;
      const avg =
        priceArr.length > 0
          ? Math.round(priceArr.reduce((s, p) => s + p, 0) / priceArr.length)
          : null;
      return {
        ...base,
        priceStats: {
          count: priceArr.length,
          min,
          max,
          avg,
        },
      };
    }),
  });
}
