import { NextResponse } from "next/server";
import { getNextTagReviewPlace, getTagReviewCounts } from "@/lib/tag-review/queries";
import { normalizeTagsReviewStatus, TAG_REVIEW_CATEGORIES, type TagReviewCategory } from "@/lib/classification/tag-review";
import { getSupabaseRead, isAdminEnabled } from "@/lib/supabase/server";
import { safeSupabaseError } from "@/lib/supabase/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  try {
    if (!isAdminEnabled()) {
      return NextResponse.json({ error: "管理機能は無効です。" }, { status: 403 });
    }
    const url = new URL(request.url);
    const category = normalizeCategory(url.searchParams.get("category"));
    const status = normalizeTagsReviewStatus(url.searchParams.get("status"));
    const cursor = url.searchParams.get("cursor");
    const supabase = getSupabaseRead();
    const [counts, place] = await Promise.all([
      getTagReviewCounts(supabase, category),
      getNextTagReviewPlace(supabase, category, status, cursor)
    ]);
    return NextResponse.json({ counts, place }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(safeSupabaseError(error, "getTagReviewPlace"), { status: 500 });
  }
}

function normalizeCategory(value: unknown): TagReviewCategory {
  const text = String(value ?? "All").trim();
  return TAG_REVIEW_CATEGORIES.includes(text as TagReviewCategory) ? text as TagReviewCategory : "All";
}
