"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { classifyRegion } from "@/lib/classification/region";
import { ja, jaCategory, jaDisplay, jaGooglePlaceTypes, jaStatus } from "@/lib/i18n/ja";
import { parseGoogleMapsUrl } from "@/lib/import/google-maps-url";
import { googleDisplayName, googleMapsUri, hasNameDifference, hasUrlDifference, hasWeakNameMatch, isCandidateOnly, preferredGoogleMapsUrl, sourceGoogleMapsUrl, sourceSavedName } from "@/lib/import/source-fields";
import { reviewSourceUrlCandidate } from "@/lib/import/source-url-review";
import type { NormalizedImportItem } from "@/types/import";

type SourceLink = {
  id?: string;
  source_list_name?: string | null;
  active?: boolean | null;
};

type Classification = {
  main_category?: string | null;
  prefecture?: string | null;
  city?: string | null;
  ward?: string | null;
  area_label?: string | null;
  travel_region?: string | null;
  reason?: string | null;
  confidence?: number | null;
};

export type ReviewPlace = {
  id: string;
  name: string;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url: string | null;
  website_url: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  primary_type: string | null;
  types: string[] | null;
  raw_import?: Record<string, unknown> | null;
  raw_google?: Record<string, unknown> | null;
  enrichment_status: string | null;
  normalized_place_id?: string | null;
  place_id_confidence?: string | null;
  place_id_review_reason?: string | null;
  place_id_candidate?: Record<string, unknown> | null;
  place_classifications?: Classification[] | Classification | null;
  source_links?: SourceLink[];
};

type Props = {
  places: ReviewPlace[];
  mode: "card" | "list";
  status: string;
  initialCounts: Record<ReviewStatus, number>;
};

const REVIEW_STATUSES = ["place_id_candidate", "source_conflict", "needs_review", "not_found", "error", "coordinate_point", "source_url_confirmed"] as const;
type ReviewStatus = typeof REVIEW_STATUSES[number];

