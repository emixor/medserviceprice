/**
 * POST /api/v1/subscriptions
 * Create a price-drop subscription.
 * Body: { email, serviceId, clinicId?, thresholdKzt }
 * Returns the created subscription (with token for unsubscribe link).
 *
 * GET /api/v1/subscriptions?email=foo@bar.com
 * List a user's active subscriptions.
 *
 * DELETE /api/v1/subscriptions?token=xxx
 * Unsubscribe via token (from email link).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: { email?: string; serviceId?: string; clinicId?: string; thresholdKzt?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const serviceId = body.serviceId;
  const clinicId = body.clinicId || null;
  const thresholdKzt = Number(body.thresholdKzt);

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (!serviceId) {
    return NextResponse.json({ error: "serviceId is required" }, { status: 400 });
  }
  if (!Number.isFinite(thresholdKzt) || thresholdKzt <= 0) {
    return NextResponse.json({ error: "thresholdKzt must be a positive number" }, { status: 400 });
  }

  const svc = await db.serviceDirectory.findUnique({ where: { id: serviceId } });
  if (!svc) return NextResponse.json({ error: "Service not found" }, { status: 404 });
  if (clinicId) {
    const cl = await db.clinic.findUnique({ where: { id: clinicId } });
    if (!cl) return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }

  // Dedup: one active subscription per (email, serviceId, clinicId)
  const existing = await db.priceSubscription.findFirst({
    where: { email, serviceId, clinicId: clinicId ?? null, active: true },
  });
  if (existing) {
    // update threshold if changed
    if (existing.thresholdKzt !== thresholdKzt) {
      await db.priceSubscription.update({
        where: { id: existing.id },
        data: { thresholdKzt },
      });
    }
    return NextResponse.json({ ok: true, id: existing.id, token: existing.token, updated: true });
  }

  const token = randomUUID();
  const sub = await db.priceSubscription.create({
    data: { email, serviceId, clinicId, thresholdKzt, token },
  });
  return NextResponse.json({ ok: true, id: sub.id, token: sub.token });
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  const subs = await db.priceSubscription.findMany({
    where: { email, active: true },
    include: { service: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    subscriptions: subs.map((s) => ({
      id: s.id,
      serviceId: s.serviceId,
      serviceName: s.service.nameRu,
      clinicId: s.clinicId,
      thresholdKzt: s.thresholdKzt,
      createdAt: s.createdAt,
      token: s.token,
    })),
  });
}

export async function DELETE(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const id = req.nextUrl.searchParams.get("id");
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();

  // Path A: token-based unsubscribe (from email links) — no email check needed.
  if (token) {
    const sub = await db.priceSubscription.findUnique({ where: { token } });
    if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    await db.priceSubscription.update({ where: { id: sub.id }, data: { active: false } });
    return NextResponse.json({ ok: true, unsubscribed: true });
  }

  // Path B: id-based deletion from the My Alerts UI — requires matching email
  // to prevent cross-user deletion.
  if (id) {
    if (!email) return NextResponse.json({ error: "email is required for id-based delete" }, { status: 400 });
    const sub = await db.priceSubscription.findUnique({ where: { id } });
    if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    if (sub.email !== email) {
      return NextResponse.json({ error: "Email does not match subscription owner" }, { status: 403 });
    }
    await db.priceSubscription.update({ where: { id: sub.id }, data: { active: false } });
    return NextResponse.json({ ok: true, unsubscribed: true });
  }

  return NextResponse.json({ error: "Either token or id is required" }, { status: 400 });
}
