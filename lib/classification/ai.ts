import { classifyPlace } from "./category";
import type { NormalizedImportItem, PlaceClassification } from "@/types/import";

export const MAIN_CATEGORIES = ["Art", "Cafe", "Restaurant", "Fashion", "Hotel", "Bath", "Hospital", "Life", "Other"] as const;
export const ART_SUB_CATEGORIES = ["Museum", "Gallery", "Art Center", "Architecture", "Art Shop", "Public Art", "Foundation", "Archive / Library", "Other Art"] as const;
export const RESTAURANT_SCENE_TAGS = ["Date", "Business", "Solo", "Casual", "Group", "Travel", "High-end", "Local"] as const;

export type AIClassificationInput = {
  original_name: string | null;
  source_list_names: string[];
  current_name: string;
  address: string | null;
  google_maps_url: string | null;
  primary_type: string | null;
  types: string[];
  website_url: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  country: string | null;
  prefecture: string | null;
  city: string | null;
  ward: string | null;
  raw_google_summary: Record<string, unknown>;
  raw_import_summary: Record<string, unknown>;
  rule_based: PlaceClassification;
};

export type AIClassificationResult = PlaceClassification & {
  ai_raw: Record<string, unknown>;
  ai_model: string;
};

type Options = {
  apiKey?: string;
  model?: string;
};

const DEFAULT_MODEL = "gpt-4o-mini";

export async function classifyPlaceWithAI(input: AIClassificationInput, options: Options = {}): Promise<AIClassificationResult> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が未設定です。.env.local に OPENAI_API_KEY を設定してください。");
  }
  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const raw = await callOpenAI(input, apiKey, model);
  return normalizeAIOutput(raw, input.rule_based, model);
}

export function buildAIClassificationInput(place: Record<string, unknown>): AIClassificationInput {
  const classification = firstRelated(place.place_classifications);
  const rawGoogle = record(place.raw_google);
  const rawImport = record(place.raw_import);
  const types = Array.isArray(place.types) ? place.types.map(String) : [];
  const sourceListNames = Array.isArray(place.source_links)
    ? place.source_links
      .filter((link) => record(link)?.active !== false)
      .map((link) => String(record(link)?.source_list_name ?? ""))
      .filter(Boolean)
    : [];
  const ruleBased = classifyPlace(toNormalizedItem(place, sourceListNames[0] ?? null));

  return {
    original_name: sourceName(rawImport) ?? stringOrNull(place.name),
    source_list_names: sourceListNames,
    current_name: String(place.name ?? ""),
    address: stringOrNull(place.address),
    google_maps_url: stringOrNull(place.google_maps_url),
    primary_type: stringOrNull(place.primary_type),
    types,
    website_url: stringOrNull(place.website_url),
    rating: numberOrNull(place.rating),
    user_ratings_total: numberOrNull(place.user_ratings_total),
    country: stringOrNull(classification?.country),
    prefecture: stringOrNull(classification?.prefecture),
    city: stringOrNull(classification?.city),
    ward: stringOrNull(classification?.ward),
    raw_google_summary: summarizeRawGoogle(rawGoogle),
    raw_import_summary: summarizeRawImport(rawImport),
    rule_based: ruleBased
  };
}

export function normalizeAIOutput(raw: Record<string, unknown>, fallback: PlaceClassification, model = DEFAULT_MODEL): AIClassificationResult {
  const main = oneOf(raw.main_category, MAIN_CATEGORIES) ?? fallback.main_category;
  const subCategory = main === "Art"
    ? oneOf(raw.sub_category, ART_SUB_CATEGORIES) ?? fallback.sub_category ?? "Other Art"
    : null;
  const sceneTags = main === "Restaurant"
    ? arraySubset(raw.scene_tags, RESTAURANT_SCENE_TAGS, fallback.scene_tags)
    : [];
  return {
    main_category: main,
    sub_category: subCategory,
    scene_tags: sceneTags,
    country: cleanText(raw.country) ?? fallback.country,
    prefecture: cleanText(raw.prefecture) ?? fallback.prefecture,
    city: cleanText(raw.city) ?? fallback.city,
    ward: cleanText(raw.ward) ?? fallback.ward,
    area_label: cleanText(raw.area_label) ?? fallback.area_label,
    nearest_station: cleanText(raw.nearest_station) ?? fallback.nearest_station,
    travel_region: cleanText(raw.travel_region) ?? fallback.travel_region,
    priority: fallback.priority,
    visited_status: fallback.visited_status,
    confidence: clampConfidence(raw.confidence, fallback.confidence),
    reason: cleanText(raw.reason) ?? fallback.reason,
    ai_raw: raw,
    ai_model: model
  };
}

export function classificationToDbPayload(result: AIClassificationResult, source = "ai") {
  return {
    main_category: result.main_category,
    sub_category: result.sub_category,
    scene_tags: result.scene_tags,
    country: result.country,
    prefecture: result.prefecture,
    city: result.city,
    ward: result.ward,
    area_label: result.area_label,
    nearest_station: result.nearest_station,
    travel_region: result.travel_region,
    confidence: result.confidence,
    reason: result.reason,
    classification_source: source,
    ai_raw: result.ai_raw,
    ai_model: result.ai_model,
    ai_classified_at: new Date().toISOString()
  };
}

