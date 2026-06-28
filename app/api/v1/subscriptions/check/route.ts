/**
 * POST /api/v1/subscriptions/check
 * Evaluate all active price-drop subscriptions against current normalized_prices.
 * For each subscription whose current best price <= thresholdKzt AND that hasn't
 * been notified in the last 24h, stamp lastNotifiedAt and include it in the
 * response as a "triggered" notification.
 *
 * Body (optional): { email?: string }
 *   - If email is supplied, only check that user's subscriptions (used by the
 *     header notification bell for a logged-in-ish visitor).
 *   - If omitted, check ALL active subscriptions (used by a cron / admin trigger).
 *
 * Returns:
 *   { triggered: [{ id, email, serviceId, serviceName, clinicId?, clinicName?,
 *     thresholdKzt, currentPrice, savingsKzt, savingsPct, triggeredAt }],
 *     checked, triggeredCount }
 *
 * No actual email sending in this environment — the UI surfaces triggered
 * alerts via the header bell. The lastNotifiedAt stamp throttles re-alerts
 * to once per 24h per subscription.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THROTTLE_MS = 24 * 60 * 60 * 1000; // 24h

export async function POST(req: NextRequest) {
  let body: { email?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty */
  }

  const email = (body.email ?? "").trim().toLowerCase() || undefined;

  const where = email ? { email, active: true } : { active: true };
  const subs = await db.priceSubscription.findMany({
    where,
    include: {
      service: {
        select: { id: true, nameRu: true, nameKk: true, nameEn: true, category: true },
      },
    },
    take: 500, // safety cap
  });

  if (!subs.length) {
    return NextResponse.json({ triggered: [], checked: 0, triggeredCount: 0 });
  }

  // Gather current best (min) price per service across active normalized prices.
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

  // For clinic-specific subs, fetch that clinic's current price.
  const clinicSubs = subs.filter((s) => s.clinicId);
  const clinicPriceMap = new Map<string, number>(); // `${serviceId}|${clinicId}` -> price
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
  }

  const now = new Date();
  const triggered: Array<{
    id: string;
    email: string;
    serviceId: string;
    serviceName: string;
    clinicId: string | null;
    clinicName: string | null;
    thresholdKzt: number;
    currentPrice: number;
    savingsKzt: number;
    savingsPct: number;
    triggeredAt: string;
  }> = [];

  for (const sub of subs) {
    const currentPrice = sub.clinicId
      ? clinicPriceMap.get(`${sub.serviceId}|${sub.clinicId}`) ?? null
      : minByService.get(sub.serviceId) ?? null;
    if (currentPrice == null) continue;
    if (currentPrice > sub.thresholdKzt) continue;

    // Throttle: skip if notified within 24h
    if (sub.lastNotifiedAt && now.getTime() - sub.lastNotifiedAt.getTime() < THROTTLE_MS) {
      continue;
    }

    // Fetch clinic name if clinic-specific
    let clinicName: string | null = null;
    if (sub.clinicId) {
      const cl = await db.clinic.findUnique({
        where: { id: sub.clinicId },
        select: { clinicName: true, city: true },
      });
      clinicName = cl ? `${cl.clinicName} · ${cl.city}` : null;
    }

    const savingsKzt = Math.max(0, Math.round(sub.thresholdKzt - currentPrice));
    const savingsPct = sub.thresholdKzt > 0
      ? Math.round((savingsKzt / sub.thresholdKzt) * 100)
      : 0;

    // Stamp lastNotifiedAt
    await db.priceSubscription.update({
      where: { id: sub.id },
      data: { lastNotifiedAt: now },
    });

    triggered.push({
      id: sub.id,
      email: sub.email,
      serviceId: sub.serviceId,
      serviceName: sub.service.nameRu,
      clinicId: sub.clinicId,
      clinicName,
      thresholdKzt: sub.thresholdKzt,
      currentPrice,
      savingsKzt,
      savingsPct,
      triggeredAt: now.toISOString(),
    });
  }

  return NextResponse.json({
    triggered,
    checked: subs.length,
    triggeredCount: triggered.length,
  });
}
