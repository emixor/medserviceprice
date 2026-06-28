/**
 * OSMS (Обязательное социальное медицинское страхование) coverage classification.
 *
 * The Kazakhstan OSMS framework guarantees a baseline package of free medical
 * services for insured citizens at participating clinics. Coverage reality is
 * complex (depends on the patient's insurance status, the clinic's OSMS
 * contract, the specific ICD-10 diagnosis, etc.) and we cannot query the
 * official OSMS register in real time. This module produces a *hint* based on
 * category + keyword heuristics, clearly marked as informational.
 *
 * Three deterministic classes:
 *   "likely"   — basic diagnostic & primary-care services typically included
 *                in the OSMS guaranteed package (CBC, urinalysis, ECG, X-ray,
 *                therapist/GP/endocrinologist visits, etc.)
 *   "unlikely" — cosmetic, elective, premium, or wellness services typically
 *                NOT covered (Botox, LASIK, dental implants, VIP check-ups)
 *   "unknown"  — everything else (specialist visits, MRI, etc.) — UI shows an
 *                "informational only" disclaimer.
 *
 * Deterministic: same input always produces the same output.
 * No external API calls. No invented coverage claims.
 */

export type OsmsCoverage = "likely" | "unlikely" | "unknown";

type ServiceForOsms = {
  category: string;
  nameRu: string;
  nameEn?: string;
  synonyms?: string[];
};

// --- "Likely covered" keyword patterns ---------------------------------------
// Basic diagnostics and primary care that the OSMS guaranteed package
// typically includes for insured patients at contracted clinics.
const LIKELY_COVERED_PATTERNS: RegExp[] = [
  // Core hematology & basic chemistry
  /\bОАК\b|общий анализ крови|ЖАҚ|complete blood count|\bCBC\b|blood count|клинический анализ крови/i,
  /анализ мочи|urinalysis|ОАМ|urine test/i,
  /биохимическ|biochemistry|metabolic panel|БХК/i,
  /глюкоза|glucose|сахар крови/i,
  /электрокардио|\bЭКГ\b|\bECG\b|\bEKG\b|кардиограмм/i,
  /рентген|x-?ray|fluorograph|флюорограф/i,
  /УЗИ|ультразвук|ultrasound|sonograph/i,
  // Primary-care physician visits
  /приём терапевт|терапевт|general practitioner|\bGP\b|family doctor|врач общей практики/i,
  /приём педиатр|педиатр|pediatric/i,
  // Common chronic-disease monitoring
  /гликирован|HbA1c|артериальн|blood pressure/i,
  // Pregnancy / basic prenatal
  /приём гинеколог|гинеколог|gynecolog|акушер|obstetric/i,
  // Vaccinations
  /вакцин|прививк|vaccin/i,
];

// --- "Likely NOT covered" keyword patterns -----------------------------------
// Cosmetic, elective, premium-tier, or wellness-oriented services that are
// almost never covered by state insurance anywhere.
const LIKELY_NOT_COVERED_PATTERNS: RegExp[] = [
  // Cosmetic / aesthetic
  /ботокс|botox|косметолог|aesthetic|beauty|filler|филлер|мезотерап/i,
  /лазерн|laser hair|epilat|эпилляц/i,
  /пластик|plastic surgery|rhinoplast|ринопласт/i,
  // Vision correction
  /лазерн.*коррекц|LASIK|SMILE|рефракционн/i,
  // Dental implants / ortho
  /имплант|implant|брекет|braces|виниры|veneer/i,
  /отбеливан.*зуб|teeth whitening/i,
  // Premium / VIP / executive
  /\bVIP\b|премиум|executive|члекап.*премиум|VIP-чекап/i,
  // Wellness & spa
  /массаж.*расслаб|spa|wellness|оздоровительн.*программ/i,
  /генетическ.*тест|genetic test|DNA test/i,
];

/**
 * Classify a service's likely OSMS coverage based on its name + synonyms + category.
 * Returns one of "likely" | "unlikely" | "unknown".
 *
 * Algorithm:
 * 1. Concatenate nameRu + nameEn + synonyms into one lowercase haystack.
 * 2. If any LIKELY_NOT_COVERED pattern matches → "unlikely" (cosmetic/elective wins).
 * 3. Else if any LIKELY_COVERED pattern matches → "likely".
 * 4. Else → "unknown" (most specialist diagnostics and procedures land here).
 *
 * Deterministic & order-stable: the same input always produces the same output.
 */
export function classifyOsmsCoverage(svc: ServiceForOsms): OsmsCoverage {
  const haystack = [
    svc.nameRu,
    svc.nameEn ?? "",
    ...(svc.synonyms ?? []),
  ].join(" ");

  // Check "unlikely" patterns first — cosmetic/elective wins over basic.
  for (const p of LIKELY_NOT_COVERED_PATTERNS) {
    if (p.test(haystack)) return "unlikely";
  }
  for (const p of LIKELY_COVERED_PATTERNS) {
    if (p.test(haystack)) return "likely";
  }
  return "unknown";
}

/**
 * Human-readable localized note explaining the OSMS hint.
 * Always reminds the user that coverage depends on their insurance & clinic.
 */
export function osmsNote(coverage: OsmsCoverage, t: (k: string) => string): string {
  switch (coverage) {
    case "likely":
      return t("osms.note.likely");
    case "unlikely":
      return t("osms.note.unlikely");
    default:
      return t("osms.note.unknown");
  }
}
