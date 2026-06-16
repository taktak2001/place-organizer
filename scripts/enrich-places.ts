import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyPlace } from "../lib/classification/category";
import { classifyRegion } from "../lib/classification/region";
import { buildApiReadyIndex, findApiReadyRecord, hasDangerousApiReadyRisk, loadApiReadyRecords, summarizeApiReadyRecords, type ApiReadyRecord } from "../lib/import/api-ready";
import { googleMapsUrlForCoordinates, parseCoordinateText, type ParsedCoordinates } from "../lib/import/coordinates";
import { distanceKm as mapsDistanceKm, isGenericOrChainLikeName, parseGoogleMapsUrl, resolveGoogleMapsRedirect, type GoogleMapsUrlInfo } from "../lib/import/google-maps-url";
import { hasUrlDifference, hasWeakNameMatch, sourceGoogleMapsUrl } from "../lib/import/source-fields";
import type { NormalizedImportItem, PlaceClassification } from "../types/import";

const DEFAULT_LIMIT = 10;
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "googleMapsUri",
  "websiteUri",
  "internationalPhoneNumber",
  "rating",
  "userRatingCount",
  "priceLevel",
  "businessStatus",
  "primaryType",
  "types",
  "regularOpeningHours",
  "currentOpeningHours",
  "photos"
].join(",");
const TEXT_SEARCH_FIELD_MASK = `places.${DETAILS_FIELD_MASK.split(",").join(",places.")}`;

type EnrichOptions = {
  dryRun: boolean;
  limit: number;
  status: string;
  reclassify: boolean;
};

type PlaceRow = {
  id: string;
  normalized_key: string;
  google_place_id: string | null;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  raw_import: Record<string, unknown> | null;
  raw_google?: Record<string, unknown> | null;
  enrichment_status: string | null;
  place_classifications?: ClassificationRow[] | ClassificationRow | null;
  source_links?: SourceLinkRow[];
};

type ClassificationRow = {
  visited_status: string | null;
  priority: string | null;
  country?: string | null;
  prefecture?: string | null;
  city?: string | null;
  ward?: string | null;
  area_label?: string | null;
  nearest_station?: string | null;
  travel_region?: string | null;
};

type SourceLinkRow = {
  source_list_name: string | null;
  source_file: string | null;
  source_url?: string | null;
  memo: string | null;
  active: boolean | null;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string | number;
  businessStatus?: string;
  primaryType?: string;
  types?: string[];
  regularOpeningHours?: Record<string, unknown>;
  currentOpeningHours?: Record<string, unknown>;
  photos?: Array<{ name?: string }>;
};

type EnrichResult = {
  status: "enriched" | "not_found" | "needs_review" | "error" | "coordinate_point" | "source_url_confirmed";
  place?: GooglePlace;
  coordinates?: ParsedCoordinates;
  sourceUrlInfo?: GoogleMapsUrlInfo | null;
  apiReady?: ApiReadyRecord | null;
  reviewReasons?: string[];
  confidence?: number;
  strategy: string;
  error?: string;
};

type RunStatus = EnrichResult["status"];

type PersistResult = {
  requested_status: RunStatus;
  final_status: string;
  update_verified: boolean;
  error?: string;
};

type RunCounters = Record<RunStatus, number>;

