import Link from "next/link";
import { ExternalLink, Search, SlidersHorizontal } from "lucide-react";
import { ja, jaCategory, jaDisplay, jaGooglePlaceTypes, jaSceneTag, jaStatus } from "@/lib/i18n/ja";
import { googleDisplayName, googleMapsUri, isCandidateOnly, preferredGoogleMapsUrl } from "@/lib/import/source-fields";
import { safeQuery } from "@/lib/supabase/queries";
import type { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const CATEGORY_ORDER = ["Art", "Cafe", "Restaurant", "Fashion", "Hotel", "Bath", "Other"];

type SearchParams = Record<string, string | string[] | undefined>;
type PlaceRow = Record<string, unknown>;

type PlacesData = {
  places: PlaceRow[];
  filterOptions: {
    mainCategories: string[];
    subCategories: string[];
    sourceLists: string[];
    sceneTags: string[];
    travelRegions: string[];
    areaLabels: string[];
    visitedStatuses: string[];
    enrichmentStatuses: string[];
  };
};

export default async function PlacesPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = normalizeSearchParams(searchParams);
  const { data, error } = await safeQuery<PlacesData>({ places: [], filterOptions: emptyOptions() }, async (supabase) => {
    const places = await fetchAllPlaces(supabase);
    return { places, filterOptions: buildFilterOptions(places) };
  });

  const filtered = data.places.filter((place) => placeMatches(place, filters));
  const sorted = sortPlaces(filtered, filters.sort);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const visiblePlaces = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium uppercase text-moss">{ja.places.eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold">{ja.places.title}</h1>
      </div>

      {error ? <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</div> : null}

      <QuickFilters />

      <form className="rounded-lg border border-stone-300 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label>
            <span className="text-xs font-medium uppercase text-stone-600">{ja.places.search}</span>
            <div className="mt-1 flex items-center gap-2 rounded-md border border-stone-300 px-3">
              <Search className="h-4 w-4 text-stone-500" />
              <input name="search" defaultValue={filters.search} className="h-12 w-full bg-transparent outline-none md:h-10" placeholder={ja.places.name} />
            </div>
          </label>
          <button className="h-12 self-end rounded-md bg-ink px-5 text-sm font-semibold text-white md:h-10">{ja.places.apply}</button>
        </div>

        <details className="mt-3 rounded-md border border-stone-200 bg-paper p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
            <SlidersHorizontal className="h-4 w-4" />
            フィルタを開く
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-4 lg:grid-cols-6">
            <SelectFilter name="main_category" label={ja.places.category} value={filters.main_category} options={data.filterOptions.mainCategories} />
            <SelectFilter name="source_list_name" label={ja.places.sourceList} value={filters.source_list_name} options={data.filterOptions.sourceLists} />
            <SelectFilter name="sub_category" label={ja.places.subCategory} value={filters.sub_category} options={data.filterOptions.subCategories} />
            <SceneTagFilter selected={filters.scene_tags} options={data.filterOptions.sceneTags} />
            <SelectFilter name="area_label" label={ja.places.area} value={filters.area_label} options={data.filterOptions.areaLabels} />
            <SelectFilter name="travel_region" label={ja.places.travelRegion} value={filters.travel_region} options={data.filterOptions.travelRegions} />
            <SelectFilter name="visited_status" label={ja.places.visitedStatus} value={filters.visited_status} options={data.filterOptions.visitedStatuses} />
            <DataStatusFilter value={filters.data_status} />
            <SelectFilter name="enrichment_status" label={ja.places.enrichmentStatus} value={filters.enrichment_status} options={data.filterOptions.enrichmentStatuses} />
            <PresenceFilter name="rating_presence" label={ja.places.ratingFilter} value={filters.rating_presence} anyLabel={ja.places.ratingAny} withLabel={ja.places.ratingWith} withoutLabel={ja.places.ratingWithout} />
            <PresenceFilter name="address_presence" label={ja.places.addressFilter} value={filters.address_presence} anyLabel={ja.places.addressAny} withLabel={ja.places.addressWith} withoutLabel={ja.places.addressWithout} />
            <ArchiveFilter value={filters.archive_view} />
            <label className="flex h-12 items-center gap-2 self-end rounded-md border border-stone-300 bg-white px-3 text-sm md:h-10">
              <input type="checkbox" name="needs_review_only" value="1" defaultChecked={filters.needs_review_only === "1"} />
              {ja.places.reviewOnly}
            </label>
            <label>
              <span className="text-xs font-medium uppercase text-stone-600">{ja.places.sort}</span>
              <select name="sort" defaultValue={filters.sort} className="mt-1 h-12 w-full rounded-md border border-stone-300 bg-white px-3 md:h-10">
                <option value="recommended">{ja.places.recommended}</option>
                <option value="name">{ja.places.name}</option>
                <option value="category">{ja.places.categorySort}</option>
                <option value="created_at">{ja.places.created}</option>
                <option value="updated_at">{ja.places.updated}</option>
              </select>
            </label>
            <input type="hidden" name="page" value="1" />
          </div>
        </details>
      </form>

      <div className="flex flex-col gap-2 rounded-lg border border-stone-300 bg-white p-4 text-sm text-stone-700 md:flex-row md:items-center md:justify-between">
        <div>
          絞り込み結果: <span className="font-semibold text-ink">{filtered.length}</span>件
          <span className="ml-2 text-stone-500">全{data.places.length}件中</span>
        </div>
        <div>
          {page}/{totalPages}ページ、{PAGE_SIZE}件ずつ表示
        </div>
      </div>

      <div className="grid gap-3">
        {visiblePlaces.map((place) => (
          <PlaceCard key={String(place.id)} place={place} />
        ))}
        {visiblePlaces.length === 0 ? <div className="rounded-lg border border-stone-300 bg-white p-6 text-sm text-stone-600">{ja.places.noPlacesFound}</div> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} filters={filters} />
    </div>
  );
}

