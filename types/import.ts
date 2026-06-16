export type SupportedImportKind = "zip" | "csv" | "json" | "geojson";

export type NormalizedImportItem = {
  source_file: string;
  source_list_name: string | null;
  name: string;
  address: string | null;
  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  raw: Record<string, unknown>;
  google_place_id?: string | null;
  normalized_key: string;
};

export type ImportError = {
  source_file?: string;
  message: string;
  row?: number;
};

export type SkippedImportRow = {
  source_file?: string;
  message: string;
  row?: number;
};

export type DuplicateCandidate = {
  key: string;
  count: number;
  names: string[];
  source_lists: string[];
};

export type DiffPreview = {
  added: number;
  removed: number;
  unchanged: number;
  list_added: number;
  list_removed: number;
};

export type ParseResult = {
  file_hash: string;
  filename: string;
  items: NormalizedImportItem[];
  file_counts: Record<string, number>;
  list_counts: Record<string, number>;
  duplicate_candidates: DuplicateCandidate[];
  errors: ImportError[];
  skipped_rows: SkippedImportRow[];
  diff: DiffPreview | null;
  already_imported: boolean;
  supabase_available: boolean;
};

export type PlaceClassification = {
  main_category: string;
  sub_category: string | null;
  scene_tags: string[];
  country: string | null;
  prefecture: string | null;
  city: string | null;
  ward: string | null;
  area_label: string | null;
  nearest_station: string | null;
  travel_region: string | null;
  priority: string | null;
  visited_status: string;
  confidence: number;
  reason: string;
};
