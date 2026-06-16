import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DANGEROUS_API_READY_RISK_FLAGS, loadApiReadyRecords, normalizeApiReadyUrl, type ApiReadyRecord } from "../lib/import/api-ready";
import { distanceKm } from "../lib/import/google-maps-url";
import { normalizedNameSimilarity, sourceGoogleMapsUrl } from "../lib/import/source-fields";

const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "googleMapsUri",
  "primaryType",
  "types",
  "businessStatus"
].join(",");
const TEXT_SEARCH_FIELD_MASK = `places.${DETAILS_FIELD_MASK.split(",").join(",places.")}`;

type Options = {
  dryRun: boolean;
  apply: boolean;
  limit: number;
  strategy: string | null;
  list: string | null;
  status: string | null;
  verbose: boolean;
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
};

type CandidateResult = {
  record: ApiReadyRecord;
  place: GooglePlace | null;
  score: number;
  confidence: "high" | "medium" | "low";
  review_reason: string;
  skipped_reason?: string;
};

type PlaceRow = {
  id: string;
  name: string;
  google_maps_url: string | null;
  raw_import: Record<string, unknown> | null;
  enrichment_status: string | null;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.apply ? "mode: apply" : "mode: dry-run");
  log(`strategy filter: ${options.strategy ?? "all"}`);
  log(`list filter: ${options.list ?? "all"}`);
  log(`status filter: ${options.status ?? "none"}`);
  log(`limit: ${options.limit}`);

  const records = await loadTargets(options);
  log(`target count: ${records.length}`);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey && records.some((record) => shouldCallApi(record))) {
    throw new Error("GOOGLE_MAPS_API_KEY が未設定です。.env.local に GOOGLE_MAPS_API_KEY を設定してください。");
  }

  const supabase = options.apply ? getSupabase() : options.status ? getSupabase() : null;
  const placeByUrl = supabase ? await loadPlaceIndex(supabase) : new Map<string, PlaceRow>();
  const summary = emptySummary();
  const samples: Array<Record<string, unknown>> = [];

  for (const record of records) {
    summary.target_count += 1;
    summary.strategy_counts[record.api_strategy] = (summary.strategy_counts[record.api_strategy] ?? 0) + 1;
    for (const flag of record.risk_flags) summary.risk_flag_counts[flag] = (summary.risk_flag_counts[flag] ?? 0) + 1;

    const result = await resolveCandidate(apiKey!, record);
    applyResultCounts(summary, result);

    if (options.apply && result.place) {
      const place = placeByUrl.get(normalizeApiReadyUrl(record.source_url) ?? "");
      if (place) await updatePlaceCandidate(supabase!, place.id, result);
    }

    if (options.verbose && samples.length < 10) {
      samples.push({
        source_list_name: record.source_list_name,
        api_strategy: record.api_strategy,
        confidence: result.confidence,
        score: Number(result.score.toFixed(3)),
        risk_flags: record.risk_flags,
        skipped_reason: result.skipped_reason ?? null
      });
    }
    await sleep(90);
  }

  log("done");
  console.log(JSON.stringify({
    ...summary,
    dry_run: !options.apply,
    samples: options.verbose ? samples : undefined
  }, null, 2));
}

async function loadTargets(options: Options) {
  let records = loadApiReadyRecords();
  if (options.strategy) records = records.filter((record) => record.api_strategy === options.strategy);
  if (options.list) records = records.filter((record) => record.source_list_name.toLowerCase() === options.list!.toLowerCase());
  if (options.status) {
    const supabase = getSupabase();
    const allowedUrls = await urlsForStatus(supabase, options.status);
    records = records.filter((record) => allowedUrls.has(normalizeApiReadyUrl(record.source_url) ?? ""));
  }
  return records.slice(0, options.limit);
}

