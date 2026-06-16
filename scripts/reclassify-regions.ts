import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyRegion } from "../lib/classification/region";
import type { NormalizedImportItem } from "../types/import";

const BATCH_SIZE = 100;

type Options = {
  dryRun: boolean;
  apply: boolean;
  status: string;
  onlyMissing: boolean;
  onlyMissingWithAddress: boolean;
  onlyMissingWithNameHint: boolean;
};

type PlaceRow = {
  id: string;
  normalized_key: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  google_place_id: string | null;
  raw_import: Record<string, unknown> | null;
  raw_google: Record<string, unknown> | null;
  enrichment_status: string | null;
  place_classifications?: ClassificationRow[] | ClassificationRow | null;
  source_links?: SourceLinkRow[];
};

type ClassificationRow = {
  country: string | null;
  prefecture: string | null;
  city: string | null;
  ward: string | null;
  area_label: string | null;
  nearest_station: string | null;
  travel_region: string | null;
  manual_override?: boolean | null;
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
  log(`status filter: ${options.status}`);

  log("env check");
  const supabase = getSupabase();
  log("connecting Supabase");
  await verifySupabaseSchema(supabase);

  const allPlaces = await fetchPlaces(supabase, options.status);
  const places = allPlaces.filter((place) => matchesOptions(place, options));
  log(`target count: ${places.length}`);

  const skippedManualOverride = places.filter((place) => firstClassification(place.place_classifications)?.manual_override === true).length;
  const changes = places.filter((place) => firstClassification(place.place_classifications)?.manual_override !== true).map((place) => {
    const before = firstClassification(place.place_classifications);
    const after = mergeRegion(before, classifyRegion(toNormalizedItem(place)));
    return { place, before, after };
  });

  const beforeUnknown = changes.filter(({ before }) => isMissing(before?.area_label) || isMissing(before?.travel_region)).length;
  const afterUnknown = changes.filter(({ after }) => isMissing(after.area_label) || isMissing(after.travel_region)).length;
  const changed = changes.filter(({ before, after }) => regionChanged(before, after));
  const filledMetrics = filledRegionMetrics(changes);
  const reasonCounts = countBy(changes.map(({ place }) => regionReason(place)));

  log(`before missing area/travel: ${beforeUnknown}`);
  log(`after missing area/travel: ${afterUnknown}`);
  log(`changed classifications: ${changed.length}`);

  if (!options.apply) {
    log("done: dry-run");
    console.log(JSON.stringify({
      status: "dry_run",
      target_count: places.length,
      skipped_manual_override_count: skippedManualOverride,
      before_missing_area_or_travel: beforeUnknown,
      after_missing_area_or_travel: afterUnknown,
      changed_count: changed.length,
      applied_count: 0,
      filled_area_label_count: filledMetrics.area_label,
      filled_travel_region_count: filledMetrics.travel_region,
      filled_prefecture_count: filledMetrics.prefecture,
      filled_city_count: filledMetrics.city,
      still_missing_count: afterUnknown,
      reason_counts: reasonCounts,
      skipped_no_signal_count: places.filter((place) => !hasRegionSignal(place)).length,
      travel_region_counts: countBy(changes.map(({ after }) => after.travel_region)),
      area_label_counts: countBy(changes.map(({ after }) => after.area_label))
    }, null, 2));
    return;
  }

  let processed = 0;
  for (const batch of chunks(changed, BATCH_SIZE)) {
    const payload = batch.map(({ place, after }) => ({
      place_id: place.id,
      country: after.country,
      prefecture: after.prefecture,
      city: after.city,
      ward: after.ward,
      area_label: after.area_label,
      nearest_station: after.nearest_station,
      travel_region: after.travel_region
    }));
    const { error } = await supabase.from("place_classifications").upsert(payload, { onConflict: "place_id" });
    if (error) throw error;
    processed += batch.length;
    log(`regions upsert ${processed}/${changed.length}`);
  }

  log("done");
  console.log(JSON.stringify({
    status: "completed",
    target_count: places.length,
    skipped_manual_override_count: skippedManualOverride,
    before_missing_area_or_travel: beforeUnknown,
    after_missing_area_or_travel: afterUnknown,
    changed_count: changed.length,
    applied_count: changed.length,
    filled_area_label_count: filledMetrics.area_label,
    filled_travel_region_count: filledMetrics.travel_region,
    filled_prefecture_count: filledMetrics.prefecture,
    filled_city_count: filledMetrics.city,
    still_missing_count: afterUnknown,
    reason_counts: reasonCounts,
    skipped_no_signal_count: places.filter((place) => !hasRegionSignal(place)).length
  }, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient, status: string) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase
      .from("places")
      .select("id, normalized_key, name, address, latitude, longitude, google_maps_url, google_place_id, raw_import, raw_google, enrichment_status, place_classifications(country, prefecture, city, ward, area_label, nearest_station, travel_region, manual_override), source_links(source_list_name, source_file, memo, active)")
      .range(from, from + 999);
    if (status !== "all") query = query.eq("enrichment_status", status);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function toNormalizedItem(place: PlaceRow): NormalizedImportItem {
  const links = activeLinks(place.source_links);
  return {
    source_file: links.map((link) => link.source_file).filter(Boolean).join(", ") || "reclassify_regions",
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

function regionChanged(before: ClassificationRow | null, after: ReturnType<typeof classifyRegion>) {
  if (!before) return true;
  return before.country !== after.country ||
    before.prefecture !== after.prefecture ||
    before.city !== after.city ||
    before.ward !== after.ward ||
    before.area_label !== after.area_label ||
    before.nearest_station !== after.nearest_station ||
    before.travel_region !== after.travel_region;
}

function mergeRegion(before: ClassificationRow | null, after: ReturnType<typeof classifyRegion>): ReturnType<typeof classifyRegion> {
  return {
    country: keepExisting(before?.country, after.country),
    prefecture: keepExisting(before?.prefecture, after.prefecture),
    city: keepExisting(before?.city, after.city),
    ward: keepExisting(before?.ward, after.ward),
    area_label: keepExisting(before?.area_label, after.area_label),
    nearest_station: keepExisting(before?.nearest_station, after.nearest_station),
    travel_region: keepExisting(before?.travel_region, after.travel_region)
  };
}

function keepExisting(current: string | null | undefined, next: string | null | undefined) {
  return isMissing(next) && !isMissing(current) ? current ?? null : next ?? null;
}

function filledRegionMetrics(changes: Array<{ before: ClassificationRow | null; after: ReturnType<typeof classifyRegion> }>) {
  return {
    area_label: changes.filter(({ before, after }) => isMissing(before?.area_label) && !isMissing(after.area_label)).length,
    travel_region: changes.filter(({ before, after }) => isMissing(before?.travel_region) && !isMissing(after.travel_region)).length,
    prefecture: changes.filter(({ before, after }) => isMissing(before?.prefecture) && !isMissing(after.prefecture)).length,
    city: changes.filter(({ before, after }) => isMissing(before?.city) && !isMissing(after.city)).length
  };
}

function firstClassification(value: unknown): ClassificationRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as ClassificationRow : null;
}

function activeLinks(value: unknown): SourceLinkRow[] {
  return Array.isArray(value) ? value.filter((link) => typeof link === "object" && link !== null && (link as SourceLinkRow).active !== false) as SourceLinkRow[] : [];
}

function matchesOptions(place: PlaceRow, options: Options) {
  const classification = firstClassification(place.place_classifications);
  const missing = isMissing(classification?.area_label) || isMissing(classification?.travel_region);
  if ((options.onlyMissing || options.onlyMissingWithAddress || options.onlyMissingWithNameHint) && !missing) return false;
  if (options.onlyMissingWithAddress && !hasAddressSignal(place)) return false;
  if (options.onlyMissingWithNameHint && !hasRegionNameHint(place)) return false;
  return true;
}

function hasAddressSignal(place: PlaceRow) {
  const raw = candidateAwareRaw(place.raw_google);
  return Boolean(place.address || raw.formattedAddress || raw.formatted_address);
}

function hasRegionNameHint(place: PlaceRow) {
  return /六本木|中目黒|銀座|表参道|清澄白河|京都|箱根|軽井沢|金沢|直島|瀬戸内|Paris|Seoul|New York|Brooklyn|Los Angeles|London/i.test(place.name);
}

function hasRegionSignal(place: PlaceRow) {
  return hasAddressSignal(place) || hasRegionNameHint(place) || (place.latitude !== null && place.longitude !== null);
}

function regionReason(place: PlaceRow) {
  if (place.address) return "address";
  const raw = candidateAwareRaw(place.raw_google);
  if (raw.formattedAddress || raw.formatted_address) return "raw_google_address";
  if (place.latitude !== null && place.longitude !== null) return "lat_lng";
  if (hasRegionNameHint(place)) return "name_hint";
  return "no_signal";
}

function candidateAwareRaw(rawGoogle: unknown) {
  if (typeof rawGoogle !== "object" || rawGoogle === null) return {};
  const raw = rawGoogle as Record<string, unknown>;
  return typeof raw.candidate_place === "object" && raw.candidate_place !== null ? raw.candidate_place as Record<string, unknown> : raw;
}

function isMissing(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "unknown";
}

function countBy(values: unknown[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = isMissing(value) ? "未分類" : String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20));
}

async function verifySupabaseSchema(supabase: SupabaseClient) {
  const { error } = await supabase.from("places").select("id").limit(1);
  if (error) throw new Error(`places テーブルが見つかりません。Supabase SQL Editorで migration を実行してください。詳細: ${error.message}`);
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

function parseArgs(): Options {
  const apply = process.argv.includes("--apply");
  return {
    dryRun: process.argv.includes("--dry-run") || !apply,
    apply,
    status: valueAfter("--status") ?? "all",
    onlyMissing: process.argv.includes("--only-missing"),
    onlyMissingWithAddress: process.argv.includes("--only-missing-with-address"),
    onlyMissingWithNameHint: process.argv.includes("--only-missing-with-name-hint")
  };
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function chunks<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function log(message: string) {
  console.log(`[reclassify:regions] ${message}`);
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) return JSON.stringify(error);
  return String(error);
}

void main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