export function ReviewClient({ places, mode, status, initialCounts }: Props) {
  const [items, setItems] = useState(places);
  const [counts, setCounts] = useState(initialCounts);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const current = items[0];

  useEffect(() => {
    setItems(places);
    setCounts(initialCounts);
    setSelected(new Set());
    setMessage(null);
  }, [places, initialCounts]);

  async function updateStatus(ids: string[], nextStatus: string) {
    setMessage(null);
    const response = await fetch("/api/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status: nextStatus })
    });
    if (!response.ok) {
      setMessage(ja.review.failed);
      return;
    }
    setItems((previous) => previous.filter((item) => !ids.includes(item.id)));
    setCounts((previous) => adjustCounts(previous, status, nextStatus, ids.length));
    setSelected(new Set());
    setMessage(ja.review.updated);
  }

  async function confirmSourceUrl(ids: string[]) {
    setMessage(null);
    const response = await fetch("/api/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "confirm_source_url" })
    });
    if (!response.ok) {
      setMessage(ja.review.failed);
      return;
    }
    setItems((previous) => previous.filter((item) => !ids.includes(item.id)));
    setCounts((previous) => adjustCounts(previous, status, "source_url_confirmed", ids.length));
    setSelected(new Set());
    setMessage(ja.review.updated);
  }

  async function placeIdAction(ids: string[], action: "approve_place_id_candidate" | "reject_place_id_candidate" | "keep_source_url_confirmed") {
    setMessage(null);
    const response = await fetch("/api/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action })
    });
    if (!response.ok) {
      setMessage(ja.review.failed);
      return;
    }
    setItems((previous) => previous.filter((item) => !ids.includes(item.id)));
    setCounts((previous) => adjustCounts(previous, status, action === "keep_source_url_confirmed" ? "source_url_confirmed" : "place_id_processed", ids.length));
    setSelected(new Set());
    setMessage(ja.review.updated);
  }

  function skip(id: string) {
    setItems((previous) => previous.filter((item) => item.id !== id));
    setMessage(null);
  }

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <StatusTabs counts={counts} status={status} mode={mode} />
        <div className="rounded-lg border border-line bg-white p-6 text-sm text-stone-600">{ja.review.noTargets}</div>
      </div>
    );
  }

  if (mode === "list") {
    return (
      <div className="space-y-3">
        <StatusTabs counts={counts} status={status} mode={mode} />
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-3 text-sm">
          <span>{ja.review.remaining}: {items.length}</span>
          <button type="button" onClick={() => setSelected(new Set(items.map((item) => item.id)))} className="min-h-11 rounded-md border border-line px-3 py-2">{ja.review.selectAll}</button>
          <button type="button" onClick={() => setSelected(new Set())} className="min-h-11 rounded-md border border-line px-3 py-2">{ja.review.clearSelection}</button>
          <button type="button" disabled={selected.size === 0} onClick={() => updateStatus([...selected], "enriched")} className="min-h-11 rounded-md bg-ink px-3 py-2 font-semibold text-white hover:bg-[#222A31] disabled:opacity-50">{ja.review.approveSelected}</button>
          <button type="button" disabled={selected.size === 0} onClick={() => updateStatus([...selected], "pending_enrichment")} className="min-h-11 rounded-md border border-line px-3 py-2 disabled:opacity-50">{ja.review.resetSelected}</button>
          {status === "place_id_candidate" ? (
            <>
              <button type="button" disabled={selected.size === 0} onClick={() => placeIdAction([...selected], "approve_place_id_candidate")} className="min-h-11 rounded-md border border-moss px-3 py-2 disabled:opacity-50">候補を承認</button>
              <button type="button" disabled={selected.size === 0} onClick={() => placeIdAction([...selected], "keep_source_url_confirmed")} className="min-h-11 rounded-md border border-line px-3 py-2 disabled:opacity-50">元リンクのまま</button>
            </>
          ) : null}
          {message ? <span className="text-stone-600">{message}</span> : null}
        </div>
        <div className="grid gap-3">
          {items.map((place) => (
            <label key={place.id} className="grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-[auto_1fr]">
              <input
                type="checkbox"
                checked={selected.has(place.id)}
                onChange={(event) => setSelected((previous) => {
                  const next = new Set(previous);
                  if (event.target.checked) next.add(place.id);
                  else next.delete(place.id);
                  return next;
                })}
                className="mt-1"
              />
              <ReviewSummary place={place} compact />
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <StatusTabs counts={counts} status={status} mode={mode} />
      <div className="rounded-lg border border-line bg-white p-3 text-sm text-stone-700">
        {jaStatus(status)}: {ja.review.remaining} {items.length}
      </div>
      {current ? (
        <article className="rounded-lg border border-line bg-white p-5">
          <ReviewSummary place={current} />
          <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
            <button type="button" onClick={() => updateStatus([current.id], "enriched")} className="min-h-11 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-[#222A31]">{ja.review.approve}</button>
            <button type="button" onClick={() => confirmSourceUrl([current.id])} className="min-h-11 rounded-md border border-moss px-4 py-2 text-sm font-medium text-moss">元リンクを正として採用</button>
            <button type="button" onClick={() => updateStatus([current.id], "not_found")} className="min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium">{ja.review.markNotFound}</button>
            <button type="button" onClick={() => updateStatus([current.id], "pending_enrichment")} className="min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium">{ja.review.resetPending}</button>
            <button type="button" onClick={() => updateStatus([current.id], "error")} className="min-h-11 rounded-md border border-clay px-4 py-2 text-sm font-medium text-clay">{ja.review.markError}</button>
            {status === "place_id_candidate" ? (
              <>
                <button type="button" onClick={() => placeIdAction([current.id], "approve_place_id_candidate")} className="min-h-11 rounded-md border border-moss px-4 py-2 text-sm font-medium text-moss">Place ID候補を承認</button>
                <button type="button" onClick={() => placeIdAction([current.id], "reject_place_id_candidate")} className="min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium">候補を却下</button>
                <button type="button" onClick={() => placeIdAction([current.id], "keep_source_url_confirmed")} className="min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium">元リンク確認済みのまま</button>
              </>
            ) : null}
            <button type="button" onClick={() => skip(current.id)} className="min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium">{ja.review.skip}</button>
          </div>
          {message ? <div className="mt-3 text-sm text-stone-600">{message}</div> : null}
        </article>
      ) : null}
    </div>
  );
}

function StatusTabs({ counts, status, mode }: { counts: Props["initialCounts"]; status: string; mode: "card" | "list" }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
      {REVIEW_STATUSES.map((item) => (
        <Link
          key={item}
          href={`/review?status=${item}&mode=${mode}`}
          className={`inline-flex h-10 shrink-0 items-center rounded-md border px-4 text-sm font-medium ${item === status ? "border-moss bg-moss text-white" : "border-line bg-white text-ink"}`}
        >
          {jaStatus(item)} <span className="ml-1 opacity-80">{counts[item]}</span>
        </Link>
      ))}
    </div>
  );
}

function adjustCounts(counts: Props["initialCounts"], currentStatus: string, nextStatus: string, amount: number) {
  const next = { ...counts };
  if (isReviewStatus(currentStatus)) next[currentStatus] = Math.max(0, next[currentStatus] - amount);
  if (isReviewStatus(nextStatus)) next[nextStatus] += amount;
  return next;
}

function isReviewStatus(value: string): value is keyof Props["initialCounts"] {
  return REVIEW_STATUSES.includes(value as keyof Props["initialCounts"]);
}

function ReviewSummary({ place, compact = false }: { place: ReviewPlace; compact?: boolean }) {
  const classification = classificationWithRegionFallback(place);
  const links = (place.source_links ?? []).filter((link) => link.active !== false);
  const sourceName = sourceSavedName(place.raw_import, place.name);
  const googleName = googleDisplayName(place.raw_google);
  const sourceMapsUrl = sourceGoogleMapsUrl(place.raw_import);
  const enrichedMapsUrl = googleMapsUri(place.raw_google);
  const preferredMapsUrl = preferredGoogleMapsUrl({
    rawGoogle: place.raw_google,
    placeGoogleMapsUrl: place.google_maps_url,
    rawImport: place.raw_import,
    latitude: place.latitude,
    longitude: place.longitude
  });
  const nameDiff = hasNameDifference(sourceName, googleName);
  const urlDiff = hasUrlDifference(sourceMapsUrl, enrichedMapsUrl);
  const distanceDiff = sourceCandidateDistanceKm(place);
  const candidateOnly = isCandidateOnly(place.raw_google);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/places/${place.id}`} className="text-lg font-semibold text-ink hover:text-moss">
          {sourceName ?? place.name}
        </Link>
        {nameDiff ? <span className="rounded-md bg-clay px-2 py-1 text-xs font-semibold text-white">名称差分あり</span> : null}
        {urlDiff ? <span className="rounded-md bg-clay px-2 py-1 text-xs font-semibold text-white">URL差分あり</span> : null}
        {distanceDiff !== null && distanceDiff > 1.5 ? <span className="rounded-md bg-clay px-2 py-1 text-xs font-semibold text-white">距離差分あり</span> : null}
        <span className="rounded-md bg-paper px-2 py-1 text-xs text-stone-700">{jaCategory(classification?.main_category ?? "Other")}</span>
        {links.map((link) => (
          <span key={link.id ?? `${place.id}-${link.source_list_name}`} className="rounded-md border border-line px-2 py-0.5 text-xs">
            {jaDisplay(link.source_list_name)}
          </span>
        ))}
      </div>

      <div className={`mt-3 grid gap-2 text-sm ${compact ? "md:grid-cols-3" : "md:grid-cols-4"}`}>
        <Meta label="元CSVの保存名" value={sourceName} />
        <Meta label="Google補完後の名称" value={googleName} />
        <Meta label="元Google Maps URL" value={sourceMapsUrl ? "あり" : null} />
        <Meta label="補完後Google Maps URL" value={enrichedMapsUrl ? "あり" : null} />
        <Meta label="元リンク地点" value={sourceUrlInfoLabel(place)} />
        <Meta label="距離差分" value={distanceDiff !== null ? `${distanceDiff.toFixed(1)}km` : null} />
        <Meta label={ja.placeDetail.address} value={candidateOnly ? null : place.address} />
        <Meta label={ja.places.googleCategory} value={candidateOnly ? "補完候補" : googleTypeLabel(place)} />
        <Meta label={ja.places.rating} value={candidateOnly ? null : ratingLabel(place)} />
        <Meta label="都道府県" value={classification?.prefecture} />
        <Meta label="市区町村" value={regionCityLabel(classification)} />
        <Meta label={ja.places.area} value={classification?.area_label} />
        <Meta label={ja.places.travelRegion} value={classification?.travel_region} />
        <Meta label={ja.places.enrichmentStatus} value={jaStatus(place.enrichment_status)} />
        <Meta label="Place ID信頼度" value={placeIdConfidenceLabel(place.place_id_confidence)} />
        <Meta label="Place ID候補" value={placeIdCandidateLabel(place.place_id_candidate)} />
        <Meta label="Place ID確認理由" value={place.place_id_review_reason} />
        <Meta label="要確認理由" value={reviewReason(place, classification)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {preferredMapsUrl ? <Outbound href={preferredMapsUrl} label="Googleマップで開く" /> : null}
        {sourceMapsUrl ? <Outbound href={sourceMapsUrl} label="元Googleマップで開く" /> : null}
        {enrichedMapsUrl ? <Outbound href={enrichedMapsUrl} label="補完後Googleマップで開く" /> : null}
        {place.website_url ? <Outbound href={place.website_url} label={ja.places.openWebsite} /> : null}
      </div>
    </div>
  );
}

function classificationWithRegionFallback(place: ReviewPlace): Classification | null {
  const classification = firstClassification(place.place_classifications);
  if (!needsRegionFallback(classification)) return classification;
  const fallback = classifyRegion(normalizedItemForRegionFallback(place));
  return {
    ...(classification ?? {}),
    prefecture: regionValue(classification?.prefecture, fallback.prefecture),
    city: regionValue(classification?.city, fallback.city),
    ward: regionValue(classification?.ward, fallback.ward),
    area_label: regionValue(classification?.area_label, fallback.area_label),
    travel_region: regionValue(classification?.travel_region, fallback.travel_region)
  };
}

function firstClassification(value: ReviewPlace["place_classifications"]) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function needsRegionFallback(classification: Classification | null) {
  if (!classification) return true;
  return isEmpty(classification.prefecture) ||
    isEmpty(classification.city) ||
    isEmpty(classification.area_label) ||
    isEmpty(classification.travel_region);
}

function normalizedItemForRegionFallback(place: ReviewPlace): NormalizedImportItem {
  return {
    source_file: "review_fallback",
    source_list_name: null,
    name: place.name,
    address: place.address,
    google_maps_url: place.google_maps_url,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    notes: null,
    raw: { google: place.raw_google ?? {} },
    google_place_id: null,
    normalized_key: place.id
  };
}

function regionValue(current: string | null | undefined, fallback: string | null) {
  return isEmpty(current) ? fallback : current;
}

function Meta({ label, value }: { label: string; value: unknown }) {
  const empty = isEmpty(value);
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={empty ? "text-stone-400" : "font-medium text-ink"}>{jaDisplay(value)}</div>
    </div>
  );
}

function Outbound({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:border-moss">
      {label}
      <ExternalLink className="h-4 w-4" />
    </a>
  );
}

function googleTypeLabel(place: ReviewPlace) {
  return jaGooglePlaceTypes(place.primary_type, place.types);
}

function ratingLabel(place: ReviewPlace) {
  if (place.rating === null || place.rating === undefined) return null;
  const total = place.user_ratings_total === null || place.user_ratings_total === undefined ? "" : ` (${place.user_ratings_total}件)`;
  return `${place.rating}${total}`;
}

function placeIdConfidenceLabel(value: unknown) {
  const labels: Record<string, string> = { high: "高", medium: "中", low: "低", confirmed: "承認済み", rejected: "却下済み" };
  const text = String(value ?? "");
  return labels[text] ?? value;
}

function placeIdCandidateLabel(value: unknown) {
  const candidate = rawGoogleRecord(value);
  if (!candidate) return null;
  const displayName = rawGoogleRecord(candidate.displayName)?.text;
  const score = typeof candidate.score === "number" ? `score ${candidate.score.toFixed(2)}` : null;
  return [displayName, score].filter(Boolean).join(" / ");
}

function isEmpty(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "unknown" || text === "未分類";
}

function regionCityLabel(classification: Classification | null) {
  if (!classification) return null;
  return [classification.city, classification.ward].filter(Boolean).join("") || null;
}

function reviewReason(place: ReviewPlace, classification: Classification | null) {
  const rawReason = rawGoogleRecord(place.raw_google)?.review_reason;
  const weakName = hasWeakNameMatch(sourceSavedName(place.raw_import, place.name), googleDisplayName(place.raw_google));
  if (rawReason) return weakName && !String(rawReason).includes("名称一致") ? `名称一致が弱いです / ${String(rawReason)}` : rawReason;
  const sourceReview = reviewSourceUrlCandidate({
    name: place.name,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    google_maps_url: place.google_maps_url,
    raw_import: place.raw_import ?? null,
    raw_google: place.raw_google ?? null
  });
  if (sourceReview.reasons.length > 0) return sourceReview.reasons.join(" / ");
  if (weakName) return "名称一致が弱いです";
  if (place.enrichment_status === "coordinate_point") return "座標保存地点";
  if (classification?.reason) return humanizeReason(classification.reason, classification.confidence);
  if (place.enrichment_status === "not_found") return "Google Placesで見つかりませんでした";
  if (place.enrichment_status === "error") return "補完処理でエラーが発生しました";
  if (place.enrichment_status === "needs_review") return "候補の確認が必要です";
  return null;
}

function humanizeReason(reason: string, confidence: number | null | undefined) {
  if (reason.includes("text_search") && confidence !== null && confidence !== undefined && confidence < 0.55) {
    return "住所なしでText Searchしたため";
  }
  if (reason.includes("text_search")) return "Text Searchで補完しました";
  if (reason.includes("confidence") || (confidence !== null && confidence !== undefined && confidence < 0.55)) return "confidenceが低いです";
  if (reason.includes("api_error")) return "APIエラーが発生しました";
  return reason;
}

function rawGoogleRecord(raw: unknown) {
  return typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : null;
}

function sourceUrlInfoLabel(place: ReviewPlace) {
  const info = rawGoogleRecord(place.raw_google)?.source_url_review;
  const record = typeof info === "object" && info !== null
    ? info as Record<string, unknown>
    : parseGoogleMapsUrl(sourceGoogleMapsUrl(place.raw_import));
  if (record.name_hint) return String(record.name_hint);
  if (typeof record.latitude === "number" && typeof record.longitude === "number") return "座標あり";
  if (record.place_id) return "Place IDあり";
  return null;
}

function sourceCandidateDistanceKm(place: ReviewPlace) {
  const info = rawGoogleRecord(place.raw_google)?.source_url_review;
  const record = typeof info === "object" && info !== null
    ? info as Record<string, unknown>
    : parseGoogleMapsUrl(sourceGoogleMapsUrl(place.raw_import));
  const sourceLat = typeof record.latitude === "number" ? record.latitude : null;
  const sourceLng = typeof record.longitude === "number" ? record.longitude : null;
  if (sourceLat === null || sourceLng === null || place.latitude === null || place.latitude === undefined || place.longitude === null || place.longitude === undefined) return null;
  const radius = 6371;
  const dLat = toRad(place.latitude - sourceLat);
  const dLng = toRad(place.longitude - sourceLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(sourceLat)) * Math.cos(toRad(place.latitude)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return value * Math.PI / 180;
}
