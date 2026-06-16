import JSZip from "jszip";
import { parse } from "csv-parse/sync";
import type { ImportError, NormalizedImportItem, SkippedImportRow } from "@/types/import";
import { cleanText, finalizeItem, getListNameFromPath } from "./normalize";

type ParsedFile = {
  items: NormalizedImportItem[];
  errors: ImportError[];
  skipped_rows: SkippedImportRow[];
};

const SUPPORTED_FILE = /\.(csv|json|geojson)$/i;

const FIELD_ALIASES = {
  name: ["name", "title", "タイトル", "place name", "location name", "場所名", "名前", "名称", "label", "placeName"],
  url: ["url", "URL", "google maps url", "maps url", "link", "リンク", "google_maps_url"],
  address: ["address", "formatted address", "住所", "所在地", "formatted_address"],
  latitude: ["lat", "latitude", "緯度"],
  longitude: ["lng", "lon", "longitude", "経度"],
  notes: ["notes", "note", "memo", "メモ", "コメント", "タグ", "説明", "description"]
};

function findValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value] as const);
  for (const alias of aliases) {
    const found = normalizedEntries.find(([key]) => key === alias.toLowerCase());
    if (found) return found[1];
  }
  return null;
}

function numeric(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function itemFromRecord(record: Record<string, unknown>, sourceFile: string, index: number): NormalizedImportItem | null {
  const sourceListName = cleanText(record.source_list_name) ?? getListNameFromPath(sourceFile);
  const name =
    cleanText(findValue(record, FIELD_ALIASES.name)) ??
    cleanText((record.location as Record<string, unknown> | undefined)?.name) ??
    cleanText((record.place as Record<string, unknown> | undefined)?.name);
  if (!name) return null;

  const coords = extractCoordinates(record);
  return finalizeItem({
    source_file: sourceFile,
    source_list_name: sourceListName,
    name,
    address: cleanText(findValue(record, FIELD_ALIASES.address)),
    google_maps_url: cleanText(findValue(record, FIELD_ALIASES.url)),
    latitude: numeric(findValue(record, FIELD_ALIASES.latitude)) ?? coords.latitude,
    longitude: numeric(findValue(record, FIELD_ALIASES.longitude)) ?? coords.longitude,
    notes: cleanText(findValue(record, FIELD_ALIASES.notes)),
    raw: { ...record, _row: index }
  });
}

function isSkippableRecord(record: Record<string, unknown>) {
  const values = Object.values(record).map((value) => cleanText(value));
  if (values.every((value) => !value)) return true;
  const nonEmptyValues = values.filter(Boolean);
  if (nonEmptyValues.length === 1 && /^[-ー—–]+$/.test(nonEmptyValues[0] ?? "")) return true;
  return false;
}

function extractCoordinates(record: Record<string, unknown>) {
  const location = record.location as Record<string, unknown> | undefined;
  const geometry = record.geometry as Record<string, unknown> | undefined;
  const coordinates = (geometry?.coordinates ?? record.coordinates) as unknown;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    return { longitude: numeric(coordinates[0]), latitude: numeric(coordinates[1]) };
  }
  return {
    latitude: numeric(location?.latitude ?? location?.lat),
    longitude: numeric(location?.longitude ?? location?.lng ?? location?.lon)
  };
}

export function parseCsvContent(content: string, sourceFile: string): ParsedFile {
  const errors: ImportError[] = [];
  const skippedRows: SkippedImportRow[] = [];
  try {
    const rows = parse(content, {
      columns: true,
      skip_empty_lines: false,
      bom: true,
      relax_column_count: true,
      trim: true
    }) as Record<string, unknown>[];
    const items = rows.flatMap((row, index) => {
      if (isSkippableRecord(row)) {
        skippedRows.push({ source_file: sourceFile, row: index + 2, message: "空行のためスキップしました。" });
        return [];
      }
      const item = itemFromRecord(row, sourceFile, index + 2);
      if (!item) {
        errors.push({ source_file: sourceFile, row: index + 2, message: "場所名が見つかりません。" });
        return [];
      }
      return [item];
    });
    return { items, errors, skipped_rows: skippedRows };
  } catch (error) {
    return { items: [], errors: [{ source_file: sourceFile, message: `CSVの解析に失敗しました: ${String(error)}` }], skipped_rows: skippedRows };
  }
}

