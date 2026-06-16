import { NextResponse } from "next/server";
import { computeDiffPreview } from "@/lib/import/diff";
import { duplicateCandidates, fileCounts, listCounts, sha256 } from "@/lib/import/normalize";
import { parseImportFiles } from "@/lib/import/parsers";
import { getSupabaseRead } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = getUploadedFiles(formData);
    if (files.length === 0) {
      return NextResponse.json({ error: "ZIP、CSV、JSON、GeoJSONのいずれかのファイルをアップロードしてください。" }, { status: 400 });
    }
    const invalidFile = files.find((file) => !/\.(zip|csv|json|geojson)$/i.test(file.name));
    if (invalidFile) {
      return NextResponse.json({ error: "対応していないファイル形式です。.zip、.csv、.json、.geojsonに対応しています。" }, { status: 400 });
    }

    const preparedFiles = await Promise.all(
      files.map(async (file) => {
        const fileBuffer = await file.arrayBuffer();
        return {
          file: new File([fileBuffer], file.name, { type: file.type }),
          hash: sha256(fileBuffer)
        };
      })
    );
    const fileHash = sha256(Buffer.from(JSON.stringify(preparedFiles.map((entry) => ({ name: entry.file.name, hash: entry.hash })))));
    const parsed = await parseImportFiles(preparedFiles.map((entry) => entry.file));

    const previousSnapshot = await getPreviousSnapshot(fileHash);
    const diff = computeDiffPreview(parsed.items, previousSnapshot.items);
    const filename = files.length === 1 ? files[0].name : `複数ファイル (${files.length}件)`;

    return NextResponse.json({
      file_hash: fileHash,
      filename,
      items: parsed.items,
      file_counts: fileCounts(parsed.items),
      list_counts: listCounts(parsed.items),
      duplicate_candidates: duplicateCandidates(parsed.items),
      errors: parsed.errors,
      skipped_rows: parsed.skipped_rows,
      diff,
      already_imported: previousSnapshot.alreadyImported,
      supabase_available: previousSnapshot.supabaseAvailable
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function getUploadedFiles(formData: FormData) {
  const values = [...formData.getAll("files"), ...formData.getAll("file")];
  const files = values.filter((value): value is File => value instanceof File);
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}:${file.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getPreviousSnapshot(fileHash: string) {
  try {
    const supabase = getSupabaseRead();
    const { data: sameHash } = await supabase
      .from("google_takeout_snapshots")
      .select("id")
      .eq("file_hash", fileHash)
      .maybeSingle();

    const { data: latest } = await supabase
      .from("google_takeout_snapshots")
      .select("id")
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest?.id) return { items: null, alreadyImported: Boolean(sameHash), supabaseAvailable: true };

    const items = await fetchSnapshotItems(supabase, latest.id);
    return { items, alreadyImported: Boolean(sameHash), supabaseAvailable: true };
  } catch {
    return { items: null, alreadyImported: false, supabaseAvailable: false };
  }
}

async function fetchSnapshotItems(supabase: ReturnType<typeof getSupabaseRead>, snapshotId: string) {
  const rows: Array<{ normalized_key: string; source_list_name: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("google_takeout_snapshot_items")
      .select("normalized_key, source_list_name")
      .eq("snapshot_id", snapshotId)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
