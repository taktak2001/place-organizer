import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyPlace } from "../lib/classification/category";
import { computeDiffPreview } from "../lib/import/diff";
import { duplicateCandidates } from "../lib/import/normalize";
import type { NormalizedImportItem } from "../types/import";
import { readPrivateCsvData, summarizePrivateData } from "./private-data";

const BATCH_SIZE = 100;
const LOOKUP_BATCH_SIZE = 20;
const REQUIRED_TABLES = [
  "places",
  "place_classifications",
  "source_links",
  "import_batches",
  "google_takeout_snapshots",
  "google_takeout_snapshot_items"
] as const;

type SnapshotItem = {
  normalized_key: string;
  source_list_name: string | null;
};

type PlaceIdRow = {
  id: string;
  normalized_key: string;
};

type SeedOptions = {
  dryRun: boolean;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.dryRun ? "mode: dry-run" : "mode: write");

  log("loading CSV files");
  const data = readPrivateCsvData();
  const summary = summarizePrivateData(data);
  const duplicates = duplicateCandidates(data.items);
  const uniqueItems = [...new Map(data.items.map((item) => [item.normalized_key, item])).values()];

  log(`files: ${data.files.length}`);
  log(`parsed items: ${data.items.length}`);
  log(`unique places: ${uniqueItems.length}`);
  log(`skipped rows: ${data.skippedRows.length}`);
  log(`real errors: ${data.errors.length}`);
  log(`duplicate candidates: ${duplicates.length}`);

  if (data.files.length === 0) {
    log("done: no CSV files found in data/private");
    console.log(JSON.stringify({ status: "no_csv_files", ...summary }, null, 2));
    return;
  }

  if (data.errors.length > 0) {
    console.log(JSON.stringify({ status: "parse_failed", ...summary }, null, 2));
    throw new Error("CSVにreal errorsがあります。先に npm run inspect:private-data で確認してください。");
  }

  if (options.dryRun) {
    const classifiedCount = uniqueItems.map((item) => classifyPlace(item)).length;
    log(`classified places: ${classifiedCount}`);
    log("done: dry-run");
    console.log(JSON.stringify({
      status: "dry_run",
      parsed_count: data.items.length,
      unique_place_count: uniqueItems.length,
      skipped_row_count: data.skippedRows.length,
      real_error_count: data.errors.length,
      duplicate_candidate_count: duplicates.length,
      file_counts: summary.file_counts,
      list_counts: summary.list_counts,
      source_list_names: summary.source_list_names
    }, null, 2));
    return;
  }

  log("env check");
  const supabase = getSeedSupabase();

  log("connecting Supabase");
  await verifySupabaseSchema(supabase);
  log("Supabase schema ok");

  const previous = await latestSnapshotItems(supabase);
  const diff = computeDiffPreview(data.items, previous);
  const seedRunHash = `seed:${data.contentHash}:${new Date().toISOString()}`;

  log("creating import batch");
  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      source_type: "seed_private_csv",
      filename: "data/private/*.csv",
      file_hash: seedRunHash,
      status: "processing",
      total_count: data.items.length,
      parsed_count: data.items.length,
      duplicate_count: duplicates.reduce((sum, duplicate) => sum + duplicate.count - 1, 0),
      error_count: data.errors.length,
      logs: {
        content_hash: data.contentHash,
        source_files: data.files,
        diff,
        skipped_row_count: data.skippedRows.length
      }
    })
    .select("id")
    .single();
  if (batchError) throw batchError;

  log("upserting places");
  const existingKeys = await getExistingNormalizedKeys(supabase, uniqueItems.map((item) => item.normalized_key));
  const placeRows = await upsertPlaces(supabase, uniqueItems);
  const placeIds = new Map(placeRows.map((row) => [row.normalized_key, row.id]));
  const insertedCount = uniqueItems.filter((item) => !existingKeys.has(item.normalized_key)).length;
  const updatedCount = uniqueItems.length - insertedCount;

  log("upserting classifications");
  await upsertClassifications(supabase, uniqueItems, placeIds);

  log("upserting source_links");
  await upsertSourceLinks(supabase, data.items, placeIds);

  log("deactivating removed source_links");
  await deactivateRemovedSourceLinks(supabase, data.items, previous);

  log("creating snapshot");
  const { data: snapshot, error: snapshotError } = await supabase
    .from("google_takeout_snapshots")
    .insert({
      import_batch_id: batch.id,
      filename: "data/private/*.csv",
      file_hash: seedRunHash,
      total_count: data.items.length,
      raw_manifest: {
        content_hash: data.contentHash,
        source_files: data.files,
        diff,
        mode: "seed_private_csv"
      }
    })
    .select("id")
    .single();
  if (snapshotError) throw snapshotError;

  log("inserting snapshot_items");
  await insertSnapshotItems(supabase, snapshot.id, data.items);

  log("finalizing import batch");
  const { error: updateError } = await supabase
    .from("import_batches")
    .update({ status: "completed", inserted_count: insertedCount, updated_count: updatedCount })
    .eq("id", batch.id);
  if (updateError) throw updateError;

  log("done");
  console.log(JSON.stringify({
    status: "completed",
    parsed_count: data.items.length,
    unique_place_count: uniqueItems.length,
    skipped_row_count: data.skippedRows.length,
    real_error_count: data.errors.length,
    inserted_count: insertedCount,
    updated_count: updatedCount,
    duplicate_candidate_count: duplicates.length,
    diff,
    file_counts: summary.file_counts,
    list_counts: summary.list_counts
  }, null, 2));
}

