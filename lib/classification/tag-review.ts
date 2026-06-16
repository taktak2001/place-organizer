import { RESTAURANT_CUISINE_TAGS } from "@/lib/classification/restaurant-cuisine";

export const TAG_REVIEW_STATUSES = ["unreviewed", "reviewed", "needs_check"] as const;
export type TagsReviewStatus = typeof TAG_REVIEW_STATUSES[number];

export const TAG_REVIEW_STATUS_LABELS: Record<TagsReviewStatus, string> = {
  unreviewed: "未確認",
  reviewed: "確認済み",
  needs_check: "要確認"
};

export const TAG_REVIEW_CATEGORIES = ["All", "Restaurant", "Cafe", "Fashion", "Art", "Hotel", "Bath", "Life", "Other"] as const;
export type TagReviewCategory = typeof TAG_REVIEW_CATEGORIES[number];

export const SCENE_TAGS = ["Date", "Business", "Solo", "Casual", "Group", "Travel", "High-end", "Local"] as const;

export const ART_SUB_CATEGORIES = ["Museum", "Gallery", "Art Center", "Architecture", "Art Shop", "Public Art", "Foundation", "Archive / Library", "Other Art"] as const;

export const TAG_OPTIONS: Record<string, readonly string[]> = {
  Restaurant: RESTAURANT_CUISINE_TAGS,
  Cafe: ["Work-friendly", "Relax", "Coffee", "Sweets", "Bakery", "Spacious", "Takeout", "Quiet", "Morning", "Night Cafe", "Other"],
  Fashion: ["Minimal", "Mode", "Street", "Vintage", "Shoes", "Jewelry", "Leather Goods", "Select Shop", "Brand Store", "Department Store", "Mens", "Womens", "Unisex", "Other"],
  Art: [],
  Hotel: ["Design Hotel", "Ryokan", "Resort", "Business Hotel", "Luxury", "Boutique", "Onsen", "Other"],
  Bath: ["Sauna", "Onsen", "Sento", "Spa", "Private Bath", "Hotel Bath", "Other"],
  Life: ["Park", "Temple / Shrine", "Bookstore", "Public Facility", "Landmark", "Nature", "Shopping", "Other"],
  Other: ["Park", "Temple / Shrine", "Bookstore", "Public Facility", "Landmark", "Nature", "Shopping", "Other"]
};

export function normalizeTagsReviewStatus(value: unknown): TagsReviewStatus {
  const text = String(value ?? "").trim();
  if (text === "reviewed" || text === "needs_check") return text;
  return "unreviewed";
}

export function categoryAllowsSubCategory(category: unknown) {
  return String(category ?? "") === "Art";
}

export function tagOptionsForCategory(category: unknown) {
  return TAG_OPTIONS[String(category ?? "")] ?? [];
}

export function normalizeTagArray(value: unknown, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map((item) => String(item ?? "").trim()).filter((item) => allowedSet.has(item)))];
}

export function normalizeSceneArray(value: unknown) {
  return normalizeTagArray(value, SCENE_TAGS);
}
