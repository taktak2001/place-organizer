import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";
import { ja, jaCategory } from "@/lib/i18n/ja";
import { safeQuery, type SafeSupabaseError } from "@/lib/supabase/queries";
import type { getSupabaseRead } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type HomeData = {
  totalAvailablePlaces: number;
  categoryCards: CategoryCardData[];
};

type CategoryCardData = {
  category: string;
  slug: string;
  total: number;
  want: number;
  samples: string[];
};

type PlaceSummaryRow = {
  id: string;
  name: string;
  is_archived: boolean | null;
};

type ClassificationSummaryRow = {
  place_id: string;
  main_category: string | null;
};

type SourceLinkSummaryRow = {
  place_id: string;
};

const PUBLIC_HOME_CATEGORIES = [
  ["restaurant", "Restaurant"],
  ["cafe", "Cafe"],
  ["art", "Art"],
  ["fashion", "Fashion"],
  ["hotel", "Hotel"],
  ["bath", "Bath"]
] as const;

const FALLBACK_HOME: HomeData = {
  totalAvailablePlaces: 0,
  categoryCards: PUBLIC_HOME_CATEGORIES.map(([slug, category]) => ({ slug, category, total: 0, want: 0, samples: [] }))
};

export default async function HomePage() {
  const { data, error } = await safeQuery<HomeData>(FALLBACK_HOME, getPublicHomeSummary, "getPublicHomeSummary");

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-5 border-b border-stone-300 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase text-moss">{ja.dashboard.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold">保存場所を探す</h1>
          <p className="mt-2 max-w-2xl text-sm text-stone-700">カテゴリから素早く探して、元Googleマップリンクを開けます。</p>
        </div>
        <Link href="/places" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-moss px-5 text-sm font-semibold text-white lg:h-11">
          <ListChecks className="h-4 w-4" />
          {ja.dashboard.browsePlaces}
        </Link>
      </section>

      {error ? <HomeError error={error} /> : null}

      <section className="rounded-lg border border-stone-300 bg-white p-3">
        <div className="text-xs font-medium uppercase text-stone-600">利用可能な場所</div>
        <div className="mt-1 text-2xl font-semibold text-ink">{data.totalAvailablePlaces}</div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">カテゴリから探す</h2>
          <Link href="/categories" className="text-sm font-semibold text-moss">すべて見る</Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.categoryCards.map((card) => (
            <Link key={card.slug} href={`/category/${card.slug}`} className="block rounded-lg border border-stone-300 bg-white p-4 transition active:scale-[0.99] active:bg-paper hover:border-moss hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">{jaCategory(card.category)}</h3>
                  <p className="mt-1 text-sm text-stone-600">行ってみたい {card.want} / 全 {card.total}</p>
                </div>
                <ArrowRight className="mt-1 h-5 w-5 text-moss" />
              </div>
              <div className="mt-4 space-y-2">
                {card.samples.map((sample) => (
                  <div key={sample} className="truncate rounded-md bg-paper px-3 py-2 text-sm text-stone-800">{sample}</div>
                ))}
                {card.samples.length === 0 ? <div className="text-sm text-stone-500">まだデータがありません。</div> : null}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

async function getPublicHomeSummary(supabase: ReturnType<typeof getSupabaseRead>): Promise<HomeData> {
  const [availableCount, places, classifications, wantLinks] = await Promise.all([
    countQuery(
      "home.availablePlacesCount",
      () => supabase.from("places").select("id", { count: "exact", head: true }).or("is_archived.is.null,is_archived.eq.false")
    ),
    fetchPagedRows<PlaceSummaryRow>(
      "home.availablePlaces",
      (from, to) => supabase.from("places").select("id, name, is_archived").or("is_archived.is.null,is_archived.eq.false").range(from, to)
    ),
    fetchPagedRows<ClassificationSummaryRow>(
      "home.classifications",
      (from, to) => supabase.from("place_classifications").select("place_id, main_category").range(from, to)
    ),
    fetchPagedRows<SourceLinkSummaryRow>(
      "home.wantSourceLinks",
      (from, to) => supabase.from("source_links").select("place_id").eq("active", true).ilike("source_list_name", "%行ってみたい%").range(from, to)
    )
  ]);

  const availablePlaces = places.filter((place) => place.is_archived !== true);
  const availableById = new Map(availablePlaces.map((place) => [place.id, place]));
  const categoryByPlaceId = new Map(
    classifications
      .filter((row) => availableById.has(row.place_id))
      .map((row) => [row.place_id, row.main_category ?? "Other"])
  );
  const wantIds = new Set(wantLinks.map((link) => link.place_id).filter(Boolean));

  return {
    totalAvailablePlaces: availableCount,
    categoryCards: PUBLIC_HOME_CATEGORIES.map(([slug, category]) => {
      const categoryPlaces = availablePlaces
        .filter((place) => categoryByPlaceId.get(place.id) === category)
        .sort((a, b) => Number(wantIds.has(b.id)) - Number(wantIds.has(a.id)) || a.name.localeCompare(b.name, "ja"));
      return {
        slug,
        category,
        total: categoryPlaces.length,
        want: categoryPlaces.filter((place) => wantIds.has(place.id)).length,
        samples: categoryPlaces.slice(0, 3).map((place) => place.name)
      };
    })
  };
}

async function countQuery(queryName: string, query: () => PromiseLike<{ count: number | null; error: unknown }>) {
  const result = await query();
  if (result.error) throw toSafeQueryError(queryName, result.error);
  return result.count ?? 0;
}

async function fetchPagedRows<T>(queryName: string, query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await query(from, from + 999);
    if (result.error) throw toSafeQueryError(queryName, result.error);
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 1000) break;
  }
  return rows;
}

function toSafeQueryError(queryName: string, supabaseError: unknown): SafeSupabaseError {
  const error = typeof supabaseError === "object" && supabaseError !== null ? supabaseError as Record<string, unknown> : {};
  return {
    query: queryName,
    message: typeof error.message === "string" ? error.message : String(supabaseError),
    code: typeof error.code === "string" ? error.code : undefined,
    details: typeof error.details === "string" ? error.details : undefined,
    hint: typeof error.hint === "string" ? error.hint : undefined
  };
}

function HomeError({ error }: { error: string }) {
  const envError = error.includes("Supabase公開接続情報が未設定です。missing") || error.includes("NEXT_PUBLIC_SUPABASE_URL または NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return (
    <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-800">
      <div className="font-semibold">{envError ? "Supabase公開接続情報が未設定です" : "データ取得に失敗しました"}</div>
      <pre className="mt-2 whitespace-pre-wrap text-xs text-stone-600">{localizeError(error)}</pre>
    </div>
  );
}

function localizeError(error: string) {
  if (error.includes("Supabase公開接続情報が未設定です。missing")) return error.replace(/^Error:\s*/, "");
  return error;
}
