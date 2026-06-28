/**
 * Symptom → Service mapper — informational only, NOT a medical diagnosis.
 *
 * Lets users type a symptom (RU/EN/KK) and get a shortlist of services/tests
 * that *might* be relevant, with confidence levels. Each rule is hand-curated
 * and deterministic. Every response includes a strong disclaimer.
 *
 * Rules are matched by:
 *   1. Direct keyword / synonym match in the symptom text (case-insensitive)
 *   2. Multi-symptom AND-conditions (e.g. fever + cough → influenza panel)
 *
 * Each rule lists canonical ServiceDirectory nameRu (or substring) so the API
 * can resolve to a serviceId at runtime via Prisma `contains` lookup. If no
 * service matches, the rule is skipped — never invented.
 *
 * Confidence levels (deterministic, NOT AI):
 *   "high"   — symptom has a direct, common diagnostic pathway
 *   "medium" — symptom could indicate several pathways; multiple tests listed
 *   "low"    — symptom is non-specific; broad panel suggested
 *
 * DISCLAIMER: This is an informational tool to help users find relevant
 * medical services. It is NOT a diagnosis. Always consult a licensed physician.
 */

export type SymptomConfidence = "high" | "medium" | "low";

export type SymptomRule = {
  // Unique rule id, used in the response for traceability.
  id: string;
  // Symptom keywords in any language. Matched case-insensitively as substrings.
  // ALL keywords in an `and` group must match (AND logic within a group).
  // ANY group matching (OR logic across groups) triggers the rule.
  matchers: { and: string[] }[];
  // Suggested services — each entry is a canonical nameRu (or substring) that
  // the API will resolve to a ServiceDirectory row via case-insensitive contains.
  // If multiple services match a nameRu substring, the cheapest-active-price
  // one is preferred. If no service matches, the suggestion is dropped.
  suggestions: { nameRuContains: string; confidence: SymptomConfidence; reason: string }[];
};

