import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const services = await db.serviceDirectory.count();
    return NextResponse.json({
      ok: true,
      service: "MedServicePrice.kz API",
      version: "v1",
      seeded: services > 0,
      endpoints: [
        "GET  /api/v1/search",
        "GET  /api/v1/clinics",
        "GET  /api/v1/clinics/[id]",
        "GET  /api/v1/services",
        "GET  /api/v1/services/[id]/history",
        "POST /api/v1/compare",
        "GET  /api/v1/admin/unmatched",
        "POST /api/v1/admin/unmatched",
        "POST /api/v1/seed",
        "POST /api/v1/ingest",
        "GET  /api/v1/stats",
      ],
    });
  } catch {
    return NextResponse.json({ ok: false, error: "db unavailable" }, { status: 503 });
  }
}
