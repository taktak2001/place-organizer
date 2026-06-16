import type { NormalizedImportItem } from "@/types/import";

export async function importFromManualGoogleMapsUrl(_url: string): Promise<NormalizedImportItem[]> {
  throw new Error("Manual Google Maps URL import is planned for a future phase.");
}

export async function importFromTakeoutZip(_file: File): Promise<NormalizedImportItem[]> {
  throw new Error("Use /api/import/parse in Phase 1. This interface is reserved for future orchestration.");
}

export async function importFromCsv(_file: File): Promise<NormalizedImportItem[]> {
  throw new Error("Use /api/import/parse in Phase 1. This interface is reserved for future orchestration.");
}

export async function importFromGeoJson(_file: File): Promise<NormalizedImportItem[]> {
  throw new Error("Use /api/import/parse in Phase 1. This interface is reserved for future orchestration.");
}

export async function enrichWithGooglePlaces(_placeIds: string[]): Promise<void> {
  throw new Error("Google Places enrichment is intentionally disabled in Phase 1.");
}

export async function classifyWithAI(_placeIds: string[]): Promise<void> {
  throw new Error("AI classification is planned for a future phase.");
}
