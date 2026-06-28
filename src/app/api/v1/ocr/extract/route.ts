/**
 * POST /api/v1/ocr/extract
 * OCR / document extraction endpoint (Workstream 3).
 *
 * Accepts multipart/form-data with a single `file` field and extracts
 * medical-service names from it, mapping each one to the ServiceDirectory
 * with a deterministic confidence score.
 *
 * Supported input types:
 *   • image/png, image/jpeg, image/webp         → VLM (vision) extraction
 *   • application/pdf                           → VLM (vision) extraction
 *   • text/plain, text/csv                      → one service name per line
 *   • application/json                          → string values that look
 *                                                 like service names
 *
 * Algorithm:
 *   1. Parse multipart form, pull `file`, validate type + size (≤ 10 MB).
 *   2. Branch on type:
 *        - text/*           → split lines, each non-empty line is an item
 *        - application/json → parse + heuristic string-value filter
 *        - image/* | pdf    → base64 data URL → z-ai-web-dev-sdk
 *                             `chat.completions.createVision` with a strict
 *                             "return only a JSON array of strings" prompt.
 *                             On any failure, return 501 "Image OCR not
 *                             supported in this environment" so the UI can
 *                             surface a friendly fallback message.
 *   3. For each extracted string, attempt a deterministic match against the
 *      ServiceDirectory:
 *        - exact case-insensitive name match → confidence 1.0
 *        - substring match on a canonical name (nameRu/nameKk/nameEn) → 0.8
 *        - substring match on a synonym only → 0.6
 *        - no match → confidence 0.0, matchedServiceId = null
 *      The FIRST match wins (deterministic, ordered by Prisma's default
 *      id ordering so results are stable run-to-run).
 *   4. Always return a structured response, even on empty extraction:
 *        { items: OcrItem[], elapsedMs: number, warning?: string }
 *
 * The disclaimer ("extraction is automatic and may contain errors") is
 * shown in the UI at all times — this endpoint never claims medical
 * authority; it only performs name extraction + directory lookup.
 *
 * Response shape (200):
 * {
 *   "items": [
 *     { "extractedText": "ОАК",
 *       "matchedServiceId": "cm..." | null,
 *       "matchedServiceName": "Общий анализ крови (ОАК)" | null,
 *       "confidence": 0.8 }
 *   ],
 *   "elapsedMs": 1234,
 *   "warning": "optional — present when extraction yielded no items
 *               or the VLM response could not be parsed"
 * }
 *
 * Errors:
 *   400  "No file uploaded"           — missing/empty `file` field
 *   400  "Unsupported file type"      — type not in allow-list above
 *   400  "File too large"             — size > 10 MB
 *   501  "Image OCR not supported in this environment"
 *                                     — VLM call failed / SDK unavailable
 *
 * Runtime: nodejs (the z-ai-web-dev-sdk is server-only). force-dynamic
 * because every request is unique (file upload).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
]);

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

type OcrItem = {
  extractedText: string;
  matchedServiceId: string | null;
  matchedServiceName: string | null;
  confidence: number; // 0.0 | 0.6 | 0.8 | 1.0
};

type DirectoryRow = {
  id: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  synonyms: string[];
};

/** Defensive parse of the JSON-encoded `synonyms` column into a string[]. */
function safeSynonyms(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/**
 * Try to match a single extracted string against the loaded directory.
 * Returns the first match (deterministic) with a confidence tier:
 *   1.0 — exact case-insensitive name match
 *   0.8 — substring match on a canonical name (ru/kk/en)
 *   0.6 — substring match on a synonym only
 *   0.0 — no match (matchedServiceId = null)
 *
 * "Substring" is bidirectional: either the extracted text contains a
 * canonical name (e.g. "сделать ОАК срочно" ⊇ "ОАК") or a canonical name
 * contains the extracted text (e.g. "ОАК" ⊆ "Общий анализ крови (ОАК)").
 */
function matchService(
  raw: string,
  directory: DirectoryRow[],
): {
  matchedServiceId: string | null;
  matchedServiceName: string | null;
  confidence: number;
} {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return { matchedServiceId: null, matchedServiceName: null, confidence: 0 };
  }

  // Tier 1 — exact name match (any of the three canonical names)
  for (const d of directory) {
    if (
      d.nameRu.toLowerCase() === text ||
      d.nameKk.toLowerCase() === text ||
      d.nameEn.toLowerCase() === text
    ) {
      return {
        matchedServiceId: d.id,
        matchedServiceName: d.nameRu,
        confidence: 1.0,
      };
    }
  }

  // Tier 2 — exact synonym match (still strong, but not a canonical name)
  for (const d of directory) {
    for (const syn of d.synonyms) {
      if (syn.trim().toLowerCase() === text) {
        return {
          matchedServiceId: d.id,
          matchedServiceName: d.nameRu,
          confidence: 0.8,
        };
      }
    }
  }

  // Tier 3 — substring match on a canonical name (bidirectional)
  for (const d of directory) {
    const ru = d.nameRu.toLowerCase();
    const kk = d.nameKk.toLowerCase();
    const en = d.nameEn.toLowerCase();
    if (
      (ru.length >= 3 && (text.includes(ru) || ru.includes(text))) ||
      (kk.length >= 3 && (text.includes(kk) || kk.includes(text))) ||
      (en.length >= 3 && (text.includes(en) || en.includes(text)))
    ) {
      return {
        matchedServiceId: d.id,
        matchedServiceName: d.nameRu,
        confidence: 0.8,
      };
    }
  }

  // Tier 4 — substring match on a synonym only (lower confidence)
  for (const d of directory) {
    for (const syn of d.synonyms) {
      const s = syn.trim().toLowerCase();
      if (s.length >= 3 && (text.includes(s) || s.includes(text))) {
        return {
          matchedServiceId: d.id,
          matchedServiceName: d.nameRu,
          confidence: 0.6,
        };
      }
    }
  }

  return { matchedServiceId: null, matchedServiceName: null, confidence: 0 };
}

