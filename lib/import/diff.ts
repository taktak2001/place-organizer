import type { DiffPreview, NormalizedImportItem } from "@/types/import";

type SnapshotItem = {
  normalized_key: string;
  source_list_name: string | null;
};

function membershipKey(item: SnapshotItem) {
  return `${item.normalized_key}::${item.source_list_name ?? "Unknown"}`;
}

export function computeDiffPreview(current: NormalizedImportItem[], previous: SnapshotItem[] | null): DiffPreview | null {
  if (!previous) return null;

  const currentPlaces = new Set(current.map((item) => item.normalized_key));
  const previousPlaces = new Set(previous.map((item) => item.normalized_key));
  const currentMembership = new Set(current.map(membershipKey));
  const previousMembership = new Set(previous.map(membershipKey));

  return {
    added: [...currentPlaces].filter((key) => !previousPlaces.has(key)).length,
    removed: [...previousPlaces].filter((key) => !currentPlaces.has(key)).length,
    unchanged: [...currentPlaces].filter((key) => previousPlaces.has(key)).length,
    list_added: [...currentMembership].filter((key) => !previousMembership.has(key)).length,
    list_removed: [...previousMembership].filter((key) => !currentMembership.has(key)).length
  };
}
