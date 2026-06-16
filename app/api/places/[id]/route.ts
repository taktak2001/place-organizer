import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("places")
      .select("*, place_classifications(*), source_links(*)")
      .eq("id", params.id)
      .single();
    if (error) throw error;
    return NextResponse.json({ place: data });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const placePatch = {
      google_place_id: emptyToNull(body.google_place_id),
      name: emptyToUndefined(body.name),
      address: emptyToNull(body.address),
      enrichment_status: emptyToNull(body.enrichment_status),
      is_archived: booleanToUndefined(body.is_archived),
      archived_at: body.archived_at === undefined ? undefined : emptyToNull(body.archived_at),
      archive_reason: emptyToNull(body.archive_reason)
    };
    const classificationPatch = {
      main_category: emptyToNull(body.main_category),
      sub_category: emptyToNull(body.sub_category),
      scene_tags: body.scene_tags,
      area_label: emptyToNull(body.area_label),
      travel_region: emptyToNull(body.travel_region),
      visited_status: emptyToNull(body.visited_status),
      priority: emptyToNull(body.priority),
      manual_override: body.manual_override === undefined ? undefined : booleanToUndefined(body.manual_override),
      classification_source: emptyToNull(body.classification_source)
    };

    const cleanPlacePatch = removeUndefined(placePatch);
    if (Object.keys(cleanPlacePatch).length > 0) {
      const { error } = await supabase
        .from("places")
        .update(cleanPlacePatch)
        .eq("id", params.id);
      if (error) throw error;
    }

    const cleanClassificationPatch = removeUndefined(classificationPatch);
    if (Object.keys(cleanClassificationPatch).length > 0) {
      const { error } = await supabase
        .from("place_classifications")
        .update(cleanClassificationPatch)
        .eq("place_id", params.id);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function removeUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function emptyToNull(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function emptyToUndefined(value: unknown) {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function booleanToUndefined(value: unknown) {
  if (value === undefined) return undefined;
  return value === true || value === "true";
}
