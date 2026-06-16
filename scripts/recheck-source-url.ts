import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sourceGoogleMapsUrl } from "../lib/import/source-fields";
import { reviewSourceUrlCandidate, sourceUrlReasonCounts } from "../lib/import/source-url-review";

type Options = {
  dryRun: boolean;
  apply: boolean;
  action: "mark-needs-review" | "source-url-confirmed" | "clear-google-fields";
  includeConfirmed: boolean;
  status: string;
};

type PlaceRow = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  raw_import: Record<string, unknown> | null;
  raw_google: Record<string, unknown> | null;
  enrichment_status: string | null;
};

loadEnvLocal();

async function main() {
  const options = parseArgs();
  log("start");
  log(options.dryRun ? "mode: dry-run" : "mode: write");
  log(`status filter: ${options.status}`);
  log(`action: ${options.action}`);
  if (options.status === "all" && !options.includeConfirmed) {
    log("source_url_confirmed は処理済みとして除外します。再チェックする場合は --include-confirmed を付けてください。");
  }
  if (options.status === "enriched" && !options.apply) {
    log("warning: enriched は正しい補完情報を含む可能性があります。まずdry-runで理由別件数を確認してください。");
  }
  if (options.status === "enriched" && options.apply) {
    log("warning: enriched にapplyします。デフォルトの mark-needs-review はGoogleフィールドを消さず、レビューへ戻します。");
  }
  const supabase = getSupabase();
  const places = await fetchPlaces(supabase, options.status);
  const confirmedCount = places.filter(isSourceUrlConfirmed).length;
  const checkedPlaces = checkedPlacesForOptions(places, options);
  const skippedConfirmedCount = places.length - checkedPlaces.length;
  log(`total count: ${places.length}`);
  log(`checked count: ${checkedPlaces.length}`);
  log(`skipped confirmed count: ${skippedConfirmedCount}`);

  const reviews = checkedPlaces.map((place) => ({ place, review: reviewPlace(place) }));
  const flagged = reviews.filter(({ review }) => review.reasons.length > 0);
  const targets = targetEntries(reviews, options);
  const reasonCounts = sourceUrlReasonCounts(flagged.map(({ review }) => review));
  log(`flagged count: ${flagged.length}`);
  log(`action target count: ${targets.length}`);

  const summary = {
    total_count: places.length,
    checked_count: checkedPlaces.length,
    already_source_url_confirmed_count: confirmedCount,
    skipped_confirmed_count: skippedConfirmedCount,
    source_url_confirmed_count: 0,
    cleared_google_fields_count: 0,
    needs_review_count: 0,
    missing_source_url_count: missingSourceUrlCount(checkedPlaces, options),
    unchanged_count: checkedPlaces.length - targets.length
  };

  if (options.apply) {
    let processed = 0;
    for (const { place, review } of targets) {
      const rawGoogle = typeof place.raw_google === "object" && place.raw_google !== null ? place.raw_google : {};
      const sourceUrl = sourceGoogleMapsUrl(place.raw_import, place.google_maps_url);
      const nextStatus = options.action === "source-url-confirmed" && sourceUrl ? "source_url_confirmed" : "needs_review";
      const shouldClear = options.action === "source-url-confirmed" || options.action === "clear-google-fields";
      const updatePayload = shouldClear
        ? clearGoogleFieldsPayload(review, rawGoogle, sourceUrl, nextStatus, reviewReason(options.status, nextStatus))
        : markNeedsReviewPayload(review, rawGoogle);
      const { error } = await supabase
        .from("places")
        .update(updatePayload)
        .eq("id", place.id);
      if (error) throw error;
      if (nextStatus === "source_url_confirmed") summary.source_url_confirmed_count += 1;
      else summary.needs_review_count += 1;
      if (shouldClear) summary.cleared_google_fields_count += 1;
      processed += 1;
      if (processed % 100 === 0 || processed === targets.length) log(`updated ${processed}/${targets.length}`);
    }
  } else {
    for (const { place } of targets) {
      const sourceUrl = sourceGoogleMapsUrl(place.raw_import, place.google_maps_url);
      if (options.action === "source-url-confirmed" && sourceUrl) summary.source_url_confirmed_count += 1;
      else summary.needs_review_count += 1;
    }
    summary.cleared_google_fields_count = options.action === "mark-needs-review" ? 0 : targets.length;
  }

  log("done");
  console.log(JSON.stringify({
    status: options.dryRun ? "dry_run" : "completed",
    target_count: checkedPlaces.length,
    flagged_count: flagged.length,
    action_target_count: targets.length,
    ...summary,
    reason_counts: reasonCounts
  }, null, 2));
}

