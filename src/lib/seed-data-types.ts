/**
 * Shared types for the seed-data module.
 * Extracted to allow clinic-sources.ts to import ServiceCategory
 * without pulling in the full SERVICE_DIRECTORY_SEED array.
 */

export type ServiceCategory = "laboratory" | "doctor_appointment" | "diagnostics" | "procedure";

export type ServiceSeed = {
  nameRu: string;
  nameKk: string;
  nameEn: string;
  synonyms: string[];
  category: ServiceCategory;
  description: string;
  unit?: string;
};