/**
 * Pull string values out of an arbitrary parsed JSON value. Only strings
 * longer than 3 chars and not pure-numbers are kept (the heuristic from the
 * task spec). Recurses into objects and arrays.
 */
function collectJsonStrings(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === "string") {
    const v = node.trim();
    if (v.length > 3 && !/^\d+([.,]\d+)?$/.test(v)) {
      out.push(v);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectJsonStrings(n, out);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectJsonStrings(v, out);
    }
  }
}

/** Strip markdown fences + surrounding prose and parse the JSON array. */
function parseJsonArray(raw: string): string[] {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const candidate = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(candidate)) return [];
    return candidate
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();

  // ── 1. Parse multipart form ──────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "No file uploaded" },
      { status: 400 },
    );
  }

  const fileField = form.get("file");
  if (!fileField || typeof fileField === "string") {
    return NextResponse.json(
      { error: "No file uploaded" },
      { status: 400 },
    );
  }

  const file = fileField as File;

  // ── 2. Validate type + size ──────────────────────────────────────────────
  const ctype = (file.type || "").toLowerCase();
  if (!ALLOWED_TYPES.has(ctype)) {
    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large" },
      { status: 400 },
    );
  }

  // ── 3. Load service directory (only what we need for matching) ───────────
  let directory: DirectoryRow[] = [];
  try {
    const rows = await db.serviceDirectory.findMany({
      select: {
        id: true,
        nameRu: true,
        nameKk: true,
        nameEn: true,
        synonyms: true,
      },
      orderBy: { id: "asc" }, // deterministic match order
    });
    directory = rows.map((r) => ({
      id: r.id,
      nameRu: r.nameRu,
      nameKk: r.nameKk,
      nameEn: r.nameEn,
      synonyms: safeSynonyms(r.synonyms),
    }));
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to load service directory",
        detail: String((e as Error).message),
        elapsedMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }

  // ── 4. Extract raw strings, branching on file type ──────────────────────
  let rawStrings: string[] = [];
  let warning: string | undefined;

  if (IMAGE_TYPES.has(ctype)) {
    // Vision path — base64-encode the file and ask the VLM for a JSON array.
    let dataUrl: string;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const b64 = buf.toString("base64");
      dataUrl = `data:${ctype};base64,${b64}`;
    } catch (e) {
      return NextResponse.json(
        {
          error: "Image OCR not supported in this environment",
          detail: String((e as Error).message),
          elapsedMs: Date.now() - t0,
        },
        { status: 501 },
      );
    }

    const systemPrompt =
      "You are a medical-service extractor. From this image, extract all medical test or service names. " +
      "Return ONLY a JSON array of strings, no commentary.";

    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.createVision({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: systemPrompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        thinking: { type: "disabled" },
      });
      const content: string =
        completion?.choices?.[0]?.message?.content ?? "";
      rawStrings = parseJsonArray(content);
      if (rawStrings.length === 0) {
        warning = "Image OCR not supported in this environment";
      }
    } catch (e) {
      // VLM unavailable / errored — surface a 501 so the UI can fall back
      // gracefully to a "please upload a text file" message.
      return NextResponse.json(
        {
          error: "Image OCR not supported in this environment",
          detail: String((e as Error).message),
          elapsedMs: Date.now() - t0,
        },
        { status: 501 },
      );
    }
  } else if (ctype === "text/plain" || ctype === "text/csv") {
    // Text path — one service name per non-empty line.
    try {
      const text = await file.text();
      rawStrings = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (rawStrings.length === 0) {
        warning = "No service names found in the uploaded text file";
      }
    } catch (e) {
      return NextResponse.json(
        {
          error: "Failed to read text file",
          detail: String((e as Error).message),
          elapsedMs: Date.now() - t0,
        },
        { status: 400 },
      );
    }
  } else if (ctype === "application/json") {
    // JSON path — collect string values that look like service names.
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      collectJsonStrings(parsed, rawStrings);
      if (rawStrings.length === 0) {
        warning = "No service-name-like strings found in the JSON file";
      }
    } catch (e) {
      return NextResponse.json(
        {
          error: "Failed to parse JSON file",
          detail: String((e as Error).message),
          elapsedMs: Date.now() - t0,
        },
        { status: 400 },
      );
    }
  }

  // ── 5. Match each extracted string against the ServiceDirectory ──────────
  const items: OcrItem[] = rawStrings.map((raw) => {
    const m = matchService(raw, directory);
    return {
      extractedText: raw,
      matchedServiceId: m.matchedServiceId,
      matchedServiceName: m.matchedServiceName,
      confidence: m.confidence,
    };
  });

  if (items.length === 0 && !warning) {
    warning = "No service names could be extracted from the uploaded file";
  }

  // ── 6. Respond ───────────────────────────────────────────────────────────
  const body: Record<string, unknown> = {
    items,
    elapsedMs: Date.now() - t0,
  };
  if (warning) body.warning = warning;

  return NextResponse.json(body, { status: 200 });
}
