import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { duplicateCandidates, fileCounts, listCounts, sha256 } from "../lib/import/normalize";
import { parseCsvContent } from "../lib/import/parsers";
import type { ImportError, NormalizedImportItem, SkippedImportRow } from "../types/import";

export type PrivateDataInspection = {
  files: string[];
  totalRows: number;
  items: NormalizedImportItem[];
  errors: ImportError[];
  skippedRows: SkippedImportRow[];
  contentHash: string;
};

export function privateDataDir() {
  return path.join(process.cwd(), "data", "private");
}

export function readPrivateCsvData(dir = privateDataDir()): PrivateDataInspection {
  if (!fs.existsSync(dir)) {
    return emptyInspection();
  }

  const files = fs.readdirSync(dir).filter((file) => /\.csv$/i.test(file)).sort();
  const results = files.map((file) => {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const rawRows = parse(content, {
      columns: true,
      skip_empty_lines: false,
      bom: true,
      relax_column_count: true,
      trim: true
    }) as Record<string, unknown>[];
    const parsed = parseCsvContent(content, file);
    return { file, content, rawRows: rawRows.length, parsed };
  });

  const hashInput = results.map((result) => ({
    file: result.file,
    hash: sha256(Buffer.from(result.content))
  }));

  return {
    files,
    totalRows: results.reduce((sum, result) => sum + result.rawRows, 0),
    items: results.flatMap((result) => result.parsed.items),
    errors: results.flatMap((result) => result.parsed.errors),
    skippedRows: results.flatMap((result) => result.parsed.skipped_rows),
    contentHash: sha256(Buffer.from(JSON.stringify(hashInput)))
  };
}

export function summarizePrivateData(data: PrivateDataInspection) {
  return {
    file_count: data.files.length,
    total_rows: data.totalRows,
    parsed_count: data.items.length,
    file_counts: fileCounts(data.items),
    list_counts: listCounts(data.items),
    skipped_row_count: data.skippedRows.length,
    skipped_rows_by_file: countBy(data.skippedRows.map((row) => row.source_file ?? "Unknown")),
    real_error_count: data.errors.length,
    errors_by_file: countBy(data.errors.map((error) => error.source_file ?? "Unknown")),
    duplicate_candidate_count: duplicateCandidates(data.items).length,
    source_list_names: Object.keys(listCounts(data.items)).sort(),
    normalized_key_count: data.items.filter((item) => item.normalized_key).length
  };
}

export function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function emptyInspection(): PrivateDataInspection {
  return {
    files: [],
    totalRows: 0,
    items: [],
    errors: [],
    skippedRows: [],
    contentHash: sha256(Buffer.from("no-private-data"))
  };
}
