/**
 * GET /api/v1/services
 * Returns the full services directory (for browse + compare selection).
 * Query: category=... to filter.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
  const category = req.nextUrl.searchParams.get("category");
  const services = await db.serviceDirectory.findMany({
    where: category ? { category } : undefined,
    orderBy: { nameRu: "asc" },
  });
  return NextResponse.json({
    services: services.map((s) => ({
      id: s.id,
      nameRu: s.nameRu,
      nameKk: s.nameKk,
      nameEn: s.nameEn,
      category: s.category,
      description: s.description,
      unit: s.unit,
      synonyms: safeArr(s.synonyms),
      osmsCoverage: s.osmsCoverage ?? "unknown",
    })),
  });
}
