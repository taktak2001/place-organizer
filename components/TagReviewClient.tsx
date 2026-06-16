"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ART_SUB_CATEGORIES, SCENE_TAGS, TAG_OPTIONS, TAG_REVIEW_CATEGORIES, TAG_REVIEW_STATUSES, type TagsReviewStatus } from "@/lib/classification/tag-review";
import { REGION_FILTER_SECTIONS } from "@/lib/classification/display-region";
import { jaCategory, jaCategoryTag, jaDisplay, jaSceneTag } from "@/lib/i18n/ja";
import { preferredGoogleMapsUrl } from "@/lib/import/source-fields";
import { firstRelated, restaurantPriceBand, restaurantPriceBandLabel, type PlaceRow } from "@/lib/places/browse";

type Counts = Record<TagsReviewStatus, number>;

type Props = {
  initialCategory: string;
  initialStatus: TagsReviewStatus;
  initialCounts: Counts;
  initialPlace: PlaceRow | null;
  statusLabels: Record<TagsReviewStatus, string>;
};

const MAIN_CATEGORIES = ["Restaurant", "Cafe", "Fashion", "Art", "Hotel", "Bath", "Life", "Other"];
const PRICE_BANDS = ["cheap", "normal", "high", "luxury", "unknown"];

export function TagReviewClient({ initialCategory, initialStatus, initialCounts, initialPlace, statusLabels }: Props) {
  const [category, setCategory] = useState(initialCategory);
  const [status, setStatus] = useState<TagsReviewStatus>(initialStatus);
  const [counts, setCounts] = useState(initialCounts);
  const [current, setCurrent] = useState<PlaceRow | null>(initialPlace);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadNext(nextCategory = category, nextStatus = status, cursor?: string | null) {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ category: nextCategory, status: nextStatus });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/tag-review?${params.toString()}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(json));
      setCounts(json.counts ?? { unreviewed: 0, reviewed: 0, needs_check: 0 });
      setCurrent(json.place ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function switchCategory(next: string) {
    setCategory(next);
    void loadNext(next, status);
  }

  function switchStatus(next: TagsReviewStatus) {
    setStatus(next);
    void loadNext(category, next);
  }

  function afterSaved(cursor: string, nextStatus: TagsReviewStatus) {
    setMessage("保存しました");
    setCounts((value) => ({
      ...value,
      [status]: Math.max(0, (value[status] ?? 0) - 1),
      [nextStatus]: (value[nextStatus] ?? 0) + 1
    }));
    void loadNext(category, status, cursor);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-white p-3">
        <div className="mb-2 text-xs font-semibold uppercase text-stone-600">対象カテゴリ</div>
        <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
          {TAG_REVIEW_CATEGORIES.map((item) => {
            const active = item === category;
            return (
              <button
                key={item}
                type="button"
                onClick={() => switchCategory(item)}
                className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-semibold ${active ? "border-moss bg-moss text-white" : "border-line bg-white text-ink"}`}
              >
                {item === "All" ? "すべて" : jaCategory(item)}
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TAG_REVIEW_STATUSES.map((item) => {
          const active = item === status;
          return (
            <button
              key={item}
              type="button"
              onClick={() => switchStatus(item)}
              className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-semibold ${active ? "border-moss bg-moss text-white" : "border-line bg-white text-ink"}`}
            >
              {statusLabels[item]} {counts[item] ?? 0}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-line bg-white p-4 text-sm text-stone-700">
        {loading ? "読み込み中..." : current ? `1 / ${counts[status] ?? 0} 件を確認中` : "対象はありません。"}
        {message ? <span className={message.includes("query:") || message.includes("message:") ? "ml-3 text-clay" : "ml-3 text-moss"}>{message}</span> : null}
      </div>

      {current ? (
        <TagReviewCard
          key={String(current.id)}
          place={current}
          onSaved={(nextStatus) => afterSaved(String(current.id), nextStatus)}
          onSkip={() => {
            setMessage("スキップしました");
            void loadNext(category, status, String(current.id));
          }}
        />
      ) : (
        <div className="rounded-lg border border-line bg-white p-6 text-sm text-stone-600">この条件の対象はありません。</div>
      )}
    </div>
  );
}

function TagReviewCard({ place, onSaved, onSkip }: { place: PlaceRow; onSaved: (status: TagsReviewStatus) => void; onSkip: () => void }) {
  const classification = firstRelated(place.place_classifications);
  const initialCategory = String(classification?.main_category ?? "Other");
  const [mainCategory, setMainCategory] = useState(MAIN_CATEGORIES.includes(initialCategory) ? initialCategory : "Other");
  const [subCategory, setSubCategory] = useState(String(classification?.sub_category ?? ""));
  const [categoryTags, setCategoryTags] = useState<string[]>(arrayValue(classification?.category_tags));
  const [sceneTags, setSceneTags] = useState<string[]>(arrayValue(classification?.scene_tags));
  const [regionLabel, setRegionLabel] = useState(String(classification?.region_filter_label ?? ""));
  const [priceBand, setPriceBand] = useState(restaurantPriceBand(place, classification));
  const [note, setNote] = useState(String(classification?.tags_review_note ?? ""));
  const [saving, setSaving] = useState(false);
  const categoryOptions = useMemo(() => TAG_OPTIONS[mainCategory] ?? [], [mainCategory]);
  const mapsHref = preferredGoogleMapsUrl({
    placeGoogleMapsUrl: sourceLinkUrl(place) ?? place.google_maps_url,
    latitude: place.latitude,
    longitude: place.longitude
  });

  function changeMainCategory(next: string) {
    setMainCategory(next);
    setCategoryTags([]);
    setSceneTags(next === "Restaurant" ? sceneTags : []);
    setSubCategory(next === "Art" ? subCategory : "");
    setPriceBand(next === "Restaurant" ? priceBand : "unknown");
  }

  async function save(nextStatus: TagsReviewStatus) {
    setSaving(true);
    try {
      const response = await fetch(`/api/tag-review/${String(place.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          main_category: mainCategory,
          sub_category: subCategory,
          category_tags: categoryTags,
          scene_tags: sceneTags,
          region_filter_label: regionLabel,
          restaurant_price_band: priceBand,
          tags_review_status: nextStatus,
          tags_review_note: note
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(json));
      onSaved(nextStatus);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-line pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-moss">Tag Review</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">{String(place.name ?? "")}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <Chip label={jaCategory(mainCategory)} />
            {subCategory ? <Chip label={jaDisplay(subCategory)} /> : null}
            {categoryTags.map((tag) => <Chip key={tag} label={jaCategoryTag(tag)} />)}
            {sceneTags.map((tag) => <Chip key={tag} label={jaSceneTag(tag)} tone="scene" />)}
            {regionLabel ? <Chip label={regionLabel} tone="region" /> : null}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 md:min-w-72">
          {mapsHref ? (
            <a href={mapsHref} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-[#222A31]">
              元Googleマップで開く
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <Link href={`/places/${String(place.id)}`} className="inline-flex h-12 items-center justify-center rounded-md border border-line px-4 text-sm font-semibold text-ink">
            詳細を見る
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-stone-600">メインカテゴリ</span>
            <select value={mainCategory} onChange={(event) => changeMainCategory(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
              {MAIN_CATEGORIES.map((category) => <option key={category} value={category}>{jaCategory(category)}</option>)}
            </select>
          </label>

          {mainCategory === "Art" ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase text-stone-600">サブカテゴリ</span>
              <select value={subCategory} onChange={(event) => setSubCategory(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
                <option value="">未設定</option>
                {ART_SUB_CATEGORIES.map((value) => <option key={value} value={value}>{jaDisplay(value)}</option>)}
              </select>
            </label>
          ) : null}

          {categoryOptions.length > 0 ? <CheckboxGroup title="カテゴリタグ" values={categoryOptions} selected={categoryTags} onChange={setCategoryTags} labeler={jaCategoryTag} /> : null}
          {mainCategory === "Restaurant" ? <CheckboxGroup title="利用シーン" values={SCENE_TAGS} selected={sceneTags} onChange={setSceneTags} labeler={jaSceneTag} tone="scene" /> : null}
        </section>

        <section className="space-y-3">
          <label>
            <span className="text-xs font-semibold uppercase text-stone-600">地域</span>
            <input value={regionLabel} onChange={(event) => setRegionLabel(event.target.value)} list="tag-review-region-labels" className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3" />
            <datalist id="tag-review-region-labels">
              {REGION_FILTER_SECTIONS.flatMap((section) => section.labels).map((label) => <option key={label} value={label} />)}
            </datalist>
          </label>
          {mainCategory === "Restaurant" ? (
            <label>
              <span className="text-xs font-semibold uppercase text-stone-600">価格帯</span>
              <select value={priceBand} onChange={(event) => setPriceBand(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
                {PRICE_BANDS.map((band) => <option key={band} value={band}>{restaurantPriceBandLabel(band)}</option>)}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="text-xs font-semibold uppercase text-stone-600">メモ</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2" />
          </label>
        </section>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => save("reviewed")} className="min-h-11 rounded-md bg-clay px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">保存して次へ</button>
        <button type="button" disabled={saving} onClick={() => save("needs_check")} className="min-h-11 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">要確認にする</button>
        <button type="button" disabled={saving} onClick={onSkip} className="min-h-11 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">スキップ</button>
      </div>
    </article>
  );
}

function CheckboxGroup({ title, values, selected, onChange, labeler, tone = "category" }: { title: string; values: readonly string[]; selected: string[]; onChange: (values: string[]) => void; labeler: (value: unknown) => string; tone?: "category" | "scene" }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase text-stone-600">{title}</legend>
      <div className="mt-1 flex flex-wrap gap-2 rounded-md border border-line bg-paper p-2">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(active ? selected.filter((item) => item !== value) : [...selected, value])}
              className={`min-h-9 rounded-md border px-2 py-1 text-xs font-medium ${active ? "border-moss bg-moss text-white" : tone === "scene" ? "border-transparent bg-accentSoft text-ink" : "border-line bg-white text-ink"}`}
            >
              {labeler(value)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Chip({ label, tone = "category" }: { label: string; tone?: "category" | "scene" | "region" }) {
  const className = tone === "scene" ? "bg-accentSoft text-ink" : tone === "region" ? "border border-line bg-white text-stone-700" : "border border-line bg-white text-ink";
  return <span className={`rounded-md px-2 py-0.5 font-medium ${className}`}>{label}</span>;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function sourceLinkUrl(place: PlaceRow) {
  const links = Array.isArray(place.source_links) ? place.source_links : [];
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const record = link as Record<string, unknown>;
    if (record.active === false) continue;
    const url = String(record.source_url ?? "").trim();
    if (url) return url;
  }
  return null;
}

function errorText(json: Record<string, unknown>) {
  if (typeof json.error === "string") return json.error;
  const parts = [
    json.query ? `query: ${json.query}` : null,
    json.message ? `message: ${json.message}` : null,
    json.code ? `code: ${json.code}` : null,
    json.details ? `details: ${json.details}` : null,
    json.hint ? `hint: ${json.hint}` : null
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : "タグレビューの取得に失敗しました";
}
