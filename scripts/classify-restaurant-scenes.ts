import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyRestaurantScenesByRule, classifyRestaurantScenesWithAI, type RestaurantSceneInput, type RestaurantSceneResult } from "../lib/classification/restaurant-scenes";

type Options = {
  apply: boolean;
  dryRun: boolean;
  force: boolean;
  useAI: boolean;
  limit: number;
};

type PlaceRow = Record<string, unknown> & {
  id: string;
  name: string;
  address: string | null;
  primary_type: string | null;
  types: string[] | null;
  website_url: string | null;
  rating: number | null;
  price_level: number | null;
  place_classifications?: Array<Record<string, unknown>> | Record<string, unknown> | null;
  source_links?: Array<Record<string, unknown>>;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.dryRun ? "mode: dry-run" : "mode: write");
  log(`limit: ${options.limit}`);
  log(options.useAI ? "ai: enabled" : "ai: disabled; using rules");
  const supabase = getSupabase();
  const places = await fetchPlaces(supabase);
  const candidates = places.filter((place) => isRestaurantWithoutScenes(place));
  const skippedManualOverrideCount = candidates.filter((place) => isManualOverride(place) && !options.force).length;
  const targets = candidates.filter((place) => options.force || !isManualOverride(place)).slice(0, options.limit);
  const apiKey = process.env.OPENAI_API_KEY;
  if (options.useAI && !apiKey) throw new Error("OPENAI_API_KEY が未設定です。.env.local に OPENAI_API_KEY を設定するか、--use-ai を外してルール分類を使ってください。");

  log(`loaded places: ${places.length}`);
  log(`candidate restaurants: ${candidates.length}`);
  log(`skipped manual_override: ${skippedManualOverrideCount}`);
  log(`target count: ${targets.length}`);

  let proposedCount = 0;
  let appliedCount = 0;
  let aiErrorCount = 0;
  let ruleFallbackCount = 0;
  const tagCounts = new Map<string, number>();

  for (const place of targets) {
    const input = toSceneInput(place);
    let result: RestaurantSceneResult;
    if (options.useAI && apiKey) {
      try {
        result = await classifyRestaurantScenesWithAI(input, apiKey);
      } catch (error) {
        aiErrorCount += 1;
        result = classifyRestaurantScenesByRule(input);
        ruleFallbackCount += 1;
        log(`AI failed; used rule fallback (${aiErrorCount})`);
      }
    } else {
      result = classifyRestaurantScenesByRule(input);
      ruleFallbackCount += 1;
    }

    proposedCount += result.scene_tags.length > 0 ? 1 : 0;
    for (const tag of result.scene_tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);

    if (options.apply && result.scene_tags.length > 0) {
      const classification = firstClassification(place);
      const { error } = await supabase
        .from("place_classifications")
        .upsert({
          place_id: place.id,
          main_category: "Restaurant",
          sub_category: classification?.sub_category ?? null,
          scene_tags: result.scene_tags,
          country: classification?.country ?? null,
          prefecture: classification?.prefecture ?? null,
          city: classification?.city ?? null,
          ward: classification?.ward ?? null,
          area_label: classification?.area_label ?? null,
          nearest_station: classification?.nearest_station ?? null,
          travel_region: classification?.travel_region ?? null,
          visited_status: classification?.visited_status ?? "want",
          priority: classification?.priority ?? null,
          confidence: result.confidence,
          reason: `restaurant_scene:${result.reason}`,
          classification_source: result.source === "ai" ? "ai" : "rule",
          ai_raw: result.ai_raw ?? classification?.ai_raw ?? null,
          ai_model: result.ai_model ?? classification?.ai_model ?? null,
          ai_classified_at: result.source === "ai" ? new Date().toISOString() : classification?.ai_classified_at ?? null,
          manual_override: false
        }, { onConflict: "place_id" });
      if (error) throw error;
      appliedCount += 1;
      if (appliedCount % 20 === 0 || appliedCount === targets.length) log(`applied ${appliedCount}/${targets.length}`);
    }
  }

  log("done");
  console.log(JSON.stringify({
    status: options.apply ? "completed" : "dry_run",
    loaded_count: places.length,
    candidate_count: candidates.length,
    skipped_manual_override_count: skippedManualOverrideCount,
    target_count: targets.length,
    proposed_count: proposedCount,
    applied_count: appliedCount,
    ai_error_count: aiErrorCount,
    rule_fallback_count: ruleFallbackCount,
    scene_tag_counts: Object.fromEntries([...tagCounts.entries()].sort((a, b) => b[1] - a[1]))
  }, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, address, primary_type, types, website_url, rating, price_level, place_classifications(*), source_links(source_list_name, active)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function isRestaurantWithoutScenes(place: PlaceRow) {
  const classification = firstClassification(place);
  return classification?.main_category === "Restaurant" &&
    (!Array.isArray(classification.scene_tags) || classification.scene_tags.length === 0);
}

function isManualOverride(place: PlaceRow) {
  return firstClassification(place)?.manual_override === true;
}

function toSceneInput(place: PlaceRow): RestaurantSceneInput {
  return {
    name: place.name,
    source_list_names: sourceListNames(place),
    address: place.address,
    primary_type: place.primary_type,
    types: Array.isArray(place.types) ? place.types.map(String) : [],
    website_url: place.website_url,
    rating: numberOrNull(place.rating),
    price_level: numberOrNull(place.price_level)
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

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseArgs(): Options {
  const apply = process.argv.includes("--apply");
  const limit = Number(valueAfter("--limit") ?? "50");
  return {
    apply,
    dryRun: process.argv.includes("--dry-run") || !apply,
    force: process.argv.includes("--force"),
    useAI: process.argv.includes("--use-ai"),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50
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
  console.log(`[classify:restaurant-scenes] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
  process.exit(1);
});
