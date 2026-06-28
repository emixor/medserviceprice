/**
 * GET /api/v1/subscriptions/manage?email=foo@bar.com
 * List a user's active subscriptions with live price context so the "My Alerts"
 * panel can show: threshold, current best price, status (watching / triggered /
 * exceeded), and savings so far.
 *
 * Returns:
 *   { subscriptions: [{
 *     id, serviceId, serviceName, serviceNameEn, serviceNameKk, category,
 *     clinicId, clinicName, thresholdKzt, currentPrice, status, savingsKzt,
 *     savingsPct, createdAt, lastNotifiedAt
 *   }], email }
 *
 * status: "triggered" (currentPrice <= threshold), "watching" (price within 20%
 * above threshold), "waiting" (price further away), "unavailable" (no active price).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email query param is required" }, { status: 400 });
  }

  const subs = await db.priceSubscription.findMany({
    where: { email, active: true },
    include: {
      service: {
        select: { id: true, nameRu: true, nameKk: true, nameEn: true, category: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!subs.length) {
    return NextResponse.json({ subscriptions: [], email });
  }

  // Batch-fetch current min price for each service + clinic-specific prices.
  const serviceIds = [...new Set(subs.map((s) => s.serviceId))];
  const priceRows = await db.normalizedPrice.groupBy({
    by: ["serviceId"],
    _min: { priceKzt: true },
    where: { serviceId: { in: serviceIds }, isActive: true },
  });
  const minByService = new Map<string, number>();
  for (const r of priceRows) {
    const v = r._min.priceKzt;
    if (v != null) minByService.set(r.serviceId, v);
  }

  const clinicSubs = subs.filter((s) => s.clinicId);
  const clinicPriceMap = new Map<string, number>();
  const clinicIdSet = new Set(clinicSubs.map((s) => s.clinicId!));
  let clinicInfoMap = new Map<string, { name: string; city: string }>();
  if (clinicSubs.length) {
    const rows = await db.normalizedPrice.findMany({
      where: {
        isActive: true,
        OR: clinicSubs.map((s) => ({ serviceId: s.serviceId, clinicId: s.clinicId! })),
      },
      select: { serviceId: true, clinicId: true, priceKzt: true },
    });
    for (const r of rows) {
      clinicPriceMap.set(`${r.serviceId}|${r.clinicId}`, r.priceKzt);
    }
    const clinics = await db.clinic.findMany({
      where: { id: { in: [...clinicIdSet] } },
      select: { id: true, clinicName: true, city: true },
    });
    clinicInfoMap = new Map(clinics.map((c) => [c.id, { name: c.clinicName, city: c.city }]));
  }

  const result = subs.map((sub) => {
    const currentPrice = sub.clinicId
      ? clinicPriceMap.get(`${sub.serviceId}|${sub.clinicId}`) ?? null
      : minByService.get(sub.serviceId) ?? null;

    let status: "triggered" | "watching" | "waiting" | "unavailable" = "unavailable";
    let savingsKzt = 0;
    let savingsPct = 0;
    if (currentPrice != null) {
      savingsKzt = Math.max(0, Math.round(sub.thresholdKzt - currentPrice));
      savingsPct = sub.thresholdKzt > 0
        ? Math.round((savingsKzt / sub.thresholdKzt) * 100)
        : 0;
      if (currentPrice <= sub.thresholdKzt) {
        status = "triggered";
      } else if (currentPrice <= sub.thresholdKzt * 1.2) {
        status = "watching";
      } else {
        status = "waiting";
      }
    }

    const clinicInfo = sub.clinicId ? clinicInfoMap.get(sub.clinicId) : null;

    return {
      id: sub.id,
      serviceId: sub.serviceId,
      serviceName: sub.service.nameRu,
      serviceNameEn: sub.service.nameEn,
      serviceNameKk: sub.service.nameKk,
      category: sub.service.category,
      clinicId: sub.clinicId,
      clinicName: clinicInfo ? `${clinicInfo.name} · ${clinicInfo.city}` : null,
      thresholdKzt: sub.thresholdKzt,
      currentPrice,
      status,
      savingsKzt,
      savingsPct,
      createdAt: sub.createdAt.toISOString(),
      lastNotifiedAt: sub.lastNotifiedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ subscriptions: result, email });
}
