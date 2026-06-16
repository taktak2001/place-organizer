import fs from "node:fs";
import path from "node:path";
import { distanceKm, parseGoogleMapsUrl, resolveGoogleMapsRedirect, type GoogleMapsUrlInfo } from "../lib/import/google-maps-url";
import { hasUrlDifference, normalizedNameSimilarity } from "../lib/import/source-fields";
import { readPrivateCsvData } from "./private-data";

const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "googleMapsUri",
  "primaryType",
  "types",
  "businessStatus",
  "rating",
  "userRatingCount"
].join(",");
const TEXT_SEARCH_FIELD_MASK = `places.${DETAILS_FIELD_MASK.split(",").join(",places.")}`;

type UrlType = "place_url" | "search_url" | "short_url" | "coordinate_url" | "cid_url" | "query_url" | "unknown_url" | "invalid_url";
type SampleMode = "first" | "random";

type Options = {
  limit: number;
  list: string | null;
  sample: SampleMode;
  json: boolean;
  resolve: boolean;
  verbose: boolean;
};

type SourceUrlRow = {
  title: string;
  source_list_name: string;
  url: string | null;
  tags: string | null;
  comment: string | null;
  memo: string | null;
};

type ParsedRow = SourceUrlRow & {
  url_type: UrlType;
  resolved_url: string | null;
  info: GoogleMapsUrlInfo;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
};

type ResolveResult = {
  strategy: "place_id" | "coordinates" | "query_with_bias" | "text_search" | "unresolved" | "manual_review";
  place: GooglePlace | null;
  needs_manual_review: boolean;
  risky_text_search_only: boolean;
  warning: string | null;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  const rows = selectRows(readRows(), options);
  log(options, "start");
  log(options, `selected rows: ${rows.length}`);

  const parsedRows: ParsedRow[] = [];
  for (const row of rows) {
    const parsed = await parseSourceUrl(row);
    parsedRows.push(parsed);
  }

  const parseSummary = summarizeParsedRows(parsedRows);
  const output: Record<string, unknown> = {
    status: "completed",
    source: "data/private",
    list_filter: options.list,
    limit: options.limit,
    ...parseSummary
  };

  if (options.resolve) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY が未設定です。.env.local に GOOGLE_MAPS_API_KEY を設定してください。");
    const resolved = [];
    for (let index = 0; index < parsedRows.length; index += 1) {
      log(options, `resolve ${index + 1}/${parsedRows.length}`);
      resolved.push({ row: parsedRows[index], result: await resolveOne(parsedRows[index], apiKey) });
      await sleep(120);
    }
    Object.assign(output, summarizeResolvedRows(resolved));
    if (options.verbose) output.samples = verboseSamples(resolved);
  }

  printOutput(options, output);
}

function readRows(): SourceUrlRow[] {
  const data = readPrivateCsvData();
  return data.items.map((item) => ({
    title: item.name,
    source_list_name: item.source_list_name ?? listNameFromFile(item.source_file),
    url: item.google_maps_url,
    tags: rawField(item.raw, "タグ"),
    comment: rawField(item.raw, "コメント"),
    memo: rawField(item.raw, "メモ")
  }));
}

function selectRows(rows: SourceUrlRow[], options: Options) {
  const filtered = options.list
    ? rows.filter((row) => row.source_list_name.toLowerCase() === options.list!.toLowerCase())
    : rows;
  const sampled = options.sample === "random" ? shuffle([...filtered]) : filtered;
  return sampled.slice(0, options.limit);
}

async function parseSourceUrl(row: SourceUrlRow): Promise<ParsedRow> {
  const originalInfo = parseGoogleMapsUrl(row.url);
  const resolvedUrl = row.url ? await resolveGoogleMapsRedirect(row.url) : row.url;
  const info = parseGoogleMapsUrl(resolvedUrl);
  return {
    ...row,
    resolved_url: resolvedUrl,
    info: { ...info, original_url: row.url, resolved_url: resolvedUrl },
    url_type: classifyUrlType(row.url, resolvedUrl, info, originalInfo)
  };
}

