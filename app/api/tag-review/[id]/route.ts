import { NextResponse } from "next/server";
import { ART_SUB_CATEGORIES, categoryAllowsSubCategory, normalizeSceneArray, normalizeTagArray, normalizeTagsReviewStatus, tagOptionsForCategory } from "@/lib/classification/tag-review";
import { AdminAuthError, assertAdminRequest, getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const MAIN_CATEGORIES = new Set(["Restaurant", "Cafe", "Fashion", "Art", "Hotel", "Bath", "Hospital", "Life", "Other"]);
const PRICE_BANDS = new Set(["cheap", "normal", "high", "luxury", "unknown"]);

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    assertAdminRequest(request);
    const body = await request.json();
    const mainCategory = normalizeMainCategory(body.main_category);
    const reviewStatus = normalizeTagsReviewStatus(body.tags_review_status ?? "reviewed");
    const categoryTags = categoryAllowsSubCategory(mainCategory) ? [] : normalizeTagArray(body.category_tags, tagOptionsForCategory(mainCategory));
    const sceneTags = mainCategory === "Restaurant" ? normalizeSceneArray(body.scene_tags) : [];
    const subCategory = mainCategory === "Art" ? normalizeSubCategory(body.sub_category) : emptyToNull(body.sub_category);
    const priceBand = emptyToNull(body.restaurant_price_band) ?? "unknown";
    if (!PRICE_BANDS.has(priceBand)) {
      return NextResponse.json({ error: "invalid restaurant_price_band" }, { status: 400 });
    }

    const patch = {
      main_category: mainCategory,
      sub_category: subCategory,
      category_tags: categoryTags,
      scene_tags: sceneTags,
      region_filter_label: emptyToNull(body.region_filter_label),
      restaurant_price_band: mainCategory === "Restaurant" ? priceBand : null,
      tags_review_status: reviewStatus,
      tags_review_note: emptyToNull(body.tags_review_note),
      tags_reviewed_at: new Date().toISOString(),
      manual_override: true,
      classification_source: "manual",
      updated_at: new Date().toISOString()
    };

    const { error } = await getSupabaseAdmin()
      .from("place_classifications")
      .upsert({ place_id: params.id, ...patch }, { onConflict: "place_id" });
    if (error) throw error;

    return NextResponse.json({ ok: true, place_id: params.id, tags_review_status: reviewStatus }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function normalizeMainCategory(value: unknown) {
  const text = String(value ?? "Other").trim();
  return MAIN_CATEGORIES.has(text) ? text : "Other";
}

function normalizeSubCategory(value: unknown) {
  const text = String(value ?? "").trim();
  return (ART_SUB_CATEGORIES as readonly string[]).includes(text) ? text : null;
}

function emptyToNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
