/**
 * GET /api/v1/price-drops
 * Surface services with the biggest recent price drops, by comparing the latest
 * price_history entry per (serviceId, clinicId) against the previous one.
 *
 * Returns up to 10 services with the largest absolute price decrease, including:
 *   - service name (localized)
 *   - clinic name + city
 *   - oldPrice → newPrice
 *   - absolute drop (KZT) and percentage drop
 *   - recordedAt timestamp
 *
 * Query params:
 *   - limit: 1..20, default 10
 *   - minDropPct: default 5 (only show drops of ≥5%)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10)));
  const minDropPct = Math.max(0, parseFloat(url.searchParams.get("minDropPct") || "5"));

  // Fetch the latest 2 history rows per (serviceId, clinicId) by reading a
  // generous recent window. SQLite Prisma doesn't support window functions, so
  // we fetch recent rows in JS, group, sort, and pick top 2 per pair.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const recentHist = await db.priceHistory.findMany({
    where: { recordedAt: { gte: ninetyDaysAgo } },
    orderBy: { recordedAt: "desc" },
    select: {
      id: true,
      serviceId: true,
      clinicId: true,
      clinicName: true,
      priceKzt: true,
      recordedAt: true,
    },
    take: 2000, // safety cap
  });

  // Group by `${serviceId}|${clinicId}` and keep the 2 most recent rows
  const pairMap = new Map<string, typeof recentHist>();
  for (const h of recentHist) {
    const key = `${h.serviceId}|${h.clinicId}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    const arr = pairMap.get(key)!;
    if (arr.length < 2) arr.push(h);
  }

  type Drop = {
    serviceId: string;
    serviceName: string;
    serviceNameRu: string;
    serviceNameKk: string;
    category: string;
    clinicId: string;
    clinicName: string;
    city: string;
    oldPrice: number;
    newPrice: number;
    dropKzt: number;
    dropPct: number;
    recordedAt: string;
  };

  // Build list of drops
  const drops: Drop[] = [];
  const serviceIds = new Set<string>();
  const clinicIds = new Set<string>();
  for (const [, arr] of pairMap) {
    if (arr.length < 2) continue;
    // arr[0] is newest (desc order), arr[1] is previous
    const newest = arr[0];
    const prev = arr[1];
    if (newest.priceKzt >= prev.priceKzt) continue; // not a drop
    const dropKzt = prev.priceKzt - newest.priceKzt;
    const dropPct = prev.priceKzt > 0 ? Math.round((dropKzt / prev.priceKzt) * 100) : 0;
    if (dropPct < minDropPct) continue;
    drops.push({
      serviceId: newest.serviceId,
      serviceName: "", // filled below
      serviceNameRu: "",
      serviceNameKk: "",
      category: "",
      clinicId: newest.clinicId,
      clinicName: newest.clinicName,
      city: "",
      oldPrice: prev.priceKzt,
      newPrice: newest.priceKzt,
      dropKzt,
      dropPct,
      recordedAt: newest.recordedAt.toISOString(),
    });
    serviceIds.add(newest.serviceId);
    clinicIds.add(newest.clinicId);
  }

  // Sort by absolute drop KZT descending, take top `limit`
  drops.sort((a, b) => b.dropKzt - a.dropKzt);
  const top = drops.slice(0, limit);

  if (!top.length) {
    return NextResponse.json({ drops: [], generatedAt: new Date().toISOString() });
  }

  // Hydrate service + clinic info
  const services = await db.serviceDirectory.findMany({
    where: { id: { in: Array.from(serviceIds) } },
    select: { id: true, nameEn: true, nameRu: true, nameKk: true, category: true },
  });
  const clinics = await db.clinic.findMany({
    where: { id: { in: Array.from(clinicIds) } },
    select: { id: true, clinicName: true, city: true },
  });
  const svcMap = new Map(services.map((s) => [s.id, s]));
  const cliMap = new Map(clinics.map((c) => [c.id, c]));

  for (const d of top) {
    const s = svcMap.get(d.serviceId);
    if (s) {
      d.serviceName = s.nameEn;
      d.serviceNameRu = s.nameRu;
      d.serviceNameKk = s.nameKk;
      d.category = s.category;
    }
    const c = cliMap.get(d.clinicId);
    if (c) {
      d.clinicName = d.clinicName || c.clinicName;
      d.city = c.city;
    }
  }

  return NextResponse.json({
    drops: top,
    generatedAt: new Date().toISOString(),
  });
}
