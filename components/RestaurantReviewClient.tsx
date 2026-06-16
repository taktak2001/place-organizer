"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { RESTAURANT_CUISINE_TAGS } from "@/lib/classification/restaurant-cuisine";
import { REGION_FILTER_SECTIONS } from "@/lib/classification/display-region";
import { jaCategoryTag, jaSceneTag } from "@/lib/i18n/ja";
import { preferredGoogleMapsUrl } from "@/lib/import/source-fields";
import { firstRelated, restaurantPriceBand, restaurantPriceBandLabel, sceneTags, type PlaceRow } from "@/lib/places/browse";
import { RESTAURANT_REVIEW_STATUSES, type RestaurantReviewCounts, type RestaurantReviewStatus } from "@/lib/restaurant/review-queries";

type Props = {
  initialCounts: RestaurantReviewCounts;
  initialPlace: PlaceRow | null;
  initialStatus: RestaurantReviewStatus;
};

const SCENE_TAGS = ["Date", "Business", "Solo", "Casual", "Group", "Travel", "High-end", "Local"];
const PRICE_BANDS = ["cheap", "normal", "high", "luxury", "unknown"];

export function RestaurantReviewClient({ initialCounts, initialPlace, initialStatus }: Props) {
  const [counts, setCounts] = useState(initialCounts);
  const [status, setStatus] = useState<RestaurantReviewStatus>(initialStatus);
  const [current, setCurrent] = useState<PlaceRow | null>(initialPlace);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadNext(nextStatus = status, cursor?: string | null) {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ status: nextStatus });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/restaurant-review?${params.toString()}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(json));
      setCounts(json.counts ?? { unreviewed: 0, verified: 0, not_restaurant: 0, needs_check: 0 });
      setCurrent(json.place ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function switchStatus(next: RestaurantReviewStatus) {
    setStatus(next);
    void loadNext(next);
  }

  function afterSaved(previousStatus: RestaurantReviewStatus, nextStatus: RestaurantReviewStatus, cursor: string) {
    setCounts((value) => ({
      ...value,
      [previousStatus]: Math.max(0, (value[previousStatus] ?? 0) - 1),
      [nextStatus]: (value[nextStatus] ?? 0) + 1
    }));
    setMessage("保存しました");
    void loadNext(previousStatus, cursor);
  }

  const totalForStatus = counts[status] ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {RESTAURANT_REVIEW_STATUSES.map((item) => {
          const active = item.value === status;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => switchStatus(item.value)}
              className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-semibold ${active ? "border-moss bg-moss text-white" : "border-line bg-white text-ink"}`}
            >
              {item.label} {counts[item.value] ?? 0}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-line bg-white p-4 text-sm text-stone-700">
        {loading ? "読み込み中..." : current ? `1 / ${totalForStatus} 件を確認中` : "対象はありません。"}
        {message ? <span className={message.includes("query:") || message.includes("message:") ? "ml-3 text-clay" : "ml-3 text-moss"}>{message}</span> : null}
      </div>

      {current ? (
        <RestaurantReviewCard
          key={String(current.id)}
          place={current}
          status={status}
          onSaved={afterSaved}
          onSkip={() => {
            setMessage("スキップしました");
            void loadNext(status, String(current.id));
          }}
          onNext={() => loadNext(status, String(current.id))}
        />
      ) : (
        <div className="rounded-lg border border-line bg-white p-6 text-sm text-stone-600">このステータスの対象はありません。</div>
      )}
    </div>
  );
}

function RestaurantReviewCard({ place, status, onSaved, onSkip, onNext }: { place: PlaceRow; status: RestaurantReviewStatus; onSaved: (previousStatus: RestaurantReviewStatus, nextStatus: RestaurantReviewStatus, cursor: string) => void; onSkip: () => void; onNext: () => void }) {
  const classification = firstRelated(place.place_classifications);
  const [reviewStatusValue, setReviewStatusValue] = useState<RestaurantReviewStatus>(reviewStatus(place));
  const [categoryTags, setCategoryTags] = useState<string[]>(arrayValue(classification?.category_tags));
  const [selectedScenes, setSelectedScenes] = useState<string[]>(sceneTags(classification));
  const [regionGroup, setRegionGroup] = useState(String(classification?.region_group ?? ""));
  const [regionLabel, setRegionLabel] = useState(String(classification?.region_filter_label ?? ""));
  const [travelRegion, setTravelRegion] = useState(String(classification?.travel_region ?? ""));
  const [areaLabel, setAreaLabel] = useState(String(classification?.area_label ?? ""));
  const [priceBand, setPriceBand] = useState(restaurantPriceBand(place, classification));
  const [notes, setNotes] = useState(String(classification?.restaurant_notes ?? ""));
  const [saving, setSaving] = useState(false);
  const mapsHref = preferredGoogleMapsUrl({
    placeGoogleMapsUrl: sourceLinkUrl(place) ?? place.google_maps_url,
    latitude: place.latitude,
    longitude: place.longitude
  });

  async function save(nextStatus = reviewStatusValue) {
    setSaving(true);
    try {
      const payload = {
        restaurant_review_status: nextStatus,
        category_tags: categoryTags,
        scene_tags: selectedScenes,
        region_group: regionGroup,
        region_filter_label: regionLabel,
        travel_region: travelRegion,
        area_label: areaLabel,
        restaurant_price_band: priceBand,
        restaurant_notes: notes
      };
      const response = await fetch(`/api/restaurant-review/${String(place.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(json));
      onSaved(status, nextStatus, String(place.id));
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
          <p className="text-xs font-semibold uppercase text-moss">Restaurant Review</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">{String(place.name ?? "")}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <Chip tone="cuisine" label={`料理 ${categoryTags.length || "未設定"}`} />
            <Chip tone="scene" label={`シーン ${selectedScenes.length || "未設定"}`} />
            <Chip tone="region" label={regionLabel || travelRegion || areaLabel || "地域未設定"} />
            <Chip tone="price" label={restaurantPriceBandLabel(priceBand)} />
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
            <span className="text-xs font-semibold uppercase text-stone-600">本当にレストランか</span>
            <select value={reviewStatusValue} onChange={(event) => setReviewStatusValue(event.target.value as RestaurantReviewStatus)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
              <option value="verified">レストラン</option>
              <option value="not_restaurant">レストランではない</option>
              <option value="needs_check">要確認</option>
              <option value="unreviewed">未確認</option>
            </select>
          </label>

          <CheckboxGroup title="料理ジャンル" values={[...RESTAURANT_CUISINE_TAGS]} selected={categoryTags} onChange={setCategoryTags} labeler={jaCategoryTag} tone="cuisine" />
          <CheckboxGroup title="利用シーン" values={SCENE_TAGS} selected={selectedScenes} onChange={setSelectedScenes} labeler={jaSceneTag} tone="scene" />
        </section>

        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="text-xs font-semibold uppercase text-stone-600">地域グループ</span>
              <select value={regionGroup} onChange={(event) => setRegionGroup(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
                <option value="">未設定</option>
                <option value="Tokyo">東京</option>
                <option value="Japan">日本</option>
                <option value="Overseas">海外</option>
                <option value="Unknown">不明</option>
              </select>
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-stone-600">地域</span>
              <input value={regionLabel} onChange={(event) => setRegionLabel(event.target.value)} list="restaurant-region-labels" className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3" />
              <datalist id="restaurant-region-labels">
                {REGION_FILTER_SECTIONS.flatMap((section) => section.labels).map((label) => <option key={label} value={label} />)}
              </datalist>
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-stone-600">旅行地域</span>
              <input value={travelRegion} onChange={(event) => setTravelRegion(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3" />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-stone-600">エリア</span>
              <input value={areaLabel} onChange={(event) => setAreaLabel(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3" />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-stone-600">価格帯</span>
              <select value={priceBand} onChange={(event) => setPriceBand(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
                {PRICE_BANDS.map((band) => <option key={band} value={band}>{restaurantPriceBandLabel(band)}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-stone-600">メモ</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2" />
          </label>
        </section>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => save("verified")} className="min-h-11 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-[#222A31] disabled:opacity-50">保存して次へ</button>
        <button type="button" disabled={saving} onClick={() => save("not_restaurant")} className="min-h-11 rounded-md border border-clay bg-warningSoft px-4 py-2 text-sm font-semibold text-clay disabled:opacity-50">レストランではない</button>
        <button type="button" disabled={saving} onClick={() => save("needs_check")} className="min-h-11 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">要確認にする</button>
        <button type="button" disabled={saving} onClick={onSkip} className="min-h-11 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">スキップ</button>
        <button type="button" disabled={saving} onClick={onNext} className="min-h-11 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">次へ</button>
      </div>
    </article>
  );
}

function CheckboxGroup({ title, values, selected, onChange, labeler, tone }: { title: string; values: readonly string[]; selected: string[]; onChange: (values: string[]) => void; labeler: (value: unknown) => string; tone: "cuisine" | "scene" }) {
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
              className={`min-h-9 rounded-md border px-2 py-1 text-xs font-medium ${chipClass(tone, active)}`}
            >
              {labeler(value)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Chip({ tone, label }: { tone: "cuisine" | "scene" | "region" | "price"; label: string }) {
  return <span className={`rounded-md px-2 py-0.5 font-medium ${chipClass(tone, false)}`}>{label}</span>;
}

function chipClass(tone: "cuisine" | "scene" | "region" | "price", active: boolean) {
  if (active) return "border-moss bg-moss text-white";
  if (tone === "scene") return "border-transparent bg-accentSoft text-ink";
  if (tone === "price") return "border-transparent bg-ink text-white";
  if (tone === "region") return "border border-line bg-white text-stone-700";
  return "border border-line bg-white text-ink";
}

function reviewStatus(place: PlaceRow): RestaurantReviewStatus {
  const value = String(firstRelated(place.place_classifications)?.restaurant_review_status ?? "unreviewed");
  if (value === "verified" || value === "not_restaurant" || value === "needs_check") return value;
  return "unreviewed";
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
  return parts.length > 0 ? parts.join("\n") : "Restaurantレビューの取得に失敗しました";
}
