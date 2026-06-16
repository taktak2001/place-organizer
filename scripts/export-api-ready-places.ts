import fs from "node:fs";
import path from "node:path";
import { isGenericOrChainLikeName, parseGoogleMapsUrl, resolveGoogleMapsRedirect, type GoogleMapsUrlInfo } from "../lib/import/google-maps-url";
import { readPrivateCsvData } from "./private-data";

type UrlType = "place_url" | "search_url" | "short_url" | "coordinate_url" | "cid_url" | "query_url" | "unknown_url";
type ApiStrategy = "place_id_details" | "coordinate_bias_search" | "query_with_bias" | "source_url_only" | "manual_review";
type RiskFlag =
  | "text_search_only_risky"
  | "chain_or_multi_location_risk"
  | "generic_name_risk"
  | "cid_not_directly_supported"
  | "no_coordinates"
  | "no_place_id"
  | "short_url_expansion_failed"
  | "coordinate_only"
  | "event_or_exhibition_name";

type Options = {
  limit: number | null;
  list: string | null;
  json: boolean;
  csv: boolean;
};

type ApiReadyRecord = {
  source_list_name: string;
  source_title: string;
  source_url: string | null;
  source_tags: string[];
  source_memo: string | null;
  source_comment: string | null;
  url_type: UrlType;
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

type Summary = {
  total_count: number;
  by_url_type: Record<string, number>;
  by_api_strategy: Record<string, number>;
  should_call_places_api_count: number;
  manual_review_count: number;
  risk_flag_counts: Record<string, number>;
  by_source_list_name: Record<string, number>;
  place_id_count: number;
  cid_count: number;
  coordinate_count: number;
  query_count: number;
  short_url_count: number;
  parse_failed_count: number;
};

const OUTPUT_DIR = path.join(process.cwd(), "data", "derived");
const JSON_OUTPUT = path.join(OUTPUT_DIR, "api-ready-places.json");
const CSV_OUTPUT = path.join(OUTPUT_DIR, "api-ready-places.csv");
const SUMMARY_OUTPUT = path.join(OUTPUT_DIR, "api-ready-summary.json");

async function main() {
  const options = parseArgs();
  log("start");
  log(`list filter: ${options.list ?? "all"}`);
  log(`limit: ${options.limit ?? "all"}`);

  const rows = selectItems(readPrivateCsvData().items, options);
  const records: ApiReadyRecord[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    records.push(await toApiReadyRecord(rows[index]));
  }

  const summary = summarize(records);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(records, null, 2)}\n`);
  fs.writeFileSync(CSV_OUTPUT, toCsv(records));
  fs.writeFileSync(SUMMARY_OUTPUT, `${JSON.stringify(summary, null, 2)}\n`);

  const logSummary = {
    total_count: summary.total_count,
    parse_success_count: summary.total_count - summary.parse_failed_count,
    by_url_type: summary.by_url_type,
    by_api_strategy: summary.by_api_strategy,
    risk_flag_counts: summary.risk_flag_counts,
    requested_format: options.json ? "json" : options.csv ? "csv" : "all",
    output_paths: {
      json: JSON_OUTPUT,
      csv: CSV_OUTPUT,
      summary: SUMMARY_OUTPUT
    }
  };

  log("done");
  console.log(JSON.stringify(logSummary, null, 2));
}

function selectItems(items: ReturnType<typeof readPrivateCsvData>["items"], options: Options) {
  const filtered = options.list
    ? items.filter((item) => String(item.source_list_name ?? "").toLowerCase() === options.list!.toLowerCase())
    : items;
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}

async function toApiReadyRecord(item: ReturnType<typeof readPrivateCsvData>["items"][number]): Promise<ApiReadyRecord> {
  const sourceUrl = cleanText(item.google_maps_url);
  const originalInfo = parseGoogleMapsUrl(sourceUrl);
  const expandedUrl = sourceUrl ? await resolveGoogleMapsRedirect(sourceUrl) : null;
  const resolvedInfo = parseGoogleMapsUrl(expandedUrl);
  const info: GoogleMapsUrlInfo = { ...resolvedInfo, original_url: sourceUrl, resolved_url: expandedUrl };
  const urlType = classifyUrlType(sourceUrl, expandedUrl, info, originalInfo);
  const sourceTitle = item.name;
  const riskFlags = riskFlagsFor({ item, info, sourceTitle, sourceUrl, expandedUrl, urlType });
  const strategy = strategyFor(info, urlType, riskFlags);
  const tags = sourceTags(item.raw);

  return {
    source_list_name: item.source_list_name ?? listNameFromFile(item.source_file),
    source_title: sourceTitle,
    source_url: sourceUrl,
    source_tags: tags,
    source_memo: rawField(item.raw, "メモ"),
    source_comment: rawField(item.raw, "コメント"),
    url_type: urlType,
    expanded_url: expandedUrl,
    extracted_place_id: info.place_id,
    extracted_cid: info.cid,
    extracted_query: info.query,
    extracted_lat: info.latitude,
    extracted_lng: info.longitude,
    extracted_name_hint: info.name_hint,
    api_strategy: strategy.api_strategy,
    should_call_places_api: strategy.should_call_places_api,
    confidence: strategy.confidence,
    risk_flags: riskFlags,
    reason: strategy.reason
  };
}

function classifyUrlType(original: string | null, expanded: string | null, info: GoogleMapsUrlInfo, originalInfo: GoogleMapsUrlInfo): UrlType {
  if (!original || !isValidUrl(original)) return "unknown_url";
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(original)) return "short_url";
  const text = `${original} ${expanded ?? ""}`.toLowerCase();
  if (/\/maps\/place\//i.test(text) || info.place_id || originalInfo.place_id) return "place_url";
  if (info.cid || originalInfo.cid || /[?&](cid|ludocid)=/.test(text)) return "cid_url";
  if (info.latitude !== null && info.longitude !== null) return "coordinate_url";
  if (/\/maps\/search\//i.test(text)) return "search_url";
  if (info.query || originalInfo.query || /[?&](q|query)=/.test(text)) return "query_url";
  return "unknown_url";
}

function strategyFor(info: GoogleMapsUrlInfo, urlType: UrlType, riskFlags: RiskFlag[]) {
  if (info.place_id) {
    return {
      api_strategy: "place_id_details" as const,
      should_call_places_api: true,
      confidence: 0.95,
      reason: "URLからplace_idを抽出できるためPlace Details対象です。"
    };
  }

  const hasCoordinates = info.latitude !== null && info.longitude !== null;
  const hasQuery = Boolean(info.query || info.name_hint);
  if (hasCoordinates && hasQuery) {
    return {
      api_strategy: "coordinate_bias_search" as const,
      should_call_places_api: true,
      confidence: 0.72,
      reason: "URL由来の座標とquery/name hintを使って周辺候補を確認します。"
    };
  }

  if (info.cid && hasQuery) {
    const risky = riskFlags.some((flag) => flag === "chain_or_multi_location_risk" || flag === "generic_name_risk" || flag === "event_or_exhibition_name");
    return {
      api_strategy: risky ? "source_url_only" as const : "query_with_bias" as const,
      should_call_places_api: !risky,
      confidence: risky ? 0.38 : 0.55,
      reason: risky
        ? "CIDは直接解決できず、名称リスクがあるため元URL保持を優先します。"
        : "CIDは直接解決できませんが、URL由来queryで補助確認できます。"
    };
  }

  if (hasQuery) {
    return {
      api_strategy: "manual_review" as const,
      should_call_places_api: false,
      confidence: 0.25,
      reason: "queryのみでText Search単独依存になるためレビュー対象です。"
    };
  }

  if (hasCoordinates) {
    return {
      api_strategy: "source_url_only" as const,
      should_call_places_api: false,
      confidence: 0.35,
      reason: "座標のみの保存地点として元URL保持を優先します。"
    };
  }

  return {
    api_strategy: urlType === "unknown_url" ? "manual_review" as const : "source_url_only" as const,
    should_call_places_api: false,
    confidence: 0.1,
    reason: "URLからAPIに安全に渡せる情報を抽出できません。"
  };
}

function riskFlagsFor(input: {
  item: ReturnType<typeof readPrivateCsvData>["items"][number];
  info: GoogleMapsUrlInfo;
  sourceTitle: string;
  sourceUrl: string | null;
  expandedUrl: string | null;
  urlType: UrlType;
}): RiskFlag[] {
  const flags = new Set<RiskFlag>();
  const titleAndHint = [input.sourceTitle, input.info.name_hint, input.info.query].filter(Boolean).join(" ");
  if (isGenericOrChainLikeName(titleAndHint)) flags.add("chain_or_multi_location_risk");
  if (isGenericName(titleAndHint)) flags.add("generic_name_risk");
  if (input.info.cid) flags.add("cid_not_directly_supported");
  if (!input.info.place_id) flags.add("no_place_id");
  if (input.info.latitude === null || input.info.longitude === null) flags.add("no_coordinates");
  if (input.urlType === "short_url" && input.sourceUrl === input.expandedUrl) flags.add("short_url_expansion_failed");
  if (input.info.latitude !== null && input.info.longitude !== null && !input.info.query && !input.info.name_hint) flags.add("coordinate_only");
  if (/展覧会|展示|個展|企画展|teamlab|チームラボ/i.test(titleAndHint)) flags.add("event_or_exhibition_name");
  if (!input.info.place_id && !input.info.cid && (input.info.query || input.info.name_hint) && input.info.latitude === null) flags.add("text_search_only_risky");
  return [...flags].sort();
}

function summarize(records: ApiReadyRecord[]): Summary {
  return {
    total_count: records.length,
    by_url_type: countBy(records.map((record) => record.url_type)),
    by_api_strategy: countBy(records.map((record) => record.api_strategy)),
    should_call_places_api_count: records.filter((record) => record.should_call_places_api).length,
    manual_review_count: records.filter((record) => record.api_strategy === "manual_review").length,
    risk_flag_counts: countBy(records.flatMap((record) => record.risk_flags)),
    by_source_list_name: countBy(records.map((record) => record.source_list_name)),
    place_id_count: records.filter((record) => record.extracted_place_id).length,
    cid_count: records.filter((record) => record.extracted_cid).length,
    coordinate_count: records.filter((record) => record.extracted_lat !== null && record.extracted_lng !== null).length,
    query_count: records.filter((record) => record.extracted_query || record.extracted_name_hint).length,
    short_url_count: records.filter((record) => record.url_type === "short_url").length,
    parse_failed_count: records.filter((record) => record.url_type === "unknown_url").length
  };
}

function toCsv(records: ApiReadyRecord[]) {
  const columns: Array<keyof ApiReadyRecord> = [
    "source_list_name",
    "source_title",
    "source_url",
    "source_tags",
    "source_memo",
    "source_comment",
    "url_type",
    "expanded_url",
    "extracted_place_id",
    "extracted_cid",
    "extracted_query",
    "extracted_lat",
    "extracted_lng",
    "extracted_name_hint",
    "api_strategy",
    "should_call_places_api",
    "confidence",
    "risk_flags",
    "reason"
  ];
  const lines = [columns.join(",")];
  for (const record of records) {
    lines.push(columns.map((column) => csvCell(record[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function sourceTags(raw: Record<string, unknown>) {
  const tags = rawField(raw, "タグ");
  return tags ? tags.split(/[、,|]/).map((tag) => tag.trim()).filter(Boolean) : [];
}

function rawField(raw: Record<string, unknown>, key: string) {
  const found = Object.entries(raw).find(([candidate]) => candidate.trim().toLowerCase() === key.toLowerCase());
  const text = String(found?.[1] ?? "").trim();
  return text || null;
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function listNameFromFile(value: string) {
  return path.basename(value).replace(/\.[^.]+$/, "");
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isGenericName(value: string) {
  const normalized = value.toLowerCase().normalize("NFKC").replace(/[^\p{Letter}\p{Number}]+/gu, "");
  return normalized.length <= 6 || /^(cafe|coffee|gallery|hotel|museum|restaurant|shop|store|bar|art)$/i.test(value.trim());
}

function parseArgs(): Options {
  const limit = Number(valueAfter("--limit") ?? "");
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null,
    list: valueAfter("--list"),
    json: process.argv.includes("--json"),
    csv: process.argv.includes("--csv")
  };
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function log(message: string) {
  console.log(`[export:api-ready] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
  process.exit(1);
});
