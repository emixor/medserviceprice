/**
 * Normalization Engine
 * -------------------------------------------------------------
 * Maps raw service name strings (e.g. "ОАК", "Общий анализ крови",
 * "CBC", "Клинический анализ крови") to a single normalized
 * ServiceDirectory item using fuzzy token-set matching.
 *
 * Algorithm:
 *  1. Normalize text (lowercase, strip punctuation, collapse whitespace, transliterate Latin<->Cyrillic for common medical terms)
 *  2. Build a candidate pool = directory name (RU/KK/EN) + synonyms, each normalized
 *  3. Score each candidate using a blend of:
 *       - exact normalized equality            (1.0)
 *       - token-set ratio (Jaccard on token sets) — handles reordering/extra words
 *       - token-sort ratio (Levenshtein on sorted tokens)
 *       - substring containment boost
 *  4. Return best match + confidence in [0,1].
 *  5. Confidence >= MATCH_THRESHOLD (0.80) => normalized; else => unmatched queue.
 */

export type ServiceCandidate = {
  id: string;
  nameRu: string;
  nameKk: string;
  nameEn: string;
  synonyms: string[];
  category: string;
};

export type NormalizeResult = {
  serviceId: string | null;
  confidence: number;
  matchedText: string | null;
};

export const MATCH_THRESHOLD = 0.8;

/** Cyrillic <-> Latin transliteration maps for common medical tokens. */
const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const LAT_TO_CYR: Record<string, string> = {
  a: "а", b: "б", v: "в", g: "г", d: "д", e: "е", zh: "ж", z: "з",
  i: "и", y: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  r: "р", s: "с", t: "т", u: "у", f: "ф", h: "х", ts: "ц", ch: "ч",
  sh: "ш", sch: "щ", ya: "я", yu: "ю", yo: "ё",
};

/** Known multi-letter transliteration sequences (must be replaced before single chars). */
const MULTI_LAT = ["sch", "shch", "zh", "sh", "ch", "ya", "yu", "yo", "ts", "kh", "ye"];
const MULTI_LAT_TARGET = ["щ", "щ", "ж", "ш", "ч", "я", "ю", "ё", "ц", "х", "е"];

