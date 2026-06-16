import { NextResponse } from "next/server";
import { classifyPlace } from "@/lib/classification/category";
import { computeDiffPreview } from "@/lib/import/diff";
import { duplicateCandidates } from "@/lib/import/normalize";
import { AdminAuthError, assertAdminRequest, getSupabaseAdmin } from "@/lib/supabase/server";
import type { NormalizedImportItem } from "@/types/import";

export const runtime = "nodejs";
export const maxDuration = 60;

type CommitPayload = {
  filename: string;
  file_hash: string;
  items: NormalizedImportItem[];
  errors?: unknown[];
};

export async function POST(request: Request) {
  try {
    assertAdminRequest(request);
    const payload = (await request.json()) as CommitPayload;
    if (!payload.file_hash || !payload.filename || !Array.isArray(payload.items)) {
      return NextResponse.json({ error: "インポート内容が不正です。" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: existingBatch } = await supabase
      .from("import_batches")
      .select("id")
      .eq("file_hash", payload.file_hash)
      .maybeSingle();
    if (existingBatch) {
      return NextResponse.json({ error: "同じファイルはすでにインポート済みです。" }, { status: 409 });
    }

    const previous = await latestSnapshotItems(supabase);
    const diff = computeDiffPreview(payload.items, previous);
    const duplicates = duplicateCandidates(payload.items);
    const uniqueItems = [...new Map(payload.items.map((item) => [item.normalized_key, item])).values()];

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        source_type: "google_takeout",
        filename: payload.filename,
        file_hash: payload.file_hash,
        status: "processing",
        total_count: payload.items.length,
        parsed_count: payload.items.length,
        duplicate_count: duplicates.reduce((sum, duplicate) => sum + duplicate.count - 1, 0),
        error_count: payload.errors?.length ?? 0,
        logs: { diff, duplicate_keys: duplicates.map((duplicate) => duplicate.key) }
      })
      .select("id")
      .single();
    if (batchError) throw batchError;

    let insertedCount = 0;
    let updatedCount = 0;

    for (const item of uniqueItems) {
      const { data: existing } = await supabase
        .from("places")
        .select("id")
        .eq("normalized_key", item.normalized_key)
        .maybeSingle();

      const placePayload = {
        normalized_key: item.normalized_key,
        google_place_id: item.google_place_id ?? null,
        name: item.name,
        address: item.address,
        latitude: item.latitude,
        longitude: item.longitude,
        google_maps_url: item.google_maps_url,
        raw_import: item.raw,
        enrichment_status: "pending_enrichment"
      };

      const { data: place, error: placeError } = await supabase
        .from("places")
        .upsert(placePayload, { onConflict: "normalized_key" })
        .select("id")
        .single();
      if (placeError) throw placeError;
      if (existing) updatedCount += 1;
      else insertedCount += 1;

      const classification = classifyPlace(item);
      const { error: classificationError } = await supabase.from("place_classifications").upsert(
        {
          place_id: place.id,
          ...classification
        },
        { onConflict: "place_id" }
      );
      if (classificationError) throw classificationError;
    }

    const sourceLinks = payload.items.map((item) => ({
      place_id: null as string | null,
      item
    }));
    for (const link of sourceLinks) {
      const { data: place, error: placeLookupError } = await supabase
        .from("places")
        .select("id")
        .eq("normalized_key", link.item.normalized_key)
        .single();
      if (placeLookupError) throw placeLookupError;
      link.place_id = place.id;
      const { error: linkError } = await supabase.from("source_links").upsert(
        {
          place_id: place.id,
          source_type: "google_takeout",
          source_file: link.item.source_file,
          source_url: link.item.google_maps_url,
          source_list_name: link.item.source_list_name,
          memo: link.item.notes,
          active: true
        },
        { onConflict: "place_id,source_type,source_list_name" }
      );
      if (linkError) throw linkError;
    }

    await deactivateRemovedSourceLinks(supabase, payload.items, previous);

    const { data: snapshot, error: snapshotError } = await supabase
      .from("google_takeout_snapshots")
      .insert({
        import_batch_id: batch.id,
        filename: payload.filename,
        file_hash: payload.file_hash,
        total_count: payload.items.length,
        raw_manifest: {
          source_files: [...new Set(payload.items.map((item) => item.source_file))],
          diff
        }
      })
      .select("id")
      .single();
    if (snapshotError) throw snapshotError;

    const snapshotItems = payload.items.map((item) => ({
      snapshot_id: snapshot.id,
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
    if (snapshotItems.length > 0) {
      const { error: snapshotItemsError } = await supabase.from("google_takeout_snapshot_items").insert(snapshotItems);
      if (snapshotItemsError) throw snapshotItemsError;
    }

    const { error: updateError } = await supabase
      .from("import_batches")
      .update({ status: "completed", inserted_count: insertedCount, updated_count: updatedCount })
      .eq("id", batch.id);
    if (updateError) throw updateError;

    return NextResponse.json({
      import_batch_id: batch.id,
      snapshot_id: snapshot.id,
      inserted_count: insertedCount,
      updated_count: updatedCount,
      duplicate_count: duplicates.reduce((sum, duplicate) => sum + duplicate.count - 1, 0),
      diff
    });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function latestSnapshotItems(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data: latest } = await supabase
    .from("google_takeout_snapshots")
    .select("id")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest?.id) return null;
  const { data } = await supabase
    .from("google_takeout_snapshot_items")
    .select("normalized_key, source_list_name")
    .eq("snapshot_id", latest.id);
  return data ?? null;
}

async function deactivateRemovedSourceLinks(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  current: NormalizedImportItem[],
  previous: Array<{ normalized_key: string; source_list_name: string | null }> | null
) {
  if (!previous) return;
  const currentMembership = new Set(current.map((item) => `${item.normalized_key}::${item.source_list_name ?? "Unknown"}`));
  const removed = previous.filter((item) => !currentMembership.has(`${item.normalized_key}::${item.source_list_name ?? "Unknown"}`));
  for (const item of removed) {
    const { data: place } = await supabase.from("places").select("id").eq("normalized_key", item.normalized_key).maybeSingle();
    if (!place?.id) continue;
    await supabase
      .from("source_links")
      .update({ active: false })
      .eq("place_id", place.id)
      .eq("source_type", "google_takeout")
      .eq("source_list_name", item.source_list_name);
  }
}
