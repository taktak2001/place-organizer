import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type PlaceRow = Record<string, unknown> & {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  raw_google: Record<string, unknown> | null;
  enrichment_status: string | null;
  place_classifications?: ClassificationRow[] | ClassificationRow | null;
  source_links?: SourceLinkRow[];
};

type ClassificationRow = {
  main_category: string | null;
  area_label: string | null;
  travel_region: string | null;
  scene_tags: string[] | null;
  manual_override: boolean | null;
};

type SourceLinkRow = {
  source_list_name: string | null;
  active: boolean | null;
};

loadEnvLocal();

async function main() {
  log("start");
  const supabase = getSupabase();
  const places = await fetchPlaces(supabase);
  const classifications = places.map((place) => ({ place, classification: firstClassification(place.place_classifications) }));
  const other = classifications.filter(({ classification }) => classification?.main_category === "Other");
  const missingRegion = classifications.filter(({ classification }) => isMissing(classification?.area_label) || isMissing(classification?.travel_region));
  const missingRestaurantScenes = classifications.filter(({ classification }) => classification?.main_category === "Restaurant" && (!Array.isArray(classification.scene_tags) || classification.scene_tags.length === 0));
  const manualOverride = classifications.filter(({ classification }) => classification?.manual_override === true);

  const result = {
    total_places: places.length,
    other_count: other.length,
    missing_region_count: missingRegion.length,
    missing_restaurant_scenes_count: missingRestaurantScenes.length,
    manual_override_count: manualOverride.length,
    other_breakdown: {
      source_list_hintあり: other.filter(({ place }) => hasSourceListHint(place)).length,
      google_primary_type_typesあり: other.filter(({ place }) => hasGoogleTypes(place)).length,
      name_keyword_hintあり: other.filter(({ place }) => hasNameKeywordHint(place)).length,
      addressあり: other.filter(({ place }) => Boolean(place.address)).length,
      source_url_only: other.filter(({ place }) => place.enrichment_status === "source_url_confirmed").length,
      no_useful_signal: other.filter(({ place }) => !hasAnyCategorySignal(place)).length
    },
    other_google_primary_type_counts: countBy(other.map(({ place }) => primaryType(place)).filter(isString)),
    other_google_type_counts: countBy(other.flatMap(({ place }) => googleTypes(place))),
    reclassifiable_other_by_type_count: other.filter(({ place }) => reclassifiableTypeCategory(place) !== null).length,
    missing_region_breakdown: {
      addressあり: missingRegion.filter(({ place }) => Boolean(place.address)).length,
      raw_google_formattedAddressあり: missingRegion.filter(({ place }) => hasRawGoogleAddress(place)).length,
      latitude_longitudeあり: missingRegion.filter(({ place }) => place.latitude !== null && place.longitude !== null).length,
      name_city_region_hintあり: missingRegion.filter(({ place }) => hasRegionNameHint(place)).length,
      source_url_only: missingRegion.filter(({ place }) => place.enrichment_status === "source_url_confirmed").length,
      no_useful_signal: missingRegion.filter(({ place }) => !hasAnyRegionSignal(place)).length
    }
  };

  log("done");
  console.log(JSON.stringify(result, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, address, latitude, longitude, raw_google, enrichment_status, place_classifications(main_category, area_label, travel_region, scene_tags, manual_override), source_links(source_list_name, active)")
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

function activeListText(place: PlaceRow) {
  return (place.source_links ?? [])
    .filter((link) => link.active !== false)
    .map((link) => link.source_list_name)
    .filter(Boolean)
    .join(" ");
}

function rawGoogleRecord(place: PlaceRow) {
  const raw = place.raw_google;
  if (!raw || typeof raw !== "object") return {};
  const candidate = raw.candidate_place;
  return typeof candidate === "object" && candidate !== null ? candidate as Record<string, unknown> : raw;
}

function hasSourceListHint(place: PlaceRow) {
  return /art|cafe|restaurant|fashion|hotel|風呂|hospital|病院|クリニック/i.test(activeListText(place));
}

function hasGoogleTypes(place: PlaceRow) {
  return Boolean(primaryType(place) || googleTypes(place).length > 0);
}

function hasNameKeywordHint(place: PlaceRow) {
  return /gallery|museum|foundation|art center|gelato|ice cream|patisserie|bakery|hotel|ryokan|sauna|spa|美術館|ミュージアム|ギャラリー|財団|旅館|温泉|銭湯/i.test(place.name);
}

function hasAnyCategorySignal(place: PlaceRow) {
  return hasSourceListHint(place) || hasGoogleTypes(place) || hasNameKeywordHint(place) || Boolean(place.address);
}

function primaryType(place: PlaceRow) {
  const raw = rawGoogleRecord(place);
  return String(raw.primaryType ?? raw.primary_type ?? "").trim() || null;
}

function googleTypes(place: PlaceRow) {
  const raw = rawGoogleRecord(place);
  return Array.isArray(raw.types) ? raw.types.map(String).filter(Boolean) : [];
}

function reclassifiableTypeCategory(place: PlaceRow) {
  const types = [primaryType(place), ...googleTypes(place)].filter(Boolean).join(" ");
  if (/\b(bakery|dessert_shop|ice_cream_shop|confectionery|cafe|coffee_shop)\b/.test(types)) return "Cafe";
  if (/\b(restaurant|bar|food|meal_takeaway)\b/.test(types)) return "Restaurant";
  if (/\b(art_gallery|museum)\b/.test(types)) return "Art";
  if (/\b(clothing_store|shoe_store|jewelry_store|department_store)\b/.test(types)) return "Fashion";
  if (/\b(lodging|hotel)\b/.test(types)) return "Hotel";
  if (/\b(spa|sauna|public_bath|hot_spring)\b/.test(types)) return "Bath";
  if (/\b(transit_station|train_station|bus_stop|airport|book_store|bookstore|library)\b/.test(types)) return "Life";
  return null;
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40));
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasRawGoogleAddress(place: PlaceRow) {
  const raw = rawGoogleRecord(place);
  return Boolean(raw.formattedAddress || raw.formatted_address);
}

function hasRegionNameHint(place: PlaceRow) {
  return /六本木|中目黒|銀座|表参道|清澄白河|京都|箱根|軽井沢|金沢|直島|瀬戸内|Paris|Seoul|New York|Brooklyn|Los Angeles|London/i.test(place.name);
}

function hasAnyRegionSignal(place: PlaceRow) {
  return Boolean(place.address) || hasRawGoogleAddress(place) || (place.latitude !== null && place.longitude !== null) || hasRegionNameHint(place);
}

function isMissing(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "unknown" || text === "未分類";
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Supabase接続情報が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。");
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    process.env[trimmed.slice(0, index)] = process.env[trimmed.slice(0, index)] ?? trimmed.slice(index + 1).replace(/^['"]|['"]$/g, "");
  }
}

function log(message: string) {
  console.log(`[inspect:classification-gaps] ${message}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
