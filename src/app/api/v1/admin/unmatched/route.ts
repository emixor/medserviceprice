/**
 * GET /api/v1/admin/unmatched
 * Returns the unmatched queue for manual admin tagging.
 * Query: status=pending|resolved|ignored (default pending)
 *
 * POST /api/v1/admin/unmatched
 * Resolve an unmatched entry: { id, action: "resolve"|"ignore", serviceId? }
 * - "resolve" links the raw entry to the chosen serviceId: creates/updates a
 *   normalized_price row, marks the unmatched entry resolved, and back-fills
 *   the raw_parsed_data row.
 * - "ignore" marks the entry ignored.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { USD_TO_KZT_RATE } from "@/lib/seed-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const items = await db.unmatchedQueue.findMany({
    where: status === "all" ? undefined : { status },
    orderBy: { parsedAt: "desc" },
    take: 200,
    include: { suggestedService: true },
  });

  // Attach service directory suggestions for admin to pick from
  const directory = await db.serviceDirectory.findMany({
    orderBy: { nameRu: "asc" },
    select: { id: true, nameRu: true, nameKk: true, nameEn: true, category: true, synonyms: true },
  });

  return NextResponse.json({
    items: items.map((i) => ({
      id: i.id,
      serviceNameRaw: i.serviceNameRaw,
      clinicNameRaw: i.clinicNameRaw,
      cityNameRaw: i.cityNameRaw,
      priceRaw: i.priceRaw,
      currencyRaw: i.currencyRaw,
      sourceName: i.sourceName,
      confidence: i.confidence,
      parsedAt: i.parsedAt,
      status: i.status,
      suggestedService: i.suggestedService
        ? {
            id: i.suggestedService.id,
            nameRu: i.suggestedService.nameRu,
          }
        : null,
    })),
    directory: directory.map((d) => ({
      id: d.id,
      nameRu: d.nameRu,
      nameKk: d.nameKk,
      nameEn: d.nameEn,
      category: d.category,
      synonyms: safeArr(d.synonyms),
    })),
  });
}

export async function POST(req: NextRequest) {
  let body: { id?: string; action?: string; serviceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { id, action, serviceId } = body;
  if (!id || !action) {
    return NextResponse.json({ error: "id and action are required" }, { status: 400 });
  }
  const item = await db.unmatchedQueue.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Unmatched entry not found" }, { status: 404 });
  }

  if (action === "ignore") {
    await db.unmatchedQueue.update({
      where: { id },
      data: { status: "ignored", resolvedAt: new Date() },
    });
    return NextResponse.json({ ok: true, action: "ignored" });
  }

  if (action === "resolve") {
    if (!serviceId) {
      return NextResponse.json({ error: "serviceId is required to resolve" }, { status: 400 });
    }
    const svc = await db.serviceDirectory.findUnique({ where: { id: serviceId } });
    if (!svc) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    // Find the clinic by name+city
    let clinic = await db.clinic.findFirst({
      where: { clinicName: item.clinicNameRaw, city: item.cityNameRaw },
    });
    if (!clinic) {
      return NextResponse.json(
        { error: "Clinic not found for this unmatched entry" },
        { status: 404 }
      );
    }
    const priceKzt =
      item.currencyRaw === "USD" ? Math.round(item.priceRaw * USD_TO_KZT_RATE) : item.priceRaw;

    // Find the raw row to back-fill
    const raw = await db.rawParsedData.findFirst({
      where: {
        clinicNameRaw: item.clinicNameRaw,
        cityNameRaw: item.cityNameRaw,
        serviceNameRaw: item.serviceNameRaw,
      },
      orderBy: { parsedAt: "desc" },
    });

    // Upsert normalized price
    const existing = await db.normalizedPrice.findUnique({
      where: { clinicId_serviceId: { clinicId: clinic.id, serviceId } },
    });
    if (existing) {
      const priceChanged = existing.priceKzt !== priceKzt;
      await db.normalizedPrice.update({
        where: { id: existing.id },
        data: {
          serviceNameRaw: item.serviceNameRaw,
          priceKzt,
          currency: "KZT",
          durationDays: raw?.durationDays ?? null,
          parsedAt: new Date(),
          isActive: true,
          rawId: raw?.id ?? null,
        },
      });
      if (priceChanged) {
        await db.priceHistory.create({
          data: {
            serviceId,
            clinicId: clinic.id,
            clinicName: clinic.clinicName,
            priceKzt,
            recordedAt: new Date(),
          },
        });
      }
    } else {
      await db.normalizedPrice.create({
        data: {
          clinicId: clinic.id,
          serviceId,
          serviceNameRaw: item.serviceNameRaw,
          priceKzt,
          currency: "KZT",
          durationDays: raw?.durationDays ?? null,
          parsedAt: new Date(),
          isActive: true,
          rawId: raw?.id ?? null,
        },
      });
      await db.priceHistory.create({
        data: {
          serviceId,
          clinicId: clinic.id,
          clinicName: clinic.clinicName,
          priceKzt,
          recordedAt: new Date(),
        },
      });
    }

    // Back-fill raw row
    if (raw) {
      await db.rawParsedData.update({
        where: { id: raw.id },
        data: { serviceId, normalized: true, confidence: 1 },
      });
    }

    await db.unmatchedQueue.update({
      where: { id },
      data: {
        status: "resolved",
        suggestedServiceId: serviceId,
        resolvedAt: new Date(),
        resolvedBy: "admin",
      },
    });

    return NextResponse.json({ ok: true, action: "resolved", serviceId, clinicId: clinic.id });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
