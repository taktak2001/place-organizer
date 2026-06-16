import Link from "next/link";
import { Search } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { InfinitePlaceList } from "@/components/InfinitePlaceList";
import { ja, jaCategory } from "@/lib/i18n/ja";
import { CATEGORY_ORDER } from "@/lib/places/browse";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PlacesPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = normalizeSearchParams(searchParams);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-medium uppercase text-moss">{ja.places.eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold">{ja.places.title}</h1>
        <p className="mt-2 text-sm text-stone-700">全体から名前・カテゴリ・行ってみたいで素早く探します。細かい条件はカテゴリ別ページで指定できます。</p>
      </header>

      <QuickFilters filters={filters} />

      <form className="rounded-lg border border-line bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label>
            <span className="text-xs font-medium uppercase text-stone-600">{ja.places.search}</span>
            <div className="mt-1 flex items-center gap-2 rounded-md border border-line px-3">
              <Search className="h-4 w-4 text-stone-500" />
              <input name="search" defaultValue={filters.search} className="h-12 w-full bg-transparent outline-none md:h-10" placeholder={ja.places.name} />
            </div>
          </label>
          <button className="h-12 self-end rounded-md bg-ink px-5 text-sm font-semibold text-white md:h-10">{ja.places.apply}</button>
        </div>
        {filters.categories.map((category) => <input key={category} type="hidden" name="categories" value={category} />)}
        {filters.want ? <input type="hidden" name="want" value="1" /> : null}
      </form>

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4 text-sm text-stone-700 md:flex-row md:items-center md:justify-between">
        <div>初期表示30件、スクロールで追加表示します。</div>
        <Link href="/categories" className="font-semibold text-moss">カテゴリ別に探す</Link>
      </div>

      <InfinitePlaceList endpoint="/api/places/browse" params={filtersToApiParams(filters)} />
    </div>
  );
}

function QuickFilters({ filters }: { filters: ReturnType<typeof normalizeSearchParams> }) {
  const items = [
    { label: "行ってみたい", type: "want" as const, iconKey: "sparkles" },
    ...CATEGORY_ORDER.map((category) => ({ label: jaCategory(category), category }))
  ];
  return (
    <section className="rounded-lg border border-line bg-white p-3">
      <div className="mb-2 text-xs font-medium uppercase text-stone-600">クイックフィルタ</div>
      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
        {items.map((item) => {
          const active = "type" in item ? filters.want : filters.categories.includes(item.category);
          const href = "type" in item ? buildPlacesUrl({ ...filters, want: !filters.want }) : buildPlacesUrl(toggleCategory(filters, item.category));
          return (
            <Link
              key={item.label}
              href={href}
              className={`group inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${active ? "border-moss bg-moss text-white" : "border-line bg-paper text-ink hover:border-moss hover:text-moss"}`}
            >
              <CategoryIcon category={"category" in item ? item.category : undefined} iconKey={"iconKey" in item ? item.iconKey : undefined} size={16} className={active ? "text-white" : "text-ink transition group-hover:text-moss"} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function normalizeSearchParams(searchParams: SearchParams) {
  return {
    search: valueOf(searchParams.search),
    categories: valuesOf(searchParams.categories).filter((category) => CATEGORY_ORDER.includes(category)),
    want: valueOf(searchParams.want) === "1"
  };
}

function toggleCategory(filters: ReturnType<typeof normalizeSearchParams>, category: string) {
  const categories = filters.categories.includes(category)
    ? filters.categories.filter((item) => item !== category)
    : [...filters.categories, category];
  return { ...filters, categories };
}

function buildPlacesUrl(filters: ReturnType<typeof normalizeSearchParams>) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  for (const category of filters.categories) params.append("categories", category);
  if (filters.want) params.set("want", "1");
  const query = params.toString();
  return query ? `/places?${query}` : "/places";
}

function filtersToApiParams(filters: ReturnType<typeof normalizeSearchParams>) {
  return {
    search: filters.search,
    categories: filters.categories,
    want: filters.want
  };
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function valuesOf(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}
