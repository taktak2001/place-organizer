import type { getSupabaseRead } from "@/lib/supabase/server";

export type PlaceRow = Record<string, unknown>;

export const CATEGORY_SLUGS = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  art: "Art",
  fashion: "Fashion",
  hotel: "Hotel",
  bath: "Bath",
  life: "Life",
  other: "Other"
} as const;

export const PRIMARY_CATEGORY_SLUGS = ["restaurant", "cafe", "art", "fashion", "hotel", "bath"] as const;
export const ALL_CATEGORY_SLUGS = ["restaurant", "cafe", "art", "fashion", "hotel", "bath", "life", "other"] as const;
export const CATEGORY_ORDER = ["Art", "Cafe", "Restaurant", "Fashion", "Hotel", "Bath", "Life", "Other"];
export const PAGE_SIZE = 50;

export type CategorySlug = keyof typeof CATEGORY_SLUGS;

export async function fetchAllPlaces(supabase: ReturnType<typeof getSupabaseRead>) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("*, place_classifications(*), source_links(*)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export function categoryFromSlug(slug: string) {
  return CATEGORY_SLUGS[slug as CategorySlug] ?? null;
}

export function slugFromCategory(category: string) {
  const match = Object.entries(CATEGORY_SLUGS).find(([, value]) => value === category);
  return match?.[0] ?? "other";
}

export function firstRelated(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function activeLinks(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((link) => typeof link === "object" && link !== null && (link as { active?: boolean }).active !== false) as Record<string, unknown>[]
    : [];
}

export function placeCategory(place: PlaceRow) {
  return String(firstRelated(place.place_classifications)?.main_category ?? "Other");
}

export function sceneTags(classification: Record<string, unknown> | null) {
  return Array.isArray(classification?.scene_tags)
    ? classification.scene_tags.map(String).filter(Boolean)
    : [];
}

export function categoryTags(classification: Record<string, unknown> | null) {
  return Array.isArray(classification?.category_tags)
    ? classification.category_tags.map(String).filter(Boolean)
    : [];
}

export function isWantToGo(place: PlaceRow) {
  return activeLinks(place.source_links).some((link) => String(link.source_list_name ?? "").includes("行ってみたい"));
}

export function searchableText(place: PlaceRow) {
  const classification = firstRelated(place.place_classifications);
  return [
    place.name,
    place.address,
    classification?.area_label,
    classification?.travel_region,
    ...activeLinks(place.source_links).map((link) => link.source_list_name)
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
}

export function sortRecommended(places: PlaceRow[]) {
  return [...places].sort((a, b) => {
    return Number(isWantToGo(b)) - Number(isWantToGo(a)) ||
      categoryRank(a) - categoryRank(b) ||
      String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
  });
}

export function categoryRank(place: PlaceRow) {
  const index = CATEGORY_ORDER.indexOf(placeCategory(place));
  return index === -1 ? CATEGORY_ORDER.length : index;
}

export function uniqueOptions(values: unknown[]) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

export function matchesText(filter: string, value: unknown) {
  if (!filter) return true;
  return String(value ?? "").toLowerCase().includes(filter.toLowerCase());
}

export function matchesArchive(place: PlaceRow) {
  return place.is_archived !== true;
}

export function priceLevelLabel(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return "未設定";
  return "¥".repeat(Math.max(1, Number(value) || 1));
}
