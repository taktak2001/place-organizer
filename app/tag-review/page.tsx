import Link from "next/link";
import { TagReviewClient } from "@/components/TagReviewClient";
import { TAG_REVIEW_STATUS_LABELS, type TagsReviewStatus } from "@/lib/classification/tag-review";
import { getNextTagReviewPlace, getTagReviewCounts } from "@/lib/tag-review/queries";
import { getSupabaseRead, isAdminEnabled } from "@/lib/supabase/server";
import { safeQuery } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const EMPTY_COUNTS = { unreviewed: 0, reviewed: 0, needs_check: 0 };

export default async function TagReviewPage() {
  if (!isAdminEnabled()) {
    return (
      <div className="rounded-lg border border-line bg-white p-6">
        <p className="text-sm font-semibold uppercase text-moss">Tag Review</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">タグレビューは無効です</h1>
        <p className="mt-2 text-sm text-stone-700">公開環境では管理用タグ編集画面を非表示にしています。</p>
        <Link href="/categories" className="mt-4 inline-flex h-11 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white">
          カテゴリ一覧へ
        </Link>
      </div>
    );
  }

  const initialStatus: TagsReviewStatus = "unreviewed";
  const { data, error } = await safeQuery({ counts: EMPTY_COUNTS, place: null }, (supabase) => getInitialData(supabase, initialStatus), "getInitialTagReviewData");

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-moss">Tag Review</p>
          <h1 className="mt-1 text-3xl font-semibold text-ink">タグ編集レビュー</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-700">
            カテゴリごとのタグ、利用シーン、サブカテゴリを手動で確認して保存します。
          </p>
        </div>
        <Link href="/categories" className="inline-flex h-11 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink">
          公開カテゴリを見る
        </Link>
      </header>

      {error ? <pre className="whitespace-pre-wrap rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</pre> : null}

      <TagReviewClient
        initialCategory="All"
        initialStatus={initialStatus}
        initialCounts={data.counts}
        initialPlace={data.place}
        statusLabels={TAG_REVIEW_STATUS_LABELS}
      />
    </div>
  );
}

async function getInitialData(supabase: ReturnType<typeof getSupabaseRead>, status: TagsReviewStatus) {
  const [counts, place] = await Promise.all([
    getTagReviewCounts(supabase, "All"),
    getNextTagReviewPlace(supabase, "All", status)
  ]);
  return { counts, place };
}
