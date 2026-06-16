import { RESTAURANT_CUISINE_TAGS } from "@/lib/classification/restaurant-cuisine";
import { RESTAURANT_SCENE_TAGS } from "@/lib/classification/ai";

export const RESTAURANT_REVIEW_STATUSES = ["pending", "verified", "not_restaurant", "needs_check"] as const;
export type RestaurantReviewStatus = typeof RESTAURANT_REVIEW_STATUSES[number];

export const RESTAURANT_QUALITY_FLAG_LABELS: Record<string, string> = {
  missing_cuisine_tags: "料理ジャンル未設定",
  missing_scene_tags: "利用シーン未設定",
  other_cuisine_only: "料理ジャンルがその他のみ",
  invalid_cuisine_tags: "不明な料理ジャンル",
  invalid_scene_tags: "不明な利用シーン",
  missing_region: "地域未分類",
  missing_price_level: "価格帯未設定",
  source_url_confirmed_only: "元リンク確認済みのみ",
  candidate_only: "補完候補のみ",
  archived_place: "アーカイブ済み"
};

export type RestaurantQualityInput = {
  is_archived?: boolean | null;
  enrichment_status?: string | null;
  price_level?: number | string | null;
  raw_google?: Record<string, unknown> | null;
  classification?: {
    category_tags?: unknown;
    scene_tags?: unknown;
    area_label?: string | null;
    travel_region?: string | null;
    region_filter_label?: string | null;
  } | null;
};

export type RestaurantQualityResult = {
  flags: string[];
  reason: string;
  suggested_status: RestaurantReviewStatus;
};

const CUISINE_TAG_SET = new Set<string>(RESTAURANT_CUISINE_TAGS);
const SCENE_TAG_SET = new Set<string>(RESTAURANT_SCENE_TAGS);

export function inspectRestaurantQuality(input: RestaurantQualityInput): RestaurantQualityResult {
  const classification = input.classification ?? {};
  const cuisineTags = stringArray(classification.category_tags);
  const sceneTags = stringArray(classification.scene_tags);
  const flags = new Set<string>();

  if (input.is_archived === true) flags.add("archived_place");
  if (cuisineTags.length === 0) flags.add("missing_cuisine_tags");
  if (sceneTags.length === 0) flags.add("missing_scene_tags");
  if (cuisineTags.length === 1 && cuisineTags[0] === "Other") flags.add("other_cuisine_only");
  if (cuisineTags.some((tag) => !CUISINE_TAG_SET.has(tag))) flags.add("invalid_cuisine_tags");
  if (sceneTags.some((tag) => !SCENE_TAG_SET.has(tag))) flags.add("invalid_scene_tags");
  if (isMissingRegion(classification)) flags.add("missing_region");
  if (input.price_level === null || input.price_level === undefined || String(input.price_level).trim() === "") flags.add("missing_price_level");
  if (input.enrichment_status === "source_url_confirmed") flags.add("source_url_confirmed_only");
  if (isCandidateOnly(input.raw_google)) flags.add("candidate_only");

  const resultFlags = [...flags].sort();
  return {
    flags: resultFlags,
    reason: resultFlags.map((flag) => RESTAURANT_QUALITY_FLAG_LABELS[flag] ?? flag).join(" / ") || "品質フラグなし",
    suggested_status: resultFlags.length > 0 ? "needs_check" : "pending"
  };
}

export function isRestaurantReviewStatus(value: unknown): value is RestaurantReviewStatus {
  return RESTAURANT_REVIEW_STATUSES.includes(value as RestaurantReviewStatus);
}

export function restaurantQualityFlagLabel(flag: unknown) {
  const key = String(flag ?? "");
  return RESTAURANT_QUALITY_FLAG_LABELS[key] ?? key;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function isMissingRegion(classification: RestaurantQualityInput["classification"]) {
  return [classification?.region_filter_label, classification?.travel_region, classification?.area_label]
    .map((value) => String(value ?? "").trim())
    .every((value) => !value || value === "Unknown" || value === "未分類");
}

function isCandidateOnly(rawGoogle: unknown) {
  if (typeof rawGoogle !== "object" || rawGoogle === null) return false;
  const raw = rawGoogle as Record<string, unknown>;
  return raw.candidate_only === true || Boolean(raw.candidate_place);
}