type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.dryRun ? "mode: dry-run" : "mode: write");
  log(`status filter: ${options.status}`);
  log(`limit: ${options.limit}`);
  log(`reclassify: ${options.reclassify ? "enabled" : "disabled"}`);

  log("env check");
  const supabase = getSupabase();
  log(`Supabase URL: ${safeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!options.dryRun && !apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY が未設定です。.env.local に GOOGLE_MAPS_API_KEY を設定してください。");
  }

  log("connecting Supabase");
  await verifySupabaseSchema(supabase);
  const targets = await fetchTargets(supabase, options.status, options.limit);
  const apiReadyRecords = loadApiReadyRecords();
  const apiReadyIndex = buildApiReadyIndex(apiReadyRecords);
  log(`api-ready records: ${apiReadyRecords.length}`);
  log(`target count: ${targets.length}`);

  if (options.dryRun) {
    const summary = summarizeStrategies(targets, apiReadyIndex);
    log("done: dry-run");
    console.log(JSON.stringify({ status: "dry_run", target_count: targets.length, ...summary }, null, 2));
    return;
  }

  const decisionCounters = emptyRunCounters();
  const dbVerifiedCounters = emptyRunCounters();
  const enrichedPlaceIds: string[] = [];
  let processed = 0;

  for (const place of targets) {
    processed += 1;
    log(`processing ${processed}/${targets.length}`);
    const result = await enrichOne(place, apiKey!, apiReadyIndex);
    decisionCounters[result.status] += 1;
    const persisted = await persistResult(supabase, place, result);
    incrementVerifiedCounter(dbVerifiedCounters, persisted.final_status);
    if (persisted.final_status === "enriched") enrichedPlaceIds.push(place.id);
    await sleep(120);
  }

  const reclassifySummary = options.reclassify ? await reclassifyRegionsForPlaceIds(supabase, enrichedPlaceIds) : emptyReclassifySummary();
  const finalCounts = await fetchDbFinalCounts(supabase);

  log(`Run result (API decision) enriched: ${decisionCounters.enriched}`);
  log(`Run result (API decision) not_found: ${decisionCounters.not_found}`);
  log(`Run result (API decision) needs_review: ${decisionCounters.needs_review}`);
  log(`Run result (API decision) error: ${decisionCounters.error}`);
  log(`Run result (API decision) coordinate_point: ${decisionCounters.coordinate_point}`);
  log(`Run result (API decision) source_url_confirmed: ${decisionCounters.source_url_confirmed}`);
  log(`Run result (DB verified) enriched: ${dbVerifiedCounters.enriched}`);
  log(`Run result (DB verified) not_found: ${dbVerifiedCounters.not_found}`);
  log(`Run result (DB verified) needs_review: ${dbVerifiedCounters.needs_review}`);
  log(`Run result (DB verified) error: ${dbVerifiedCounters.error}`);
  log(`Run result (DB verified) coordinate_point: ${dbVerifiedCounters.coordinate_point}`);
  log(`Run result (DB verified) source_url_confirmed: ${dbVerifiedCounters.source_url_confirmed}`);
  log(`reclassified count: ${reclassifySummary.reclassified_count}`);
  log(`missing area/travel before: ${reclassifySummary.missing_before}`);
  log(`missing area/travel after: ${reclassifySummary.missing_after}`);
  log(`DB final counts pending_enrichment: ${finalCounts.pending_enrichment}`);
  log(`DB final counts enriched: ${finalCounts.enriched}`);
  log(`DB final counts needs_review: ${finalCounts.needs_review}`);
  log(`DB final counts not_found: ${finalCounts.not_found}`);
  log(`DB final counts error: ${finalCounts.error}`);
  log(`DB final counts coordinate_point: ${finalCounts.coordinate_point}`);
  log(`DB final counts source_url_confirmed: ${finalCounts.source_url_confirmed}`);
  log("done");
  console.log(JSON.stringify({
    status: "completed",
    processed_count: processed,
    run_result: {
      api_decision_counts: decisionCounters,
      db_verified_counts: dbVerifiedCounters
    },
    reclassified_count: reclassifySummary.reclassified_count,
    missing_area_or_travel_before: reclassifySummary.missing_before,
    missing_area_or_travel_after: reclassifySummary.missing_after,
    db_final_counts: finalCounts
  }, null, 2));
}

async function enrichOne(place: PlaceRow, apiKey: string, apiReadyIndex: ReturnType<typeof buildApiReadyIndex>): Promise<EnrichResult> {
  try {
    const coordinates = parseCoordinateText(place.name);
    if (coordinates) return { status: "coordinate_point", coordinates, strategy: "coordinate_name" };

    const sourceUrl = sourceGoogleMapsUrl(place.raw_import, sourceUrlFromLinks(place.source_links) ?? place.google_maps_url);
    const sourceUrlInfo = sourceUrl ? parseGoogleMapsUrl(await resolveGoogleMapsRedirect(sourceUrl)) : null;
    const apiReady = findApiReadyRecord(apiReadyIndex, {
      sourceUrl,
      sourceListNames: activeLinks(place.source_links).map((link) => link.source_list_name),
      title: place.name
    });
    if (apiReady?.api_strategy === "source_url_only") {
      return {
        status: "source_url_confirmed",
        strategy: "api_ready_source_url_only",
        sourceUrlInfo,
        apiReady,
        reviewReasons: ["api_strategy=source_url_only のため元リンクを正として保持します"]
      };
    }
    if (apiReady?.api_strategy === "manual_review" || apiReady?.should_call_places_api === false) {
      return {
        status: "needs_review",
        strategy: `api_ready_${apiReady?.api_strategy ?? "manual_review"}`,
        sourceUrlInfo,
        apiReady,
        reviewReasons: ["APIに安全に渡せないため手動確認が必要です"]
      };
    }

    if (place.google_place_id) {
      const details = await fetchPlaceDetails(apiKey, place.google_place_id);
      return classifyGoogleCandidate(place, details, "place_details", undefined, sourceUrlInfo, [], apiReady);
    }

    const urlPlaceId = sourceUrlInfo?.place_id ?? extractPlaceId(sourceUrl ?? place.google_maps_url);
    if (urlPlaceId) {
      const details = await fetchPlaceDetails(apiKey, urlPlaceId);
      return classifyGoogleCandidate(place, details, "source_url_place_id", undefined, sourceUrlInfo, [], apiReady);
    }

    const query = buildSearchQuery(place, sourceUrlInfo);
    if (!query) return { status: "not_found", strategy: "no_query" };

    const candidates = await textSearch(apiKey, query, place, sourceUrlInfo);
    if (candidates.length === 0) return { status: "not_found", strategy: "text_search", sourceUrlInfo };
    const best = pickBestCandidate(place, candidates, sourceUrlInfo);
    if (!best.place) return { status: "not_found", strategy: "text_search", sourceUrlInfo };
    return classifyGoogleCandidate(place, best.place, "text_search", best.confidence, sourceUrlInfo, best.reviewReasons, apiReady);
  } catch (error) {
    return { status: "error", strategy: "api_error", error: formatError(error) };
  }
}

async function persistResult(supabase: SupabaseClient, place: PlaceRow, result: EnrichResult): Promise<PersistResult> {
  const now = new Date().toISOString();
  const updatePayload =
    result.status === "coordinate_point" && result.coordinates
      ? {
          latitude: result.coordinates.latitude,
          longitude: result.coordinates.longitude,
          google_maps_url: place.google_maps_url ?? googleMapsUrlForCoordinates(result.coordinates),
          enrichment_status: result.status,
          last_enriched_at: now,
          updated_at: now,
          raw_google: {
            source: "coordinate_name",
            review_reason: "座標保存地点",
            latitude: result.coordinates.latitude,
            longitude: result.coordinates.longitude
          }
        }
      : result.place && result.status !== "error"
      ? result.status === "enriched" ? {
          ...placeUpdateFromGoogle(result.place),
          raw_google: {
            ...result.place,
            source_url_review: result.sourceUrlInfo,
            api_ready: apiReadySummary(result.apiReady),
            review_reason: null
          },
          enrichment_status: result.status,
          last_enriched_at: now,
          updated_at: now
        } : sourceUrlPriorityPayload(place, result, now)
      : result.status === "source_url_confirmed"
      ? sourceUrlPriorityPayload(place, result, now)
      : {
          enrichment_status: result.status,
          last_enriched_at: now,
          updated_at: now,
          raw_google: result.error
            ? { error: result.error, strategy: result.strategy }
            : {
                ...(typeof place.raw_google === "object" && place.raw_google !== null ? place.raw_google : {}),
                strategy: result.strategy,
                api_ready: apiReadySummary(result.apiReady),
                review_reason: buildReviewReason(place, result)
              }
        };

  const update = await updatePlaceAndReturnStatus(supabase, place.id, updatePayload);
  const updateError = update.error;
  if (updateError) {
    log(`place update failed (${shortId(place.id)}): ${formatSupabaseError(updateError)}`);
    const finalStatus = await markPlaceAsError(supabase, place.id, now, updateError.message ?? "Supabase update failed", result.strategy);
    return {
      requested_status: result.status,
      final_status: finalStatus,
      update_verified: finalStatus === "error",
      error: updateError.message
    };
  }

  if (!update.status) {
    log(`place update returned no row (${shortId(place.id)})`);
    const finalStatus = await markPlaceAsError(supabase, place.id, now, "Supabase update returned no row", result.strategy);
    return {
      requested_status: result.status,
      final_status: finalStatus,
      update_verified: false,
      error: "Supabase update returned no row"
    };
  }

  if (result.place && result.status === "enriched") {
    const item = normalizedItemFromGoogle(place, result.place);
    const classification = mergeClassification(place, classifyPlace(item), result);
    const { error } = await supabase.from("place_classifications").upsert({ place_id: place.id, ...classification }, { onConflict: "place_id" });
    if (error) {
      log(`classification upsert failed (${shortId(place.id)}): ${formatSupabaseError(error)}`);
      await supabase.from("places").update({ raw_google: { ...result.place, classification_error: error.message }, updated_at: now }).eq("id", place.id);
    }
  }

  if (result.status === "coordinate_point" && result.coordinates) {
    const classification = coordinatePointClassification(place, result.coordinates);
    const { error } = await supabase.from("place_classifications").upsert({ place_id: place.id, ...classification }, { onConflict: "place_id" });
    if (error) {
      log(`coordinate classification upsert failed (${shortId(place.id)}): ${formatSupabaseError(error)}`);
    }
  }

  const finalStatus = await fetchPlaceStatus(supabase, place.id);
  if (finalStatus !== result.status) {
    log(`status verify mismatch (${shortId(place.id)}): expected ${result.status}, got ${finalStatus ?? "missing"}`);
  }

  return {
    requested_status: result.status,
    final_status: finalStatus ?? update.status,
    update_verified: finalStatus === result.status
  };
}

function sourceUrlPriorityPayload(place: PlaceRow, result: EnrichResult, now: string) {
  const sourceUrl = result.sourceUrlInfo?.original_url ?? sourceGoogleMapsUrl(place.raw_import, sourceUrlFromLinks(place.source_links) ?? place.google_maps_url);
  return {
    google_place_id: null,
    address: null,
    latitude: result.sourceUrlInfo?.latitude ?? null,
    longitude: result.sourceUrlInfo?.longitude ?? null,
    google_maps_url: sourceUrl,
    website_url: null,
    phone_number: null,
    rating: null,
    user_ratings_total: null,
    price_level: null,
    business_status: null,
    primary_type: null,
    types: null,
    photo_references: null,
    regular_opening_hours: null,
    current_opening_hours: null,
    raw_google: {
      candidate_only: true,
      candidate_place: result.place,
      source_url_review: result.sourceUrlInfo,
      api_ready: apiReadySummary(result.apiReady),
      review_reason: buildReviewReason(place, result) || "元リンクと補完候補が一致しないため、元リンクを優先しました"
    },
    enrichment_status: result.status === "needs_review" ? "needs_review" : result.status,
    last_enriched_at: now,
    updated_at: now
  };
}

async function updatePlaceAndReturnStatus(supabase: SupabaseClient, placeId: string, updatePayload: Record<string, unknown>) {
  const first = await updatePlace(supabase, placeId, updatePayload);
  if (!first.error || !shouldRetryWithoutGooglePlaceId(first.error, updatePayload)) return first;

  log(`google_place_id conflict; retrying without google_place_id (${shortId(placeId)})`);
  const retryPayload = { ...updatePayload };
  delete retryPayload.google_place_id;
  return await updatePlace(supabase, placeId, retryPayload);
}

async function updatePlace(supabase: SupabaseClient, placeId: string, updatePayload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("places")
    .update(updatePayload)
    .eq("id", placeId)
    .select("id, enrichment_status")
    .maybeSingle();

  return {
    status: typeof data?.enrichment_status === "string" ? data.enrichment_status : null,
    error: error as SupabaseErrorLike | null
  };
}

function shouldRetryWithoutGooglePlaceId(error: SupabaseErrorLike, updatePayload: Record<string, unknown>) {
  if (!("google_place_id" in updatePayload)) return false;
  const text = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  return text.includes("google_place_id") && (text.includes("duplicate") || text.includes("unique") || error.code === "23505");
}

async function markPlaceAsError(supabase: SupabaseClient, placeId: string, now: string, message: string, strategy: string) {
  const fallbackPayload = {
    enrichment_status: "error",
    last_enriched_at: now,
    updated_at: now,
    raw_google: { error: message, strategy }
  };
  const { data, error } = await supabase
    .from("places")
    .update(fallbackPayload)
    .eq("id", placeId)
    .select("id, enrichment_status")
    .maybeSingle();

  if (error) {
    log(`failed to mark error (${shortId(placeId)}): ${formatSupabaseError(error)}`);
    return await fetchPlaceStatus(supabase, placeId) ?? "unknown";
  }
  return typeof data?.enrichment_status === "string" ? data.enrichment_status : "unknown";
}

async function fetchPlaceStatus(supabase: SupabaseClient, placeId: string) {
  const { data, error } = await supabase
    .from("places")
    .select("enrichment_status")
    .eq("id", placeId)
    .maybeSingle();
  if (error) {
    log(`status verify failed (${shortId(placeId)}): ${formatSupabaseError(error)}`);
    return null;
  }
  return typeof data?.enrichment_status === "string" ? data.enrichment_status : null;
}

async function reclassifyRegionsForPlaceIds(supabase: SupabaseClient, placeIds: string[]) {
  if (placeIds.length === 0) return emptyReclassifySummary();
  log(`reclassifying regions for enriched places: ${placeIds.length}`);
  const places = await fetchPlacesByIds(supabase, placeIds);
  const changes = places.map((place) => {
    const before = firstClassification(place.place_classifications);
    const after = classifyRegion(normalizedItemFromCurrentPlace(place));
    return { place, before, after };
  });

  const missingBefore = changes.filter(({ before }) => isMissing(before?.area_label) || isMissing(before?.travel_region)).length;
  const missingAfter = changes.filter(({ after }) => isMissing(after.area_label) || isMissing(after.travel_region)).length;
  const changed = changes.filter(({ before, after }) => regionChanged(before, after));

  if (changed.length > 0) {
    const payload = changed.map(({ place, after }) => ({
      place_id: place.id,
      country: after.country,
      prefecture: after.prefecture,
      city: after.city,
      ward: after.ward,
      area_label: after.area_label,
      nearest_station: after.nearest_station,
      travel_region: after.travel_region
    }));
    const { error } = await supabase.from("place_classifications").upsert(payload, { onConflict: "place_id" });
    if (error) throw error;
  }

  return { reclassified_count: changed.length, missing_before: missingBefore, missing_after: missingAfter };
}

function classifyGoogleCandidate(place: PlaceRow, candidate: GooglePlace, strategy: string, explicitConfidence?: number, sourceUrlInfo?: GoogleMapsUrlInfo | null, reviewReasons: string[] = [], apiReady?: ApiReadyRecord | null): EnrichResult {
  const confidence = explicitConfidence ?? scoreCandidate(place, candidate);
  if (!candidate.id) return { status: "not_found", strategy };
  const sourceReviewReasons = reviewSourceUrlConsistency(place, candidate, sourceUrlInfo);
  const apiReadyReasons = apiReadyReviewReasons(apiReady);
  const reasons = [...reviewReasons, ...sourceReviewReasons, ...apiReadyReasons];
  if (apiReady?.api_strategy === "query_with_bias" || hasDangerousApiReadyRisk(apiReady) || confidence < 0.55 || reasons.length > 0) {
    return { status: "needs_review", place: candidate, confidence, strategy, sourceUrlInfo, apiReady, reviewReasons: reasons };
  }
  return { status: "enriched", place: candidate, confidence, strategy, sourceUrlInfo, apiReady };
}

function buildReviewReason(place: PlaceRow, result: EnrichResult) {
  const reasons: string[] = [];
  reasons.push(...(result.reviewReasons ?? []));
  reasons.push(...apiReadyReviewReasons(result.apiReady));
  if (hasWeakNameMatch(place.name, result.place?.displayName?.text)) reasons.push("名称一致が弱いです");
  if (result.confidence !== undefined && result.confidence < 0.55) reasons.push("confidenceが低いです");
  if (result.strategy === "text_search" && !place.address) reasons.push("住所なしでText Searchしたため");
  else if (result.strategy === "text_search") reasons.push("Text Searchで補完しました");
  if (!place.address) reasons.push("住所なしで検索しました");
  return [...new Set(reasons)][0] ?? "候補の確認が必要です";
}

function apiReadyReviewReasons(record: ApiReadyRecord | null | undefined) {
  if (!record) return [];
  const reasons: string[] = [];
  if (record.api_strategy === "query_with_bias") reasons.push("api_strategy=query_with_bias のため自動採用しません");
  if (record.api_strategy === "source_url_only") reasons.push("api_strategy=source_url_only のため元リンクを正として保持します");
  if (record.api_strategy === "manual_review") reasons.push("api_strategy=manual_review のため確認が必要です");
  if (record.risk_flags.includes("cid_not_directly_supported")) reasons.push("CIDはPlaces APIに直接渡せないため元リンクを優先します");
  if (record.risk_flags.includes("chain_or_multi_location_risk")) reasons.push("チェーン店/複数店舗の可能性があります");
  if (record.risk_flags.includes("generic_name_risk")) reasons.push("一般的な名称のため候補確認が必要です");
  if (record.risk_flags.includes("event_or_exhibition_name")) reasons.push("展示・イベント名の可能性があります");
  if (record.risk_flags.includes("text_search_only_risky")) reasons.push("Text Search単独採用は危険です");
  return [...new Set(reasons)];
}

function apiReadySummary(record: ApiReadyRecord | null | undefined) {
  if (!record) return null;
  return {
    source_list_name: record.source_list_name,
    url_type: record.url_type,
    api_strategy: record.api_strategy,
    should_call_places_api: record.should_call_places_api,
    confidence: record.confidence,
    risk_flags: record.risk_flags,
    reason: record.reason,
    extracted_place_id: record.extracted_place_id,
    extracted_cid: record.extracted_cid ? true : false,
    extracted_lat: record.extracted_lat,
    extracted_lng: record.extracted_lng,
    extracted_query: record.extracted_query ? true : false,
    extracted_name_hint: record.extracted_name_hint ? true : false
  };
}

async function fetchPlaceDetails(apiKey: string, placeId: string): Promise<GooglePlace> {
  const cleanId = placeId.replace(/^places\//, "");
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(cleanId)}?languageCode=ja&regionCode=JP`, {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK
    }
  });
  if (!response.ok) throw new Error(`Place Details failed: ${response.status}`);
  return await response.json() as GooglePlace;
}

