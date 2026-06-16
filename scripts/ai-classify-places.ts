import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildAIClassificationInput, classificationToDbPayload, classifyPlaceWithAI } from "../lib/classification/ai";

type Options = {
  apply: boolean;
  dryRun: boolean;
  force: boolean;
  limit: number;
  status: string | null;
  category: string | null;
  onlyMissingRegion: boolean;
  hasSignals: boolean;
  onlyMissingRegionWithAddress: boolean;
  onlyMissingRegionWithNameHint: boolean;
};

type PlaceRow = Record<string, unknown> & {
  id: string;
  enrichment_status: string | null;
  place_classifications?: Array<Record<string, unknown>> | Record<string, unknown> | null;
};

const REGION_FIELDS = ["country", "prefecture", "city", "ward", "area_label", "travel_region"] as const;
type RegionField = typeof REGION_FIELDS[number];

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.dryRun ? "mode: dry-run" : "mode: write");
  log(`limit: ${options.limit}`);
  log(`has signals: ${options.hasSignals ? "true" : "false"}`);
  log(options.force ? "force: true" : "force: false");
  warnCost();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY が未設定です。.env.local に OPENAI_API_KEY を設定してください。");

  const supabase = getSupabase();
  const places = await fetchPlaces(supabase);
  const filtered = places.filter((place) => matchesOptions(place, options));
  const skippedManualOverrideCount = filtered.filter((place) => isManualOverride(place) && !options.force).length;
  const targets = prioritize(filtered.filter((place) => options.force || !isManualOverride(place))).slice(0, options.limit);

  log(`loaded places: ${places.length}`);
  log(`candidate places: ${filtered.length}`);
  log(`skipped manual_override: ${skippedManualOverrideCount}`);
  log(`target count: ${targets.length}`);

  let proposedCount = 0;
  let appliedCount = 0;
  const categoryChanges = new Map<string, number>();
  const regionMetrics = createRegionMetrics();
  regionMetrics.missing_region_before = countMissingRegion(targets);

  for (const place of targets) {
    const before = firstClassification(place);
    const input = buildAIClassificationInput(place);
    const result = await classifyPlaceWithAI(input, { apiKey });
    proposedCount += 1;
    const key = `${input.rule_based.main_category}->${result.main_category}`;
    categoryChanges.set(key, (categoryChanges.get(key) ?? 0) + 1);
    collectRegionMetrics(regionMetrics, before, result);

    if (options.apply) {
      const { error } = await supabase
        .from("place_classifications")
        .upsert({
          place_id: place.id,
          ...classificationToDbPayload(result, "ai"),
          manual_override: false
        }, { onConflict: "place_id" });
      if (error) throw error;
      appliedCount += 1;
      if (appliedCount % 10 === 0 || appliedCount === targets.length) log(`applied ${appliedCount}/${targets.length}`);
    }
  }
  const missingRegionAfter = regionMetrics.after_missing_region_count;

  log("done");
  if (options.onlyMissingRegion) {
    log(`missing region before: ${regionMetrics.missing_region_before}`);
    log(`missing region after: ${missingRegionAfter}`);
    log(`filled area_label: ${regionMetrics.filled_area_label_count}`);
    log(`filled travel_region: ${regionMetrics.filled_travel_region_count}`);
  }
  console.log(JSON.stringify({
    status: options.apply ? "completed" : "dry_run",
    loaded_count: places.length,
    candidate_count: filtered.length,
    skipped_manual_override_count: skippedManualOverrideCount,
    target_count: targets.length,
    proposed_count: proposedCount,
    applied_count: appliedCount,
    missing_region_before: regionMetrics.missing_region_before,
    missing_region_after: missingRegionAfter,
    filled_area_label_count: regionMetrics.filled_area_label_count,
    filled_travel_region_count: regionMetrics.filled_travel_region_count,
    filled_prefecture_count: regionMetrics.filled_prefecture_count,
    filled_city_count: regionMetrics.filled_city_count,
    region_change_counts: sortObject(regionMetrics.region_change_counts),
    category_change_counts: Object.fromEntries([...categoryChanges.entries()].sort((a, b) => b[1] - a[1]))
  }, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("*, place_classifications(*), source_links(*)")
      .eq("is_archived", false)
      .range(from, from + 999);
    if (error?.code === "42703") return fetchPlacesWithoutArchiveFilter(supabase);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fetchPlacesWithoutArchiveFilter(supabase: SupabaseClient) {
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

function matchesOptions(place: PlaceRow, options: Options) {
  const classification = firstClassification(place);
  if (options.status && place.enrichment_status !== options.status) return false;
  if (options.category && classification?.main_category !== options.category) return false;
  if (options.onlyMissingRegion && !isMissingRegion(classification)) return false;
  if (options.onlyMissingRegionWithAddress && (!isMissingRegion(classification) || !hasAddressSignal(place))) return false;
  if (options.onlyMissingRegionWithNameHint && (!isMissingRegion(classification) || !hasRegionNameHint(place))) return false;
  if (options.hasSignals && !hasUsefulAiSignal(place, classification)) return false;
  return true;
}

function prioritize(places: PlaceRow[]) {
  return [...places].sort((a, b) => priorityScore(b) - priorityScore(a));
}

function priorityScore(place: PlaceRow) {
  const classification = firstClassification(place);
  let score = 0;
  if (classification?.main_category === "Other") score += 50;
  if (isMissingRegion(classification)) score += 40;
  if (classification?.main_category === "Art" && isEmpty(classification?.sub_category)) score += 30;
  if (classification?.main_category === "Restaurant" && (!Array.isArray(classification.scene_tags) || classification.scene_tags.length === 0)) score += 25;
  if (place.enrichment_status === "source_url_confirmed") score += 10;
  return score;
}

function hasUsefulAiSignal(place: PlaceRow, classification: Record<string, unknown> | null) {
  if (isMissingRegion(classification) && (hasAddressSignal(place) || hasRegionNameHint(place))) return true;
  if (classification?.main_category === "Other" && (hasSourceListHint(place) || hasGoogleTypes(place) || hasNameKeywordHint(place))) return true;
  return false;
}

function hasAddressSignal(place: PlaceRow) {
  const raw = rawGoogleRecord(place.raw_google);
  return Boolean(place.address || raw.formattedAddress || raw.formatted_address);
}

function hasSourceListHint(place: PlaceRow) {
  const links = Array.isArray(place.source_links) ? place.source_links as Array<Record<string, unknown>> : [];
  const text = links.map((link) => link.source_list_name).filter(Boolean).join(" ");
  return /art|cafe|restaurant|fashion|hotel|風呂|hospital|病院|クリニック/i.test(text);
}

function hasGoogleTypes(place: PlaceRow) {
  const raw = rawGoogleRecord(place.raw_google);
  return Boolean(raw.primaryType || raw.primary_type || (Array.isArray(raw.types) && raw.types.length > 0));
}

function hasNameKeywordHint(place: PlaceRow) {
  return /gallery|museum|foundation|art center|gelato|ice cream|patisserie|bakery|hotel|ryokan|sauna|spa|美術館|ミュージアム|ギャラリー|財団|旅館|温泉|銭湯/i.test(String(place.name ?? ""));
}

function hasRegionNameHint(place: PlaceRow) {
  return /六本木|中目黒|銀座|表参道|清澄白河|京都|箱根|軽井沢|金沢|直島|瀬戸内|Paris|Seoul|New York|Brooklyn|Los Angeles|London/i.test(String(place.name ?? ""));
}

function rawGoogleRecord(rawGoogle: unknown) {
  if (typeof rawGoogle !== "object" || rawGoogle === null) return {};
  const raw = rawGoogle as Record<string, unknown>;
  return typeof raw.candidate_place === "object" && raw.candidate_place !== null ? raw.candidate_place as Record<string, unknown> : raw;
}

function firstClassification(place: PlaceRow) {
  const value = place.place_classifications;
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function isManualOverride(place: PlaceRow) {
  return firstClassification(place)?.manual_override === true;
}

function isMissingRegion(classification: Record<string, unknown> | null) {
  return isEmpty(classification?.area_label) || isEmpty(classification?.travel_region);
}

function countMissingRegion(places: PlaceRow[]) {
  return places.filter((place) => isMissingRegion(firstClassification(place))).length;
}

type RegionMetrics = {
  missing_region_before: number;
  missing_region_after?: number;
  after_missing_region_count: number;
  filled_area_label_count: number;
  filled_travel_region_count: number;
  filled_prefecture_count: number;
  filled_city_count: number;
  region_change_counts: Record<string, number>;
};

function createRegionMetrics(): RegionMetrics {
  return {
    missing_region_before: 0,
    after_missing_region_count: 0,
    filled_area_label_count: 0,
    filled_travel_region_count: 0,
    filled_prefecture_count: 0,
    filled_city_count: 0,
    region_change_counts: {}
  };
}

function collectRegionMetrics(
  metrics: RegionMetrics,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
) {
  if (isMissingRegion(after)) metrics.after_missing_region_count += 1;

  for (const field of REGION_FIELDS) {
    const beforeValue = normalizedRegionValue(before?.[field]);
    const afterValue = normalizedRegionValue(after[field]);
    if (!beforeValue && afterValue) incrementFilledMetric(metrics, field);
    if (beforeValue !== afterValue) {
      const changeKey = `${field}:${beforeValue || "missing"}->${afterValue || "missing"}`;
      metrics.region_change_counts[changeKey] = (metrics.region_change_counts[changeKey] ?? 0) + 1;
    }
  }
}

function incrementFilledMetric(metrics: RegionMetrics, field: RegionField) {
  if (field === "area_label") metrics.filled_area_label_count += 1;
  if (field === "travel_region") metrics.filled_travel_region_count += 1;
  if (field === "prefecture") metrics.filled_prefecture_count += 1;
  if (field === "city") metrics.filled_city_count += 1;
}

function normalizedRegionValue(value: unknown) {
  if (isEmpty(value)) return "";
  return String(value).trim();
}

function sortObject(counts: Record<string, number>) {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function isEmpty(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "未分類";
}

function parseArgs(): Options {
  const apply = process.argv.includes("--apply");
  const limit = Number(valueAfter("--limit") ?? "20");
  return {
    apply,
    dryRun: process.argv.includes("--dry-run") || !apply,
    force: process.argv.includes("--force"),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20,
    status: valueAfter("--status"),
    category: valueAfter("--category"),
    onlyMissingRegion: process.argv.includes("--only-missing-region"),
    hasSignals: process.argv.includes("--has-signals"),
    onlyMissingRegionWithAddress: process.argv.includes("--only-missing-region-with-address"),
    onlyMissingRegionWithNameHint: process.argv.includes("--only-missing-region-with-name-hint")
  };
}

function warnCost() {
  log("AI分類はOpenAI APIを呼び出します。まず --dry-run --limit 5 など小さく試してください。");
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
  console.log(`[classify:ai] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
  process.exit(1);
});
