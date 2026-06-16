import { NextResponse } from "next/server";
import { parseGoogleMapsUrl } from "@/lib/import/google-maps-url";
import { sourceGoogleMapsUrl } from "@/lib/import/source-fields";
import { AdminAuthError, assertAdminRequest, getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const ALLOWED_STATUSES = new Set(["enriched", "not_found", "pending_enrichment", "error", "coordinate_point", "source_url_confirmed"]);

export async function PATCH(request: Request) {
  try {
    assertAdminRequest(request);
    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    const status = String(body.status ?? "");
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids are required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (body.action === "approve_place_id_candidate") {
      const { data, error: selectError } = await supabase
        .from("places")
        .select("id, place_id_candidate")
        .in("id", ids);
      if (selectError) throw selectError;

      for (const place of data ?? []) {
        const candidate = typeof place.place_id_candidate === "object" && place.place_id_candidate !== null
          ? place.place_id_candidate as Record<string, unknown>
          : {};
        const candidateId = typeof candidate.id === "string" ? candidate.id : null;
        const { error } = await supabase
          .from("places")
          .update({
            google_place_id: candidateId,
            normalized_place_id: candidateId,
            place_id_confidence: "confirmed",
            place_id_review_reason: "Place ID候補を承認しました",
            place_id_normalized_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", place.id);
        if (error) throw error;
      }

      return NextResponse.json({ ok: true, updated_count: ids.length }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.action === "reject_place_id_candidate") {
      const { error } = await supabase
        .from("places")
        .update({
          normalized_place_id: null,
          place_id_confidence: "rejected",
          place_id_review_reason: "Place ID候補を却下しました",
          place_id_normalized_at: new Date().toISOString(),
          place_id_candidate: null,
          updated_at: new Date().toISOString()
        })
        .in("id", ids);
      if (error) throw error;
      return NextResponse.json({ ok: true, updated_count: ids.length }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.action === "keep_source_url_confirmed") {
      const { error } = await supabase
        .from("places")
        .update({
          normalized_place_id: null,
          place_id_confidence: "rejected",
          place_id_review_reason: "元リンク確認済みのまま保持しました",
          place_id_normalized_at: new Date().toISOString(),
          place_id_candidate: null,
          enrichment_status: "source_url_confirmed",
          updated_at: new Date().toISOString()
        })
        .in("id", ids);
      if (error) throw error;
      return NextResponse.json({ ok: true, updated_count: ids.length }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.action === "confirm_source_url") {
      const { data, error: selectError } = await supabase
        .from("places")
        .select("id, raw_import, google_maps_url")
        .in("id", ids);
      if (selectError) throw selectError;

      for (const place of data ?? []) {
        const sourceUrl = sourceGoogleMapsUrl(place.raw_import, place.google_maps_url);
        const parsed = parseGoogleMapsUrl(sourceUrl);
        const { error } = await supabase
          .from("places")
          .update({
            google_place_id: null,
            google_maps_url: sourceUrl,
            address: null,
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            website_url: null,
            phone_number: null,
            rating: null,
            user_ratings_total: null,
            price_level: null,
            business_status: null,
            primary_type: null,
            types: null,
            photo_references: null,
            regular_opening_hours: null,
            current_opening_hours: null,
            raw_google: {
              source_url_review: parsed,
              review_reason: "元リンクを正として採用しました"
            },
            enrichment_status: "source_url_confirmed",
            updated_at: new Date().toISOString()
          })
          .eq("id", place.id);
        if (error) throw error;
      }

      return NextResponse.json(
        { ok: true, updated_count: ids.length },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }

    const { error } = await supabase
      .from("places")
      .update({ enrichment_status: status, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) throw error;
    return NextResponse.json(
      { ok: true, updated_count: ids.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