async function callOpenAI(input: AIClassificationInput, apiKey: string, model: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: JSON.stringify(compactInput(input)) }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
  }
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI API response did not include JSON content.");
  return JSON.parse(content) as Record<string, unknown>;
}

function systemPrompt() {
  return [
    "You classify saved Google Maps places for a private place organizer.",
    "Return JSON only.",
    `main_category must be one of: ${MAIN_CATEGORIES.join(", ")}.`,
    `Art sub_category must be one of: ${ART_SUB_CATEGORIES.join(", ")}.`,
    `Restaurant scene_tags must be a subset of: ${RESTAURANT_SCENE_TAGS.join(", ")}.`,
    "Use source list names as strong hints. Art list means Art, Cafe list means Cafe, Restaurant list means Restaurant, Fashion list means Fashion, Hotel list means Hotel, 風呂 list means Bath.",
    "Do not invent exact addresses if unknown.",
    "If unsure, use Other or Other Art.",
    "For region, prefer concise common area labels such as 六本木, 中目黒, 銀座, 京橋, 日本橋, 表参道, 青山, 渋谷, 代官山, 恵比寿, 清澄白河, 上野, 丸の内, 日比谷, 京都, 箱根, 軽井沢, 金沢, 直島, 瀬戸内, Paris, Paris 14e, Arles, Seoul, New York, Los Angeles, London.",
    "Output keys: main_category, sub_category, scene_tags, country, prefecture, city, ward, area_label, nearest_station, travel_region, confidence, reason."
  ].join("\n");
}

function compactInput(input: AIClassificationInput) {
  return {
    original_name: input.original_name,
    source_list_names: input.source_list_names,
    current_name: input.current_name,
    address: input.address,
    primary_type: input.primary_type,
    types: input.types,
    website_url_exists: Boolean(input.website_url),
    rating: input.rating,
    user_ratings_total: input.user_ratings_total,
    existing_region: {
      country: input.country,
      prefecture: input.prefecture,
      city: input.city,
      ward: input.ward
    },
    raw_google_summary: input.raw_google_summary,
    raw_import_summary: input.raw_import_summary,
    rule_based: input.rule_based
  };
}

function toNormalizedItem(place: Record<string, unknown>, sourceListName: string | null): NormalizedImportItem {
  return {
    source_file: "ai_classification",
    source_list_name: sourceListName,
    name: String(place.name ?? ""),
    address: stringOrNull(place.address),
    google_maps_url: stringOrNull(place.google_maps_url),
    latitude: numberOrNull(place.latitude),
    longitude: numberOrNull(place.longitude),
    notes: null,
    raw: { google: record(place.raw_google) ?? {} },
    google_place_id: stringOrNull(place.google_place_id),
    normalized_key: String(place.normalized_key ?? place.id ?? "")
  };
}

function summarizeRawGoogle(raw: Record<string, unknown> | null) {
  const candidate = record(raw?.candidate_place);
  const source = candidate ?? raw;
  return {
    displayName: displayName(source),
    formattedAddress: source?.formattedAddress ?? source?.formatted_address ?? null,
    primaryType: source?.primaryType ?? source?.primary_type ?? null,
    types: Array.isArray(source?.types) ? source?.types.slice(0, 12) : [],
    businessStatus: source?.businessStatus ?? source?.business_status ?? null
  };
}

function summarizeRawImport(raw: Record<string, unknown> | null) {
  return {
    name: sourceName(raw),
    has_url: Boolean(raw && Object.keys(raw).some((key) => /url|link|リンク/i.test(key) && String(raw[key] ?? "").trim()))
  };
}

function displayName(raw: Record<string, unknown> | null) {
  const display = record(raw?.displayName);
  return cleanText(display?.text) ?? cleanText(raw?.name);
}

function sourceName(raw: Record<string, unknown> | null) {
  if (!raw) return null;
  for (const key of ["name", "title", "タイトル", "place name", "location name", "場所名", "名前", "名称", "label", "placeName"]) {
    const found = Object.entries(raw).find(([candidate]) => candidate.trim().toLowerCase() === key.toLowerCase());
    const text = cleanText(found?.[1]);
    if (text) return text;
  }
  return null;
}

function firstRelated(value: unknown) {
  if (Array.isArray(value)) return record(value[0]);
  return record(value);
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  const text = cleanText(value);
  return allowed.find((item) => item.toLowerCase() === text?.toLowerCase()) ?? null;
}

function arraySubset<T extends readonly string[]>(value: unknown, allowed: T, fallback: string[]) {
  const input = Array.isArray(value) ? value : [];
  const valid = input.map((item) => oneOf(item, allowed)).filter(Boolean) as T[number][];
  return [...new Set(valid.length > 0 ? valid : fallback.filter((item) => allowed.includes(item)))];
}

function clampConfidence(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function record(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text && text !== "Unknown" ? text : null;
}

function stringOrNull(value: unknown) {
  return cleanText(value);
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