async function resolveCandidate(apiKey: string, record: ApiReadyRecord): Promise<CandidateResult> {
  if (record.api_strategy === "source_url_only") {
    return skipped(record, "source_url_only");
  }
  if (record.api_strategy === "manual_review") {
    return skipped(record, "manual_review");
  }

  try {
    const place = record.api_strategy === "place_id_details" && record.extracted_place_id
      ? await fetchPlaceDetails(apiKey, record.extracted_place_id)
      : await searchBestCandidate(apiKey, record);
    if (!place?.id) return { record, place: null, score: 0, confidence: "low", review_reason: "候補が見つかりませんでした" };
    const score = scoreCandidate(record, place);
    const confidence = confidenceFor(record, score);
    return {
      record,
      place,
      score,
      confidence,
      review_reason: reviewReasonFor(record, confidence, score)
    };
  } catch (error) {
    return { record, place: null, score: 0, confidence: "low", review_reason: `APIエラー: ${formatError(error)}` };
  }
}

function skipped(record: ApiReadyRecord, reason: "source_url_only" | "manual_review"): CandidateResult {
  return {
    record,
    place: null,
    score: 0,
    confidence: "low",
    review_reason: reason === "source_url_only" ? "元リンク保持のみの対象です" : "手動確認対象です",
    skipped_reason: reason
  };
}

