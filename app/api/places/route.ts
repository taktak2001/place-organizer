import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const supabase = getSupabaseAdmin();
    let query = supabase.from("places").select(
      `
      *,
      place_classifications(*),
      source_links(*)
    `
    );

    const search = searchParams.get("search");
    if (search) query = query.ilike("name", `%${search}%`);
    const requestedSort = searchParams.get("sort") ?? "created_at";
    const sort = ["created_at", "rating", "name"].includes(requestedSort) ? requestedSort : "created_at";
    query = query.order(sort, { ascending: sort === "name" });

    const { data, error } = await query.limit(500);
    if (error) throw error;

    const filtered = (data ?? []).filter((place) => {
      const classification = Array.isArray(place.place_classifications) ? place.place_classifications[0] : place.place_classifications;
      const links = (place.source_links ?? []).filter((link: { active: boolean }) => link.active);
      return matchesArchiveView(searchParams.get("archive_view") ?? "normal", place) &&
        matches(searchParams.get("main_category"), classification?.main_category) &&
        matches(searchParams.get("sub_category"), classification?.sub_category) &&
        matches(searchParams.get("visited_status"), classification?.visited_status) &&
        matches(searchParams.get("area_label"), classification?.area_label) &&
        matches(searchParams.get("travel_region"), classification?.travel_region) &&
        matches(searchParams.get("enrichment_status"), place.enrichment_status) &&
        matches(searchParams.get("source_list_name"), links.map((link: { source_list_name: string | null }) => link.source_list_name).join(" ")) &&
        matches(searchParams.get("scene_tags"), (classification?.scene_tags ?? []).join(" "));
    });

    return NextResponse.json({ places: filtered });
  } catch (error) {
    return NextResponse.json({ error: String(error), places: [] }, { status: 500 });
  }
}

function matches(filter: string | null, value: string | null | undefined) {
  if (!filter) return true;
  return (value ?? "").toLowerCase().includes(filter.toLowerCase());
}

function matchesArchiveView(filter: string, place: { is_archived?: boolean | null }) {
  const archived = place.is_archived === true;
  if (filter === "all") return true;
  if (filter === "archived") return archived;
  return !archived;
}
