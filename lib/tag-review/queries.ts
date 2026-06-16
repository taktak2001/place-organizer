import { normalizeTagsReviewStatus, TAG_REVIEW_STATUSES, type TagsReviewStatus } from "@/lib/classification/tag-review";
import type { PlaceRow } from "@/lib/places/browse";
import type { getSupabaseRead } from "@/lib/supabase/server";

type SupabaseRead = ReturnType<typeof getSupabaseRead>;
type QueryResult<T = unknown> = { data: T | null; error: unknown; count?: number | null };
type QueryLike<T = unknown> = PromiseLike<QueryResult<T>> & {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => QueryLike<T>;
  eq: (column: string, value: string) => QueryLike<T>;
  gt: (column: string, value: string) => QueryLike<T>;
  lt: (column: string, value: string) => QueryLike<T>;
  or: (filters: string, options?: { referencedTable?: string; foreignTable?: string }) => QueryLike<T>;
  order: (column: string, options?: { ascending?: boolean }) => QueryLike<T>;
  limit: (count: number) => QueryLike<T>;
};

export type TagReviewCounts = Record<TagsReviewStatus, number>;

type ClassificationRow = {
  place_id: string;
  main_category: string | null;
  sub_category: string | null;
  category_tags: string[] | null;
  scene_tags: string[] | null;
  travel_region: string | null;
  area_label: string | null;
  region_group: string | null;
  region_filter_label: string | null;
  restaurant_price_band?: string | null;
  tags_review_status?: string | null;
  tags_review_note?: string | null;
};

export async function getTagReviewCounts(supabase: SupabaseRead, category: string): Promise<TagReviewCounts> {
  const counts: TagReviewCounts = { unreviewed: 0, reviewed: 0, needs_check: 0 };
  await Promise.all(TAG_REVIEW_STATUSES.map(async (status) => {
    const { count, error } = await withStatus(
      tagReviewQuery(supabase, category, "place_id", { count: "exact", head: true }),
      status
    );
    if (error) throw error;
    counts[status] = count ?? 0;
  }));
  return counts;
}

export async function getNextTagReviewPlace(supabase: SupabaseRead, category: string, status: TagsReviewStatus, cursor?: string | null): Promise<PlaceRow | null> {
  const next = await fetchNextClassification(supabase, category, status, cursor, false) ?? await fetchNextClassification(supabase, category, status, cursor, true);
  if (!next) return null;

  const { data, error } = await supabase
    .from("places")
    .select("id, name, google_maps_url, address, rating, primary_type, types, is_archived, price_level, latitude, longitude, source_links(source_list_name, source_url, active)")
    .eq("id", next.place_id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_archived === true) return null;
  return { ...(data as unknown as PlaceRow), place_classifications: [next] };
}

function tagReviewQuery(supabase: SupabaseRead, category: string, columns = "place_id", options?: { count?: "exact"; head?: boolean }) {
  let query = (supabase
    .from("place_classifications")
    .select(`${columns}, places!inner(is_archived)`, options)) as unknown as QueryLike;
  if (category !== "All") query = query.eq("main_category", category);
  return query.or("is_archived.is.null,is_archived.eq.false", { referencedTable: "places", foreignTable: "places" });
}

async function fetchNextClassification(supabase: SupabaseRead, category: string, status: TagsReviewStatus, cursor: string | null | undefined, wrap: boolean): Promise<ClassificationRow | null> {
  let query = withStatus(
    tagReviewQuery(supabase, category, classificationSelect()).order("place_id", { ascending: true }).limit(12),
    status
  );
  if (cursor) query = wrap ? query.lt("place_id", cursor) : query.gt("place_id", cursor);

  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data as ClassificationRow[] : [];
  const sorted = [...rows].sort((a, b) => reviewPriority(b) - reviewPriority(a) || a.place_id.localeCompare(b.place_id));
  return sorted[0] ?? null;
}

function withStatus(query: QueryLike, status: TagsReviewStatus): QueryLike {
  if (status === "unreviewed") return query.or("tags_review_status.is.null,tags_review_status.eq.unreviewed");
  return query.eq("tags_review_status", status);
}

function reviewPriority(row: ClassificationRow) {
  const category = String(row.main_category ?? "");
  const categoryTags = Array.isArray(row.category_tags) ? row.category_tags : [];
  const sceneTags = Array.isArray(row.scene_tags) ? row.scene_tags : [];
  let score = 0;
  if (category !== "Art" && categoryTags.length === 0) score += 10;
  if (category === "Restaurant" && sceneTags.length === 0) score += 5;
  if (category === "Art" && !String(row.sub_category ?? "").trim()) score += 10;
  if (!String(row.region_filter_label ?? "").trim()) score += 3;
  if (normalizeTagsReviewStatus(row.tags_review_status) === "unreviewed") score += 1;
  return score;
}

function classificationSelect() {
  return "place_id, main_category, sub_category, category_tags, scene_tags, travel_region, area_label, region_group, region_filter_label, restaurant_price_band, tags_review_status, tags_review_note";
}
