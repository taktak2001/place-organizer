import { NextResponse } from "next/server";
import { normalizeCuisineTags } from "@/lib/classification/restaurant-cuisine";
import { AdminAuthError, assertAdminRequest, getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const REVIEW_STATUSES = new Set(["pending", "verified", "not_restaurant", "needs_check"]);
const PRICE_BANDS = new Set(["cheap", "normal", "high", "luxury", "unknown"]);
const SCENE_TAGS = new Set(["Date", "Business", "Solo", "Casual", "Group", "Travel", "High-end", "Local"]);

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    assertAdminRequest(request);
    const body = await request.json();
    const status = stringValue(body.restaurant_review_status) ?? "verified";
    if (!REVIEW_STATUSES.has(status)) {
      return NextResponse.json({ error: "invalid restaurant_review_status" }, { status: 400 });
    }

    const categoryTags = normalizeCuisineTags(body.category_tags);
    const sceneTags = normalizeSceneTags(body.scene_tags);
    const priceBand = stringValue(body.restaurant_price_band) ?? "unknown";
    if (!PRICE_BANDS.has(priceBand)) {
      return NextResponse.json({ error: "invalid restaurant_price_band" }, { status: 400 });
    }

    const notRestaurant = status === "not_restaurant";
    const patch = {
      main_category: notRestaurant ? stringValue(body.main_category) ?? "Other" : "Restaurant",
      category_tags: notRestaurant ? [] : categoryTags,
      scene_tags: notRestaurant ? [] : sceneTags,
      region_group: emptyToNull(body.region_group),
      region_filter_label: emptyToNull(body.region_filter_label),
      travel_region: emptyToNull(body.travel_region),
      area_label: emptyToNull(body.area_label),
      restaurant_review_status: status,
      restaurant_reviewed_at: new Date().toISOString(),
      restaurant_review_note: emptyToNull(body.restaurant_review_note),
      restaurant_price_band: notRestaurant ? "unknown" : priceBand,
      manual_override: true,
      classification_source: "manual"
    };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("place_classifications")
      .upsert({ place_id: params.id, ...patch }, { onConflict: "place_id" });
    if (error) throw error;

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function normalizeSceneTags(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map((item) => String(item ?? "").trim()).filter((item) => SCENE_TAGS.has(item)))];
}

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function emptyToNull(value: unknown) {
  return stringValue(value);
}
