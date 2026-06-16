import Link from "next/link";
import { notFound } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { PlaceBrowseCard } from "@/components/PlaceBrowseCard";
import { RESTAURANT_CUISINE_TAGS } from "@/lib/classification/restaurant-cuisine";
import { jaCategory, jaCategoryTag, jaDisplay, jaSceneTag } from "@/lib/i18n/ja";
import { categoryFromSlug, categoryTags, fetchAllPlaces, firstRelated, isWantToGo, matchesArchive, matchesText, PAGE_SIZE, priceLevelLabel, sceneTags, sortRecommended, uniqueOptions, type PlaceRow } from "@/lib/places/browse";
import { safeQuery } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type SearchParams = Record<string, string | string[] | undefined>;

const SCENE_TAGS = ["Date", "Business", "Solo", "Casual", "Group", "Travel", "High-end", "Local"];
const ART_SUB_CATEGORIES = ["Museum", "Gallery", "Art Center", "Architecture", "Art Shop", "Public Art", "Foundation", "Archive / Library", "Other Art"];
const FASHION_TAGS = ["Minimal", "Mode", "Street", "Vintage", "Shoes", "Jewelry", "Select Shop", "Department Store", "Other"];
const CAFE_TAGS = ["Work-friendly", "Relax", "Coffee", "Sweets", "Bakery", "Spacious", "Takeout"];