async function textSearch(apiKey: string, query: string, place: PlaceRow, sourceUrlInfo?: GoogleMapsUrlInfo | null): Promise<GooglePlace[]> {
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "ja",
    regionCode: "JP",
    maxResultCount: 5
  };
  const biasLat = sourceUrlInfo?.latitude ?? place.latitude;
  const biasLng = sourceUrlInfo?.longitude ?? place.longitude;
  if (biasLat !== null && biasLng !== null) {
    body.locationBias = {
      circle: {
        center: { latitude: biasLat, longitude: biasLng },
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
  return json.places ?? [];
}

function pickBestCandidate(place: PlaceRow, candidates: GooglePlace[], sourceUrlInfo?: GoogleMapsUrlInfo | null) {
  let best: { place: GooglePlace | null; confidence: number; reviewReasons: string[] } = { place: null, confidence: 0, reviewReasons: [] };
  for (const candidate of candidates) {
    const reviewReasons = reviewSourceUrlConsistency(place, candidate, sourceUrlInfo);
    const confidence = scoreCandidate(place, candidate, sourceUrlInfo);
    if (confidence > best.confidence) best = { place: candidate, confidence, reviewReasons };
  }
  return best;
}

function scoreCandidate(place: PlaceRow, candidate: GooglePlace, sourceUrlInfo?: GoogleMapsUrlInfo | null) {
  let score = 0;
  const sourceName = normalizeText(sourceUrlInfo?.name_hint ?? place.name);
  const candidateName = normalizeText(candidate.displayName?.text);
  const sourceAddress = normalizeText(place.address);
  const candidateAddress = normalizeText(candidate.formattedAddress);

  if (sourceName && candidateName && sourceName === candidateName) score += 0.65;
  else if (sourceName && candidateName && (sourceName.includes(candidateName) || candidateName.includes(sourceName))) score += 0.45;
  else if (sourceName && candidateName && tokenOverlap(sourceName, candidateName) >= 0.5) score += 0.35;

  if (sourceAddress && candidateAddress && candidateAddress.includes(sourceAddress.slice(0, Math.min(12, sourceAddress.length)))) score += 0.25;
  const sourceLat = sourceUrlInfo?.latitude ?? place.latitude;
  const sourceLng = sourceUrlInfo?.longitude ?? place.longitude;
  if (sourceLat !== null && sourceLng !== null && candidate.location?.latitude !== undefined && candidate.location.longitude !== undefined) {
    const km = distanceKm(sourceLat, sourceLng, candidate.location.latitude, candidate.location.longitude);
    if (km < 0.1) score += 0.25;
    else if (km < 1) score += 0.15;
  }

  return Math.min(1, score);
}

function reviewSourceUrlConsistency(place: PlaceRow, candidate: GooglePlace, sourceUrlInfo?: GoogleMapsUrlInfo | null) {
  const reasons: string[] = [];
  const distance = mapsDistanceKm(sourceUrlInfo?.latitude ?? null, sourceUrlInfo?.longitude ?? null, candidate.location?.latitude ?? null, candidate.location?.longitude ?? null);
  if (distance !== null && distance > 1.5) reasons.push("元リンク由来の地点と補完候補の距離が離れています");
  if (hasWeakNameMatch(sourceUrlInfo?.name_hint ?? place.name, candidate.displayName?.text)) reasons.push("名称一致が弱いです");
  if (hasUrlDifference(sourceUrlInfo?.resolved_url ?? sourceUrlInfo?.original_url, candidate.googleMapsUri) && hasWeakNameMatch(place.name, candidate.displayName?.text)) {
    reasons.push("元Google Maps URLと補完後URLが異なります");
  }
  if (isGenericOrChainLikeName(place.name) && !sourceUrlInfo?.place_id) reasons.push("チェーン店/複数店舗の可能性があります");
  if (reasons.length > 0) reasons.push("元リンクを優先してください");
  return [...new Set(reasons)];
}

function placeUpdateFromGoogle(place: GooglePlace) {
  return {
    google_place_id: place.id ?? null,
    address: place.formattedAddress ?? null,
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    google_maps_url: place.googleMapsUri ?? null,
    website_url: place.websiteUri ?? null,
    phone_number: place.internationalPhoneNumber ?? null,
    rating: place.rating ?? null,
    user_ratings_total: place.userRatingCount ?? null,
    price_level: normalizePriceLevel(place.priceLevel),
    business_status: place.businessStatus ?? null,
    primary_type: place.primaryType ?? null,
    types: place.types ?? null,
    photo_references: place.photos?.map((photo) => photo.name).filter(Boolean) ?? null,
    regular_opening_hours: place.regularOpeningHours ?? null,
    current_opening_hours: place.currentOpeningHours ?? null,
    raw_google: place
  };
}

function normalizedItemFromGoogle(place: PlaceRow, google: GooglePlace): NormalizedImportItem {
  const links = activeLinks(place.source_links);
  return {
    source_file: links.map((link) => link.source_file).filter(Boolean).join(", ") || "google_places_enrichment",
    source_list_name: links.map((link) => link.source_list_name).filter(Boolean).join(" ") || null,
    name: place.name,
    address: google.formattedAddress ?? place.address,
    google_maps_url: google.googleMapsUri ?? place.google_maps_url,
    latitude: google.location?.latitude ?? place.latitude,
    longitude: google.location?.longitude ?? place.longitude,
    notes: links.map((link) => link.memo).filter(Boolean).join("\n") || null,
    raw: { ...place.raw_import, google },
    google_place_id: google.id ?? place.google_place_id,
    normalized_key: place.normalized_key
  };
}

function normalizedItemFromCurrentPlace(place: PlaceRow): NormalizedImportItem {
  const links = activeLinks(place.source_links);
  return {
    source_file: links.map((link) => link.source_file).filter(Boolean).join(", ") || "google_places_enrichment",
    source_list_name: links.map((link) => link.source_list_name).filter(Boolean).join(" ") || null,
    name: place.name,
    address: place.address,
    google_maps_url: place.google_maps_url,
    latitude: place.latitude,
    longitude: place.longitude,
    notes: links.map((link) => link.memo).filter(Boolean).join("\n") || null,
    raw: { ...(place.raw_import ?? {}), google: place.raw_google ?? {} },
    google_place_id: place.google_place_id,
    normalized_key: place.normalized_key
  };
}

function mergeClassification(place: PlaceRow, classification: PlaceClassification, result: EnrichResult) {
  const current = firstClassification(place.place_classifications);
  return {
    ...classification,
    visited_status: current?.visited_status && current.visited_status !== "unknown" ? current.visited_status : classification.visited_status,
    priority: current?.priority ?? classification.priority,
    confidence: result.confidence ?? classification.confidence,
    reason: `google_places:${result.strategy}:${classification.reason}`
  };
}

function coordinatePointClassification(place: PlaceRow, coordinates: ParsedCoordinates): PlaceClassification {
  const current = firstClassification(place.place_classifications);
  const region = classifyRegion(normalizedItemFromCoordinate(place, coordinates));
  return {
    main_category: "Other",
    sub_category: "Coordinate Point",
    scene_tags: [],
    ...region,
    priority: current?.priority ?? null,
    visited_status: current?.visited_status && current.visited_status !== "unknown" ? current.visited_status : "unknown",
    confidence: 0.95,
    reason: "coordinate point"
  };
}

function normalizedItemFromCoordinate(place: PlaceRow, coordinates: ParsedCoordinates): NormalizedImportItem {
  const links = activeLinks(place.source_links);
  return {
    source_file: links.map((link) => link.source_file).filter(Boolean).join(", ") || "coordinate_point",
    source_list_name: links.map((link) => link.source_list_name).filter(Boolean).join(" ") || null,
    name: place.name,
    address: place.address,
    google_maps_url: place.google_maps_url ?? googleMapsUrlForCoordinates(coordinates),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    notes: links.map((link) => link.memo).filter(Boolean).join("\n") || null,
    raw: { ...(place.raw_import ?? {}), coordinate_point: coordinates },
    google_place_id: place.google_place_id,
    normalized_key: place.normalized_key
  };
}

function firstClassification(value: unknown): ClassificationRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as ClassificationRow : null;
}

async function fetchTargets(supabase: SupabaseClient, status: string, limit: number) {
  const { data, error } = await supabase
    .from("places")
    .select("id, normalized_key, google_place_id, name, address, latitude, longitude, google_maps_url, raw_import, enrichment_status, place_classifications(visited_status, priority), source_links(source_list_name, source_file, source_url, memo, active)")
    .eq("enrichment_status", status)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as PlaceRow[];
}

async function fetchPlacesByIds(supabase: SupabaseClient, placeIds: string[]) {
  const { data, error } = await supabase
    .from("places")
    .select("id, normalized_key, google_place_id, name, address, latitude, longitude, google_maps_url, raw_import, raw_google, enrichment_status, place_classifications(visited_status, priority, country, prefecture, city, ward, area_label, nearest_station, travel_region), source_links(source_list_name, source_file, source_url, memo, active)")
    .in("id", placeIds);
  if (error) throw error;
  return (data ?? []) as unknown as PlaceRow[];
}

async function verifySupabaseSchema(supabase: SupabaseClient) {
  const { error } = await supabase.from("places").select("id").limit(1);
  if (error) throw new Error(`places テーブルが見つかりません。Supabase SQL Editorで migration を実行してください。詳細: ${error.message}`);
}

function summarizeStrategies(places: PlaceRow[], apiReadyIndex: ReturnType<typeof buildApiReadyIndex>) {
  const strategyCounts: Record<string, number> = {};
  const apiReadyMatches: ApiReadyRecord[] = [];
  let withGoogleMapsUrl = 0;
  let withAddress = 0;
  let withLatLng = 0;
  let wouldUseTextSearch = 0;

  for (const place of places) {
    const strategy = strategyFor(place);
    const sourceUrl = sourceGoogleMapsUrl(place.raw_import, sourceUrlFromLinks(place.source_links) ?? place.google_maps_url);
    const apiReady = findApiReadyRecord(apiReadyIndex, {
      sourceUrl,
      sourceListNames: activeLinks(place.source_links).map((link) => link.source_list_name),
      title: place.name
    });
    if (apiReady) apiReadyMatches.push(apiReady);
    strategyCounts[strategy] = (strategyCounts[strategy] ?? 0) + 1;
    if (place.google_maps_url) withGoogleMapsUrl += 1;
    if (place.address) withAddress += 1;
    if (place.latitude !== null && place.longitude !== null) withLatLng += 1;
    if (strategy === "text_search_name_address" || strategy === "text_search_name") wouldUseTextSearch += 1;
  }

  return {
    sample_strategy_counts: strategyCounts,
    with_google_maps_url: withGoogleMapsUrl,
    with_address: withAddress,
    with_lat_lng: withLatLng,
    would_use_text_search: wouldUseTextSearch,
    api_ready_match_count: apiReadyMatches.length,
    api_ready_summary: summarizeApiReadyRecords(apiReadyMatches)
  };
}

function strategyFor(place: PlaceRow) {
  if (parseCoordinateText(place.name)) return "coordinate_name";
  if (place.google_place_id) return "place_details";
  if (extractPlaceId(place.google_maps_url)) return "maps_url_place_id";
  if (place.name && place.address) return "text_search_name_address";
  if (place.name) return "text_search_name";
  return "no_query";
}

function buildSearchQuery(place: PlaceRow, sourceUrlInfo?: GoogleMapsUrlInfo | null) {
  if (sourceUrlInfo?.query) return sourceUrlInfo.query;
  if (sourceUrlInfo?.name_hint && place.address) return `${sourceUrlInfo.name_hint} ${place.address}`;
  if (sourceUrlInfo?.name_hint) return sourceUrlInfo.name_hint;
  if (place.name && place.address) return `${place.name} ${place.address}`;
  return place.name;
}

function sourceUrlFromLinks(value: unknown) {
  const links = activeLinks(value);
  return links.map((link) => link.source_url).find(Boolean) ?? null;
}

function extractPlaceId(url: string | null) {
  if (!url) return null;
  const decoded = decodeURIComponent(url);
  const queryPlaceId = decoded.match(/[?&]query_place_id=([^&]+)/)?.[1];
  if (queryPlaceId) return queryPlaceId;
  const placeId = decoded.match(/(?:place_id:|placeid=|placeId=)(ChI[^&/?\s]+)/)?.[1];
  if (placeId) return placeId;
  const resource = decoded.match(/places\/(ChI[^&/?\s]+)/)?.[1];
  return resource ?? null;
}

function normalizePriceLevel(value: string | number | undefined) {
  if (typeof value === "number") return value;
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4
  };
  return value ? map[value] ?? null : null;
}