function reviewPlace(place: PlaceRow) {
  return reviewSourceUrlCandidate(place);
}

function checkedPlacesForOptions(places: PlaceRow[], options: Options) {
  if (options.status === "source_url_confirmed" || options.includeConfirmed) return places;
  return places.filter((place) => !isSourceUrlConfirmed(place));
}

function isSourceUrlConfirmed(place: PlaceRow) {
  return place.enrichment_status === "source_url_confirmed";
}

function targetEntries(reviews: Array<{ place: PlaceRow; review: ReturnType<typeof reviewPlace> }>, options: Options) {
  if (options.action === "source-url-confirmed" && options.status === "not_found") {
    return reviews.filter(({ place }) => Boolean(sourceGoogleMapsUrl(place.raw_import, place.google_maps_url)));
  }
  return reviews.filter(({ review }) => review.reasons.length > 0);
}

function missingSourceUrlCount(places: PlaceRow[], options: Options) {
  if (options.action !== "source-url-confirmed" || options.status !== "not_found") return 0;
  return places.filter((place) => !sourceGoogleMapsUrl(place.raw_import, place.google_maps_url)).length;
}

async function fetchPlaces(supabase: SupabaseClient, status: string) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase
      .from("places")
      .select("id, name, latitude, longitude, google_maps_url, raw_import, raw_google, enrichment_status")
      .range(from, from + 999);
    if (status !== "all") query = query.eq("enrichment_status", status);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function candidatePlace(rawGoogle: Record<string, unknown>) {
  return typeof rawGoogle.candidate_place === "object" && rawGoogle.candidate_place !== null
    ? rawGoogle.candidate_place
    : rawGoogle;
}

function markNeedsReviewPayload(review: ReturnType<typeof reviewPlace>, rawGoogle: Record<string, unknown>) {
  return {
    raw_google: {
      ...rawGoogle,
      source_url_review: review.source_url_info,
      review_reason: "元リンクと補完候補が矛盾している可能性があります"
    },
    enrichment_status: "needs_review",
    updated_at: new Date().toISOString()
  };
}

function clearGoogleFieldsPayload(review: ReturnType<typeof reviewPlace>, rawGoogle: Record<string, unknown>, sourceUrl: string | null, nextStatus: string, reviewReasonText: string) {
  return {
    google_place_id: null,
    google_maps_url: sourceUrl,
    address: null,
    latitude: review.source_url_info.latitude,
    longitude: review.source_url_info.longitude,
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
      candidate_place: candidatePlace(rawGoogle),
      source_url_review: review.source_url_info,
      review_reason: reviewReasonText
    },
    enrichment_status: nextStatus,
    updated_at: new Date().toISOString()
  };
}

function reviewReason(status: string, nextStatus: string) {
  if (status === "not_found" && nextStatus === "source_url_confirmed") {
    return "Places APIでは見つからなかったため、元リンクを正として採用しました";
  }
  return "元リンクと補完候補が一致しないため、元リンクを優先しました";
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
  const apply = process.argv.includes("--apply");
  const action = valueAfter("--action") ?? "mark-needs-review";
  if (!["mark-needs-review", "source-url-confirmed", "clear-google-fields"].includes(action)) {
    throw new Error("--action は mark-needs-review / source-url-confirmed / clear-google-fields のいずれかを指定してください。");
  }
  return {
    apply,
    dryRun: process.argv.includes("--dry-run") || !apply,
    action: action as Options["action"],
    includeConfirmed: process.argv.includes("--include-confirmed"),
    status: valueAfter("--status") ?? "needs_review"
  };
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function log(message: string) {
  console.log(`[recheck:source-url] ${message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