function classifyUrlType(original: string | null, resolved: string | null, info: GoogleMapsUrlInfo, originalInfo: GoogleMapsUrlInfo): UrlType {
  if (!original) return "invalid_url";
  if (!isValidUrl(original)) return "invalid_url";
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(original)) return "short_url";
  const text = `${original} ${resolved ?? ""}`.toLowerCase();
  if (/\/maps\/place\//i.test(text) || info.place_id || originalInfo.place_id) return "place_url";
  if (info.cid || originalInfo.cid || /[?&](cid|ludocid)=/.test(text)) return "cid_url";
  if (info.latitude !== null && info.longitude !== null) return "coordinate_url";
  if (/\/maps\/search\//i.test(text)) return "search_url";
  if (info.query || originalInfo.query || /[?&](q|query)=/.test(text)) return "query_url";
  return /google\.[^/]+\/maps|maps\.google\./i.test(text) ? "unknown_url" : "invalid_url";
}

function summarizeParsedRows(rows: ParsedRow[]) {
  const counts = countBy(rows.map((row) => row.url_type));
  return {
    total_checked: rows.length,
    parse_success_count: rows.filter((row) => row.url_type !== "invalid_url" && row.url_type !== "unknown_url").length,
    parse_failed_count: rows.filter((row) => row.url_type === "invalid_url" || row.url_type === "unknown_url").length,
    has_place_id_count: rows.filter((row) => row.info.place_id).length,
    has_cid_count: rows.filter((row) => row.info.cid).length,
    has_coordinates_count: rows.filter((row) => row.info.latitude !== null && row.info.longitude !== null).length,
    has_query_count: rows.filter((row) => row.info.query || row.info.name_hint).length,
    short_url_count: counts.short_url ?? 0,
    search_url_count: counts.search_url ?? 0,
    place_url_count: counts.place_url ?? 0,
    unknown_url_count: counts.unknown_url ?? 0,
    invalid_url_count: counts.invalid_url ?? 0,
    url_type_counts: counts
  };
}

async function resolveOne(row: ParsedRow, apiKey: string): Promise<ResolveResult> {
  const info = row.info;
  if (info.place_id) {
    const place = await fetchPlaceDetails(apiKey, info.place_id);
    return { strategy: "place_id", place, needs_manual_review: !place, risky_text_search_only: false, warning: place ? null : "place_idで解決できませんでした" };
  }
  const cidWarning = info.cid ? "CIDは現行Places APIで直接解決できないためURL由来queryで補助確認しました" : null;
  if (info.cid) {
    if (!info.query && !info.name_hint && info.latitude === null) {
      return { strategy: "manual_review", place: null, needs_manual_review: true, risky_text_search_only: false, warning: "CIDは現行Places APIで直接解決できないため手動確認対象です" };
    }
  }
  const coordinateBias = info.latitude !== null && info.longitude !== null ? { latitude: info.latitude, longitude: info.longitude } : null;
  const query = info.query ?? info.name_hint;
  if (coordinateBias && (query || row.title)) {
    const place = await firstTextSearchResult(apiKey, query ?? row.title, coordinateBias);
    return { strategy: "coordinates", place, needs_manual_review: !isCloseToSource(info, place), risky_text_search_only: false, warning: place ? cidWarning : cidWarning ?? "座標周辺で候補が見つかりませんでした" };
  }
  if (query) {
    const place = await firstTextSearchResult(apiKey, query, null);
    return { strategy: "query_with_bias", place, needs_manual_review: !place || Boolean(cidWarning), risky_text_search_only: false, warning: place ? cidWarning : cidWarning ?? "URL由来queryで候補が見つかりませんでした" };
  }
  if (row.title) {
    const place = await firstTextSearchResult(apiKey, row.title, null);
    return { strategy: "text_search", place, needs_manual_review: true, risky_text_search_only: true, warning: "タイトルだけのText Searchです" };
  }
  return { strategy: "unresolved", place: null, needs_manual_review: true, risky_text_search_only: false, warning: "URLから解決情報を抽出できませんでした" };
}

function summarizeResolvedRows(resolved: Array<{ row: ParsedRow; result: ResolveResult }>) {
  const comparison = resolved.map(({ row, result }) => compareResult(row, result.place));
  const resolvedByUrlInfo = resolved.filter(({ result }) => ["place_id", "coordinates", "query_with_bias"].includes(result.strategy) && result.place).length;
  const textSearchOnly = resolved.filter(({ result }) => result.strategy === "text_search" && result.place).length;
  return {
    resolved_by_place_id: resolved.filter(({ result }) => result.strategy === "place_id" && result.place).length,
    resolved_by_coordinates: resolved.filter(({ result }) => result.strategy === "coordinates" && result.place).length,
    resolved_by_query_with_bias: resolved.filter(({ result }) => result.strategy === "query_with_bias" && result.place).length,
    resolved_by_text_search: textSearchOnly,
    unresolved: resolved.filter(({ result }) => !result.place).length,
    needs_manual_review: resolved.filter(({ result }) => result.needs_manual_review).length,
    risky_text_search_only: resolved.filter(({ result }) => result.risky_text_search_only).length,
    title_strong_match: comparison.filter((item) => item.title_match === "strong").length,
    title_weak_match: comparison.filter((item) => item.title_match === "weak").length,
    title_mismatch: comparison.filter((item) => item.title_match === "mismatch").length,
    distance_close: comparison.filter((item) => item.distance === "close").length,
    distance_far: comparison.filter((item) => item.distance === "far").length,
    url_conflict: comparison.filter((item) => item.url_conflict).length,
    text_search_only_count: textSearchOnly,
    url_derived_resolution_count: resolvedByUrlInfo,
    url_parse_failed_count: resolved.filter(({ row }) => row.url_type === "invalid_url" || row.url_type === "unknown_url").length,
    mismatch_risk_count: resolved.filter(({ result }, index) => result.needs_manual_review || result.risky_text_search_only || comparison[index].title_match === "mismatch" || comparison[index].distance === "far").length,
    resolution_strategy_counts: countBy(resolved.map(({ result }) => result.strategy)),
    decision_hint: decisionHint(resolvedByUrlInfo, textSearchOnly, resolved)
  };
}

function compareResult(row: ParsedRow, place: GooglePlace | null) {
  const googleName = place?.displayName?.text ?? "";
  const similarity = normalizedNameSimilarity(row.title, googleName);
  const distance = distanceKm(row.info.latitude, row.info.longitude, place?.location?.latitude ?? null, place?.location?.longitude ?? null);
  return {
    title_match: similarity === null ? "unknown" : similarity >= 0.7 ? "strong" : similarity >= 0.45 ? "weak" : "mismatch",
    distance: distance === null ? "unknown" : distance <= 0.5 ? "close" : distance >= 2 ? "far" : "medium",
    url_conflict: hasUrlDifference(row.url, place?.googleMapsUri)
  };
}

function verboseSamples(resolved: Array<{ row: ParsedRow; result: ResolveResult }>) {
  return resolved.slice(0, 10).map(({ row, result }) => {
    const comparison = compareResult(row, result.place);
    return {
      source_list_name: row.source_list_name,
      title: row.title,
      url_type: row.url_type,
      strategy: result.strategy,
      warning: result.warning,
      google_name: result.place?.displayName?.text ?? null,
      title_match: comparison.title_match,
      distance: comparison.distance,
      url_conflict: comparison.url_conflict
    };
  });
}

async function fetchPlaceDetails(apiKey: string, placeId: string) {
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK
    }
  });
  if (!response.ok) return null;
  return await response.json() as GooglePlace;
}

