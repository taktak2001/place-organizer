export type ClosedStatus = "permanently_closed" | "temporarily_closed" | "unknown_closed_candidate";

export type ClosedPlaceInput = {
  business_status?: unknown;
  raw_google?: unknown;
  archive_reason?: unknown;
};

export type ClosedDetection = {
  status: ClosedStatus;
  business_status: string;
};

const PERMANENTLY_CLOSED = new Set(["CLOSED_PERMANENTLY", "PERMANENTLY_CLOSED"]);
const TEMPORARILY_CLOSED = new Set(["CLOSED_TEMPORARILY", "TEMPORARILY_CLOSED"]);

export function detectClosedPlace(place: ClosedPlaceInput): ClosedDetection | null {
  if (String(place.archive_reason ?? "") === "not_closed") return null;
  const statuses = businessStatuses(place);
  if (statuses.some((status) => PERMANENTLY_CLOSED.has(status))) {
    return { status: "permanently_closed", business_status: "CLOSED_PERMANENTLY" };
  }
  if (statuses.some((status) => TEMPORARILY_CLOSED.has(status))) {
    return { status: "temporarily_closed", business_status: "CLOSED_TEMPORARILY" };
  }
  if (statuses.some((status) => status.includes("CLOSED"))) {
    return { status: "unknown_closed_candidate", business_status: statuses.find((status) => status.includes("CLOSED")) ?? "CLOSED" };
  }
  return null;
}

export function closedStatusLabel(status: unknown) {
  if (status === "permanently_closed") return "完全閉業";
  if (status === "temporarily_closed") return "一時休業";
  if (status === "unknown_closed_candidate") return "閉業候補";
  return "閉業候補";
}

export function closedArchiveReason(status: ClosedStatus) {
  if (status === "permanently_closed") return "closed_permanently";
  if (status === "temporarily_closed") return "closed_temporarily";
  return "closed_candidate";
}

function businessStatuses(place: ClosedPlaceInput) {
  const raw = record(place.raw_google);
  const candidate = record(raw?.candidate_place);
  return [
    place.business_status,
    raw?.businessStatus,
    raw?.business_status,
    candidate?.businessStatus,
    candidate?.business_status
  ]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .filter(Boolean);
}

function record(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
