import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { CategoryPreviewItem } from "@/components/CategoryPreviewItem";
import { jaCategory } from "@/lib/i18n/ja";
import { ALL_CATEGORY_SLUGS, CATEGORY_SLUGS, fetchAllPlaces, firstRelated, isWantToGo, matchesArchive, sortRecommended, type CategorySlug, type PlaceRow } from "@/lib/places/browse";
import { safeQuery } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function CategoriesPage() {
  const { data: places, error } = await safeQuery<PlaceRow[]>([], fetchAllPlaces, "getCategoriesPlaces");
  const activePlaces = places.filter(matchesArchive);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium uppercase text-moss">CATEGORIES</p>
        <h1 className="mt-1 text-3xl font-semibold">カテゴリ一覧</h1>
        <p className="mt-2 text-sm text-stone-700">用途ごとに探す入口です。詳細な条件は各カテゴリページで指定できます。</p>
      </header>

      {error ? <pre className="whitespace-pre-wrap rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</pre> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {ALL_CATEGORY_SLUGS.map((slug) => (
          <CategoryCard key={slug} slug={slug} places={activePlaces} />
        ))}
      </div>
    </div>
  );
}

function CategoryCard({ slug, places }: { slug: CategorySlug; places: PlaceRow[] }) {
  const category = CATEGORY_SLUGS[slug];
  const categoryPlaces = sortRecommended(places.filter((place) => String(firstRelated(place.place_classifications)?.main_category ?? "Other") === category));
  const wantCount = categoryPlaces.filter(isWantToGo).length;
  return (
    <Link href={`/category/${slug}`} className="block rounded-lg border border-moss bg-white p-4 transition-colors hover:bg-paper active:bg-paper">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-paper text-moss">
              <CategoryIcon category={category} size={20} className="text-moss" />
            </span>
            <h2 className="text-xl font-semibold">{jaCategory(category)}</h2>
          </div>
          <p className="mt-1 text-sm text-stone-600">行ってみたい {wantCount} / 全 {categoryPlaces.length}</p>
        </div>
        <ArrowRight className="mt-1 h-5 w-5 text-moss" />
      </div>
      <div className="mt-4 space-y-2">
        {categoryPlaces.slice(0, 3).map((place) => (
          <CategoryPreviewItem key={String(place.id)} category={category} place={place} />
        ))}
        {categoryPlaces.length === 0 ? <div className="text-sm text-stone-500">まだデータがありません。</div> : null}
      </div>
    </Link>
  );
}
