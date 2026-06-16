import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type PlaceRow = Record<string, unknown> & {
  id: string;
  primary_type: string | null;
  types: string[] | null;
  enrichment_status: string | null;
  raw_google: Record<string, unknown> | null;
  place_classifications?: ClassificationRow[] | ClassificationRow | null;
};

type ClassificationRow = {
  main_category?: string | null;
  category_tags?: string[] | null;
  scene_tags?: string[] | null;
  area_label?: string | null;
  travel_region?: string | null;
  region_filter_label?: string | null;
  restaurant_review_status?: string | null;
  restaurant_price_band?: string | null;
};

loadEnvLocal();

async function main() {
  log("start");
  const supabase = getSupabase();
  const places = await fetchPlaces(supabase);
  const restaurants = places.filter((place) => firstClassification(place.place_classifications)?.main_category === "Restaurant");
  const result = {
    total_restaurant_count: restaurants.length,
    unreviewed_count: restaurants.filter((place) => reviewStatus(place) === "unreviewed").length,
    verified_count: restaurants.filter((place) => reviewStatus(place) === "verified").length,
    not_restaurant_count: restaurants.filter((place) => reviewStatus(place) === "not_restaurant").length,
    needs_check_count: restaurants.filter((place) => reviewStatus(place) === "needs_check").length,
    missing_cuisine_count: restaurants.filter((place) => tags(firstClassification(place.place_classifications)?.category_tags).length === 0).length,
    missing_scene_count: restaurants.filter((place) => tags(firstClassification(place.place_classifications)?.scene_tags).length === 0).length,
    missing_region_count: restaurants.filter((place) => missingRegion(firstClassification(place.place_classifications))).length,
    missing_price_band_count: restaurants.filter((place) => !firstClassification(place.place_classifications)?.restaurant_price_band).length,
    suspicious_not_restaurant_count: restaurants.filter(isSuspiciousNotRestaurant).length,
    suspicious_reason_counts: countReasons(restaurants)
  };
  log("done");
  console.log(JSON.stringify(result, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, primary_type, types, enrichment_status, raw_google, place_classifications(*)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function firstClassification(value: unknown): ClassificationRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as ClassificationRow : null;
}

function reviewStatus(place: PlaceRow) {
  const status = String(firstClassification(place.place_classifications)?.restaurant_review_status ?? "").trim();
  if (status === "verified" || status === "not_restaurant" || status === "needs_check") return status;
  return "unreviewed";
}

function tags(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function missingRegion(classification: ClassificationRow | null) {
  return !text(classification?.region_filter_label) && !text(classification?.travel_region) && !text(classification?.area_label);
}

function isSuspiciousNotRestaurant(place: PlaceRow) {
  return suspiciousReasons(place).length > 0;
}

function suspiciousReasons(place: PlaceRow) {
  const classification = firstClassification(place.place_classifications);
  const reasons: string[] = [];
  const allTypes = [place.primary_type, ...(Array.isArray(place.types) ? place.types : []), ...rawTypes(place.raw_google)]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const typeText = allTypes.join(" ");

  if (allTypes.length > 0 && !/restaurant|bar|food|meal|cafe|bakery|dessert|ice_cream|sushi|ramen|pizza|izakaya/i.test(typeText)) {
    reasons.push("non_food_google_type");
  }
  if (/museum|art_gallery|store|transit_station|train_station|bus_stop|temple|park|lodging|hotel|clothing|jewelry/i.test(typeText)) {
    reasons.push("suspicious_google_type");
  }
  if (tags(classification?.category_tags).length === 0) reasons.push("missing_cuisine");
  if (tags(classification?.scene_tags).length === 0) reasons.push("missing_scene");
  if (place.enrichment_status === "source_url_confirmed" && candidateOnly(place.raw_google)) reasons.push("ambiguous_candidate");
  return [...new Set(reasons)];
}

function countReasons(places: PlaceRow[]) {
  const counts = new Map<string, number>();
  for (const place of places) {
    for (const reason of suspiciousReasons(place)) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function rawTypes(rawGoogle: unknown) {
  const raw = typeof rawGoogle === "object" && rawGoogle !== null ? rawGoogle as Record<string, unknown> : {};
  const candidate = typeof raw.candidate_place === "object" && raw.candidate_place !== null ? raw.candidate_place as Record<string, unknown> : raw;
  return Array.isArray(candidate.types) ? candidate.types.map(String) : [];
}

function candidateOnly(rawGoogle: unknown) {
  return typeof rawGoogle === "object" && rawGoogle !== null && (rawGoogle as Record<string, unknown>).candidate_only === true;
}

function text(value: unknown) {
  const stringValue = String(value ?? "").trim();
  return stringValue && stringValue !== "未分類" && stringValue !== "Unknown" ? stringValue : null;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase接続情報が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}

function log(message: string) {
  console.log(`[inspect:restaurant-quality] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
