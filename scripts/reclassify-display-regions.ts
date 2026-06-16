import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyDisplayRegion, type DisplayRegion } from "../lib/classification/display-region";

const BATCH_SIZE = 100;

type Options = {
  apply: boolean;
  dryRun: boolean;
  onlyMissing: boolean;
};

type PlaceRow = {
  id: string;
  name: string;
  address: string | null;
  raw_google: Record<string, unknown> | null;
  place_classifications?: ClassificationRow[] | ClassificationRow | null;
};

type ClassificationRow = {
  country: string | null;
  prefecture: string | null;
  city: string | null;
  ward: string | null;
  area_label: string | null;
  travel_region: string | null;
  region_group?: string | null;
  region_filter_label?: string | null;
  region_sort_order?: number | null;
  manual_override?: boolean | null;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.apply ? "mode: apply" : "mode: dry-run");
  log(`only missing: ${options.onlyMissing}`);

  const supabase = getSupabase();
  const hasDisplayRegionColumns = await hasDisplayRegionSchema(supabase);
  if (options.apply && !hasDisplayRegionColumns) {
    throw new Error("display regionカラムが見つかりません。Supabase SQL Editorで 006_add_display_region_fields.sql を実行してください。");
  }
  if (!hasDisplayRegionColumns) log("display region columns are missing; dry-run uses existing region fields only");
  const places = await fetchPlaces(supabase, hasDisplayRegionColumns);
  const filtered = options.onlyMissing ? places.filter(isMissingDisplayRegion) : places;
  const targets = filtered.filter((place) => firstClassification(place.place_classifications)?.manual_override !== true);
  const skippedManualOverride = filtered.length - targets.length;

  const proposals = targets.map((place) => {
    const before = firstClassification(place.place_classifications);
    const after = classifyDisplayRegion({
      country: before?.country,
      prefecture: before?.prefecture,
      city: before?.city,
      ward: before?.ward,
      area_label: before?.area_label,
      travel_region: before?.travel_region,
      address: place.address,
      raw_google_summary: summarizeRawGoogle(place.raw_google)
    });
    return { place, before, after };
  });
  const changed = proposals.filter(({ before, after }) => displayRegionChanged(before, after));

  if (options.apply && changed.length > 0) {
    let processed = 0;
    for (const batch of chunks(changed, BATCH_SIZE)) {
      const payload = batch.map(({ place, after }) => ({
        place_id: place.id,
        region_group: after.region_group,
        region_filter_label: after.region_filter_label,
        region_sort_order: after.region_sort_order
      }));
      const { error } = await supabase.from("place_classifications").upsert(payload, { onConflict: "place_id" });
      if (error) throw error;
      processed += batch.length;
      log(`display regions upsert ${processed}/${changed.length}`);
    }
  }

  const groupCounts = countBy(proposals.map(({ after }) => after.region_group));
  const labelCounts = countBy(proposals.map(({ after }) => after.region_filter_label));
  const unknownCount = proposals.filter(({ after }) => after.region_group === "Unknown").length;

  log("done");
  console.log(JSON.stringify({
    status: options.apply ? "completed" : "dry_run",
    target_count: targets.length,
    changed_count: changed.length,
    applied_count: options.apply ? changed.length : 0,
    skipped_manual_override_count: skippedManualOverride,
    region_group_counts: groupCounts,
    region_filter_label_counts: labelCounts,
    unknown_count: unknownCount
  }, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient, includeDisplayRegionColumns: boolean) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const classificationSelect = includeDisplayRegionColumns
      ? "country, prefecture, city, ward, area_label, travel_region, region_group, region_filter_label, region_sort_order, manual_override"
      : "country, prefecture, city, ward, area_label, travel_region, manual_override";
    const { data, error } = await supabase
      .from("places")
      .select(`id, name, address, raw_google, place_classifications(${classificationSelect})`)
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

function isMissingDisplayRegion(place: PlaceRow) {
  const classification = firstClassification(place.place_classifications);
  return isMissing(classification?.region_group) || isMissing(classification?.region_filter_label) || classification?.region_filter_label === "未分類";
}

function displayRegionChanged(before: ClassificationRow | null, after: DisplayRegion) {
  return before?.region_group !== after.region_group ||
    before?.region_filter_label !== after.region_filter_label ||
    before?.region_sort_order !== after.region_sort_order;
}

function summarizeRawGoogle(rawGoogle: unknown) {
  if (typeof rawGoogle !== "object" || rawGoogle === null) return null;
  const raw = rawGoogle as Record<string, unknown>;
  const candidate = typeof raw.candidate_place === "object" && raw.candidate_place !== null ? raw.candidate_place as Record<string, unknown> : null;
  const source = candidate ?? raw;
  return {
    displayName: source.displayName,
    name: source.name,
    formattedAddress: source.formattedAddress ?? source.formatted_address ?? null,
    address: source.address ?? null
  };
}

function countBy(values: unknown[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value ?? "Unknown").trim() || "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")));
}

function isMissing(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "unknown" || text === "未分類";
}

async function hasDisplayRegionSchema(supabase: SupabaseClient) {
  const { error } = await supabase.from("place_classifications").select("region_group, region_filter_label, region_sort_order").limit(1);
  return !error;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Supabase接続情報が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。");
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function parseArgs(): Options {
  const apply = process.argv.includes("--apply");
  return {
    apply,
    dryRun: process.argv.includes("--dry-run") || !apply,
    onlyMissing: process.argv.includes("--only-missing")
  };
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

function chunks<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

function log(message: string) {
  console.log(`[reclassify:display-regions] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
  process.exit(1);
});
