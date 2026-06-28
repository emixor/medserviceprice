/**
 * GET  /api/v1/clinics/[id]/reviews
 * List approved reviews for a clinic. Returns avg rating + count + reviews.
 *
 * POST /api/v1/clinics/[id]/reviews
 * Submit a review. Body: { authorName, rating (1-5), comment, lang? }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const clinic = await db.clinic.findUnique({ where: { id } });
  if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

  const reviews = await db.clinicReview.findMany({
    where: { clinicId: id, approved: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const ratings = reviews.map((r) => r.rating);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  return NextResponse.json({
    avgRating: Number(avg.toFixed(2)),
    count: ratings.length,
    distribution: {
      5: ratings.filter((r) => r === 5).length,
      4: ratings.filter((r) => r >= 4 && r < 5).length,
      3: ratings.filter((r) => r >= 3 && r < 4).length,
      2: ratings.filter((r) => r >= 2 && r < 3).length,
      1: ratings.filter((r) => r >= 1 && r < 2).length,
    },
    reviews: reviews.map((r) => ({
      id: r.id,
      authorName: r.authorName,
      rating: r.rating,
      comment: r.comment,
      lang: r.lang,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { authorName?: string; rating?: number; comment?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const authorName = (body.authorName ?? "").trim().slice(0, 60);
  const rating = Number(body.rating);
  const comment = (body.comment ?? "").trim().slice(0, 1000);
  const lang = (body.lang ?? "ru").slice(0, 5);

  if (!authorName) return NextResponse.json({ error: "authorName is required" }, { status: 400 });
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be between 1 and 5" }, { status: 400 });
  }
  if (!comment) return NextResponse.json({ error: "comment is required" }, { status: 400 });

  const clinic = await db.clinic.findUnique({ where: { id } });
  if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });

  const review = await db.clinicReview.create({
    data: { clinicId: id, authorName, rating: Math.round(rating * 10) / 10, comment, lang },
  });

  // Recalculate clinic rating from all approved reviews
  const allReviews = await db.clinicReview.findMany({
    where: { clinicId: id, approved: true },
    select: { rating: true },
  });
  if (allReviews.length) {
    const newAvg = allReviews.reduce((a, b) => a + b.rating, 0) / allReviews.length;
    await db.clinic.update({ where: { id }, data: { rating: Math.round(newAvg * 10) / 10 } });
  }

  return NextResponse.json({ ok: true, id: review.id });
}
