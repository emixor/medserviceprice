/**
 * GET /api/v1/export/pdf
 * -------------------------------------------------------------
 * Exports the current search results as a polished PDF report.
 * Uses pdf-lib (pure JS, no external data files).
 *
 * Layout:
 *  - Header banner: brand + report title + generation timestamp
 *  - Filter summary line
 *  - Stats strip (6 tiles)
 *  - Results table: clinic, city, service, price, rating, duration
 *  - Footer: source + page numbers
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asStr(v: string | null): string | null {
  return v && v.trim() ? v.trim() : null;
}
function asNum(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: string | null): boolean | null {
  if (v == null) return null;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
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

function serviceHaystack(svc: { nameRu: string; nameKk: string; nameEn: string; synonyms: string | null }): string {
  const syn = safeArr(svc.synonyms).join(" ");
  return `${svc.nameRu} ${svc.nameKk} ${svc.nameEn} ${syn}`.toLowerCase();
}

function fmtKzt(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " KZT";
}

// Color helpers (RGB 0-1)
const TEAL = rgb(13 / 255, 148 / 255, 136 / 255);
const DARK = rgb(17 / 255, 24 / 255, 39 / 255);
const MUTED = rgb(107 / 255, 114 / 255, 128 / 255);
const ROW_ALT = rgb(245 / 255, 247 / 255, 250 / 255);
const BORDER = rgb(226 / 255, 232 / 255, 240 / 255);
const WHITE = rgb(1, 1, 1);
const EMERALD = rgb(16 / 255, 122 / 255, 87 / 255);

// Transliterate Cyrillic → Latin for PDF (Helvetica doesn't support Cyrillic).
// This is a simple, lossy transliteration sufficient for an exported report.
function translit(s: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
    А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "Zh", З: "Z",
    И: "I", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P", Р: "R",
    С: "S", Т: "T", У: "U", Ф: "F", Х: "Kh", Ц: "Ts", Ч: "Ch", Ш: "Sh",
    Щ: "Sch", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "Yu", Я: "Ya",
  };
  let out = "";
  for (const ch of s) out += map[ch] ?? ch;
  return out;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + "…";
}

export async function GET(req: NextRequest) {
  try {
  const sp = req.nextUrl.searchParams;
  const q = asStr(sp.get("q"));
  const city = asStr(sp.get("city"));
  const category = asStr(sp.get("category"));
  const priceMin = asNum(sp.get("price_min"));
  const priceMax = asNum(sp.get("price_max"));
  const ratingMin = asNum(sp.get("rating_min"));
  const onlineBooking = asBool(sp.get("online_booking"));
  const sort = asStr(sp.get("sort")) ?? "price_asc";
  const qLower = q ? q.toLowerCase() : null;

  // Build non-text filters
  const where: Record<string, unknown> = { isActive: true };
  const serviceWhere: Record<string, unknown> = {};
  if (category) serviceWhere.category = category;
  if (Object.keys(serviceWhere).length) where.service = serviceWhere;
  if (priceMin != null || priceMax != null) {
    const range: Record<string, number> = {};
    if (priceMin != null) range.gte = priceMin;
    if (priceMax != null) range.lte = priceMax;
    where.priceKzt = range;
  }
  const clinicWhere: Record<string, unknown> = {};
  if (city) clinicWhere.city = city;
  if (ratingMin != null) clinicWhere.rating = { gte: ratingMin };
  if (onlineBooking === true) clinicWhere.onlineBooking = true;
  if (Object.keys(clinicWhere).length) where.clinic = clinicWhere;

  const rows = await db.normalizedPrice.findMany({
    where,
    include: { clinic: true, service: true },
    take: 200,
  });

  const filtered = qLower
    ? rows.filter(
        (r) =>
          serviceHaystack(r.service).includes(qLower) ||
          r.clinic.clinicName.toLowerCase().includes(qLower) ||
          r.serviceNameRaw.toLowerCase().includes(qLower)
      )
    : rows;

  const sorted = [...filtered];
  switch (sort) {
    case "price_desc":
      sorted.sort((a, b) => b.priceKzt - a.priceKzt);
      break;
    case "rating_desc":
      sorted.sort((a, b) => b.clinic.rating - a.clinic.rating || a.priceKzt - b.priceKzt);
      break;
    case "parsed_desc":
      sorted.sort((a, b) => b.parsedAt.getTime() - a.parsedAt.getTime());
      break;
    case "price_asc":
    default:
      sorted.sort((a, b) => a.priceKzt - b.priceKzt);
  }

  // ----- Build PDF -----
  const pdfDoc = await PDFDocument.create();
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28; // A4
  const pageH = 841.89;
  const margin = 36;
  const contentW = pageW - margin * 2;

  let page = pdfDoc.addPage([pageW, pageH]);
  let y = pageH;

  const drawHeaderBanner = () => {
    page.drawRectangle(0, pageH - 80, pageW, 80, { color: TEAL });
    page.drawText("MedServicePrice.kz", { x: margin, y: pageH - 36, size: 20, font: helvBold, color: WHITE });
    page.drawText("Medical service price comparison — Kazakhstan", {
      x: margin,
      y: pageH - 56,
      size: 10,
      font: helv,
      color: WHITE,
    });
    page.drawText(`Generated: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, {
      x: margin,
      y: pageH - 70,
      size: 8,
      font: helv,
      color: WHITE,
    });
  };
  drawHeaderBanner();
  y = pageH - 100;

  // Title
  page.drawText("Price comparison report", { x: margin, y, size: 14, font: helvBold, color: DARK });
  y -= 22;

  // Filter summary
  const filtersTxt = translit(
    [
      `Query: ${q || "—"}`,
      `City: ${city || "All"}`,
      `Category: ${category || "All"}`,
      `Price: ${priceMin ?? "0"}-${priceMax ?? "inf"} KZT`,
      `Rating>=: ${ratingMin ?? "—"}`,
      `Online: ${onlineBooking === true ? "yes" : "no"}`,
      `Sort: ${sort}`,
    ].join("   |   ")
  );
  page.drawText(filtersTxt, { x: margin, y, size: 8, font: helv, color: MUTED, maxWidth: contentW });
  y -= 18;

  // Stats strip
  const totalClinics = new Set(sorted.map((r) => r.clinic.id)).size;
  const totalServices = new Set(sorted.map((r) => r.service.id)).size;
  const prices = sorted.map((r) => r.priceKzt);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 0;
  const avgP = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const stats: [string, string][] = [
    ["Results", String(sorted.length)],
    ["Clinics", String(totalClinics)],
    ["Services", String(totalServices)],
    ["Min", fmtKzt(minP)],
    ["Avg", fmtKzt(avgP)],
    ["Max", fmtKzt(maxP)],
  ];
  const statW = (contentW - 10) / stats.length;
  for (let i = 0; i < stats.length; i++) {
    const [label, value] = stats[i];
    const x = margin + i * statW;
    page.drawRectangle(x, y - 44, statW - 4, 44, { color: ROW_ALT, borderColor: BORDER, borderWidth: 0.5 });
    page.drawText(label.toUpperCase(), { x: x + 6, y: y - 14, size: 7, font: helv, color: MUTED });
    page.drawText(value, { x: x + 6, y: y - 30, size: 11, font: helvBold, color: TEAL });
  }
  y -= 56;

  // Table header
  const cols = [
    { label: "CLINIC", w: 0.30 },
    { label: "CITY", w: 0.13 },
    { label: "SERVICE", w: 0.30 },
    { label: "PRICE", w: 0.13 },
    { label: "RATING", w: 0.07 },
    { label: "DUR", w: 0.07 },
  ];
  function contentWidthFn() { return contentW; }
  const colX = cols.reduce<{ x: number; w: number; label: string }[]>((acc, c, i) => {
    const x = i === 0 ? margin : acc[i - 1].x + acc[i - 1].w;
    acc.push({ x, w: c.w * contentWidthFn(), label: c.label });
    return acc;
  }, []);

  const drawTableHeader = () => {
    page.drawRectangle(margin, y - 18, contentW, 18, { color: TEAL });
    for (const c of colX) {
      page.drawText(c.label, { x: c.x + 5, y: y - 12, size: 8, font: helvBold, color: WHITE });
    }
    y -= 18;
  };
  drawTableHeader();

  // Rows
  const rowH = 20;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (y - rowH < 60) {
      // Footer for current page
      page.drawText("MedServicePrice.kz", { x: margin, y: 28, size: 7, font: helv, color: MUTED });
      page.drawText(`Page ${pdfDoc.getPageCount()}`, { x: pageW - margin - 60, y: 28, size: 7, font: helv, color: MUTED });
      // New page
      page = pdfDoc.addPage([pageW, pageH]);
      y = pageH - margin;
      drawTableHeader();
    }
    if (i % 2 === 0) {
      page.drawRectangle(margin, y - rowH, contentW, rowH, { color: ROW_ALT });
    }
    const clinicName = translit(truncate(r.clinic.clinicName, 32));
    const cityName = translit(r.clinic.city);
    const svcName = translit(truncate(r.service.nameRu, 38));
    const priceStr = fmtKzt(r.priceKzt);
    const ratingStr = r.clinic.rating.toFixed(1);
    const durStr = r.durationDays == null ? "—" : r.durationDays === 0 ? "0d" : `${r.durationDays}d`;
    page.drawText(clinicName, { x: colX[0].x + 5, y: y - 14, size: 7.5, font: helv, color: DARK, maxWidth: colX[0].w - 8 });
    page.drawText(cityName, { x: colX[1].x + 5, y: y - 14, size: 7.5, font: helv, color: MUTED, maxWidth: colX[1].w - 8 });
    page.drawText(svcName, { x: colX[2].x + 5, y: y - 14, size: 7.5, font: helv, color: DARK, maxWidth: colX[2].w - 8 });
    page.drawText(priceStr, { x: colX[3].x + 5, y: y - 14, size: 7.5, font: helvBold, color: EMERALD, maxWidth: colX[3].w - 8 });
    page.drawText(ratingStr, { x: colX[4].x + 5, y: y - 14, size: 7.5, font: helv, color: MUTED, maxWidth: colX[4].w - 8 });
    page.drawText(durStr, { x: colX[5].x + 5, y: y - 14, size: 7.5, font: helv, color: MUTED, maxWidth: colX[5].w - 8 });
    page.drawLine({
      start: { x: margin, y: y - rowH },
      end: { x: margin + contentW, y: y - rowH },
      thickness: 0.3,
      color: BORDER,
    });
    y -= rowH;
  }

  // Footer for last page
  page.drawText("MedServicePrice.kz", { x: margin, y: 28, size: 7, font: helv, color: MUTED });
  page.drawText(`Page ${pdfDoc.getPageCount()}`, { x: pageW - margin - 60, y: 28, size: 7, font: helv, color: MUTED });

  const pdfBytes = await pdfDoc.save();

  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="medserviceprice_${Date.now()}.pdf"`,
      "Content-Length": String(pdfBytes.length),
    },
  });
  } catch (err) {
    console.error("[PDF export] Failed:", err);
    return NextResponse.json(
      { error: "PDF export failed. Please try CSV instead.", detail: String(err) },
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
