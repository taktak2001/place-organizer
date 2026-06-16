const SOURCE_NAME_FIELDS = ["name", "title", "タイトル", "place name", "location name", "場所名", "名前", "名称", "label", "placeName"];
const SOURCE_URL_FIELDS = ["url", "URL", "google maps url", "maps url", "link", "リンク", "google_maps_url"];

export function sourceSavedName(rawImport: unknown, fallback?: unknown) {
  return firstField(rawImport, SOURCE_NAME_FIELDS) ?? cleanSourceText(fallback);
}

export function sourceGoogleMapsUrl(rawImport: unknown, fallback?: unknown) {
  return firstField(rawImport, SOURCE_URL_FIELDS) ?? cleanSourceText(fallback);
}

export function googleDisplayName(rawGoogle: unknown) {
  const raw = candidateAwareRaw(rawGoogle);
  const displayName = objectRecord(raw?.displayName);
  return cleanSourceText(displayName?.text) ?? cleanSourceText(raw?.name);
}

export function googleMapsUri(rawGoogle: unknown, fallback?: unknown) {
  const raw = candidateAwareRaw(rawGoogle);
  return cleanSourceText(raw?.googleMapsUri) ??
    cleanSourceText(raw?.google_maps_uri) ??
    cleanSourceText(raw?.google_maps_url) ??
    cleanSourceText(fallback);
}

export function preferredGoogleMapsUrl(input: {
  rawGoogle?: unknown;
  placeGoogleMapsUrl?: unknown;
  rawImport?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}) {
  return sourceGoogleMapsUrl(input.rawImport) ??
    cleanSourceText(input.placeGoogleMapsUrl) ??
    googleMapsUri(input.rawGoogle) ??
    coordinateGoogleMapsUrl(input.latitude, input.longitude);
}

export function hasUrlDifference(sourceUrl: unknown, googleUrl: unknown) {
  const source = normalizeUrlForCompare(sourceUrl);
  const google = normalizeUrlForCompare(googleUrl);
  return Boolean(source && google && source !== google);
}

export function isCandidateOnly(rawGoogle: unknown) {
  const raw = objectRecord(rawGoogle);
  return raw?.candidate_only === true;
}

export function normalizedNameSimilarity(left: unknown, right: unknown) {
  const a = normalizeComparableText(left);
  const b = normalizeComparableText(right);
  if (!a || !b) return null;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return tokenOverlap(a, b);
}

export function hasNameDifference(sourceName: unknown, googleName: unknown) {
  const source = cleanSourceText(sourceName);
  const google = cleanSourceText(googleName);
  return Boolean(source && google && normalizeComparableText(source) !== normalizeComparableText(google));
}

export function hasWeakNameMatch(sourceName: unknown, googleName: unknown) {
  const similarity = normalizedNameSimilarity(sourceName, googleName);
  return similarity !== null && similarity < 0.45;
}

function firstField(rawImport: unknown, fieldNames: string[]) {
  const raw = objectRecord(rawImport);
  if (!raw) return null;
  const entries = Object.entries(raw).map(([key, value]) => [key.trim().toLowerCase(), value] as const);
  for (const field of fieldNames) {
    const found = entries.find(([key]) => key === field.toLowerCase());
    const text = cleanSourceText(found?.[1]);
    if (text) return text;
  }
  return null;
}

function cleanSourceText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function coordinateGoogleMapsUrl(latitude: unknown, longitude: unknown) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function normalizeUrlForCompare(value: unknown) {
  const text = cleanSourceText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    url.hash = "";
    return url.toString();
  } catch {
    return text;
  }
}

function objectRecord(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function candidateAwareRaw(rawGoogle: unknown) {
  const raw = objectRecord(rawGoogle);
  return objectRecord(raw?.candidate_place) ?? raw;
}

function normalizeComparableText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function tokenOverlap(a: string, b: string) {
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let shared = 0;
  for (const char of new Set([...shorter])) {
    if (longer.includes(char)) shared += 1;
  }
  return shared / Math.max(1, new Set([...shorter]).size);
}
