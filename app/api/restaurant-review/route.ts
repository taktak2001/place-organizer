import { NextResponse } from "next/server";
import { isRestaurantReviewStatus } from "@/lib/restaurant/quality";
import { AdminAuthError, assertAdminRequest, getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function PATCH(request: Request) {
  try {
    assertAdminRequest(request);
    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (ids.length === 0) return NextResponse.json({ error: "ids are required" }, { status: 400 });

    const action = String(body.action ?? "");
    const status = statusFromAction(action, body.restaurant_review_status);
    if (!status) return NextResponse.json({ error: "invalid restaurant review status" }, { status: 400 });

    const patch: Record<string, unknown> = {
      restaurant_review_status: status,
      restaurant_review_note: emptyToNull(body.restaurant_review_note) ?? reasonFromStatus(status),
      restaurant_reviewed_at: new Date().toISOString(),
      manual_override: true,
      classification_source: "manual"
    };

    if (Array.isArray(body.category_tags)) {
      patch.category_tags = body.category_tags.map(String).filter(Boolean);
    }
    if (Array.isArray(body.scene_tags)) {
      patch.scene_tags = body.scene_tags.map(String).filter(Boolean);
    }
    if (body.restaurant_price_band !== undefined) {
      patch.restaurant_price_band = emptyToNull(body.restaurant_price_band);
    }
    if (status === "not_restaurant") {
      patch.main_category = "Other";
      patch.category_tags = [];
      patch.scene_tags = [];
      patch.restaurant_price_band = "unknown";
    }

    const { error } = await getSupabaseAdmin()
      .from("place_classifications")
      .update(patch)
      .in("place_id", ids);
    if (error) throw error;

    return NextResponse.json(
      { ok: true, updated_count: ids.length, restaurant_review_status: status },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return PATCH(request);
}

function statusFromAction(action: string, value: unknown) {
  if (action === "approve") return "verified";
  if (action === "needs_review") return "needs_check";
  if (action === "reject") return "not_restaurant";
  if (action === "reset") return "pending";
  return isRestaurantReviewStatus(value) ? value : null;
}

function reasonFromStatus(status: string) {
  if (status === "verified") return "Restaurant分類を確認しました";
  if (status === "not_restaurant") return "レストランではないと判断しました";
  if (status === "needs_check") return "Restaurant分類は要確認です";
  return "Restaurant分類を未レビューに戻しました";
}

function emptyToNull(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}
