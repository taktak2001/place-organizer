"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { RESTAURANT_CUISINE_TAGS } from "@/lib/classification/restaurant-cuisine";
import { REGION_FILTER_SECTIONS } from "@/lib/classification/display-region";
import { jaCategoryTag, jaSceneTag } from "@/lib/i18n/ja";
import { preferredGoogleMapsUrl } from "@/lib/import/source-fields";
import { firstRelated, restaurantPriceBand, restaurantPriceBandLabel, sceneTags, type PlaceRow } from "@/lib/places/browse";

type ReviewStatus = "pending" | "verified" | "not_restaurant" | "needs_check";

type Props = {
  initialPlaces: PlaceRow[];
};

const STATUSES: Array<{ value: ReviewStatus; label: string }> = [
  { value: "pending", label: "未確認" },
  { value: "verified", label: "確認済み" },
  { value: "not_restaurant", label: "レストランではない" },
  { value: "needs_check", label: "要確認" }
];

const SCENE_TAGS = ["Date", "Business", "Solo", "Casual", "Group", "Travel", "High-end", "Local"];
const PRICE_BANDS = ["cheap", "normal", "high", "luxury", "unknown"];

export function RestaurantReviewClient({ initialPlaces }: Props) {
  const [places, setPlaces] = useState(initialPlaces);
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [index, setIndex] = useState(0);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => places.filter((place) => reviewStatus(place) === status), [places, status]);
  const current = filtered[Math.min(index, Math.max(0, filtered.length - 1))] ?? null;

  function switchStatus(next: ReviewStatus) {
    setStatus(next);
    setIndex(0);
    setMessage("");
  }

  function updatePlace(placeId: string, classification: Record<string, unknown>) {
    setPlaces((items) => items.map((place) => {
      if (String(place.id) !== placeId) return place;
      return { ...place, place_classifications: [{ ...(firstRelated(place.place_classifications) ?? {}), ...classification }] };
    }));
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUSES.map((item) => {
          const count = places.filter((place) => reviewStatus(place) === item.value).length;
          const active = item.value === status;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => switchStatus(item.value)}
              className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-semibold ${active ? "border-moss bg-moss text-white" : "border-line bg-white text-ink"}`}
            >
              {item.label} {count}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-line bg-white p-4 text-sm text-stone-700">
        {filtered.length === 0 ? "対象はありません。" : `${index + 1} / ${filtered.length} 件を確認中`}
        {message ? <span className="ml-3 text-moss">{message}</span> : null}
      </div>

      {current ? (
        <RestaurantReviewCard
          key={String(current.id)}
          place={current}
          onSaved={(classification) => {
            updatePlace(String(current.id), classification);
            setMessage("保存しました");
            setIndex((value) => Math.min(value, Math.max(0, filtered.length - 2)));
          }}
          onSkip={() => {
            setMessage("スキップしました");
            setIndex((value) => Math.min(value + 1, Math.max(0, filtered.length - 1)));
          }}
        />
      ) : (
        <div className="rounded-lg border border-line bg-white p-6 text-sm text-stone-600">このステータスの対象はありません。</div>
      )}
    </div>
  );
}

function RestaurantReviewCard({ place, onSaved, onSkip }: { place: PlaceRow; onSaved: (classification: Record<string, unknown>) => void; onSkip: () => void }) {
  const classification = firstRelated(place.place_classifications);
  const [reviewStatusValue, setReviewStatusValue] = useState<ReviewStatus>(reviewStatus(place));
  const [categoryTags, setCategoryTags] = useState<string[]>(arrayValue(classification?.category_tags));
  const [selectedScenes, setSelectedScenes] = useState<string[]>(sceneTags(classification));
  const [regionGroup, setRegionGroup] = useState(String(classification?.region_group ?? ""));
  const [regionLabel, setRegionLabel] = useState(String(classification?.region_filter_label ?? ""));
  const [travelRegion, setTravelRegion] = useState(String(classification?.travel_region ?? ""));
  const [areaLabel, setAreaLabel] = useState(String(classification?.area_label ?? ""));
  const [priceBand, setPriceBand] = useState(restaurantPriceBand(place, classification));
  const [note, setNote] = useState(String(classification?.restaurant_review_note ?? ""));
  const [saving, setSaving] = useState(false);
  const mapsHref = preferredGoogleMapsUrl({
    rawGoogle: place.raw_google,
    placeGoogleMapsUrl: place.google_maps_url,
    rawImport: place.raw_import,
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
        restaurant_review_note: note
      };
      const response = await fetch(`/api/restaurant-review/${String(place.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(json.error ?? "保存に失敗しました"));
      onSaved({
        ...payload,
        manual_override: true,
        classification_source: "manual",
        restaurant_reviewed_at: new Date().toISOString(),
        main_category: nextStatus === "not_restaurant" ? "Other" : "Restaurant",
        category_tags: nextStatus === "not_restaurant" ? [] : categoryTags,
        scene_tags: nextStatus === "not_restaurant" ? [] : selectedScenes,
        restaurant_price_band: nextStatus === "not_restaurant" ? "unknown" : priceBand
      });
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
            <select value={reviewStatusValue} onChange={(event) => setReviewStatusValue(event.target.value as ReviewStatus)} className="mt-1 h-11 w-full rounded-md border border-line bg-white px-3">
              <option value="verified">レストラン</option>
              <option value="not_restaurant">レストランではない</option>
              <option value="needs_check">要確認</option>
              <option value="pending">未確認</option>
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
            <textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2" />
          </label>
        </section>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => save("verified")} className="min-h-11 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-[#222A31] disabled:opacity-50">保存して次へ</button>
        <button type="button" disabled={saving} onClick={() => save("not_restaurant")} className="min-h-11 rounded-md border border-clay bg-warningSoft px-4 py-2 text-sm font-semibold text-clay disabled:opacity-50">レストランではない</button>
        <button type="button" disabled={saving} onClick={() => save("needs_check")} className="min-h-11 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">要確認にする</button>
        <button type="button" disabled={saving} onClick={onSkip} className="min-h-11 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">スキップ</button>
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

function reviewStatus(place: PlaceRow): ReviewStatus {
  const value = String(firstRelated(place.place_classifications)?.restaurant_review_status ?? "pending");
  return STATUSES.some((item) => item.value === value) ? value as ReviewStatus : "pending";
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
