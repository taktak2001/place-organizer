import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyPlace } from "../lib/classification/category";
import type { NormalizedImportItem, PlaceClassification } from "../types/import";

const BATCH_SIZE = 100;

type Options = {
  dryRun: boolean;
  apply: boolean;
  category: string | null;
};

type PlaceRow = {
  id: string;
  normalized_key: string;
  google_place_id: string | null;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  raw_import: Record<string, unknown> | null;
  raw_google: Record<string, unknown> | null;
  enrichment_status: string | null;
  place_classifications?: ClassificationRow[] | ClassificationRow | null;
  source_links?: SourceLinkRow[];
};

type ClassificationRow = PlaceClassification & {
  manual_override?: boolean | null;
  classification_source?: string | null;
};

type SourceLinkRow = {
  source_list_name: string | null;
  source_file: string | null;
  memo: string | null;
  active: boolean | null;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.apply ? "mode: apply" : "mode: dry-run");
  log(`category filter: ${options.category ?? "all"}`);

  const supabase = getSupabase();
  const places = await fetchPlaces(supabase);
  const categoryFiltered = options.category
    ? places.filter((place) => firstClassification(place.place_classifications)?.main_category === options.category)
    : places;
  const targets = categoryFiltered.filter((place) => firstClassification(place.place_classifications)?.manual_override !== true);
  const skippedManualOverride = categoryFiltered.length - targets.length;

  const proposals = targets.map((place) => {
    const before = firstClassification(place.place_classifications);
    const after = mergeClassification(before, classifyPlace(toNormalizedItem(place)));
    return { place, before, after };
  });
  const changed = proposals.filter(({ before, after }) => classificationChanged(before, after));
  const categoryChanges = countBy(changed.map(({ before, after }) => `${before?.main_category ?? "Unknown"}->${after.main_category}`));
  const reasonCounts = countBy(changed.map(({ after }) => after.reason ?? "unknown"));
  const ruleReasonCounts = countBy(proposals.map(({ place, before, after }) => ruleReasonBucket(place, before, after)));
  const regionBefore = proposals.filter(({ before }) => isMissing(before?.area_label) || isMissing(before?.travel_region)).length;
  const regionAfter = proposals.filter(({ after }) => isMissing(after.area_label) || isMissing(after.travel_region)).length;
  const filledArea = proposals.filter(({ before, after }) => isMissing(before?.area_label) && !isMissing(after.area_label)).length;
  const filledTravel = proposals.filter(({ before, after }) => isMissing(before?.travel_region) && !isMissing(after.travel_region)).length;
  const skippedNoSignal = targets.filter((place) => !hasUsefulSignal(place)).length;

  if (options.apply && changed.length > 0) {
    let processed = 0;
    for (const batch of chunks(changed, BATCH_SIZE)) {
      const payload = batch.map(({ place, before, after }) => ({
        place_id: place.id,
        main_category: after.main_category,
        sub_category: after.sub_category,
        scene_tags: after.scene_tags,
        country: after.country,
        prefecture: after.prefecture,
        city: after.city,
        ward: after.ward,
        area_label: after.area_label,
        nearest_station: after.nearest_station,
        travel_region: after.travel_region,
        priority: before?.priority ?? after.priority,
        visited_status: before?.visited_status && before.visited_status !== "unknown" ? before.visited_status : after.visited_status,
        confidence: after.confidence,
        reason: `rule_reclassify:${after.reason}`,
        classification_source: "rule",
        manual_override: false
      }));
      const { error } = await supabase.from("place_classifications").upsert(payload, { onConflict: "place_id" });
      if (error) throw error;
      processed += batch.length;
      log(`applied ${processed}/${changed.length}`);
    }
  }

  log("done");
  console.log(JSON.stringify({
    status: options.apply ? "completed" : "dry_run",
    target_count: targets.length,
    proposed_count: changed.length,
    applied_count: options.apply ? changed.length : 0,
    skipped_manual_override_count: skippedManualOverride,
    skipped_no_signal_count: skippedNoSignal,
    category_change_counts: categoryChanges,
    reason_counts: reasonCounts,
    rule_reason_counts: ruleReasonCounts,
    region_before: regionBefore,
    region_after: regionAfter,
    filled_area_label_count: filledArea,
    filled_travel_region_count: filledTravel
  }, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, normalized_key, google_place_id, name, address, latitude, longitude, google_maps_url, raw_import, raw_google, enrichment_status, place_classifications(*), source_links(source_list_name, source_file, memo, active)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function toNormalizedItem(place: PlaceRow): NormalizedImportItem {
  const links = activeLinks(place.source_links);
  return {
    source_file: links.map((link) => link.source_file).filter(Boolean).join(", ") || "reclassify_rules",
    source_list_name: links.map((link) => link.source_list_name).filter(Boolean).join(" ") || null,
    name: place.name,
    address: place.address,
    google_maps_url: place.google_maps_url,
    latitude: place.latitude,
    longitude: place.longitude,
    notes: links.map((link) => link.memo).filter(Boolean).join("\n") || null,
    raw: { ...(place.raw_import ?? {}), google: place.raw_google ?? {} },
    google_place_id: place.google_place_id,
    normalized_key: place.normalized_key
  };
}

function firstClassification(value: unknown): ClassificationRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as ClassificationRow : null;
}

function activeLinks(value: unknown): SourceLinkRow[] {
  return Array.isArray(value)
    ? value.filter((link) => typeof link === "object" && link !== null && (link as SourceLinkRow).active !== false) as SourceLinkRow[]
    : [];
}

function classificationChanged(before: ClassificationRow | null, after: PlaceClassification) {
  if (!before) return true;
  return before.main_category !== after.main_category ||
    before.sub_category !== after.sub_category ||
    JSON.stringify(before.scene_tags ?? []) !== JSON.stringify(after.scene_tags ?? []) ||
    before.area_label !== after.area_label ||
    before.travel_region !== after.travel_region ||
    before.prefecture !== after.prefecture ||
    before.city !== after.city ||
    before.ward !== after.ward;
}

function mergeClassification(before: ClassificationRow | null, after: PlaceClassification): PlaceClassification {
  return {
    ...after,
    country: keepExistingRegion(before?.country, after.country),
    prefecture: keepExistingRegion(before?.prefecture, after.prefecture),
    city: keepExistingRegion(before?.city, after.city),
    ward: keepExistingRegion(before?.ward, after.ward),
    area_label: keepExistingRegion(before?.area_label, after.area_label),
    nearest_station: keepExistingRegion(before?.nearest_station, after.nearest_station),
    travel_region: keepExistingRegion(before?.travel_region, after.travel_region),
    visited_status: before?.visited_status && before.visited_status !== "unknown" ? before.visited_status : after.visited_status,
    priority: before?.priority ?? after.priority
  };
}

function keepExistingRegion(current: string | null | undefined, next: string | null | undefined) {
  return isMissing(next) && !isMissing(current) ? current ?? null : next ?? null;
}

function hasUsefulSignal(place: PlaceRow) {
  const listText = activeLinks(place.source_links).map((link) => link.source_list_name).join(" ");
  const raw = place.raw_google ?? {};
  const google = typeof raw.candidate_place === "object" && raw.candidate_place !== null ? raw.candidate_place as Record<string, unknown> : raw;
  return Boolean(listText || place.address || google.primaryType || (Array.isArray(google.types) && google.types.length > 0) || /gallery|museum|cafe|restaurant|hotel|sauna|ギャラリー|美術館|カフェ|ホテル|温泉/.test(place.name));
}

function ruleReasonBucket(place: PlaceRow, before: ClassificationRow | null, after: PlaceClassification) {
  if (!classificationChanged(before, after) || before?.main_category === after.main_category) return "no_rule";
  if (hasSourceListRuleSignal(place, after.main_category)) return "source_list_rule";
  if (hasGoogleTypeRuleSignal(place, after.main_category)) return "google_type_rule";
  if (hasNameKeywordRuleSignal(place, after.main_category)) return "name_keyword_rule";
  return "no_rule";
}

function hasSourceListRuleSignal(place: PlaceRow, category: string) {
  const listText = activeLinks(place.source_links).map((link) => link.source_list_name).filter(Boolean).join(" ");
  const patterns: Record<string, RegExp> = {
    Art: /art|museum|美術|ギャラリー/i,
    Cafe: /cafe/i,
    Restaurant: /restaurant/i,
    Fashion: /fashion/i,
    Hotel: /hotel/i,
    Bath: /風呂|bath|sauna|spa/i,
    Hospital: /hospital|病院|クリニック|歯科/i
  };
  return Boolean(patterns[category]?.test(listText));
}

function hasGoogleTypeRuleSignal(place: PlaceRow, category: string) {
  const types = googleTypeText(place);
  const patterns: Record<string, RegExp> = {
    Art: /\b(art_gallery|museum)\b/,
    Cafe: /\b(bakery|dessert_shop|ice_cream_shop|confectionery|cafe|coffee_shop)\b/,
    Restaurant: /\b(restaurant|bar|food|meal_takeaway)\b/,
    Fashion: /\b(clothing_store|shoe_store|jewelry_store|department_store)\b/,
    Hotel: /\b(lodging|hotel)\b/,
    Bath: /\b(spa|sauna|public_bath|hot_spring)\b/,
    Hospital: /\b(hospital|doctor|dentist)\b/,
    Life: /\b(transit_station|train_station|bus_stop|airport|book_store|bookstore|library)\b/
  };
  return Boolean(patterns[category]?.test(types));
}

function hasNameKeywordRuleSignal(place: PlaceRow, category: string) {
  const name = place.name;
  const patterns: Record<string, RegExp> = {
    Art: /gallery|museum|foundation|art center|美術館|ミュージアム|ギャラリー|財団/i,
    Cafe: /gelato|ice cream|patisserie|bakery|カフェ|喫茶|珈琲|ベーカリー|ジェラート/i,
    Restaurant: /restaurant|bistro|sushi|ramen|レストラン|ビストロ|寿司|鮨|ラーメン|蕎麦|焼肉|居酒屋/i,
    Fashion: /fashion|clothing|vintage|select shop|靴|時計|古着|服|セレクトショップ/i,
    Hotel: /hotel|ryokan|旅館|ホテル/i,
    Bath: /sauna|spa|温泉|銭湯|サウナ/i,
    Hospital: /hospital|clinic|dentist|病院|クリニック|歯科/i
  };
  return Boolean(patterns[category]?.test(name));
}

function googleTypeText(place: PlaceRow) {
  const raw = place.raw_google ?? {};
  const google = typeof raw.candidate_place === "object" && raw.candidate_place !== null ? raw.candidate_place as Record<string, unknown> : raw;
  return [
    google.primaryType,
    google.primary_type,
    Array.isArray(google.types) ? google.types.join(" ") : null
  ].filter(Boolean).join(" ");
}

function isMissing(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "unknown" || text === "未分類";
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function parseArgs(): Options {
  const apply = process.argv.includes("--apply");
  return {
    apply,
    dryRun: process.argv.includes("--dry-run") || !apply,
    category: valueAfter("--category")
  };
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

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function chunks<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

function log(message: string) {
  console.log(`[reclassify:rules] ${message}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
