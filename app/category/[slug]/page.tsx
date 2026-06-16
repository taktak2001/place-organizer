import Link from "next/link";
import { notFound } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { InfinitePlaceList } from "@/components/InfinitePlaceList";
import { REGION_FILTER_SECTIONS } from "@/lib/classification/display-region";
import { RESTAURANT_CUISINE_TAGS } from "@/lib/classification/restaurant-cuisine";
import { jaCategory, jaCategoryTag, jaDisplay, jaSceneTag } from "@/lib/i18n/ja";
import { categoryFromSlug, RESTAURANT_PRICE_BANDS, restaurantPriceBandLabel } from "@/lib/places/browse";

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
  const wantToggleHref = buildUrl(params.slug, { ...filters, want: !filters.want });

  return (
    <div className="space-y-5">
      <header>
        <Link href="/categories" className="text-sm font-semibold text-moss">カテゴリ一覧へ</Link>
        <p className="mt-3 text-sm font-medium uppercase text-moss">{category}</p>
        <div className="mt-1 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-paper text-ink">
            <CategoryIcon category={category} size={24} />
          </span>
          <h1 className="text-3xl font-semibold">{jaCategory(category)}</h1>
        </div>
        <p className="mt-2 text-sm text-stone-700">初期表示30件、スクロールで追加表示します。</p>
      </header>

      <form className="rounded-lg border border-line bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <label>
            <span className="text-xs font-medium uppercase text-stone-600">検索</span>
            <div className="mt-1 flex items-center gap-2 rounded-md border border-line px-3">
              <Search className="h-4 w-4 text-stone-500" />
              <input name="search" defaultValue={filters.search} className="h-12 w-full bg-transparent outline-none md:h-10" placeholder="場所名で検索" />
            </div>
          </label>
          <Link
            href={wantToggleHref}
            aria-pressed={filters.want}
            className={`flex h-12 items-center justify-center gap-2 self-end rounded-md border px-3 text-sm font-semibold transition active:scale-[0.99] md:h-10 ${filters.want ? "border-moss bg-moss text-white" : "border-line bg-paper text-ink hover:border-moss"}`}
          >
            <span aria-hidden="true">{filters.want ? "✓" : "□"}</span>
            行ってみたい
          </Link>
          <button className="h-12 self-end rounded-md bg-ink px-5 text-sm font-semibold text-white md:h-10">適用</button>
        </div>

        <details className="mt-3 rounded-md border border-line bg-paper p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
            <SlidersHorizontal className="h-4 w-4" />
            詳細フィルタ
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {category === "Restaurant" ? <CheckboxGroup name="category_tags" label="料理ジャンル" values={[...RESTAURANT_CUISINE_TAGS]} selected={filters.category_tags} labeler={jaCategoryTag} tone="cuisine" /> : null}
            {category === "Restaurant" ? <CheckboxGroup name="scene_tags" label="利用シーン" values={SCENE_TAGS} selected={filters.scene_tags} labeler={jaSceneTag} tone="scene" /> : null}
            {category === "Art" ? <CheckboxGroup name="sub_category" label="サブカテゴリ" values={ART_SUB_CATEGORIES} selected={filters.sub_category} labeler={jaDisplay} /> : null}
            {category === "Fashion" ? <CheckboxGroup name="category_tags" label="ジャンル" values={FASHION_TAGS} selected={filters.category_tags} labeler={jaCategoryTag} /> : null}
            {category === "Cafe" ? <CheckboxGroup name="category_tags" label="タグ" values={CAFE_TAGS} selected={filters.category_tags} labeler={jaCategoryTag} /> : null}
            <RegionChipGroup selected={filters.region_filter_label} />
            {category === "Restaurant" ? <SelectFilter name="price_level" label="価格帯" value={filters.price_level} options={[...RESTAURANT_PRICE_BANDS]} labeler={restaurantPriceBandLabel} /> : null}
          </div>
        </details>
      </form>

      <InfinitePlaceList endpoint={`/api/category/${params.slug}/places`} params={filtersToApiParams(filters)} mode="category" />
    </div>
  );
}

