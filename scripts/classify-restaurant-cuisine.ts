import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyRestaurantCuisineByRule, type RestaurantCuisineInput, type RestaurantCuisineResult } from "../lib/classification/restaurant-cuisine";

type Options = {
  apply: boolean;
  dryRun: boolean;
  force: boolean;
  limit: number;
};

type PlaceRow = Record<string, unknown> & {
  id: string;
  name: string;
  address: string | null;
  primary_type: string | null;
  types: string[] | null;
  website_url: string | null;
  raw_google: Record<string, unknown> | null;
  place_classifications?: Array<Record<string, unknown>> | Record<string, unknown> | null;
  source_links?: Array<Record<string, unknown>>;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.dryRun ? "mode: dry-run" : "mode: write");
  log(`limit: ${options.limit}`);

  const supabase = getSupabase();
  const places = await fetchPlaces(supabase);
  const candidates = places.filter((place) => isRestaurant(place) && (options.force || categoryTags(place).length === 0));
  const skippedManualOverrideCount = candidates.filter((place) => isManualOverride(place) && !options.force).length;
  const targets = candidates.filter((place) => options.force || !isManualOverride(place)).slice(0, options.limit);

  log(`loaded places: ${places.length}`);
  log(`candidate restaurants: ${candidates.length}`);
  log(`skipped manual_override: ${skippedManualOverrideCount}`);
  log(`target count: ${targets.length}`);

  let proposedCount = 0;
  let appliedCount = 0;
  let unchangedCount = 0;
  const cuisineTagCounts = new Map<string, number>();

  for (const place of targets) {
    const before = firstClassification(place);
    const result = classifyRestaurantCuisineByRule(toCuisineInput(place));
    const nextTags = result.category_tags;
    for (const tag of nextTags) cuisineTagCounts.set(tag, (cuisineTagCounts.get(tag) ?? 0) + 1);

    if (nextTags.length === 0 || arraysEqual(categoryTags(place), nextTags)) {
      unchangedCount += 1;
      continue;
    }
    proposedCount += 1;

    if (options.apply) {
      const { error } = await supabase
        .from("place_classifications")
        .upsert({
          place_id: place.id,
          main_category: "Restaurant",
          sub_category: before?.sub_category ?? null,
          category_tags: nextTags,
          scene_tags: Array.isArray(before?.scene_tags) ? before.scene_tags : [],
          country: before?.country ?? null,
          prefecture: before?.prefecture ?? null,
          city: before?.city ?? null,
          ward: before?.ward ?? null,
          area_label: before?.area_label ?? null,
          nearest_station: before?.nearest_station ?? null,
          travel_region: before?.travel_region ?? null,
          visited_status: before?.visited_status ?? "want",
          priority: before?.priority ?? null,
          confidence: result.confidence,
          reason: mergeReason(before?.reason, result),
          classification_source: "rule",
          ai_raw: before?.ai_raw ?? null,
          ai_model: before?.ai_model ?? null,
          ai_classified_at: before?.ai_classified_at ?? null,
          manual_override: false
        }, { onConflict: "place_id" });
      if (error) throw error;
      appliedCount += 1;
      if (appliedCount % 20 === 0) log(`applied ${appliedCount}`);
    }
  }
  if (options.apply && appliedCount > 0) log(`applied total: ${appliedCount}`);

  log("done");
  console.log(JSON.stringify({
    status: options.apply ? "completed" : "dry_run",
    loaded_count: places.length,
    target_count: targets.length,
    proposed_count: proposedCount,
    applied_count: appliedCount,
    cuisine_tag_counts: Object.fromEntries([...cuisineTagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    unchanged_count: unchangedCount,
    skipped_manual_override_count: skippedManualOverrideCount
  }, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, address, primary_type, types, website_url, raw_google, place_classifications(*), source_links(source_list_name, active)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function isRestaurant(place: PlaceRow) {
  return firstClassification(place)?.main_category === "Restaurant";
}

function categoryTags(place: PlaceRow) {
  const tags = firstClassification(place)?.category_tags;
  return Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
}

function isManualOverride(place: PlaceRow) {
  return firstClassification(place)?.manual_override === true;
}

function toCuisineInput(place: PlaceRow): RestaurantCuisineInput {
  return {
    name: place.name,
    source_list_names: sourceListNames(place),
    address: place.address,
    primary_type: place.primary_type,
    types: Array.isArray(place.types) ? place.types.map(String) : [],
    website_url: place.website_url,
    raw_google_summary: summarizeRawGoogle(place.raw_google)
  };
}

function summarizeRawGoogle(raw: Record<string, unknown> | null) {
  if (!raw) return null;
  const candidate = record(raw.candidate_place);
  const source = candidate ?? raw;
  return {
    displayName: source.displayName,
    name: source.name,
    formattedAddress: source.formattedAddress ?? source.formatted_address ?? null,
    primaryType: source.primaryType ?? source.primary_type ?? null,
    types: Array.isArray(source.types) ? source.types.slice(0, 20) : []
  };
}

function firstClassification(place: PlaceRow) {
  const value = place.place_classifications;
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function sourceListNames(place: PlaceRow) {
  return (place.source_links ?? [])
    .filter((link) => link.active !== false)
    .map((link) => String(link.source_list_name ?? ""))
    .filter(Boolean);
}

function record(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function arraysEqual(left: string[], right: string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function mergeReason(previous: unknown, result: RestaurantCuisineResult) {
  const prefix = `restaurant_cuisine:${result.reason}`;
  const current = String(previous ?? "").trim();
  if (!current) return prefix;
  if (current.includes("restaurant_cuisine:")) return current.replace(/restaurant_cuisine:[^|]+/, prefix);
  return `${current} | ${prefix}`;
}

function parseArgs(): Options {
  const apply = process.argv.includes("--apply");
  const limit = Number(valueAfter("--limit") ?? "1000");
  return {
    apply,
    dryRun: process.argv.includes("--dry-run") || !apply,
    force: process.argv.includes("--force"),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1000
  };
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
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
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^['"]|['"]$/g, "");
    process.env[key] = process.env[key] ?? value;
  }
}

function log(message: string) {
  console.log(`[classify:restaurant-cuisine] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
  process.exit(1);
});
