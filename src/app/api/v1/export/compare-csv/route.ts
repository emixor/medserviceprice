/**
 * GET /api/v1/export/compare-csv?serviceIds=id1,id2,...
 * Exports a comparison matrix as CSV: rows = services, columns = clinics.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(s: string | number | null | undefined): string {
  if (s == null) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const idsParam = sp.get("serviceIds") ?? "";
  const serviceIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (!serviceIds.length) {
    return NextResponse.json({ error: "serviceIds is required" }, { status: 400 });
  }

  const services = await db.serviceDirectory.findMany({ where: { id: { in: serviceIds } } });
  const orderedServices = serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean) as typeof services;

  const prices = await db.normalizedPrice.findMany({
    where: { serviceId: { in: serviceIds }, isActive: true },
    include: { clinic: true, service: true },
  });

  const clinicMap = new Map<string, { id: string; name: string; city: string }>();
  for (const p of prices) {
    if (!clinicMap.has(p.clinicId)) {
      clinicMap.set(p.clinicId, { id: p.clinic.id, name: p.clinic.clinicName, city: p.clinic.city });
    }
  }
  const clinics = [...clinicMap.values()];

  // Header row
  const header = ["service_name", "category", ...clinics.map((c) => `${c.name} (${c.city})`), "min_kzt", "max_kzt", "avg_kzt"];
  const lines = [header.map(csvCell).join(",")];

  for (const svc of orderedServices) {
    const rowPrices = prices.filter((p) => p.serviceId === svc.id);
    const cells: (string | number)[] = [svc.nameRu, svc.category];
    const foundPrices: number[] = [];
    for (const c of clinics) {
      const cell = rowPrices.find((p) => p.clinicId === c.id);
      if (cell) {
        cells.push(cell.priceKzt);
        foundPrices.push(cell.priceKzt);
      } else {
        cells.push("");
      }
    }
    const min = foundPrices.length ? Math.min(...foundPrices) : "";
    const max = foundPrices.length ? Math.max(...foundPrices) : "";
    const avg = foundPrices.length ? Math.round(foundPrices.reduce((a, b) => a + b, 0) / foundPrices.length) : "";
    cells.push(min, max, avg);
    lines.push(cells.map(csvCell).join(","));
  }

  const csv = "\uFEFF" + lines.join("\r\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="comparison_${Date.now()}.csv"`,
    },
  });
}
