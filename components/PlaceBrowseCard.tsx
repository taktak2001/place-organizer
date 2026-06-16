import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ja, jaCategory, jaCategoryTag, jaDisplay, jaGooglePlaceTypes, jaSceneTag } from "@/lib/i18n/ja";
import { googleMapsUri, isCandidateOnly, preferredGoogleMapsUrl } from "@/lib/import/source-fields";
import { activeLinks, categoryTags, firstRelated, sceneTags, type PlaceRow } from "@/lib/places/browse";

type Props = {
  place: PlaceRow;
  mode?: "general" | "category";
};

export function PlaceBrowseCard({ place, mode = "general" }: Props) {
  const classification = firstRelated(place.place_classifications);
  const category = String(classification?.main_category ?? "Other");
  const links = activeLinks(place.source_links);
  const tags = displayTags(category, classification);
  const mapsHref = preferredGoogleMapsUrl({
    rawGoogle: place.raw_google,
    placeGoogleMapsUrl: place.google_maps_url,
    rawImport: place.raw_import,
    latitude: place.latitude,
    longitude: place.longitude
  });
  const candidateOnly = isCandidateOnly(place.raw_google);
  const candidateHref = googleMapsUri(place.raw_google);

  return (
    <article className="rounded-lg border border-stone-300 bg-white p-3 shadow-sm md:p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-2">
          <Link href={`/places/${String(place.id)}`} className="min-w-0 flex-1 text-lg font-semibold leading-snug text-ink hover:text-moss">
            {String(place.name)}
          </Link>
          <span className="rounded-md bg-paper px-2 py-1 text-xs font-medium text-stone-700">{jaCategory(category)}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <span key={String(link.id ?? `${place.id}-${link.source_list_name}`)} className="rounded-md border border-stone-300 px-2 py-0.5 text-xs">
              {jaDisplay(link.source_list_name)}
            </span>
          ))}
          {tags.map((tag) => (
            <span key={tag} className="rounded-md bg-moss/10 px-2 py-0.5 text-xs font-medium text-moss">
              {tagLabel(category, tag)}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-stone-700">
          <Meta label={ja.places.travelRegion} value={classification?.travel_region} />
          <Meta label={ja.places.area} value={classification?.area_label ?? classification?.ward} />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {mapsHref ? (
            <a href={mapsHref} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-ink">
              Googleマップで開く
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <Link href={`/places/${String(place.id)}`} className="inline-flex h-12 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-ink">
            {ja.places.viewDetail}
          </Link>
        </div>

        <details className="rounded-md border border-stone-200 bg-paper px-3 py-2 text-sm text-stone-700">
          <summary className="cursor-pointer font-medium">詳細情報</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <Meta label={ja.placeDetail.address} value={candidateOnly ? null : place.address} />
            <Meta label={ja.places.rating} value={candidateOnly ? null : ratingLabel(place.rating, place.user_ratings_total)} />
            <Meta label={ja.places.googleCategory} value={candidateOnly ? "補完候補" : jaGooglePlaceTypes(place.primary_type, place.types)} />
            <Meta label={ja.places.openingHours} value={candidateOnly ? null : openingHoursSummary(place)} />
            {mode === "category" ? <Meta label="API strategy" value={apiReadyValue(place.raw_google, "api_strategy")} /> : null}
            {mode === "category" ? <Meta label="risk flags" value={apiReadyRiskFlags(place.raw_google)} /> : null}
            {candidateOnly && candidateHref ? (
              <div>
                <div className="text-xs text-stone-500">補完候補</div>
                <a href={candidateHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-moss">
                  補完候補を開く
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ) : null}
          </div>
        </details>
      </div>
    </article>
  );
}

function displayTags(category: string, classification: Record<string, unknown> | null) {
  if (category === "Restaurant") return sceneTags(classification);
  if (category === "Art") return classification?.sub_category ? [String(classification.sub_category)] : [];
  if (category === "Fashion" || category === "Cafe") return categoryTags(classification);
  return [];
}

function tagLabel(category: string, tag: string) {
  if (category === "Restaurant") return jaSceneTag(tag);
  if (category === "Fashion" || category === "Cafe") return jaCategoryTag(tag);
  return jaDisplay(tag);
}

function Meta({ label, value }: { label: string; value: unknown }) {
  const empty = isEmptyDisplayValue(value);
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={empty ? "text-stone-400" : "font-medium text-ink"}>{jaDisplay(value)}</div>
    </div>
  );
}

function ratingLabel(rating: unknown, total: unknown) {
  if (rating === null || rating === undefined || String(rating).trim() === "") return null;
  const totalText = total === null || total === undefined ? "" : ` (${String(total)}件)`;
  return `${String(rating)}${totalText}`;
}

function openingHoursSummary(place: PlaceRow) {
  const current = jsonRecord(place.current_opening_hours) ?? jsonRecord(place.regular_opening_hours);
  const weekdayDescriptions = current?.weekdayDescriptions;
  if (Array.isArray(weekdayDescriptions) && weekdayDescriptions.length > 0) return weekdayDescriptions.slice(0, 2).join(" / ");
  const openNow = current?.openNow;
  if (typeof openNow === "boolean") return openNow ? "営業中" : "営業時間外";
  return null;
}

function jsonRecord(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function apiReadyValue(rawGoogle: unknown, key: string) {
  const raw = jsonRecord(rawGoogle);
  const apiReady = jsonRecord(raw?.api_ready);
  return apiReady?.[key] ?? raw?.[key];
}

function apiReadyRiskFlags(rawGoogle: unknown) {
  const value = apiReadyValue(rawGoogle, "risk_flags");
  return Array.isArray(value) ? value.join(", ") : value;
}

function isEmptyDisplayValue(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "unknown" || text === "未分類";
}
