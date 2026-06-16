import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { duplicateCandidates, fileCounts, listCounts } from "../lib/import/normalize";
import { parseCsvContent } from "../lib/import/parsers";

const sampleDir = path.join(process.cwd(), "sample-data");

if (!fs.existsSync(sampleDir)) {
  console.log(JSON.stringify({ file_count: 0, total_rows: 0, parsed_count: 0, error_count: 0, duplicate_candidate_count: 0 }, null, 2));
  process.exit(0);
}

const files = fs.readdirSync(sampleDir).filter((file) => /\.csv$/i.test(file)).sort();
const parsedResults = files.map((file) => {
  const fullPath = path.join(sampleDir, file);
  const content = fs.readFileSync(fullPath, "utf8");
  const rawRows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true
  }) as Record<string, unknown>[];
  const parsed = parseCsvContent(content, file);
  return { file, rawRows: rawRows.length, parsed };
});

const items = parsedResults.flatMap((result) => result.parsed.items);
const errors = parsedResults.flatMap((result) => result.parsed.errors);
const skippedRows = parsedResults.flatMap((result) => result.parsed.skipped_rows);
const normalizedKeyCount = items.filter((item) => item.normalized_key).length;

console.log(JSON.stringify({
  file_count: files.length,
  total_rows: parsedResults.reduce((sum, result) => sum + result.rawRows, 0),
  parsed_count: items.length,
  file_counts: fileCounts(items),
  list_counts: listCounts(items),
  skipped_row_count: skippedRows.length,
  skipped_rows_by_file: countBy(skippedRows.map((row) => row.source_file ?? "Unknown")),
  error_count: errors.length,
  errors_by_file: countBy(errors.map((error) => error.source_file ?? "Unknown")),
  duplicate_candidate_count: duplicateCandidates(items).length,
  normalized_key_count: normalizedKeyCount,
  normalized_key_rate: items.length === 0 ? 0 : Number((normalizedKeyCount / items.length).toFixed(4))
}, null, 2));

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}
