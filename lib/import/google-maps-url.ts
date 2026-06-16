export type GoogleMapsUrlInfo = {
  original_url: string | null;
  resolved_url: string | null;
  place_id: string | null;
  cid: string | null;
  query: string | null;
  name_hint: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function parseGoogleMapsUrl(value: unknown): GoogleMapsUrlInfo {
  const original = cleanText(value);
  const empty = emptyInfo(original);
  if (!original) return empty;

  let decoded = decodeSafely(original);
  try {
    const url = new URL(original);
    decoded = decodeSafely(`${url.pathname}${url.search}${url.hash}`);
    return {
      original_url: original,
      resolved_url: original,
      place_id: extractPlaceId(decoded),
      cid: url.searchParams.get("cid") ?? url.searchParams.get("ludocid") ?? extractCid(decoded),
      query: cleanText(url.searchParams.get("query") ?? url.searchParams.get("q")) ?? extractSearchPathName(decoded),
      name_hint: extractPlacePathName(decoded) ?? extractSearchPathName(decoded),
      ...extractCoordinates(decoded, url.searchParams)
    };
  } catch {
    return {
      ...empty,
      place_id: extractPlaceId(decoded),
      cid: extractCid(decoded),
      query: extractSearchPathName(decoded),
      name_hint: extractPlacePathName(decoded),
      ...extractCoordinates(decoded)
    };
  }
}

export async function resolveGoogleMapsRedirect(value: unknown) {
  const original = cleanText(value);
  if (!original || !isLikelyShortMapsUrl(original)) return original;
  try {
    const response = await fetch(original, { method: "HEAD", redirect: "follow" });
    return response.url || original;
  } catch {
    try {
      const response = await fetch(original, { method: "GET", redirect: "follow" });
      return response.url || original;
    } catch {
      return original;
    }
  }
}

export function distanceKm(lat1: number | null, lng1: number | null, lat2: number | null, lng2: number | null) {
  if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) return null;
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isGenericOrChainLikeName(value: unknown) {
  const text = String(value ?? "").toLowerCase().normalize("NFKC");
  const compact = text.replace(/[^\p{Letter}\p{Number}]+/gu, "");
  if (compact.length <= 6) return true;
  return /gelato|cafe|coffee|gallery|hotel|museum|restaurant|store|shop|badiani|gagosian|a\.?p\.?c\.?|cos/i.test(text);
}

function extractPlaceId(text: string) {
  return text.match(/[?&]query_place_id=([^&]+)/)?.[1] ??
    text.match(/[?&]place_id=([^&]+)/)?.[1] ??
    text.match(/(?:place_id:|placeid=|placeId=)(ChI[^&/?\s!]+)/)?.[1] ??
    text.match(/places\/(ChI[^&/?\s!]+)/)?.[1] ??
    null;
}

function extractCid(text: string) {
  return text.match(/[?&](?:cid|ludocid)=([^&]+)/)?.[1] ?? text.match(/!1s(0x[0-9a-f:]+)/i)?.[1] ?? null;
}

function extractCoordinates(text: string, params?: URLSearchParams) {
  const ll = params?.get("ll") ?? params?.get("center");
  const fromParam = ll?.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const fromAt = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const fromData = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const match = fromParam ?? fromAt ?? fromData;
  const latitude = match ? Number(match[1]) : null;
  const longitude = match ? Number(match[2]) : null;
  return {
    latitude: validLatLng(latitude, longitude) ? latitude : null,
    longitude: validLatLng(latitude, longitude) ? longitude : null
  };
}

function extractPlacePathName(text: string) {
  const match = text.match(/\/maps\/place\/([^/@?]+)/);
  return match ? cleanText(match[1].replaceAll("+", " ")) : null;
}

function extractSearchPathName(text: string) {
  const match = text.match(/\/maps\/search\/([^/@?]+)/);
  return match ? cleanText(match[1].replaceAll("+", " ")) : null;
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function decodeSafely(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function emptyInfo(original: string | null): GoogleMapsUrlInfo {
  return { original_url: original, resolved_url: original, place_id: null, cid: null, query: null, name_hint: null, latitude: null, longitude: null };
}

function isLikelyShortMapsUrl(value: string) {
  return /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(value);
}

function validLatLng(lat: number | null, lng: number | null) {
  return lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function toRad(value: number) {
  return value * Math.PI / 180;
}
