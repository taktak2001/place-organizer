import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { closedArchiveReason, detectClosedPlace, type ClosedStatus } from "../lib/places/closed";

type Options = {
  apply: boolean;
  status: ClosedStatus | "all";
};

type PlaceRow = {
  id: string;
  business_status: string | null;
  raw_google: Record<string, unknown> | null;
  archive_reason: string | null;
  is_archived: boolean | null;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.apply ? "mode: write" : "mode: dry-run");
  log(`status filter: ${options.status}`);
  const supabase = getSupabase();
  if (options.apply) await verifyArchiveColumns(supabase);
  const places = await fetchPlaces(supabase);
  const targets = places
    .map((place) => ({ place, closed: detectClosedPlace(place) }))
    .filter((entry): entry is { place: PlaceRow; closed: NonNullable<ReturnType<typeof detectClosedPlace>> } => {
      if (!entry.closed) return false;
      return options.status === "all" || entry.closed.status === options.status;
    });

  const summary = {
    checked_count: places.length,
    target_count: targets.length,
    archived_count: 0,
    dry_run: !options.apply
  };

  if (options.apply) {
    let processed = 0;
    for (const { place, closed } of targets) {
      const { error } = await supabase
        .from("places")
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
          archive_reason: closedArchiveReason(closed.status)
        })
        .eq("id", place.id);
      if (error) throw error;
      summary.archived_count += 1;
      processed += 1;
      if (processed % 100 === 0 || processed === targets.length) log(`archived ${processed}/${targets.length}`);
    }
  }

  log("done");
  console.log(JSON.stringify(summary, null, 2));
}

async function fetchPlaces(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, business_status, raw_google, archive_reason, is_archived")
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
  log("archive columns are not migrated yet; dry-run uses current business_status only");
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, business_status, raw_google")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]).map((place) => ({ ...place, archive_reason: null, is_archived: false })));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function verifyArchiveColumns(supabase: SupabaseClient) {
  const { error } = await supabase.from("places").select("is_archived, archived_at, archive_reason").limit(1);
  if (error?.code === "42703") {
    throw new Error("archive用カラムが未作成です。supabase/migrations/002_add_place_archive_fields.sql をSupabase SQL Editorで実行してください。");
  }
  if (error) throw error;
}

function parseArgs(): Options {
  const status = valueAfter("--status") ?? "all";
  if (!["all", "permanently_closed", "temporarily_closed", "unknown_closed_candidate"].includes(status)) {
    throw new Error("--status は all / permanently_closed / temporarily_closed / unknown_closed_candidate のいずれかを指定してください。");
  }
  return {
    apply: process.argv.includes("--apply"),
    status: status as Options["status"]
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
  console.log(`[archive:closed] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
  process.exit(1);
});
