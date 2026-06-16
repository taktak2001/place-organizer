import { distanceKm, isGenericOrChainLikeName, parseGoogleMapsUrl, type GoogleMapsUrlInfo } from "./google-maps-url";
import { googleDisplayName, googleMapsUri, hasUrlDifference, hasWeakNameMatch, sourceGoogleMapsUrl, sourceSavedName } from "./source-fields";

export const SOURCE_URL_REASONS = {
  urlDiff: "URL差分",
  distanceDiff: "距離差分",
  weakName: "名称弱一致",
  chainLike: "チェーン店/複数店舗疑い",
  sourcePriority: "元リンク優先推奨"
} as const;

export type SourceUrlReviewPlace = {
  name: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  raw_import: Record<string, unknown> | null;
  raw_google: Record<string, unknown> | null;
};

export type SourceUrlReview = {
  source_url_info: GoogleMapsUrlInfo;
  reasons: string[];
  reason_flags: Record<keyof typeof SOURCE_URL_REASONS, boolean>;
};

export function reviewSourceUrlCandidate(place: SourceUrlReviewPlace): SourceUrlReview {
  const sourceUrl = sourceGoogleMapsUrl(place.raw_import, place.google_maps_url);
  const sourceUrlInfo = parseGoogleMapsUrl(sourceUrl);
  const sourceName = sourceSavedName(place.raw_import, place.name);
  const googleName = googleDisplayName(place.raw_google);
  const enrichedUrl = googleMapsUri(place.raw_google, place.google_maps_url);
  const km = distanceKm(sourceUrlInfo.latitude, sourceUrlInfo.longitude, place.latitude, place.longitude);
  const urlDiff = hasUrlDifference(sourceUrl, enrichedUrl);
  const weakName = hasWeakNameMatch(sourceUrlInfo.name_hint ?? sourceName, googleName);
  const distanceDiff = km !== null && km > 1.5;
  const chainLike = isGenericOrChainLikeName(sourceName) && urlDiff;
  const sourcePriority = urlDiff && (weakName || distanceDiff || chainLike);

  const reasonFlags = {
    urlDiff,
    distanceDiff,
    weakName,
    chainLike,
    sourcePriority
  };
  const conflictFlags = {
    urlDiff: sourcePriority,
    distanceDiff,
    weakName,
    chainLike,
    sourcePriority
  };

  return {
    source_url_info: sourceUrlInfo,
    reasons: Object.entries(SOURCE_URL_REASONS)
      .filter(([key]) => conflictFlags[key as keyof typeof SOURCE_URL_REASONS])
      .map(([, label]) => label),
    reason_flags: reasonFlags
  };
}

export function sourceUrlReasonCounts(reviews: SourceUrlReview[]) {
  return {
    [SOURCE_URL_REASONS.urlDiff]: reviews.filter((review) => review.reason_flags.urlDiff).length,
    [SOURCE_URL_REASONS.distanceDiff]: reviews.filter((review) => review.reason_flags.distanceDiff).length,
    [SOURCE_URL_REASONS.weakName]: reviews.filter((review) => review.reason_flags.weakName).length,
    [SOURCE_URL_REASONS.chainLike]: reviews.filter((review) => review.reason_flags.chainLike).length,
    [SOURCE_URL_REASONS.sourcePriority]: reviews.filter((review) => review.reason_flags.sourcePriority).length
  };
}