async function searchBestCandidate(apiKey: string, record: ApiReadyRecord) {
  const query = record.extracted_query ?? record.extracted_name_hint ?? record.source_title;
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "ja",
    maxResultCount: 5
  };
  if (record.extracted_lat !== null && record.extracted_lng !== null) {
    body.locationBias = {
      circle: {
        center: { latitude: record.extracted_lat, longitude: record.extracted_lng },
        radius: 1500
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
  if (!response.ok) throw new Error(`Text Search failed: ${response.status}`);
  const json = await response.json() as { places?: GooglePlace[] };
  const candidates = json.places ?? [];
  return candidates.sort((a, b) => scoreCandidate(record, b) - scoreCandidate(record, a))[0] ?? null;
}

async function fetchPlaceDetails(apiKey: string, placeId: string) {
  const cleanId = placeId.replace(/^places\//, "");
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(cleanId)}?languageCode=ja`, {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK
    }
  });
  if (!response.ok) throw new Error(`Place Details failed: ${response.status}`);
  return await response.json() as GooglePlace;
}

function scoreCandidate(record: ApiReadyRecord, candidate: GooglePlace) {
  let score = 0;
  const nameSimilarity = normalizedNameSimilarity(record.extracted_name_hint ?? record.extracted_query ?? record.source_title, candidate.displayName?.text) ?? 0;
  score += nameSimilarity * 0.55;
  const distance = distanceKm(record.extracted_lat, record.extracted_lng, candidate.location?.latitude ?? null, candidate.location?.longitude ?? null);
  if (distance !== null) {
    if (distance < 0.1) score += 0.3;
    else if (distance < 0.5) score += 0.22;
    else if (distance < 1.5) score += 0.12;
    else score -= 0.25;
  } else if (record.api_strategy !== "place_id_details") {
    score -= 0.2;
  }
  if (record.api_strategy === "place_id_details") score += 0.35;
  if (record.risk_flags.some((flag) => DANGEROUS_API_READY_RISK_FLAGS.includes(flag))) score -= 0.25;
  return Math.max(0, Math.min(1, score));
}

function confidenceFor(record: ApiReadyRecord, score: number): CandidateResult["confidence"] {
  const risky = record.risk_flags.some((flag) => DANGEROUS_API_READY_RISK_FLAGS.includes(flag));
  if (record.api_strategy === "place_id_details" && score >= 0.75) return "high";
  if (!risky && record.api_strategy === "coordinate_bias_search" && score >= 0.82) return "high";
  if (score >= 0.58) return "medium";
  return "low";
}

function reviewReasonFor(record: ApiReadyRecord, confidence: CandidateResult["confidence"], score: number) {
  const reasons: string[] = [];
  if (confidence === "high") reasons.push("高信頼のPlace ID候補です");
  else reasons.push("Place ID候補の確認が必要です");
  if (record.api_strategy === "query_with_bias") reasons.push("query_with_biasは自動確定しません");
  if (record.risk_flags.includes("cid_not_directly_supported")) reasons.push("CIDは直接Place IDとして使えません");
  if (record.risk_flags.includes("chain_or_multi_location_risk")) reasons.push("チェーン店/複数店舗の可能性があります");
  if (record.risk_flags.includes("generic_name_risk")) reasons.push("一般的な名称です");
  if (record.risk_flags.includes("event_or_exhibition_name")) reasons.push("展示・イベント名の可能性があります");
  reasons.push(`score=${score.toFixed(2)}`);
  return reasons.join(" / ");
}

async function updatePlaceCandidate(supabase: SupabaseClient, placeId: string, result: CandidateResult) {
  const payload = {
    normalized_place_id: result.confidence === "high" ? result.place?.id ?? null : null,
    place_id_confidence: result.confidence,
    place_id_normalized_at: new Date().toISOString(),
    place_id_review_reason: result.review_reason,
    place_id_candidate: result.place ? {
      id: result.place.id,
      displayName: result.place.displayName,
      formattedAddress: result.place.formattedAddress,
      location: result.place.location,
      googleMapsUri: result.place.googleMapsUri,
      primaryType: result.place.primaryType,
      types: result.place.types,
      businessStatus: result.place.businessStatus,
      score: result.score,
      api_strategy: result.record.api_strategy,
      risk_flags: result.record.risk_flags
    } : null,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from("places").update(payload).eq("id", placeId);
  if (error) throw error;
}

async function loadPlaceIndex(supabase: SupabaseClient) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, google_maps_url, raw_import, enrichment_status")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  const index = new Map<string, PlaceRow>();
  for (const row of rows) {
    const key = normalizeApiReadyUrl(sourceGoogleMapsUrl(row.raw_import, row.google_maps_url));
    if (key) index.set(key, row);
  }
  return index;
}

async function urlsForStatus(supabase: SupabaseClient, status: string) {
  const index = await loadPlaceIndex(supabase);
  const urls = new Set<string>();
  for (const [url, row] of index.entries()) {
    if (status === "all" || row.enrichment_status === status) urls.add(url);
  }
  return urls;
}

function shouldCallApi(record: ApiReadyRecord) {
  return record.api_strategy !== "source_url_only" && record.api_strategy !== "manual_review";
}

function emptySummary() {
  return {
    target_count: 0,
    resolved_candidate_count: 0,
    high_confidence_count: 0,
    medium_confidence_count: 0,
    low_confidence_count: 0,
    confirmed_count: 0,
    needs_review_count: 0,
    skipped_source_url_only_count: 0,
    skipped_manual_review_count: 0,
    risk_flag_counts: {} as Record<string, number>,
    strategy_counts: {} as Record<string, number>
  };
}

function applyResultCounts(summary: ReturnType<typeof emptySummary>, result: CandidateResult) {
  if (result.skipped_reason === "source_url_only") summary.skipped_source_url_only_count += 1;
  if (result.skipped_reason === "manual_review") summary.skipped_manual_review_count += 1;
  if (result.place) summary.resolved_candidate_count += 1;
  if (result.confidence === "high") {
    summary.high_confidence_count += 1;
    summary.confirmed_count += 1;
  } else if (result.confidence === "medium") {
    summary.medium_confidence_count += 1;
    summary.needs_review_count += 1;
  } else {
    summary.low_confidence_count += 1;
    if (!result.skipped_reason) summary.needs_review_count += 1;
  }
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Supabase接続情報が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。");
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
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

function parseArgs(): Options {
  const limitValue = Number(valueAfter("--limit") ?? "");
  return {
    dryRun: process.argv.includes("--dry-run") || !process.argv.includes("--apply"),
    apply: process.argv.includes("--apply"),
    limit: Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : 20,
    strategy: valueAfter("--strategy"),
    list: valueAfter("--list"),
    status: valueAfter("--status"),
    verbose: process.argv.includes("--verbose")
  };
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string) {
  console.log(`[normalize:place-ids] ${message}`);
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

void main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