async function firstTextSearchResult(apiKey: string, query: string, bias: { latitude: number; longitude: number } | null) {
  const body: Record<string, unknown> = { textQuery: query, maxResultCount: 3 };
  if (bias) {
    body.locationBias = {
      circle: {
        center: bias,
        radius: 500
      }
    };
  }
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": TEXT_SEARCH_FIELD_MASK
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) return null;
  const json = await response.json() as { places?: GooglePlace[] };
  return json.places?.[0] ?? null;
}

function isCloseToSource(info: GoogleMapsUrlInfo, place: GooglePlace | null) {
  const distance = distanceKm(info.latitude, info.longitude, place?.location?.latitude ?? null, place?.location?.longitude ?? null);
  return distance !== null && distance <= 0.5;
}

function decisionHint(urlDerived: number, textSearchOnly: number, resolved: Array<{ row: ParsedRow; result: ResolveResult }>) {
  const parseFailed = resolved.filter(({ row }) => row.url_type === "invalid_url" || row.url_type === "unknown_url").length;
  const unresolved = resolved.filter(({ result }) => !result.place).length;
  if (unresolved === resolved.length) {
    return "今回のサンプルはURL解析はできていますが、Places APIで直接採用できる解決結果はありません。元URLを正として保持し、補完はレビュー前提にするのが安全です。";
  }
  if (urlDerived >= textSearchOnly && parseFailed < resolved.length / 2) {
    return "URL列から解決できる比率があります。既存enrichロジックはURL-firstへ再設計する価値があります。";
  }
  if (textSearchOnly > urlDerived) {
    return "Text Search依存が高めです。自動補完を弱め、レビュー前提にするのが安全です。";
  }
  return "URL列は元リンクとして保持し、Places API補完は控えめに扱うのが安全です。";
}

function rawField(raw: Record<string, unknown>, key: string) {
  const found = Object.entries(raw).find(([candidate]) => candidate.trim().toLowerCase() === key.toLowerCase());
  const text = String(found?.[1] ?? "").trim();
  return text || null;
}

function listNameFromFile(value: string) {
  return path.basename(value).replace(/\.[^.]+$/, "");
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function shuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function parseArgs(): Options {
  const limit = Number(valueAfter("--limit") ?? "20");
  const sample = valueAfter("--sample") === "random" ? "random" : "first";
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20,
    list: valueAfter("--list"),
    sample,
    json: process.argv.includes("--json"),
    resolve: process.argv.includes("--resolve"),
    verbose: process.argv.includes("--verbose")
  };
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^['"]|['"]$/g, "");
    process.env[key] = process.env[key] ?? value;
  }
}

function printOutput(options: Options, output: Record<string, unknown>) {
  if (!options.json) log(options, "done");
  console.log(JSON.stringify(output, null, 2));
}

function log(options: Options, message: string) {
  if (!options.json) console.log(`[inspect:source-urls] ${message}`);
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error, null, 2));
  process.exit(1);
});