async function upsertPlaces(supabase: SupabaseClient, items: NormalizedImportItem[]) {
  const rows: PlaceIdRow[] = [];
  let processed = 0;

  for (const batch of chunks(items, BATCH_SIZE)) {
    const payload = batch.map((item) => ({
      normalized_key: item.normalized_key,
      google_place_id: item.google_place_id ?? null,
      name: item.name,
      address: item.address,
      latitude: item.latitude,
      longitude: item.longitude,
      google_maps_url: item.google_maps_url,
      raw_import: item.raw,
      enrichment_status: "pending_enrichment"
    }));

    const { data, error } = await supabase
      .from("places")
      .upsert(payload, { onConflict: "normalized_key" })
      .select("id, normalized_key");
    if (error) throw error;
    rows.push(...((data ?? []) as PlaceIdRow[]));
    processed += batch.length;
    log(`places upsert ${processed}/${items.length}`);
  }

  return rows;
}

async function upsertClassifications(supabase: SupabaseClient, items: NormalizedImportItem[], placeIds: Map<string, string>) {
  let processed = 0;
  for (const batch of chunks(items, BATCH_SIZE)) {
    const payload = batch.map((item) => {
      const placeId = placeIds.get(item.normalized_key);
      if (!placeId) throw new Error("place_id lookup failed while building classifications");
      return {
        place_id: placeId,
        ...classifyPlace(item)
      };
    });
    const { error } = await supabase.from("place_classifications").upsert(payload, { onConflict: "place_id" });
    if (error) throw error;
    processed += batch.length;
    log(`classifications upsert ${processed}/${items.length}`);
  }
}

async function upsertSourceLinks(supabase: SupabaseClient, items: NormalizedImportItem[], placeIds: Map<string, string>) {
  const membership = new Map<string, NormalizedImportItem>();
  for (const item of items) {
    const placeId = placeIds.get(item.normalized_key);
    if (!placeId) throw new Error("place_id lookup failed while building source_links");
    membership.set(`${placeId}::${item.source_list_name ?? "Unknown"}`, item);
  }

  const uniqueMembership = [...membership.values()];
  let processed = 0;
  for (const batch of chunks(uniqueMembership, BATCH_SIZE)) {
    const payload = batch.map((item) => ({
      place_id: placeIds.get(item.normalized_key),
      source_type: "google_takeout",
      source_file: item.source_file,
      source_url: item.google_maps_url,
      source_list_name: item.source_list_name,
      memo: item.notes,
      active: true
    }));
    const { error } = await supabase.from("source_links").upsert(payload, { onConflict: "place_id,source_type,source_list_name" });
    if (error) throw error;
    processed += batch.length;
    log(`source_links upsert ${processed}/${uniqueMembership.length}`);
  }
}