export default async function CategoryPage({ params, searchParams }: { params: { slug: string }; searchParams: SearchParams }) {
  const category = categoryFromSlug(params.slug);
  if (!category) notFound();

  const filters = normalizeSearchParams(searchParams);
  const { data: places, error } = await safeQuery<PlaceRow[]>([], fetchAllPlaces, "getCategoryPlaces");
  const categoryPlaces = places.filter((place) => matchesArchive(place) && String(firstRelated(place.place_classifications)?.main_category ?? "Other") === category);
  const filtered = sortRecommended(categoryPlaces.filter((place) => placeMatches(place, category, filters)));
  const page = Math.min(filters.page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePlaces = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const regionOptions = uniqueOptions(categoryPlaces.map((place) => firstRelated(place.place_classifications)?.travel_region));
  const areaOptions = uniqueOptions(categoryPlaces.map((place) => firstRelated(place.place_classifications)?.area_label));
  const wantCount = categoryPlaces.filter(isWantToGo).length;
  const wantToggleHref = buildUrl(params.slug, { ...filters, want: !filters.want, page: 1 });
  const cuisineCounts = category === "Restaurant" ? countTags(categoryPlaces.flatMap((place) => categoryTags(firstRelated(place.place_classifications)))) : {};

  return (
    <div className="space-y-5">
      <header>
        <Link href="/categories" className="text-sm font-semibold text-moss">カテゴリ一覧へ</Link>
        <p className="mt-3 text-sm font-medium uppercase text-moss">{category}</p>
        <h1 className="mt-1 text-3xl font-semibold">{jaCategory(category)}</h1>
        <p className="mt-2 text-sm text-stone-700">行ってみたい {wantCount} / 全 {categoryPlaces.length}</p>
      </header>

      {error ? <pre className="whitespace-pre-wrap rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</pre> : null}

      <form className="rounded-lg border border-stone-300 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <label>
            <span className="text-xs font-medium uppercase text-stone-600">検索</span>
            <div className="mt-1 flex items-center gap-2 rounded-md border border-stone-300 px-3">
              <Search className="h-4 w-4 text-stone-500" />
              <input name="search" defaultValue={filters.search} className="h-12 w-full bg-transparent outline-none md:h-10" placeholder="場所名で検索" />
            </div>
          </label>
          <Link
            href={wantToggleHref}
            aria-pressed={filters.want}
            className={`flex h-12 items-center justify-center gap-2 self-end rounded-md border px-3 text-sm font-semibold transition active:scale-[0.99] md:h-10 ${filters.want ? "border-moss bg-moss text-white" : "border-stone-300 bg-paper text-ink hover:border-moss"}`}
          >
            <span aria-hidden="true">{filters.want ? "✓" : "□"}</span>
            行ってみたい
          </Link>
          <button className="h-12 self-end rounded-md bg-ink px-5 text-sm font-semibold text-white md:h-10">適用</button>
        </div>

        <details className="mt-3 rounded-md border border-stone-200 bg-paper p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
            <SlidersHorizontal className="h-4 w-4" />
            詳細フィルタ
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {category === "Restaurant" ? <CheckboxGroup name="category_tags" label="料理ジャンル" values={[...RESTAURANT_CUISINE_TAGS]} selected={filters.category_tags} labeler={jaCategoryTag} tone="cuisine" /> : null}
            {category === "Restaurant" ? <CheckboxGroup name="scene_tags" label="利用シーン" values={SCENE_TAGS} selected={filters.scene_tags} labeler={jaSceneTag} tone="scene" /> : null}
            {category === "Restaurant" ? <SelectFilter name="travel_region" label="地域" value={filters.travel_region} options={regionOptions} labeler={jaDisplay} /> : null}
            {category === "Restaurant" ? <SelectFilter name="price_level" label="価格帯" value={filters.price_level} options={["1", "2", "3", "4"]} labeler={priceLevelLabel} /> : null}
            {category === "Art" ? <CheckboxGroup name="sub_category" label="サブカテゴリ" values={ART_SUB_CATEGORIES} selected={filters.sub_category} labeler={jaDisplay} /> : null}
            {category === "Fashion" ? <CheckboxGroup name="category_tags" label="ジャンル" values={FASHION_TAGS} selected={filters.category_tags} labeler={jaCategoryTag} /> : null}
            {category === "Cafe" ? <CheckboxGroup name="category_tags" label="タグ" values={CAFE_TAGS} selected={filters.category_tags} labeler={jaCategoryTag} /> : null}
            {category !== "Restaurant" ? <SelectFilter name="travel_region" label="旅行地域" value={filters.travel_region} options={regionOptions} labeler={jaDisplay} /> : null}
            <SelectFilter name="area_label" label="エリア" value={filters.area_label} options={areaOptions} labeler={jaDisplay} />
          </div>
        </details>
      </form>

      {category === "Restaurant" ? (
        <section className="rounded-lg border border-stone-300 bg-white p-4">
          <h2 className="text-sm font-semibold text-ink">料理ジャンル別件数</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(cuisineCounts).length > 0 ? Object.entries(cuisineCounts).slice(0, 12).map(([tag, count]) => (
              <span key={tag} className="rounded-md bg-paper px-2 py-1 text-xs font-medium text-stone-800">
                {jaCategoryTag(tag)} <span className="text-stone-500">{count}</span>
              </span>
            )) : <span className="text-sm text-stone-500">まだ料理ジャンルがありません</span>}
          </div>
        </section>
      ) : null}

      <div className="rounded-lg border border-stone-300 bg-white p-4 text-sm text-stone-700">
        絞り込み結果: <span className="font-semibold text-ink">{filtered.length}</span>件
      </div>

      <div className="grid gap-3">
        {visiblePlaces.map((place) => <PlaceBrowseCard key={String(place.id)} place={place} mode="category" />)}
        {visiblePlaces.length === 0 ? <div className="rounded-lg border border-stone-300 bg-white p-6 text-sm text-stone-600">場所が見つかりません</div> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} filters={filters} slug={params.slug} />
    </div>
  );
}

function placeMatches(place: PlaceRow, category: string, filters: ReturnType<typeof normalizeSearchParams>) {
  const classification = firstRelated(place.place_classifications);
  return matchesText(filters.search, [place.name, place.address, classification?.area_label, classification?.travel_region].join(" ")) &&
    (!filters.want || isWantToGo(place)) &&
    (!filters.travel_region || String(classification?.travel_region ?? "") === filters.travel_region) &&
    (!filters.area_label || String(classification?.area_label ?? "") === filters.area_label) &&
    (filters.price_level === "" || String(place.price_level ?? "") === filters.price_level) &&
    (filters.scene_tags.length === 0 || filters.scene_tags.some((tag) => sceneTags(classification).includes(tag))) &&
    (filters.sub_category.length === 0 || filters.sub_category.includes(String(classification?.sub_category ?? ""))) &&
    (filters.category_tags.length === 0 || filters.category_tags.some((tag) => categoryTags(classification).includes(tag))) &&
    category.length > 0;
}

function CheckboxGroup({ name, label, values, selected, labeler, tone = "default" }: { name: string; label: string; values: string[]; selected: string[]; labeler: (value: unknown) => string; tone?: "default" | "cuisine" | "scene" }) {
  return (
    <fieldset className="md:col-span-2">
      <legend className="text-xs font-medium uppercase text-stone-600">{label}</legend>
      <div className="mt-1 flex min-h-10 flex-wrap gap-2 rounded-md border border-stone-300 bg-white px-2 py-2">
        {values.map((value) => (
          <label key={value} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${checkboxToneClass(tone, selected.includes(value))}`}>
            <input type="checkbox" name={name} value={value} defaultChecked={selected.includes(value)} />
            {labeler(value)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function checkboxToneClass(tone: "default" | "cuisine" | "scene", selected: boolean) {
  if (tone === "scene") return selected ? "bg-moss text-white" : "bg-moss/10 text-moss";
  if (tone === "cuisine") return selected ? "bg-clay text-white" : "bg-paper text-stone-800";
  return selected ? "bg-ink text-white" : "bg-paper text-stone-800";
}

function SelectFilter({ name, label, value, options, labeler }: { name: string; label: string; value: string; options: string[]; labeler: (value: unknown) => string }) {
  return (
    <label>
      <span className="text-xs font-medium uppercase text-stone-600">{label}</span>
      <select name={name} defaultValue={value} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">
        <option value="">すべて</option>
        {options.map((option) => (
          <option key={option} value={option}>{labeler(option)}</option>
        ))}
      </select>
    </label>
  );
}

function Pagination({ page, totalPages, filters, slug }: { page: number; totalPages: number; filters: ReturnType<typeof normalizeSearchParams>; slug: string }) {
  const previous = page > 1 ? buildUrl(slug, { ...filters, page: page - 1 }) : null;
  const next = page < totalPages ? buildUrl(slug, { ...filters, page: page + 1 }) : null;
  return (
    <div className="flex items-center justify-between">
      {previous ? <Link href={previous} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium">前へ</Link> : <span />}
      <span className="text-sm text-stone-600">{page}/{totalPages}</span>
      {next ? <Link href={next} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium">もっと見る</Link> : <span />}
    </div>
  );
}

function normalizeSearchParams(searchParams: SearchParams) {
  const page = Number(valueOf(searchParams.page));
  return {
    search: valueOf(searchParams.search),
    want: valueOf(searchParams.want) === "1",
    scene_tags: valuesOf(searchParams.scene_tags),
    sub_category: valuesOf(searchParams.sub_category),
    category_tags: valuesOf(searchParams.category_tags),
    price_level: valueOf(searchParams.price_level),
    travel_region: valueOf(searchParams.travel_region),
    area_label: valueOf(searchParams.area_label),
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  };
}

function buildUrl(slug: string, filters: ReturnType<typeof normalizeSearchParams>) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.want) params.set("want", "1");
  for (const tag of filters.scene_tags) params.append("scene_tags", tag);
  for (const sub of filters.sub_category) params.append("sub_category", sub);
  for (const tag of filters.category_tags) params.append("category_tags", tag);
  if (filters.price_level) params.set("price_level", filters.price_level);
  if (filters.travel_region) params.set("travel_region", filters.travel_region);
  if (filters.area_label) params.set("area_label", filters.area_label);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/category/${slug}?${query}` : `/category/${slug}`;
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function valuesOf(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function countTags(tags: string[]) {
  const counts = new Map<string, number>();
  for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")));
}