/** Normalize a raw string: lowercase, strip punctuation, collapse whitespace, transliterate. */
export function normalizeText(input: string): string {
  if (!input) return "";
  let s = input.toLowerCase().trim();
  // Replace digits/quotes/specials
  s = s.replace(/[«»"']/g, " ");
  // Strip punctuation but keep letters, digits, spaces and + sign (e.g. "c-реактивный белок")
  s = s.replace(/[^\p{L}\p{N}\s+]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Produce a transliterated variant (Cyrillic -> Latin). */
export function transliterateCyrToLat(input: string): string {
  let s = input.toLowerCase();
  let out = "";
  for (const ch of s) {
    out += CYR_TO_LAT[ch] ?? ch;
  }
  return out;
}

/** Produce a transliterated variant (Latin -> Cyrillic). */
export function transliterateLatToCyr(input: string): string {
  let s = input.toLowerCase();
  for (let i = 0; i < MULTI_LAT.length; i++) {
    s = s.split(MULTI_LAT[i]).join(MULTI_LAT_TARGET[i]);
  }
  let out = "";
  for (const ch of s) {
    out += LAT_TO_CYR[ch] ?? ch;
  }
  return out;
}

/** Levenshtein edit distance (iterative, O(m*n)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Ratio similarity based on Levenshtein (1.0 = identical). */
function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}

/** Tokenize a normalized string. */
function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Jaccard similarity over token sets (token-set ratio core). */
function jaccard(tokensA: string[], tokensB: string[]): number {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Token-set ratio: compare the intersection-of-words strings.
 * This is robust to extra words and reordering (FuzzyWuzzy token_set_ratio style).
 */
function tokenSetRatio(a: string, b: string): number {
  const tA = new Set(tokenize(a));
  const tB = new Set(tokenize(b));
  if (!tA.size || !tB.size) return 0;

  const inter: string[] = [];
  for (const t of tA) if (tB.has(t)) inter.push(t);
  const interStr = inter.sort().join(" ");

  const onlyA = [...tA].filter((t) => !tB.has(t)).sort().join(" ");
  const onlyB = [...tB].filter((t) => !tA.has(t)).sort().join(" ");

  const fullA = [...tA].sort().join(" ");
  const fullB = [...tB].sort().join(" ");

  const r1 = ratio(interStr, fullA);
  const r2 = ratio(interStr, fullB);
  const r3 = ratio(fullA, fullB);
  const r4 = ratio(onlyA, onlyB);

  return Math.max(r1, r2, r3, r4);
}

/**
 * Build all normalized candidate strings for a directory service:
 * RU, KK, EN names + each synonym, plus their transliterations.
 */
function buildCandidateStrings(svc: ServiceCandidate): string[] {
  const strings = new Set<string>();
  const raws = [svc.nameRu, svc.nameKk, svc.nameEn, ...svc.synonyms];
  for (const raw of raws) {
    if (!raw) continue;
    const norm = normalizeText(raw);
    if (norm) strings.add(norm);
    // Add transliteration variant if cyrillic present
    if (/[а-яё]/i.test(raw)) {
      const tr = transliterateCyrToLat(norm);
      if (tr) strings.add(tr);
    } else if (/[a-z]/i.test(raw)) {
      const tr = transliterateLatToCyr(norm);
      if (tr) strings.add(tr);
    }
  }
  return [...strings];
}

/**
 * Compute the best confidence score between a raw name and a service candidate.
 * Blends exact, token-set, token-sort (via jaccard) and substring boost.
 */
export function scoreMatch(rawNorm: string, candidateStrings: string[]): number {
  let best = 0;
  for (const cand of candidateStrings) {
    if (!cand) continue;
    // Exact normalized equality
    if (rawNorm === cand) return 1.0;
    // Substring containment boost (one fully contains the other)
    let score = tokenSetRatio(rawNorm, cand);
    if (rawNorm.includes(cand) || cand.includes(rawNorm)) {
      score = Math.max(score, 0.9);
    }
    // Token Jaccard as a secondary signal
    const j = jaccard(tokenize(rawNorm), tokenize(cand));
    score = Math.max(score, j);
    // Direct char ratio for very short strings (acronyms like ОАК/CBC)
    if (rawNorm.length <= 6 || cand.length <= 6) {
      const r = ratio(rawNorm, cand);
      score = Math.max(score, r);
    }
    if (score > best) best = score;
  }
  return best;
}

/**
 * Find the best matching service for a raw service name.
 * Returns the service id + confidence, or null id with confidence < threshold.
 */
export function findBestMatch(
  rawServiceName: string,
  directory: ServiceCandidate[]
): NormalizeResult {
  const rawNorm = normalizeText(rawServiceName);
  if (!rawNorm) return { serviceId: null, confidence: 0, matchedText: null };

  // Also try transliteration of the raw input so "CBC" matches "ОАК"-style entries via synonyms
  const rawVariants = new Set<string>([rawNorm]);
  if (/[а-яё]/i.test(rawServiceName)) {
    rawVariants.add(transliterateCyrToLat(rawNorm));
  } else if (/[a-z]/i.test(rawServiceName)) {
    rawVariants.add(transliterateLatToCyr(rawNorm));
  }

  let bestId: string | null = null;
  let bestScore = 0;
  let bestText: string | null = null;

  for (const svc of directory) {
    const candidates = buildCandidateStrings(svc);
    let svcBest = 0;
    let svcBestText: string | null = null;
    for (const variant of rawVariants) {
      const sc = scoreMatch(variant, candidates);
      if (sc > svcBest) {
        svcBest = sc;
        svcBestText = svc.nameRu;
      }
    }
    if (svcBest > bestScore) {
      bestScore = svcBest;
      bestId = svc.id;
      bestText = svcBestText;
    }
  }

  return {
    serviceId: bestScore >= MATCH_THRESHOLD ? bestId : null,
    confidence: Number(bestScore.toFixed(4)),
    matchedText: bestText,
  };
}

/**
 * Batch normalize a list of raw names against the directory.
 * Returns results in the same order.
 */
export function normalizeBatch(
  rawNames: string[],
  directory: ServiceCandidate[]
): NormalizeResult[] {
  return rawNames.map((n) => findBestMatch(n, directory));
}
