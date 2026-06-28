/**
 * Seed initializer — populates the services_directory with 120 reference services.
 * Idempotent: safe to run multiple times (uses upsert by nameRu).
 *
 * Also classifies each service's OSMS coverage hint (likely/unlikely/unknown)
 * using deterministic keyword rules from src/lib/osms-rules.ts. This is a hint,
 * not authoritative — the UI always shows an "informational only" disclaimer.
 */
import { db } from "@/lib/db";
import { SERVICE_DIRECTORY_SEED } from "@/lib/seed-data";
import { classifyOsmsCoverage } from "@/lib/osms-rules";

export async function ensureServicesDirectory(): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;
  for (const svc of SERVICE_DIRECTORY_SEED) {
    const osmsCoverage = classifyOsmsCoverage(svc);
    const found = await db.serviceDirectory.findFirst({ where: { nameRu: svc.nameRu } });
    if (found) {
      existing++;
      // refresh synonyms/category/osmsCoverage to keep in sync with seed file
      await db.serviceDirectory.update({
        where: { id: found.id },
        data: {
          nameKk: svc.nameKk,
          nameEn: svc.nameEn,
          synonyms: JSON.stringify(svc.synonyms),
          category: svc.category,
          description: svc.description ?? null,
          unit: svc.unit ?? null,
          osmsCoverage,
        },
      });
    } else {
      await db.serviceDirectory.create({
        data: {
          nameRu: svc.nameRu,
          nameKk: svc.nameKk,
          nameEn: svc.nameEn,
          synonyms: JSON.stringify(svc.synonyms),
          category: svc.category,
          description: svc.description ?? null,
          unit: svc.unit ?? null,
          osmsCoverage,
        },
      });
      created++;
    }
  }
  return { created, existing };
}