function activeLinks(value: unknown): SourceLinkRow[] {
  return Array.isArray(value) ? value.filter((link) => typeof link === "object" && link !== null && (link as SourceLinkRow).active !== false) as SourceLinkRow[] : [];
}

function regionChanged(before: ClassificationRow | null, after: ReturnType<typeof classifyRegion>) {
  if (!before) return true;
  return before.country !== after.country ||
    before.prefecture !== after.prefecture ||
    before.city !== after.city ||
    before.ward !== after.ward ||
    before.area_label !== after.area_label ||
    before.nearest_station !== after.nearest_station ||
    before.travel_region !== after.travel_region;
}

function isMissing(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "unknown";
}

function emptyReclassifySummary() {
  return { reclassified_count: 0, missing_before: 0, missing_after: 0 };
}

function emptyRunCounters(): RunCounters {
  return { enriched: 0, not_found: 0, needs_review: 0, error: 0, coordinate_point: 0, source_url_confirmed: 0 };
}

function incrementVerifiedCounter(counters: RunCounters, status: string) {
  if (status === "enriched" || status === "not_found" || status === "needs_review" || status === "error" || status === "coordinate_point" || status === "source_url_confirmed") {
    counters[status] += 1;
    return;
  }
  counters.error += 1;
}

async function fetchDbFinalCounts(supabase: SupabaseClient) {
  const statuses = ["pending_enrichment", "enriched", "needs_review", "not_found", "error", "coordinate_point", "source_url_confirmed"] as const;
  const counts: Record<typeof statuses[number], number> = {
    pending_enrichment: 0,
    enriched: 0,
    needs_review: 0,
    not_found: 0,
    error: 0,
    coordinate_point: 0,
    source_url_confirmed: 0
  };

  for (const status of statuses) {
    const { count, error } = await supabase
      .from("places")
      .select("id", { count: "exact", head: true })
      .eq("enrichment_status", status);
    if (error) throw error;
    counts[status] = count ?? 0;
  }

  return counts;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function tokenOverlap(a: string, b: string) {
  if (!a || !b) return 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.includes(shorter)) return 1;
  let shared = 0;
  for (const char of new Set([...shorter])) {
    if (longer.includes(char)) shared += 1;
  }
  return shared / Math.max(1, new Set([...shorter]).size);
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return value * Math.PI / 180;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Supabase接続情報が未設定です。.env.local に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。");
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function safeSupabaseUrl(value: string | undefined) {
  if (!value) return "未設定";
  try {
    return new URL(value).origin;
  } catch {
    return "不正なURL";
  }
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

function parseArgs(): EnrichOptions {
  const limitValue = valueAfter("--limit");
  const status = valueAfter("--status") ?? "pending_enrichment";
  const limit = limitValue ? Number(limitValue) : DEFAULT_LIMIT;
  return {
    dryRun: process.argv.includes("--dry-run"),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT,
    status,
    reclassify: !process.argv.includes("--no-reclassify")
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
  console.log(`[enrich] ${message}`);
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) return JSON.stringify(error);
  return String(error);
}

function formatSupabaseError(error: SupabaseErrorLike) {
  return [
    error.code ? `code=${error.code}` : null,
    error.message ? `message=${error.message}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null
  ].filter(Boolean).join(" ");
}

void main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
