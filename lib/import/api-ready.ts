import fs from "node:fs";
import path from "node:path";

export type ApiStrategy =
  | "place_id_details"
  | "coordinate_bias_search"
  | "query_with_bias"
  | "source_url_only"
  | "manual_review";

export type RiskFlag =
  | "text_search_only_risky"
  | "chain_or_multi_location_risk"
  | "generic_name_risk"
  | "cid_not_directly_supported"
  | "no_coordinates"
  | "no_place_id"
  | "short_url_expansion_failed"
  | "coordinate_only"
  | "event_or_exhibition_name";

export type ApiReadyRecord = {
  source_list_name: string;
  source_title: string;
  source_url: string | null;
  source_tags: string[];
  source_memo: string | null;
  source_comment: string | null;
  url_type: string;
  expanded_url: string | null;
  extracted_place_id: string | null;
  extracted_cid: string | null;
  extracted_query: string | null;
  extracted_lat: number | null;
  extracted_lng: number | null;
  extracted_name_hint: string | null;
  api_strategy: ApiStrategy;
  should_call_places_api: boolean;
  confidence: number;
  risk_flags: RiskFlag[];
  reason: string;
};

export const DANGEROUS_API_READY_RISK_FLAGS: RiskFlag[] = [
  "chain_or_multi_location_risk",
  "generic_name_risk",
  "event_or_exhibition_name",
  "text_search_only_risky",
  "cid_not_directly_supported"
];

export function loadApiReadyRecords(filePath = defaultApiReadyPath()) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(parsed) ? parsed as ApiReadyRecord[] : [];
}

export function defaultApiReadyPath() {
  return path.join(process.cwd(), "data", "derived", "api-ready-places.json");
}

export function buildApiReadyIndex(records: ApiReadyRecord[]) {
  const byUrl = new Map<string, ApiReadyRecord>();
  const byListTitle = new Map<string, ApiReadyRecord>();
  for (const record of records) {
    const urlKey = normalizeApiReadyUrl(record.source_url);
    if (urlKey) byUrl.set(urlKey, record);
    byListTitle.set(listTitleKey(record.source_list_name, record.source_title), record);
  }
  return { byUrl, byListTitle };
}

export function findApiReadyRecord(
  index: ReturnType<typeof buildApiReadyIndex>,
  input: { sourceUrl?: string | null; sourceListNames?: Array<string | null | undefined>; title?: string | null }
) {
  const urlKey = normalizeApiReadyUrl(input.sourceUrl);
  if (urlKey && index.byUrl.has(urlKey)) return index.byUrl.get(urlKey) ?? null;
  for (const listName of input.sourceListNames ?? []) {
    const key = listTitleKey(listName ?? "", input.title ?? "");
    if (index.byListTitle.has(key)) return index.byListTitle.get(key) ?? null;
  }
  return null;
}

export function hasDangerousApiReadyRisk(record: ApiReadyRecord | null | undefined) {
  if (!record) return false;
  return record.risk_flags.some((flag) => DANGEROUS_API_READY_RISK_FLAGS.includes(flag));
}

export function summarizeApiReadyRecords(records: ApiReadyRecord[]) {
  return {
    by_api_strategy: countBy(records.map((record) => record.api_strategy)),
    risk_flag_counts: countBy(records.flatMap((record) => record.risk_flags))
  };
}

export function normalizeApiReadyUrl(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    url.hash = "";
    return url.toString();
  } catch {
    return text;
  }
}

export function listTitleKey(listName: string | null | undefined, title: string | null | undefined) {
  return `${normalizeText(listName)}::${normalizeText(title)}`;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
