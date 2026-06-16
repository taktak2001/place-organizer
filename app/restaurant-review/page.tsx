import Link from "next/link";
import { RestaurantReviewClient } from "@/components/RestaurantReviewClient";
import { firstRelated, matchesArchive, sortRecommended, type PlaceRow } from "@/lib/places/browse";
import { isAdminEnabled, getSupabaseRead } from "@/lib/supabase/server";
import { safeQuery } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function RestaurantReviewPage() {
  if (!isAdminEnabled()) {
    return (
      <div className="rounded-lg border border-line bg-white p-6">
        <p className="text-sm font-semibold uppercase text-moss">Restaurant Review</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Restaurantレビューは無効です</h1>
        <p className="mt-2 text-sm text-stone-700">公開環境では管理用レビュー画面を非表示にしています。</p>
        <Link href="/category/restaurant" className="mt-4 inline-flex h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white">
          レストラン一覧へ
        </Link>
      </div>
    );
  }

  const { data: places, error } = await safeQuery<PlaceRow[]>([], fetchRestaurants, "getRestaurantReviewPlaces");
  const restaurants = sortRecommended(places.filter((place) => matchesArchive(place)));

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-moss">Restaurant Review</p>
          <h1 className="mt-1 text-3xl font-semibold text-ink">レストラン正規化</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-700">
            元Googleマップリンクを開いて、人間が料理ジャンル・利用シーン・地域・価格帯を確認します。
          </p>
        </div>
        <Link href="/category/restaurant" className="inline-flex h-11 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink">
          公開Restaurantを見る
        </Link>
      </header>

      {error ? <pre className="whitespace-pre-wrap rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</pre> : null}

      <RestaurantReviewClient initialPlaces={restaurants} />
    </div>
  );
}

async function fetchRestaurants() {
  const supabase = getSupabaseRead();
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
  return rows.filter((place) => String(firstRelated(place.place_classifications)?.main_category ?? "Other") === "Restaurant");
}
