import { NextResponse } from "next/server";
import { categoryFromSlug } from "@/lib/places/browse";
import { safeSupabaseError } from "@/lib/supabase/queries";
import { getSupabaseRead } from "@/lib/supabase/server";

export const PLACE_PAGE_SIZE = 30;

type BrowseScope =
  | { kind: "all" }
  | { kind: "category"; slug: string };

const PLACE_CARD_SELECT = `
  id,
  name,
  google_maps_url,
  address,
  rating,
  user_ratings_total,
  primary_type,
  types,
  enrichment_status,
  price_level,
  is_archived,
  latitude,
  longitude,
  place_classifications!inner(
    main_category,
    sub_category,
    category_tags,
    scene_tags,
    country,
    prefecture,
    city,
    ward,
    travel_region,
    area_label,
    region_group,
    region_filter_label,
    restaurant_price_band
  ),
  source_links(
    source_list_name,
    source_url,
    active
  )
`;

const PLACE_CARD_SELECT_WANT = PLACE_CARD_SELECT.replace(
  "source_links(\n    source_list_name,",
  "source_links!inner(\n    source_list_name,"
);

export async function placesBrowseResponse(request: Request, scope: BrowseScope) {
  try {
    const url = new URL(request.url);
    const params = readBrowseParams(url.searchParams);
    const supabase = getSupabaseRead();
    const select = params.want ? PLACE_CARD_SELECT_WANT : PLACE_CARD_SELECT;
    let query = supabase
      .from("places")
      .select(select, { count: "exact" })
      .or("is_archived.is.null,is_archived.eq.false");

    if (scope.kind === "category") {
      const category = categoryFromSlug(scope.slug);
      if (!category) {
        return NextResponse.json({ error: "category not found", places: [], total_count: 0 }, { status: 404 });
      }
      query = query.eq("place_classifications.main_category", category);
    } else if (params.categories.length > 0) {
      query = query.in("place_classifications.main_category", params.categories);
    }

    if (params.search) query = query.ilike("name", `%${escapeLike(params.search)}%`);
    if (params.want) {
      query = query.eq("source_links.active", true).ilike("source_links.source_list_name", "%行ってみたい%");
    }
    if (params.category_tags.length > 0) {
      query = query.overlaps("place_classifications.category_tags", params.category_tags);
    }
    if (params.scene_tags.length > 0) {
      query = query.overlaps("place_classifications.scene_tags", params.scene_tags);
    }
    if (params.sub_category.length > 0) {
      query = query.in("place_classifications.sub_category", params.sub_category);
    }
    if (params.region_filter_label.length > 0) {
      query = query.in("place_classifications.region_filter_label", params.region_filter_label);
    }
    if (params.price_level) {
      query = query.eq("place_classifications.restaurant_price_band", params.price_level);
    }

    const from = params.offset;
    const to = params.offset + params.limit - 1;
    const { data, error, count } = await query.order("name", { ascending: true }).range(from, to);
    if (error) throw error;

    return NextResponse.json(
      {
        places: data ?? [],
        total_count: count ?? 0,
        offset: params.offset,
        limit: params.limit,
        has_more: params.offset + (data?.length ?? 0) < (count ?? 0)
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const safe = safeSupabaseError(error, scope.kind === "category" ? "getCategoryPlacesPage" : "getPlacesPage");
    return NextResponse.json({ ...safe, places: [], total_count: 0, has_more: false }, { status: 500 });
  }
}

function readBrowseParams(searchParams: URLSearchParams) {
  const limit = boundedNumber(searchParams.get("limit"), PLACE_PAGE_SIZE, 1, 50);
  return {
    offset: boundedNumber(searchParams.get("offset"), 0, 0, 100000),
    limit,
    search: clean(searchParams.get("search")),
    want: searchParams.get("want") === "1" || searchParams.get("want_only") === "1",
    categories: searchParams.getAll("categories").map(clean).filter(Boolean),
    category_tags: searchParams.getAll("category_tags").map(clean).filter(Boolean),
    scene_tags: searchParams.getAll("scene_tags").map(clean).filter(Boolean),
    sub_category: searchParams.getAll("sub_category").map(clean).filter(Boolean),
    region_filter_label: searchParams.getAll("region_filter_label").map(clean).filter(Boolean),
    price_level: clean(searchParams.get("price_level"))
  };
}

function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function clean(value: string | null) {
  return String(value ?? "").trim();
}

function escapeLike(value: string) {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}