function PlaceCard({ place }: { place: PlaceRow }) {
  const classification = firstRelated(place.place_classifications);
  const links = activeLinks(place.source_links);
  const openingHours = openingHoursSummary(place);
  const mapsHref = googleMapsHref(place);
  const candidateOnly = isCandidateOnly(place.raw_google);
  const candidateHref = googleMapsUri(place.raw_google);
  return (
    <article className="rounded-lg border border-stone-300 bg-white p-3 shadow-sm md:p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <Link href={`/places/${String(place.id)}`} className="min-w-0 flex-1 text-lg font-semibold leading-snug text-ink hover:text-moss">
              {String(place.name)}
            </Link>
            <span className="rounded-md bg-paper px-2 py-1 text-xs text-stone-700">{jaCategory(classification?.main_category ?? "Other")}</span>
            {place.enrichment_status === "source_url_confirmed" ? (
              <span className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-700">
                {jaStatus("source_url_confirmed")}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {classification?.sub_category ? <span className="rounded-md border border-stone-300 px-2 py-0.5 text-xs">{jaDisplay(classification.sub_category)}</span> : null}
            {links.map((link) => (
              <span key={String(link.id ?? `${place.id}-${link.source_list_name}`)} className="rounded-md border border-stone-300 px-2 py-0.5 text-xs">
                {jaDisplay(link.source_list_name)}
              </span>
            ))}
          </div>
          <SceneTagBadges tags={sceneTags(classification)} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-stone-700 md:grid-cols-4">
            <Meta label={ja.places.area} value={classification?.area_label ?? classification?.ward} />
            <Meta label={ja.places.travelRegion} value={classification?.travel_region} />
            <Meta label={ja.places.visitedStatus} value={jaStatus(classification?.visited_status)} />
            <Meta label={ja.places.enrichmentStatus} value={jaStatus(place.enrichment_status)} />
          </div>
          <details className="mt-3 rounded-md border border-stone-200 bg-paper px-3 py-2 text-sm text-stone-700">
            <summary className="cursor-pointer font-medium">詳細情報</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-4">
              <Meta label={ja.placeDetail.address} value={candidateOnly ? null : place.address} />
              <Meta label={ja.places.rating} value={candidateOnly ? null : ratingLabel(place.rating, place.user_ratings_total)} />
              <Meta label={ja.places.googleCategory} value={candidateOnly ? "補完候補" : googleTypeLabel(place)} />
              <Meta label={ja.places.openingHours} value={candidateOnly ? null : openingHours} />
              {place.website_url ? (
                <div>
                  <div className="text-xs text-stone-500">{ja.places.website}</div>
                  <a href={String(place.website_url)} target="_blank" rel="noreferrer" className="font-medium text-moss">{ja.places.openWebsite}</a>
                </div>
              ) : null}
            </div>
          </details>
          <CandidateDetails place={place} />
        </div>
        <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-end">
          {mapsHref ? (
            <a href={mapsHref} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-ink lg:h-10">
              Googleマップで開く
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          {candidateOnly && candidateHref ? (
            <a href={candidateHref} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-medium text-ink hover:border-moss lg:h-10">
              補完候補を開く
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <Link href={`/places/${String(place.id)}`} className="inline-flex h-12 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-ink lg:h-10">
            {ja.places.viewDetail}
          </Link>
        </div>
      </div>
    </article>
  );
}

function QuickFilters() {
  const items = [
    { label: "行ってみたい", href: "/places?source_list_name=%E8%A1%8C%E3%81%A3%E3%81%A6%E3%81%BF%E3%81%9F%E3%81%84&sort=recommended" },
    { label: "Art", href: "/places?main_category=Art&sort=recommended" },
    { label: "Cafe", href: "/places?main_category=Cafe&sort=recommended" },
    { label: "Restaurant", href: "/places?main_category=Restaurant&sort=recommended" },
    { label: "Fashion", href: "/places?main_category=Fashion&sort=recommended" },
    { label: "東京", href: "/places?travel_region=%E6%9D%B1%E4%BA%AC&sort=recommended" },
    { label: "京都", href: "/places?travel_region=%E4%BA%AC%E9%83%BD&sort=recommended" },
    { label: "Paris", href: "/places?travel_region=Paris&sort=recommended" },
    { label: "Seoul", href: "/places?travel_region=Seoul&sort=recommended" },
    { label: "Restaurant × デート", href: "/places?main_category=Restaurant&scene_tags=Date&sort=recommended" },
    { label: "Restaurant × 一人", href: "/places?main_category=Restaurant&scene_tags=Solo&sort=recommended" },
    { label: "Restaurant × 会食", href: "/places?main_category=Restaurant&scene_tags=Business&sort=recommended" }
  ];
  return (
    <section className="rounded-lg border border-stone-300 bg-white p-3">
      <div className="mb-2 text-xs font-medium uppercase text-stone-600">クイックフィルタ</div>
      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className="inline-flex h-10 shrink-0 items-center rounded-full border border-stone-300 bg-paper px-4 text-sm font-medium text-ink hover:border-moss hover:text-moss">
            {item.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function PresenceFilter({ name, label, value, anyLabel, withLabel, withoutLabel }: { name: string; label: string; value: string; anyLabel: string; withLabel: string; withoutLabel: string }) {
  return (
    <label>
      <span className="text-xs font-medium uppercase text-stone-600">{label}</span>
      <select name={name} defaultValue={value} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">
        <option value="">{anyLabel}</option>
        <option value="with">{withLabel}</option>
        <option value="without">{withoutLabel}</option>
      </select>
    </label>
  );
}

function ArchiveFilter({ value }: { value: string }) {
  return (
    <label>
      <span className="text-xs font-medium uppercase text-stone-600">{ja.places.archiveFilter}</span>
      <select name="archive_view" defaultValue={value} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">
        <option value="normal">{ja.places.archiveNormal}</option>
        <option value="archived">{ja.places.archiveArchived}</option>
        <option value="all">{ja.places.archiveAll}</option>
      </select>
    </label>
  );
}

function DataStatusFilter({ value }: { value: string }) {
  return (
    <label>
      <span className="text-xs font-medium uppercase text-stone-600">{ja.places.dataStatus}</span>
      <select name="data_status" defaultValue={value} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">
        <option value="">{ja.places.dataStatusAll}</option>
        <option value="enriched">{ja.places.dataStatusEnriched}</option>
        <option value="source_url_confirmed">{ja.places.dataStatusSourceUrlConfirmed}</option>
        <option value="coordinate_point">{ja.places.dataStatusCoordinatePoint}</option>
        <option value="needs_review">{ja.places.dataStatusNeedsReview}</option>
        <option value="archived">{ja.places.dataStatusArchived}</option>
      </select>
    </label>
  );
}

function CandidateDetails({ place }: { place: PlaceRow }) {
  if (place.enrichment_status !== "source_url_confirmed") return null;
  const candidateName = googleDisplayName(place.raw_google);
  const candidateHref = googleMapsUri(place.raw_google);
  const candidateType = jaGooglePlaceTypes(candidateRawValue(place.raw_google, "primaryType") ?? place.primary_type, candidateRawValue(place.raw_google, "types") ?? place.types);
  if (!candidateName && !candidateHref && !candidateType) return null;
  return (
    <details className="mt-3 rounded-md border border-stone-200 bg-paper px-3 py-2 text-sm text-stone-700">
      <summary className="cursor-pointer font-medium">{jaStatus("candidate_only")}</summary>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <Meta label="候補名" value={candidateName} />
        <Meta label={ja.places.googleCategory} value={candidateType} />
        <div>
          <div className="text-xs text-stone-500">候補リンク</div>
          {candidateHref ? (
            <a href={candidateHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-moss">
              補完候補を開く
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <div className="text-stone-400">未分類</div>
          )}
        </div>
      </div>
    </details>
  );
}

function SceneTagFilter({ selected, options }: { selected: string[]; options: string[] }) {
  const visibleOptions = options.length > 0 ? options : ["Date", "Business", "Solo", "Casual", "Group", "Travel", "High-end", "Local"];
  return (
    <fieldset className="md:col-span-2 lg:col-span-3">
      <legend className="text-xs font-medium uppercase text-stone-600">{ja.places.scene}</legend>
      <div className="mt-1 flex min-h-10 flex-wrap gap-2 rounded-md border border-stone-300 bg-white px-2 py-2">
        {visibleOptions.map((tag) => (
          <label key={tag} className="inline-flex items-center gap-1 rounded-md bg-paper px-2 py-1 text-xs text-stone-800">
            <input type="checkbox" name="scene_tags" value={tag} defaultChecked={selected.includes(tag)} />
            {jaSceneTag(tag)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SceneTagBadges({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="rounded-md bg-moss/10 px-2 py-0.5 text-xs font-medium text-moss">
          {jaSceneTag(tag)}
        </span>
      ))}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: unknown }) {
  const isEmpty = isEmptyDisplayValue(value);
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={isEmpty ? "text-stone-400" : "font-medium text-ink"}>{jaDisplay(value)}</div>
    </div>
  );
}

function SelectFilter({ name, label, value, options }: { name: string; label: string; value: string; options: string[] }) {
  return (
    <label>
      <span className="text-xs font-medium uppercase text-stone-600">{label}</span>
      <select name={name} defaultValue={value} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">
        <option value="">すべて</option>
        {options.map((option) => (
          <option key={option} value={option}>{labelOption(name, option)}</option>
        ))}
      </select>
    </label>
  );
}

function Pagination({ page, totalPages, filters }: { page: number; totalPages: number; filters: ReturnType<typeof normalizeSearchParams> }) {
  const previous = page > 1 ? buildPlacesUrl(filters, page - 1) : null;
  const next = page < totalPages ? buildPlacesUrl(filters, page + 1) : null;
  return (
    <div className="flex items-center justify-between">
      {previous ? <Link href={previous} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium">前へ</Link> : <span />}
      {next ? <Link href={next} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium">もっと見る</Link> : <span />}
    </div>
  );
}

async function fetchAllPlaces(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("*, place_classifications(*), source_links(*)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function buildFilterOptions(places: PlaceRow[]): PlacesData["filterOptions"] {
  const classifications = places.map((place) => firstRelated(place.place_classifications));
  const links = places.flatMap((place) => activeLinks(place.source_links));
  return {
    mainCategories: uniqueOptions(classifications.map((item) => item?.main_category)),
    subCategories: uniqueOptions(classifications.map((item) => item?.sub_category)),
    sourceLists: uniqueOptions(links.map((link) => link.source_list_name)),
    sceneTags: uniqueOptions(classifications.flatMap((item) => sceneTags(item))),
    travelRegions: uniqueOptions(classifications.map((item) => item?.travel_region)),
    areaLabels: uniqueOptions(classifications.map((item) => item?.area_label)),
    visitedStatuses: uniqueOptions(classifications.map((item) => item?.visited_status)),
    enrichmentStatuses: uniqueOptions(places.map((place) => place.enrichment_status))
  };
}

function emptyOptions(): PlacesData["filterOptions"] {
  return {
    mainCategories: [],
    subCategories: [],
    sourceLists: [],
    sceneTags: [],
    travelRegions: [],
    areaLabels: [],
    visitedStatuses: [],
    enrichmentStatuses: []
  };
}

function normalizeSearchParams(searchParams: SearchParams) {
  const sort = valueOf(searchParams.sort);
  const page = Number(valueOf(searchParams.page));
  return {
    search: valueOf(searchParams.search),
    main_category: valueOf(searchParams.main_category),
    sub_category: valueOf(searchParams.sub_category),
    source_list_name: valueOf(searchParams.source_list_name),
    scene_tags: valuesOf(searchParams.scene_tags),
    visited_status: valueOf(searchParams.visited_status),
    area_label: valueOf(searchParams.area_label),
    travel_region: valueOf(searchParams.travel_region),
    enrichment_status: valueOf(searchParams.enrichment_status),
    data_status: valueOf(searchParams.data_status),
    rating_presence: valueOf(searchParams.rating_presence),
    address_presence: valueOf(searchParams.address_presence),
    archive_view: normalizeArchiveView(valueOf(searchParams.archive_view)),
    needs_review_only: valueOf(searchParams.needs_review_only),
    sort: ["recommended", "created_at", "updated_at", "category", "name"].includes(sort) ? sort : "recommended",
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  };
}

function sortPlaces(places: PlaceRow[], sort: string) {
  return [...places].sort((a, b) => {
    if (sort === "name") return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
    if (sort === "category") return categoryRank(a) - categoryRank(b) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
    if (sort === "updated_at") return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    if (sort === "recommended") {
      return wantRank(b) - wantRank(a) ||
        categoryRank(a) - categoryRank(b) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
    }
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
}

function placeMatches(place: PlaceRow, filters: ReturnType<typeof normalizeSearchParams>) {
  const classification = firstRelated(place.place_classifications);
  const links = activeLinks(place.source_links);
  return matches(filters.search, place.name) &&
    (filters.data_status === "archived" || matchesArchiveView(filters.archive_view, place)) &&
    matches(filters.main_category, classification?.main_category) &&
    matches(filters.sub_category, classification?.sub_category) &&
    matches(filters.source_list_name, links.map((link) => link.source_list_name).join(" ")) &&
    matchesSceneTags(filters.scene_tags, sceneTags(classification)) &&
    matches(filters.visited_status, classification?.visited_status) &&
    matches(filters.area_label, classification?.area_label) &&
    matches(filters.travel_region, classification?.travel_region) &&
    matchesDataStatus(filters.data_status, place) &&
    matches(filters.enrichment_status, place.enrichment_status) &&
    matchesPresence(filters.rating_presence, place.rating) &&
    matchesPresence(filters.address_presence, place.address) &&
    (!filters.needs_review_only || place.enrichment_status === "needs_review");
}

function normalizeArchiveView(value: string) {
  return ["normal", "archived", "all"].includes(value) ? value : "normal";
}

function matchesArchiveView(filter: string, place: PlaceRow) {
  const archived = place.is_archived === true;
  if (filter === "all") return true;
  if (filter === "archived") return archived;
  return !archived;
}

function matchesDataStatus(filter: string, place: PlaceRow) {
  if (!filter) return true;
  if (filter === "archived") return place.is_archived === true;
  return place.enrichment_status === filter;
}

function buildPlacesUrl(filters: ReturnType<typeof normalizeSearchParams>, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page })) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) params.append(key, item);
      }
    } else if (value) {
      params.set(key, String(value));
    }
  }
  return `/places?${params.toString()}`;
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function valuesOf(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function firstRelated(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function activeLinks(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((link) => typeof link === "object" && link !== null && (link as { active?: boolean }).active !== false) as Record<string, unknown>[] : [];
}

function uniqueOptions(values: unknown[]) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function matches(filter: string, value: unknown) {
  if (!filter) return true;
  return String(value ?? "").toLowerCase().includes(filter.toLowerCase());
}

function matchesSceneTags(filters: string[], tags: string[]) {
  if (filters.length === 0) return true;
  return filters.every((filter) => tags.includes(filter));
}

function labelOption(name: string, option: string) {
  if (name === "main_category") return jaCategory(option);
  if (name === "scene_tags") return jaSceneTag(option);
  if (name === "visited_status" || name === "enrichment_status") return jaStatus(option);
  return jaDisplay(option);
}

function categoryRank(place: PlaceRow) {
  const classification = firstRelated(place.place_classifications);
  const category = String(classification?.main_category ?? "Other");
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function wantRank(place: PlaceRow) {
  const links = activeLinks(place.source_links);
  return links.some((link) => String(link.source_list_name ?? "").includes("行ってみたい")) ? 1 : 0;
}

function matchesPresence(filter: string, value: unknown) {
  if (!filter) return true;
  const exists = value !== null && value !== undefined && String(value).trim() !== "";
  return filter === "with" ? exists : !exists;
}

function ratingLabel(rating: unknown, total: unknown) {
  if (rating === null || rating === undefined || String(rating).trim() === "") return null;
  const totalText = total === null || total === undefined ? "" : ` (${String(total)}件)`;
  return `${String(rating)}${totalText}`;
}

function openingHoursSummary(place: PlaceRow) {
  const current = jsonRecord(place.current_opening_hours) ?? jsonRecord(place.regular_opening_hours);
  const weekdayDescriptions = current?.weekdayDescriptions;
  if (Array.isArray(weekdayDescriptions) && weekdayDescriptions.length > 0) {
    return weekdayDescriptions.slice(0, 2).join(" / ");
  }
  const openNow = current?.openNow;
  if (typeof openNow === "boolean") return openNow ? "営業中" : "営業時間外";
  return null;
}

function jsonRecord(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function candidateRawValue(rawGoogle: unknown, key: string) {
  const raw = jsonRecord(rawGoogle);
  const candidate = jsonRecord(raw?.candidate_place);
  return candidate?.[key] ?? raw?.[key];
}

function googleTypeLabel(place: PlaceRow) {
  return jaGooglePlaceTypes(place.primary_type, place.types);
}

function googleMapsHref(place: PlaceRow) {
  return preferredGoogleMapsUrl({
    rawGoogle: place.raw_google,
    placeGoogleMapsUrl: place.google_maps_url,
    rawImport: place.raw_import,
    latitude: place.latitude,
    longitude: place.longitude
  });
}

function sceneTags(classification: Record<string, unknown> | null) {
  return Array.isArray(classification?.scene_tags)
    ? classification.scene_tags.map(String).filter(Boolean)
    : [];
}

function isEmptyDisplayValue(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "unknown" || text === "未分類";
}
