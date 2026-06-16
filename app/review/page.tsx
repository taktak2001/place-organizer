import Link from "next/link";
import { ReviewClient, type ReviewPlace } from "@/components/ReviewClient";
import { ja } from "@/lib/i18n/ja";
import { reviewSourceUrlCandidate } from "@/lib/import/source-url-review";
import { safeQuery } from "@/lib/supabase/queries";
import { isAdminEnabled, type getSupabaseRead } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const REVIEW_STATUSES = ["place_id_candidate", "source_conflict", "needs_review", "not_found", "error", "coordinate_point", "source_url_confirmed"] as const;
const PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;
type ReviewStatus = typeof REVIEW_STATUSES[number];

type ReviewData = {
  counts: Record<ReviewStatus, number>;
  places: ReviewPlace[];
};

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isAdminEnabled()) {
    return (
      <div className="rounded-lg border border-line bg-white p-6">
        <h1 className="text-xl font-semibold">{ja.review.title}</h1>
        <p className="mt-2 text-sm text-stone-700">公開環境ではレビュー操作を無効にしています。</p>
        <Link href="/places" className="mt-4 inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-[#222A31]">
          {ja.dashboard.browsePlaces}
        </Link>
      </div>
    );
  }

  const status = normalizeStatus(valueOf(searchParams.status));
  const mode = valueOf(searchParams.mode) === "list" ? "list" : "card";
  const page = Math.max(1, Number(valueOf(searchParams.page)) || 1);

  const { data, error } = await safeQuery<ReviewData>({ counts: emptyCounts(), places: [] }, async (supabase) => ({
    counts: await fetchCounts(supabase),
    places: await fetchReviewPlaces(supabase, status, page)
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase text-moss">{ja.review.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold">{ja.review.title}</h1>
          <p className="mt-2 max-w-3xl text-stone-700">{ja.review.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/review?status=${status}&mode=${mode}&page=${page}&refresh=${Date.now()}`} className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-medium">
            {ja.review.reload}
          </Link>
          <Link href="/places?needs_review_only=1" className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-medium">
            {ja.places.reviewOnly}
          </Link>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</div> : null}

      <div className="flex flex-wrap gap-2">
        <Link href={`/review?status=${status}&mode=card`} className={`rounded-md border px-3 py-2 text-sm ${mode === "card" ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>{ja.review.cardMode}</Link>
        <Link href={`/review?status=${status}&mode=list`} className={`rounded-md border px-3 py-2 text-sm ${mode === "list" ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>{ja.review.listMode}</Link>
      </div>

      <ReviewClient places={data.places} mode={mode} status={status} initialCounts={data.counts} />

      {mode === "list" ? (
        <div className="flex items-center justify-between">
          {page > 1 ? <Link href={`/review?status=${status}&mode=list&page=${page - 1}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm">前へ</Link> : <span />}
          {data.places.length === PAGE_SIZE ? <Link href={`/review?status=${status}&mode=list&page=${page + 1}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm">次へ</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}

async function fetchCounts(supabase: ReturnType<typeof getSupabaseRead>) {
  const entries = await Promise.all(REVIEW_STATUSES.map(async (status) => {
    if (status === "source_conflict") {
      return [status, (await fetchSourceConflictPlaces(supabase)).length] as const;
    }
    if (status === "place_id_candidate") {
      return [status, await countPlaceIdCandidates(supabase)] as const;
    }
    const { count, error } = await supabase.from("places").select("id", { count: "exact", head: true }).eq("enrichment_status", status);
    if (error) throw error;
    return [status, count ?? 0] as const;
  }));
  return Object.fromEntries(entries) as Record<ReviewStatus, number>;
}

async function fetchReviewPlaces(supabase: ReturnType<typeof getSupabaseRead>, status: ReviewStatus, page: number) {
  if (status === "source_conflict") {
    return fetchSourceConflictPlaces(supabase, page);
  }
  if (status === "place_id_candidate") {
    return fetchPlaceIdCandidatePlaces(supabase, page);
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, error } = await supabase
    .from("places")
    .select("id, name, address, latitude, longitude, google_maps_url, website_url, rating, user_ratings_total, primary_type, types, enrichment_status, raw_import, raw_google, place_classifications(main_category, prefecture, city, ward, area_label, travel_region, reason, confidence), source_links(id, source_list_name, active)")
    .eq("enrichment_status", status)
    .order("updated_at", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return (data ?? []) as unknown as ReviewPlace[];
}

function emptyCounts() {
  return { place_id_candidate: 0, source_conflict: 0, needs_review: 0, not_found: 0, error: 0, coordinate_point: 0, source_url_confirmed: 0 };
}

async function countPlaceIdCandidates(supabase: ReturnType<typeof getSupabaseRead>) {
  try {
    const { count, error } = await supabase
      .from("places")
      .select("id", { count: "exact", head: true })
      .not("place_id_candidate", "is", null)
      .in("place_id_confidence", ["medium", "low"]);
    if (error) throw error;
    return count ?? 0;
  } catch (error) {
    if (isMissingColumnError(error)) return 0;
    throw error;
  }
}

async function fetchPlaceIdCandidatePlaces(supabase: ReturnType<typeof getSupabaseRead>, page: number) {
  const from = (page - 1) * PAGE_SIZE;
  try {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, address, latitude, longitude, google_maps_url, website_url, rating, user_ratings_total, primary_type, types, enrichment_status, raw_import, raw_google, normalized_place_id, place_id_confidence, place_id_review_reason, place_id_candidate, place_classifications(main_category, prefecture, city, ward, area_label, travel_region, reason, confidence), source_links(id, source_list_name, active)")
      .not("place_id_candidate", "is", null)
      .in("place_id_confidence", ["medium", "low"])
      .order("place_id_normalized_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    return (data ?? []) as unknown as ReviewPlace[];
  } catch (error) {
    if (isMissingColumnError(error)) return [];
    throw error;
  }
}

async function fetchSourceConflictPlaces(supabase: ReturnType<typeof getSupabaseRead>, page?: number) {
  const rows: ReviewPlace[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, address, latitude, longitude, google_maps_url, website_url, rating, user_ratings_total, primary_type, types, enrichment_status, raw_import, raw_google, place_classifications(main_category, prefecture, city, ward, area_label, travel_region, reason, confidence), source_links(id, source_list_name, active)")
      .eq("enrichment_status", "enriched")
      .order("updated_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as ReviewPlace[]));
    if (!data || data.length < 1000) break;
  }

  const conflicts = rows.filter((place) => reviewSourceUrlCandidate({
    name: place.name,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    google_maps_url: place.google_maps_url,
    raw_import: place.raw_import ?? null,
    raw_google: place.raw_google ?? null
  }).reasons.length > 0);

  if (!page) return conflicts;
  const from = (page - 1) * PAGE_SIZE;
  return conflicts.slice(from, from + PAGE_SIZE);
}

function normalizeStatus(status: string): ReviewStatus {
  return REVIEW_STATUSES.includes(status as ReviewStatus) ? status as ReviewStatus : "needs_review";
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isMissingColumnError(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42703";
}
