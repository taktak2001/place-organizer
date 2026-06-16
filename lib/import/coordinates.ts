export type ParsedCoordinates = {
  latitude: number;
  longitude: number;
};

export function parseCoordinateText(value: unknown): ParsedCoordinates | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return parseDecimalCoordinates(text) ?? parseDmsCoordinates(text);
}

export function googleMapsUrlForCoordinates(coordinates: ParsedCoordinates) {
  return `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`;
}

function parseDecimalCoordinates(text: string): ParsedCoordinates | null {
  const match = text.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return validCoordinates(latitude, longitude) ? { latitude, longitude } : null;
}

function parseDmsCoordinates(text: string): ParsedCoordinates | null {
  const parts = [...text.matchAll(/(\d{1,3})(?:\s*[°º]\s*|\s+)(\d{1,2})?(?:\s*['’′]\s*|\s+)?(\d{1,2}(?:\.\d+)?)?(?:\s*(?:"|”|″)\s*)?\s*([NSEW])/gi)];
  if (parts.length !== 2) return null;

  const first = dmsPartToDecimal(parts[0]);
  const second = dmsPartToDecimal(parts[1]);
  if (!first || !second) return null;

  const latitude = first.axis === "lat" ? first.value : second.axis === "lat" ? second.value : null;
  const longitude = first.axis === "lng" ? first.value : second.axis === "lng" ? second.value : null;
  return latitude !== null && longitude !== null && validCoordinates(latitude, longitude) ? { latitude, longitude } : null;
}

function dmsPartToDecimal(match: RegExpMatchArray) {
  const degrees = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const direction = String(match[4] ?? "").toUpperCase();
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  const sign = direction === "S" || direction === "W" ? -1 : 1;
  const value = sign * (degrees + minutes / 60 + seconds / 3600);
  const axis = direction === "N" || direction === "S" ? "lat" : "lng";
  return { axis, value };
}

function validCoordinates(latitude: number, longitude: number) {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
}
