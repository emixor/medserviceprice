/**
 * POST /api/v1/admin/ai-normalize
 * Uses the LLM (z-ai-web-dev-sdk) to suggest a normalized service mapping for
 * unmatched queue entries that the fuzzy matcher couldn't align (confidence < 80%).
 *
 * Body: { id: string }          — suggest for a single unmatched entry
 *       { ids?: string[] }       — suggest for multiple (defaults to all pending)
 *
 * Returns: { suggestions: [{ unmatchedId, rawName, suggestedServiceId?, suggestedName?, confidence, reason }] }
 *
 * The LLM is given the full services directory as context and asked to pick the
 * best matching service for each raw name, or "NONE" if no good match exists.
 * Results are stored back on the unmatched_queue.suggested_service_id for the
 * admin to confirm.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AISuggestion = {
  rawName: string;
  serviceId: string | null;
  serviceName: string | null;
  confidence: number; // 0-1
  reason: string;
};

export async function POST(req: NextRequest) {
  let body: { id?: string; ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty */
  }

  // Collect target unmatched entries
  let items;
  if (body.id) {
    items = await db.unmatchedQueue.findMany({ where: { id: body.id } });
  } else if (body.ids?.length) {
    items = await db.unmatchedQueue.findMany({ where: { id: { in: body.ids } } });
  } else {
    items = await db.unmatchedQueue.findMany({
      where: { status: "pending" },
      orderBy: { confidence: "asc" },
      take: 10, // cap per call to keep LLM context manageable
    });
  }

  if (!items.length) {
    return NextResponse.json({ suggestions: [], message: "No pending unmatched entries" });
  }

  // Load services directory as the matching target
  const directory = await db.serviceDirectory.findMany({
    select: { id: true, nameRu: true, nameKk: true, nameEn: true, category: true, synonyms: true },
  });

  // Build a compact directory listing for the LLM prompt
  const directoryLines = directory.map((d, i) => {
    const syn = safeArr(d.synonyms).slice(0, 4).join(", ");
    return `${i + 1}. ID=${d.id} | ${d.nameRu} / ${d.nameEn} (${d.category})${syn ? ` | syn: ${syn}` : ""}`;
  });

  const rawLines = items.map((it, i) => `${i + 1}. "${it.serviceNameRaw}" (source: ${it.sourceName}, city: ${it.cityNameRaw})`);

  const systemPrompt = `Ты медицинский эксперт-нормализатор. Тебе дан справочник медицинских услуг (с ID) и список сырых названий услуг, собранных с сайтов клиник Казахстана. 
Твоя задача — для каждого сырого названия найти наиболее подходящую услугу из справочника и вернуть её ID, или "NONE" если подходящей услуги нет.
Учитывай синонимы, сокращения (ОАК=CBC, МРТ=MRI), русский/казахский/английский языки. Если сырого названия достаточно чтобы понять, что это медицинская процедура/анализ/приём, но точного совпадения нет — верни NONE с объяснением.

Верни ТОЛЬКО валидный JSON-массив, без markdown, без пояснений. Формат каждого элемента:
{"index": <номер сырого названия>, "serviceId": "<ID или null>", "confidence": <0.0-1.0>, "reason": "<короткое объяснение на русском>"}`;

  const userPrompt = `СПРАВОЧНИК УСЛУГ:\n${directoryLines.join("\n")}\n\nСЫРЫЕ НАЗВАНИЯ ДЛЯ СОПОСТАВЛЕНИЯ:\n${rawLines.join("\n")}`;

  let aiResponse: string;
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });
    aiResponse = completion.choices[0]?.message?.content ?? "";
  } catch (e) {
    return NextResponse.json(
      { error: "LLM call failed", detail: String((e as Error).message) },
      { status: 502 }
    );
  }

  // Parse the JSON array from the LLM response (strip any markdown fences)
  let parsed: Array<{ index: number; serviceId: string | null; confidence: number; reason: string }> = [];
  const cleaned = aiResponse
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch {
    // fall through with empty parsed
  }

  // Persist suggestions back onto the unmatched entries
  const suggestions: AISuggestion[] = [];
  for (const item of items) {
    const idx = items.indexOf(item) + 1;
    const match = parsed.find((p) => p.index === idx);
    let serviceId: string | null = null;
    let serviceName: string | null = null;
    let confidence = 0;
    let reason = "LLM did not return a suggestion";
    if (match) {
      confidence = Math.max(0, Math.min(1, Number(match.confidence) || 0));
      reason = String(match.reason ?? "").slice(0, 500);
      if (match.serviceId && match.serviceId !== "null") {
        const found = directory.find((d) => d.id === match.serviceId);
        if (found) {
          serviceId = found.id;
          serviceName = found.nameRu;
        }
      }
    }
    // Update the unmatched row with the AI suggestion (status stays pending until admin confirms)
    if (serviceId) {
      await db.unmatchedQueue.update({
        where: { id: item.id },
        data: { suggestedServiceId: serviceId, notes: `AI: ${reason}` },
      });
    }
    suggestions.push({
      rawName: item.serviceNameRaw,
      serviceId,
      serviceName,
      confidence,
      reason,
    });
  }

  return NextResponse.json({
    suggestions: items.map((it, i) => ({
      unmatchedId: it.id,
      rawName: it.serviceNameRaw,
      ...suggestions[i],
    })),
    processed: items.length,
  });
}

function safeArr(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
