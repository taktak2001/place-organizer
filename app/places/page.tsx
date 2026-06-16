import Link from "next/link";
import { Search } from "lucide-react";
import { PlaceBrowseCard } from "@/components/PlaceBrowseCard";
import { ja, jaCategory } from "@/lib/i18n/ja";
import { activeLinks, CATEGORY_ORDER, fetchAllPlaces, firstRelated, isWantToGo, matchesArchive, matchesText, PAGE_SIZE, sortRecommended, type PlaceRow } from "@/lib/places/browse";
import { safeQuery } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PlacesPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = normalizeSearchParams(searchParams);
  const { data: places, error } = await safeQuery<PlaceRow[]>([], fetchAllPlaces);
  const filtered = sortRecommended(places.filter((place) => placeMatches(place, filters)));
  const page = Math.min(filters.page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const visiblePlaces = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-medium uppercase text-moss">{ja.places.eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold">{ja.places.title}</h1>
        <p className="mt-2 text-sm text-stone-700">全体から名前・カテゴリ・行ってみたいで素早く探します。細かい条件はカテゴリ別ページで指定できます。</p>
      </header>

      {error ? <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{localizeError(error)}</div> : null}

      <QuickFilters filters={filters} />

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
        {filters.categories.map((category) => <input key={category} type="hidden" name="categories" value={category} />)}
        {filters.want ? <input type="hidden" name="want" value="1" /> : null}
      </form>

      <div className="flex flex-col gap-2 rounded-lg border border-stone-300 bg-white p-4 text-sm text-stone-700 md:flex-row md:items-center md:justify-between">
        <div>
          絞り込み結果: <span className="font-semibold text-ink">{filtered.length}</span>件
          <span className="ml-2 text-stone-500">全{places.filter(matchesArchive).length}件中</span>
        </div>
        <Link href="/categories" className="font-semibold text-moss">カテゴリ別に探す</Link>
      </div>

      <div className="grid gap-3">
        {visiblePlaces.map((place) => <PlaceBrowseCard key={String(place.id)} place={place} />)}
        {visiblePlaces.length === 0 ? <div className="rounded-lg border border-stone-300 bg-white p-6 text-sm text-stone-600">{ja.places.noPlacesFound}</div> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} filters={filters} />
    </div>
  );
}

function QuickFilters({ filters }: { filters: ReturnType<typeof normalizeSearchParams> }) {
  const items = [
    { label: "行ってみたい", type: "want" },
    ...CATEGORY_ORDER.map((category) => ({ label: jaCategory(category), category }))
  ];
  return (
    <section className="rounded-lg border border-stone-300 bg-white p-3">
      <div className="mb-2 text-xs font-medium uppercase text-stone-600">クイックフィルタ</div>
      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
        {items.map((item) => {
          const active = "type" in item ? filters.want : filters.categories.includes(item.category);
          const href = "type" in item ? buildPlacesUrl({ ...filters, want: !filters.want, page: 1 }) : buildPlacesUrl(toggleCategory(filters, item.category));
          return (
            <Link
              key={item.label}
              href={href}
              className={`inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold ${active ? "border-moss bg-moss text-white" : "border-stone-300 bg-paper text-ink hover:border-moss hover:text-moss"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Pagination({ page, totalPages, filters }: { page: number; totalPages: number; filters: ReturnType<typeof normalizeSearchParams> }) {
  const previous = page > 1 ? buildPlacesUrl({ ...filters, page: page - 1 }) : null;
  const next = page < totalPages ? buildPlacesUrl({ ...filters, page: page + 1 }) : null;
  return (
    <div className="flex items-center justify-between">
      {previous ? <Link href={previous} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium">前へ</Link> : <span />}
      <span className="text-sm text-stone-600">{page}/{totalPages}</span>
      {next ? <Link href={next} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium">もっと見る</Link> : <span />}
    </div>
  );
}

function placeMatches(place: PlaceRow, filters: ReturnType<typeof normalizeSearchParams>) {
  const classification = firstRelated(place.place_classifications);
  const category = String(classification?.main_category ?? "Other");
  const categoriesOk = filters.categories.length === 0 || filters.categories.includes(category);
  return matchesArchive(place) &&
    categoriesOk &&
    (!filters.want || isWantToGo(place)) &&
    matchesText(filters.search, [place.name, place.address, classification?.area_label, classification?.travel_region, ...activeLinks(place.source_links).map((link) => link.source_list_name)].join(" "));
}

function normalizeSearchParams(searchParams: SearchParams) {
  const page = Number(valueOf(searchParams.page));
  return {
    search: valueOf(searchParams.search),
    categories: valuesOf(searchParams.categories).filter((category) => CATEGORY_ORDER.includes(category)),
    want: valueOf(searchParams.want) === "1",
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  };
}

function toggleCategory(filters: ReturnType<typeof normalizeSearchParams>, category: string) {
  const categories = filters.categories.includes(category)
    ? filters.categories.filter((item) => item !== category)
    : [...filters.categories, category];
  return { ...filters, categories, page: 1 };
}

function buildPlacesUrl(filters: ReturnType<typeof normalizeSearchParams>) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  for (const category of filters.categories) params.append("categories", category);
  if (filters.want) params.set("want", "1");
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/places?${query}` : "/places";
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function valuesOf(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function localizeError(error: string) {
  if (error.includes("NEXT_PUBLIC_SUPABASE_URL または NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    return "Supabase公開接続情報が未設定です。NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。";
  }
  return error;
}
