import { createHash } from "crypto";
import type { DuplicateCandidate, NormalizedImportItem } from "@/types/import";

const PLACE_ID_PATTERNS = [/place_id[:=]([A-Za-z0-9_-]+)/i, /query_place_id=([A-Za-z0-9_-]+)/i];

export function sha256(buffer: Buffer | ArrayBuffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(new Uint8Array(buffer));
  return createHash("sha256").update(bytes).digest("hex");
}

export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s,._/\\|:;'"“”‘’`~!！?？()[\]{}<>「」『』【】・-]+/g, "")
    .trim();
}

export function normalizeMapsUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    const keep = new URLSearchParams();
    for (const key of ["q", "query", "cid", "query_place_id", "place_id"]) {
      const found = url.searchParams.get(key);
      if (found) keep.set(key, found);
    }
    url.search = keep.toString();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

export function extractGooglePlaceId(url: string | null | undefined, raw?: Record<string, unknown>) {
  const rawId = cleanText(raw?.google_place_id ?? raw?.place_id ?? raw?.placeId);
  if (rawId) return rawId;
  if (!url) return null;
  for (const pattern of PLACE_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

export function roundCoord(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * 100000) / 100000;
}

export function computeNormalizedKey(input: {
  google_place_id?: string | null;
  google_maps_url?: string | null;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source_list_name?: string | null;
}) {
  if (input.google_place_id) return `gpid:${input.google_place_id}`;
  const normalizedUrl = normalizeMapsUrl(input.google_maps_url);
  if (normalizedUrl) return `url:${normalizeText(normalizedUrl)}`;
  const name = normalizeText(input.name);
  const lat = roundCoord(input.latitude);
  const lng = roundCoord(input.longitude);
  if (name && lat !== null && lng !== null) return `geo:${name}:${lat}:${lng}`;
  const address = normalizeText(input.address);
  if (name && address) return `addr:${name}:${address}`;
  return `list:${normalizeText(input.source_list_name)}:${name}`;
}

export function finalizeItem(item: Omit<NormalizedImportItem, "normalized_key">): NormalizedImportItem {
  const googlePlaceId = extractGooglePlaceId(item.google_maps_url, item.raw);
  return {
    ...item,
    google_place_id: googlePlaceId,
    google_maps_url: normalizeMapsUrl(item.google_maps_url),
    normalized_key: computeNormalizedKey({ ...item, google_place_id: googlePlaceId })
  };
}

export function getListNameFromPath(path: string) {
  const filename = path.split("/").pop() ?? path;
  const withoutExt = filename.replace(/\.(csv|json|geojson)$/i, "");
  const parts = path.split("/").filter(Boolean);
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  if (/^(saved|保存済み|maps|google maps|your places)$/i.test(withoutExt) && parent) {
    return parent;
  }
  return withoutExt || parent || "Unknown";
}

export function listCounts(items: NormalizedImportItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = item.source_list_name || "Unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

export function fileCounts(items: NormalizedImportItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = item.source_file || "Unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

export function duplicateCandidates(items: NormalizedImportItem[]): DuplicateCandidate[] {
  const groups = new Map<string, NormalizedImportItem[]>();
  for (const item of items) {
    addDuplicateGroup(groups, item.normalized_key, item);
    if (item.google_place_id) addDuplicateGroup(groups, `gpid:${item.google_place_id}`, item);
    const url = normalizeMapsUrl(item.google_maps_url);
    if (url) addDuplicateGroup(groups, `url:${normalizeText(url)}`, item);
    if (item.name && item.address) addDuplicateGroup(groups, `addr:${normalizeText(item.name)}:${normalizeText(item.address)}`, item);
    const lat = roundCoord(item.latitude);
    const lng = roundCoord(item.longitude);
    if (item.name && lat !== null && lng !== null) addDuplicateGroup(groups, `geo:${normalizeText(item.name)}:${lat}:${lng}`, item);
  }

  const seen = new Set<string>();
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .filter(([key]) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(([key, group]) => ({
      key,
      count: group.length,
      names: [...new Set(group.map((item) => item.name))].slice(0, 5),
      source_lists: [...new Set(group.map((item) => item.source_list_name || "Unknown"))]
    }));
}

function addDuplicateGroup(groups: Map<string, NormalizedImportItem[]>, key: string, item: NormalizedImportItem) {
  const existing = groups.get(key) ?? [];
  if (!existing.some((candidate) => candidate.source_file === item.source_file && candidate.source_list_name === item.source_list_name && candidate.name === item.name)) {
    existing.push(item);
  }
  groups.set(key, existing);
}