export function parseJsonContent(content: string, sourceFile: string): ParsedFile {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parseJsonValue(parsed, sourceFile);
  } catch (error) {
    return { items: [], errors: [{ source_file: sourceFile, message: `JSONの解析に失敗しました: ${String(error)}` }], skipped_rows: [] };
  }
}

export function parseJsonValue(parsed: unknown, sourceFile: string): ParsedFile {
  const errors: ImportError[] = [];
  const skippedRows: SkippedImportRow[] = [];
  const records = recordsFromJson(parsed);
  const items = records.flatMap((record, index) => {
    if (isSkippableRecord(record)) {
      skippedRows.push({ source_file: sourceFile, row: index + 1, message: "空行のためスキップしました。" });
      return [];
    }
    const item = itemFromRecord(record, sourceFile, index + 1);
    if (!item) {
      errors.push({ source_file: sourceFile, row: index + 1, message: "場所名が見つかりません。" });
      return [];
    }
    return [item];
  });
  return { items, errors, skipped_rows: skippedRows };
}

function recordsFromJson(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (!isRecord(parsed)) return [];
  if (Array.isArray(parsed.features)) {
    return parsed.features.filter(isRecord).map((feature) => {
      const properties = isRecord(feature.properties) ? feature.properties : {};
      return { ...properties, geometry: feature.geometry };
    });
  }
  for (const key of ["places", "locations", "saved_places", "items"]) {
    const value = parsed[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [parsed];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseImportFile(file: File): Promise<ParsedFile> {
  const buffer = Buffer.from(await file.arrayBuffer());
  if (/\.zip$/i.test(file.name)) return parseZip(buffer, file.name);
  const text = buffer.toString("utf-8");
  if (/\.csv$/i.test(file.name)) return parseCsvContent(text, file.name);
  if (/\.(json|geojson)$/i.test(file.name)) return parseJsonContent(text, file.name);
  return { items: [], errors: [{ source_file: file.name, message: "対応していないファイル形式です。" }], skipped_rows: [] };
}

export async function parseImportFiles(files: File[]): Promise<ParsedFile> {
  const results = await Promise.all(files.map((file) => parseImportFile(file)));
  return {
    items: results.flatMap((result) => result.items),
    errors: results.flatMap((result) => result.errors),
    skipped_rows: results.flatMap((result) => result.skipped_rows)
  };
}

export async function parseZip(buffer: Buffer, filename: string): Promise<ParsedFile> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const supported = Object.values(zip.files).filter((entry) => !entry.dir && SUPPORTED_FILE.test(entry.name));
    if (supported.length === 0) {
      return { items: [], errors: [{ source_file: filename, message: "ZIP内に対応するCSV/JSON/GeoJSONファイルが見つかりません。" }], skipped_rows: [] };
    }
    const results = await Promise.all(
      supported.map(async (entry) => {
        const content = await entry.async("string");
        if (/\.csv$/i.test(entry.name)) return parseCsvContent(content, entry.name);
        return parseJsonContent(content, entry.name);
      })
    );
    return {
      items: results.flatMap((result) => result.items),
      errors: results.flatMap((result) => result.errors),
      skipped_rows: results.flatMap((result) => result.skipped_rows)
    };
  } catch (error) {
    return { items: [], errors: [{ source_file: filename, message: `ZIPが破損しているか、解析に失敗しました: ${String(error)}` }], skipped_rows: [] };
  }
}
