import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { closedStatusLabel, detectClosedPlace, type ClosedStatus } from "../lib/places/closed";

type Options = {
  json: boolean;
  status: ClosedStatus | "all";
  limit: number;
};

type PlaceRow = {
  id: string;
  name: string;
  google_maps_url: string | null;
  business_status: string | null;
  raw_google: Record<string, unknown> | null;
  archive_reason: string | null;
  is_archived: boolean | null;
  source_links?: Array<{ source_list_name: string | null; active: boolean | null }>;
  place_classifications?: Array<{ main_category: string | null }> | { main_category: string | null } | null;
};

loadEnvLocal();
const OUTPUT_JSON = process.argv.includes("--json");

async function main() {
  const options = parseArgs();
  log("start");
  log(`status filter: ${options.status}`);
  const supabase = getSupabase();
  const places = await fetchPlaces(supabase);
  const candidates = places
    .map((place) => ({ place, closed: detectClosedPlace(place) }))
    .filter((entry): entry is { place: PlaceRow; closed: NonNullable<ReturnType<typeof detectClosedPlace>> } => {
      if (!entry.closed) return false;
      return options.status === "all" || entry.closed.status === options.status;
    });

  const summary = {
    checked_count: places.length,
    closed_candidate_count: candidates.length,
    by_closed_status: group(candidates.map((entry) => closedStatusLabel(entry.closed.status))),
    by_source_list: group(candidates.flatMap(({ place }) => activeListNames(place))),
    by_category: group(candidates.map(({ place }) => mainCategory(place) ?? "Unknown")),
    listed_count: Math.min(options.limit, candidates.length)
  };

  const items = candidates.slice(0, options.limit).map(({ place, closed }) => ({
    id: place.id,
    display_name: place.name,
    closed_status: closed.status,
    business_status: closed.business_status,
    source_list_names: activeListNames(place),
    google_maps_url_exists: Boolean(place.google_maps_url),
    detail_url: `/places/${place.id}`,
    review_url: `/closed?status=${closed.status}`
  }));

  if (options.json) {
    console.log(JSON.stringify({ ...summary, items }, null, 2));
  } else {
    log(`checked: ${summary.checked_count}`);
    log(`closed candidates: ${summary.closed_candidate_count}`);
    log(`by closed status: ${JSON.stringify(summary.by_closed_status)}`);
    log(`by source list: ${JSON.stringify(summary.by_source_list)}`);
    log(`by category: ${JSON.stringify(summary.by_category)}`);
    log(`listed: ${summary.listed_count}`);
    console.log(JSON.stringify({ items }, null, 2));
  }
  log("done");
}

async function fetchPlaces(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, google_maps_url, business_status, raw_google, archive_reason, is_archived, source_links(source_list_name, active), place_classifications(main_category)")
      .eq("is_archived", false)
      .range(from, from + 999);
    if (error?.code === "42703") return fetchPlacesWithoutArchiveColumns(supabase);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fetchPlacesWithoutArchiveColumns(supabase: SupabaseClient) {
  log("archive columns are not migrated yet; listing candidates without archive filtering");
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, google_maps_url, business_status, raw_google, source_links(source_list_name, active), place_classifications(main_category)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]).map((place) => ({ ...place, archive_reason: null, is_archived: false })));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function activeListNames(place: PlaceRow) {
  return (place.source_links ?? [])
    .filter((link) => link.active !== false)
    .map((link) => String(link.source_list_name ?? "Unknown"));
}

function mainCategory(place: PlaceRow) {
  const value = Array.isArray(place.place_classifications)
    ? place.place_classifications[0]?.main_category
    : place.place_classifications?.main_category;
  return value ?? null;
}

function group(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function parseArgs(): Options {
  const status = valueAfter("--status") ?? "all";
  if (!["all", "permanently_closed", "temporarily_closed", "unknown_closed_candidate"].includes(status)) {
    throw new Error("--status は all / permanently_closed / temporarily_closed / unknown_closed_candidate のいずれかを指定してください。");
  }
  const limit = Number(valueAfter("--limit") ?? "20");
  return {
    json: process.argv.includes("--json"),
    status: status as Options["status"],
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
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
  if (OUTPUT_JSON) return;
  console.log(`[list:closed] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
  process.exit(1);
});