async function insertSnapshotItems(supabase: SupabaseClient, snapshotId: string, items: NormalizedImportItem[]) {
  let processed = 0;
  for (const batch of chunks(items, BATCH_SIZE)) {
    const payload = batch.map((item) => ({
      snapshot_id: snapshotId,
      source_list_name: item.source_list_name,
      source_file: item.source_file,
      normalized_key: item.normalized_key,
      name: item.name,
      address: item.address,
      google_maps_url: item.google_maps_url,
      latitude: item.latitude,
      longitude: item.longitude,
      raw: item.raw
    }));
    const { error } = await supabase.from("google_takeout_snapshot_items").insert(payload);
    if (error) throw error;
    processed += batch.length;
    log(`snapshot_items insert ${processed}/${items.length}`);
  }
}

async function getExistingNormalizedKeys(supabase: SupabaseClient, keys: string[]) {
  const existing = new Set<string>();
  let processed = 0;
  for (const batch of chunks(keys, LOOKUP_BATCH_SIZE)) {
    const { data, error } = await supabase.from("places").select("normalized_key").in("normalized_key", batch);
    if (error) throw error;
    for (const row of data ?? []) existing.add(row.normalized_key);
    processed += batch.length;
    if (processed % BATCH_SIZE === 0 || processed === keys.length) {
      log(`places existing lookup ${processed}/${keys.length}`);
    }
  }
  return existing;
}

async function latestSnapshotItems(supabase: SupabaseClient): Promise<SnapshotItem[] | null> {
  const { data: latest } = await supabase
    .from("google_takeout_snapshots")
    .select("id")
    .eq("filename", "data/private/*.csv")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest?.id) return null;
  return fetchSnapshotItems(supabase, latest.id);
}

async function fetchSnapshotItems(supabase: SupabaseClient, snapshotId: string): Promise<SnapshotItem[]> {
  const rows: SnapshotItem[] = [];
  for (let from = 0; ; from += 1000) {
    const to = from + 999;
    const { data, error } = await supabase
      .from("google_takeout_snapshot_items")
      .select("normalized_key, source_list_name")
      .eq("snapshot_id", snapshotId)
      .range(from, to);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  log(`loaded previous snapshot items: ${rows.length}`);
  return rows;
}

async function deactivateRemovedSourceLinks(
  supabase: SupabaseClient,
  current: NormalizedImportItem[],
  previous: SnapshotItem[] | null
) {
  if (!previous) {
    log("source_links deactivate 0/0");
    return;
  }
  const currentMembership = new Set(current.map((item) => `${item.normalized_key}::${item.source_list_name ?? "Unknown"}`));
  const removed = previous.filter((item) => !currentMembership.has(`${item.normalized_key}::${item.source_list_name ?? "Unknown"}`));
  let processed = 0;
  for (const item of removed) {
    const { data: place } = await supabase.from("places").select("id").eq("normalized_key", item.normalized_key).maybeSingle();
    if (place?.id) {
      await supabase
        .from("source_links")
        .update({ active: false })
        .eq("place_id", place.id)
        .eq("source_type", "google_takeout")
        .eq("source_list_name", item.source_list_name);
    }
    processed += 1;
    if (processed % BATCH_SIZE === 0 || processed === removed.length) {
      log(`source_links deactivate ${processed}/${removed.length}`);
    }
  }
  if (removed.length === 0) log("source_links deactivate 0/0");
}

async function verifySupabaseSchema(supabase: SupabaseClient) {
  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (error) {
      throw new Error(`${table} テーブルが見つかりません。Supabase SQL Editorで migration を実行してください。詳細: ${error.message}`);
    }
  }
}

function getSeedSupabase() {
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

function parseArgs(): SeedOptions {
  return {
    dryRun: process.argv.includes("--dry-run")
  };
}

function chunks<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function log(message: string) {
  console.log(`[seed] ${message}`);
}

void main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return JSON.stringify({
      message: record.message,
      details: record.details,
      hint: record.hint,
      code: record.code
    }, null, 2);
  }
  return String(error);
}
