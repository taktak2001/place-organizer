import type { getSupabaseRead } from "@/lib/supabase/server";
import type { PlaceRow } from "@/lib/places/browse";

export type RestaurantReviewStatus = "unreviewed" | "verified" | "not_restaurant" | "needs_check";

export const RESTAURANT_REVIEW_STATUSES: Array<{ value: RestaurantReviewStatus; label: string }> = [
  { value: "unreviewed", label: "未確認" },
  { value: "verified", label: "確認済み" },
  { value: "not_restaurant", label: "レストランではない" },
  { value: "needs_check", label: "要確認" }
];

export type RestaurantReviewCounts = Record<RestaurantReviewStatus, number>;

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
  maybeSingle: () => PromiseLike<QueryResult<T>>;
};

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
  restaurant_review_status: string | null;
  restaurant_price_band?: string | null;
  restaurant_quality_flags?: string[] | null;
  restaurant_notes?: string | null;
};

export async function getRestaurantReviewCounts(supabase: SupabaseRead): Promise<RestaurantReviewCounts> {
  const counts: RestaurantReviewCounts = { unreviewed: 0, verified: 0, not_restaurant: 0, needs_check: 0 };

  await Promise.all(RESTAURANT_REVIEW_STATUSES.map(async ({ value }) => {
    const { count, error } = await withReviewStatus(
      activeRestaurantClassificationQuery(supabase, "place_id", { count: "exact", head: true }),
      value
    );
    if (error) throw error;
    counts[value] = count ?? 0;
  }));

  return counts;
}

export async function getNextRestaurantReviewPlace(supabase: SupabaseRead, status: RestaurantReviewStatus, cursor?: string | null): Promise<PlaceRow | null> {
  const next = await fetchNextClassification(supabase, status, cursor, false) ?? await fetchNextClassification(supabase, status, cursor, true);
  if (!next) return null;
  return getRestaurantReviewPlaceById(supabase, next.place_id, next);
}

export async function getRestaurantReviewPlaceById(supabase: SupabaseRead, id: string, knownClassification?: ClassificationRow): Promise<PlaceRow | null> {
  const classification = knownClassification ?? await fetchClassificationByPlaceId(supabase, id);
  if (!classification || classification.main_category !== "Restaurant") return null;

  const { data, error } = await supabase
    .from("places")
    .select("id, name, google_maps_url, address, rating, website_url, primary_type, types, is_archived, price_level, latitude, longitude, source_links(source_list_name, source_url, active)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_archived === true) return null;
  return {
    ...(data as unknown as PlaceRow),
    place_classifications: [classification]
  };
}

export function normalizeReviewStatus(value: unknown): RestaurantReviewStatus {
  const text = String(value ?? "").trim();
  if (text === "verified" || text === "not_restaurant" || text === "needs_check") return text;
  return "unreviewed";
}

async function fetchNextClassification(supabase: SupabaseRead, status: RestaurantReviewStatus, cursor: string | null | undefined, wrap: boolean): Promise<ClassificationRow | null> {
  let query = withReviewStatus(
    activeRestaurantClassificationQuery(supabase, classificationSelect())
      .order("place_id", { ascending: true })
      .limit(1),
    status
  );

  if (cursor) {
    query = wrap ? query.lt("place_id", cursor) : query.gt("place_id", cursor);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data as ClassificationRow[] : [];
  return rows[0] ?? null;
}

async function fetchClassificationByPlaceId(supabase: SupabaseRead, id: string): Promise<ClassificationRow | null> {
  const { data, error } = await activeRestaurantClassificationQuery(supabase, classificationSelect())
    .eq("place_id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ClassificationRow | null) ?? null;
}

function activeRestaurantClassificationQuery(supabase: SupabaseRead, columns = "place_id", options?: { count?: "exact"; head?: boolean }) {
  const query = (supabase
    .from("place_classifications")
    .select(`${columns}, places!inner(is_archived)`, options)
    .eq("main_category", "Restaurant")) as unknown as QueryLike;
  return activePlaceFilter(query);
}

function withReviewStatus(query: QueryLike, status: RestaurantReviewStatus): QueryLike {
  if (status === "unreviewed") {
    return query.or("restaurant_review_status.is.null,restaurant_review_status.eq.unreviewed");
  }
  return query.eq("restaurant_review_status", status);
}

function activePlaceFilter(query: QueryLike): QueryLike {
  return query.or("is_archived.is.null,is_archived.eq.false", { referencedTable: "places", foreignTable: "places" });
}

function classificationSelect() {
  return "place_id, main_category, sub_category, category_tags, scene_tags, travel_region, area_label, region_group, region_filter_label, restaurant_review_status, restaurant_price_band, restaurant_quality_flags, restaurant_notes";
}