function CheckboxGroup({ name, label, values, selected, labeler, tone = "default" }: { name: string; label: string; values: string[]; selected: string[]; labeler: (value: unknown) => string; tone?: "default" | "cuisine" | "scene" }) {
  return (
    <fieldset className="md:col-span-2">
      <legend className="text-xs font-medium uppercase text-stone-600">{label}</legend>
      <div className="mt-1 flex min-h-10 flex-wrap gap-2 rounded-md border border-line bg-white px-2 py-2">
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

function RegionChipGroup({ selected }: { selected: string[] }) {
  return (
    <fieldset className="md:col-span-4">
      <legend className="text-xs font-medium uppercase text-stone-600">地域</legend>
      <div className="mt-1 space-y-3 rounded-md border border-line bg-white p-3">
        {REGION_FILTER_SECTIONS.map((section) => {
          const labels = section.labels;
          return (
            <div key={section.group}>
              <div className="mb-2 text-xs font-semibold text-stone-600">{section.title}</div>
              <div className="flex flex-wrap gap-2">
                {labels.map((label) => {
                  const active = selected.includes(label);
                  return (
                    <label key={label} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${active ? "border-moss bg-moss text-white" : "border-line bg-white text-stone-800 hover:border-moss"}`}>
                      <input className="sr-only" type="checkbox" name="region_filter_label" value={label} defaultChecked={active} />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function checkboxToneClass(tone: "default" | "cuisine" | "scene", selected: boolean) {
  if (tone === "scene") return selected ? "bg-moss text-white" : "bg-accentSoft text-ink";
  if (tone === "cuisine") return selected ? "border border-moss bg-white text-ink" : "border border-line bg-white text-ink";
  return selected ? "bg-ink text-white" : "bg-paper text-stone-800";
}

function SelectFilter({ name, label, value, options, labeler }: { name: string; label: string; value: string; options: string[]; labeler: (value: unknown) => string }) {
  return (
    <label>
      <span className="text-xs font-medium uppercase text-stone-600">{label}</span>
      <select name={name} defaultValue={value} className="mt-1 h-10 w-full rounded-md border border-line bg-white px-3">
        <option value="">すべて</option>
        {options.map((option) => (
          <option key={option} value={option}>{labeler(option)}</option>
        ))}
      </select>
    </label>
  );
}

function normalizeSearchParams(searchParams: SearchParams) {
  return {
    search: valueOf(searchParams.search),
    want: valueOf(searchParams.want) === "1",
    scene_tags: valuesOf(searchParams.scene_tags),
    sub_category: valuesOf(searchParams.sub_category),
    category_tags: valuesOf(searchParams.category_tags),
    region_filter_label: valuesOf(searchParams.region_filter_label),
    price_level: valueOf(searchParams.price_level)
  };
}

function buildUrl(slug: string, filters: ReturnType<typeof normalizeSearchParams>) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.want) params.set("want", "1");
  for (const tag of filters.scene_tags) params.append("scene_tags", tag);
  for (const sub of filters.sub_category) params.append("sub_category", sub);
  for (const tag of filters.category_tags) params.append("category_tags", tag);
  for (const label of filters.region_filter_label) params.append("region_filter_label", label);
  if (filters.price_level) params.set("price_level", filters.price_level);
  const query = params.toString();
  return query ? `/category/${slug}?${query}` : `/category/${slug}`;
}

function filtersToApiParams(filters: ReturnType<typeof normalizeSearchParams>) {
  return {
    search: filters.search,
    want: filters.want,
    scene_tags: filters.scene_tags,
    sub_category: filters.sub_category,
    category_tags: filters.category_tags,
    region_filter_label: filters.region_filter_label,
    price_level: filters.price_level
  };
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function valuesOf(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}