export const SYMPTOM_RULES: SymptomRule[] = [
  {
    id: "chest_pain",
    matchers: [
      { and: ["боль в груд"] },
      { and: ["chest pain"] },
      { and: ["грудь.*боль"] },
      { and: ["jürek"] }, // KK heart
      { and: ["жүрек.*ауыр"] },
    ],
    suggestions: [
      { nameRuContains: "Электрокардиограмма", confidence: "high", reason: "ЭКГ — первичная оценка сердечной деятельности при боли в груди." },
      { nameRuContains: "тропонин", confidence: "high", reason: "Тропонин — маркер повреждения миокарда." },
      { nameRuContains: "Приём кардиолог", confidence: "high", reason: "Консультация кардиолога — обязательна при боли в груди." },
    ],
  },
  {
    id: "fever_cough_flu",
    matchers: [
      { and: ["температур", "кашл"] },
      { and: ["fever", "cough"] },
      { and: ["қызба", "жөтел"] },
      { and: ["грипп"] },
      { and: ["flu", "influenza"] },
    ],
    suggestions: [
      { nameRuContains: "Общий анализ крови", confidence: "high", reason: "ОАК — оценить воспаление / инфекцию." },
      { nameRuContains: "С-реактивный белок", confidence: "medium", reason: "СРБ — маркер острого воспаления." },
      { nameRuContains: "Приём терапевт", confidence: "high", reason: "Консультация терапевта — для постановки диагноза." },
      { nameRuContains: "Грипп", confidence: "medium", reason: "ПЦР на грипп — при подозрении на вирусную инфекцию." },
    ],
  },
  {
    id: "fatigue_weakness",
    matchers: [
      { and: ["усталост"] },
      { and: ["слабост"] },
      { and: ["fatigue"] },
      { and: ["weakness"] },
      { and: ["шаршау"] }, // KK
    ],
    suggestions: [
      { nameRuContains: "Общий анализ крови", confidence: "medium", reason: "ОАК — исключить анемию." },
      { nameRuContains: "ферритин", confidence: "medium", reason: "Ферритин — запасы железа." },
      { nameRuContains: "Тиреотропный гормон", confidence: "medium", reason: "ТТГ — исключить гипотиреоз." },
      { nameRuContains: "Биохимический анализ", confidence: "low", reason: "Биохимия крови — общий скрининг." },
    ],
  },
  {
    id: "abdominal_pain",
    matchers: [
      { and: ["боль в живот"] },
      { and: ["живот.*боль"] },
      { and: ["abdominal pain"] },
      { and: ["stomach pain"] },
      { and: ["қарын.*ауыр"] },
    ],
    suggestions: [
      { nameRuContains: "УЗИ брюшной", confidence: "high", reason: "УЗИ органов брюшной полости — визуальная оценка." },
      { nameRuContains: "Биохимический анализ", confidence: "medium", reason: "Биохимия — печёночные и почечные пробы." },
      { nameRuContains: "Приём гастроэнтеролог", confidence: "high", reason: "Консультация гастроэнтеролога." },
      { nameRuContains: "Общий анализ крови", confidence: "low", reason: "ОАК — исключить воспаление." },
    ],
  },
  {
    id: "headache",
    matchers: [
      { and: ["головн.*боль"] },
      { and: ["headache"] },
      { and: ["бас.*ауыр"] },
      { and: ["мигрен"] },
    ],
    suggestions: [
      { nameRuContains: "Приём невролог", confidence: "high", reason: "Консультация невролога при головной боли." },
      { nameRuContains: "МРТ головного мозга", confidence: "medium", reason: "МРТ — при подозрении на органическую патологию." },
      { nameRuContains: "Общий анализ крови", confidence: "low", reason: "ОАК — исключить анемию / инфекцию." },
    ],
  },
  {
    id: "thyroid_check",
    matchers: [
      { and: ["щитовид"] },
      { and: ["thyroid"] },
      { and: ["қалқанша"] }, // KK thyroid
    ],
    suggestions: [
      { nameRuContains: "Тиреотропный гормон", confidence: "high", reason: "ТТГ — основной скрининг функции щитовидной железы." },
      { nameRuContains: "Свободный Т4", confidence: "high", reason: "Свободный Т4 — уточнение функции щитовидной железы." },
      { nameRuContains: "УЗИ щитовидной", confidence: "high", reason: "УЗИ щитовидной железы — оценка структуры." },
      { nameRuContains: "Приём эндокринолог", confidence: "high", reason: "Консультация эндокринолога." },
    ],
  },
  {
    id: "diabetes_screening",
    matchers: [
      { and: ["сахар"] },
      { and: ["диабет"] },
      { and: ["diabetes"] },
      { and: ["glucose"] },
      { and: ["глюкоза"] },
      { and: ["қант"] }, // KK sugar
    ],
    suggestions: [
      { nameRuContains: "Глюкоза крови", confidence: "high", reason: "Глюкоза натощак — базовый скрининг." },
      { nameRuContains: "Гликированный гемоглобин", confidence: "high", reason: "HbA1c — средний сахар за 3 месяца." },
      { nameRuContains: "Приём эндокринолог", confidence: "high", reason: "Консультация эндокринолога." },
    ],
  },
  {
    id: "pregnancy_check",
    matchers: [
      { and: ["беремен"] },
      { and: ["pregnancy"] },
      { and: ["жүкті"] }, // KK
      { and: ["ХГЧ"], },
      { and: ["hCG"] },
    ],
    suggestions: [
      { nameRuContains: "Хорионический гонадотропин", confidence: "high", reason: "ХГЧ — анализ на беременность." },
      { nameRuContains: "Приём гинеколог", confidence: "high", reason: "Консультация гинеколога." },
      { nameRuContains: "УЗИ органов малого таза", confidence: "medium", reason: "УЗИ — подтверждение беременности." },
    ],
  },
  {
    id: "allergy_check",
    matchers: [
      { and: ["аллерг"] },
      { and: ["allergy"] },
      { and: ["аллергия"] },
    ],
    suggestions: [
      { nameRuContains: "Иммуноглобулин E", confidence: "high", reason: "Общий IgE — маркер аллергической реакции." },
      { nameRuContains: "Приём аллерголог", confidence: "high", reason: "Консультация аллерголога." },
      { nameRuContains: "Общий анализ крови", confidence: "low", reason: "ОАК — эозинофилы при аллергии." },
    ],
  },
  {
    id: "vision_check",
    matchers: [
      { and: ["зрени"] },
      { and: ["vision"] },
      { and: ["глаз"] },
      { and: ["eye"] },
    ],
    suggestions: [
      { nameRuContains: "Приём офтальмолог", confidence: "high", reason: "Консультация офтальмолога." },
      { nameRuContains: "Острота зрения", confidence: "high", reason: "Проверка остроты зрения." },
    ],
  },
];

/**
 * Match user input against the rules. Returns up to N matched rules with
 * their suggestions (suggestions NOT yet resolved to serviceId — caller
 * must do the DB lookup).
 *
 * Matching algorithm:
 *   For each rule, check if ANY matcher group matches. A matcher group matches
 *   when ALL its `and` regexes match the input. Returns matched rules in the
 *   order they appear in SYMPTOM_RULES (deterministic).
 *
 * If nothing matches, returns an empty array — caller should show a "we
 * couldn't recognize this symptom — try consulting a doctor" message.
 */
export function matchSymptoms(
  input: string,
  maxRules = 5
): SymptomRule[] {
  const text = input.toLowerCase().trim();
  if (!text) return [];
  const matched: SymptomRule[] = [];
  for (const rule of SYMPTOM_RULES) {
    if (matched.length >= maxRules) break;
    for (const group of rule.matchers) {
      const allMatch = group.and.every((re) => {
        try {
          return new RegExp(re, "i").test(text);
        } catch {
          // If a pattern is malformed, treat as substring literal match.
          return text.includes(re.toLowerCase());
        }
      });
      if (allMatch) {
        matched.push(rule);
        break; // rule matched once, no need to check other groups
      }
    }
  }
  return matched;
}
