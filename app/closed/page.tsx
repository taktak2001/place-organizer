import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ArchiveActions } from "@/components/ArchiveActions";
import { ja, jaCategory, jaDisplay, jaGooglePlaceTypes } from "@/lib/i18n/ja";
import { googleDisplayName, preferredGoogleMapsUrl, sourceSavedName } from "@/lib/import/source-fields";
import { closedStatusLabel, detectClosedPlace, type ClosedStatus } from "@/lib/places/closed";
import { safeQuery } from "@/lib/supabase/queries";
import type { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const CLOSED_STATUSES = ["all", "permanently_closed", "temporarily_closed", "unknown_closed_candidate", "archived"] as const;

type ClosedFilter = typeof CLOSED_STATUSES[number];
type SearchParams = Record<string, string | string[] | undefined>;
type PlaceRow = Record<string, unknown>;

export default async function ClosedPage({ searchParams }: { searchParams: SearchParams }) {
  const status = normalizeStatus(valueOf(searchParams.status));
  const { data, error } = await safeQuery<PlaceRow[]>([], async (supabase) => fetchPlaces(supabase));
  const rows = data
    .map((place) => ({ place, closed: detectClosedPlace(place) }))
    .filter(({ place, closed }) => {
      if (status === "archived") return place.is_archived === true;
      if (place.is_archived === true || !closed) return false;
      return status === "all" || closed.status === status;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-stone-300 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase text-moss">{ja.closed.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold">{ja.closed.title}</h1>
          <p className="mt-2 max-w-3xl text-stone-700">{ja.closed.description}</p>
        </div>
        <Link href="/places?archive_view=archived" className="inline-flex h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-sm font-medium">
          {ja.closed.archivedView}
        </Link>
      </div>

      {error ? <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</div> : null}

      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
        {CLOSED_STATUSES.map((item) => (
          <Link
            key={item}
            href={`/closed?status=${item}`}
            className={`inline-flex h-10 shrink-0 items-center rounded-md border px-4 text-sm font-medium ${item === status ? "border-moss bg-moss text-white" : "border-stone-300 bg-white text-ink"}`}
          >
            {closedFilterLabel(item)}
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-stone-300 bg-white p-4 text-sm text-stone-700">
        表示件数: <span className="font-semibold text-ink">{rows.length}</span>件
      </div>

      <div className="grid gap-3">
        {rows.map(({ place, closed }) => (
          <ClosedCard key={String(place.id)} place={place} closedStatus={closed?.status ?? null} />
        ))}
        {rows.length === 0 ? <div className="rounded-lg border border-stone-300 bg-white p-6 text-sm text-stone-600">{ja.closed.noTargets}</div> : null}
      </div>
    </div>
  );
}

async function fetchPlaces(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const rows: PlaceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places")
      .select("*, place_classifications(*), source_links(*)")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as PlaceRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function ClosedCard({ place, closedStatus }: { place: PlaceRow; closedStatus: ClosedStatus | null }) {
  const classification = firstRelated(place.place_classifications);
  const links = activeLinks(place.source_links);
  const sourceName = sourceSavedName(place.raw_import, place.name);
  const googleName = googleDisplayName(place.raw_google);
  const mapsHref = preferredGoogleMapsUrl({
    rawGoogle: place.raw_google,
    placeGoogleMapsUrl: place.google_maps_url,
    rawImport: place.raw_import,
    latitude: place.latitude,
    longitude: place.longitude
  });
  return (
    <article className="rounded-lg border border-stone-300 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/places/${String(place.id)}`} className="text-lg font-semibold text-ink hover:text-moss">
              {String(sourceName ?? place.name)}
            </Link>
            <span className="rounded-md bg-clay px-2 py-1 text-xs font-semibold text-white">
              {place.is_archived ? ja.closed.archivedView : closedStatusLabel(closedStatus)}
            </span>
            <span className="rounded-md bg-paper px-2 py-1 text-xs text-stone-700">{jaCategory(classification?.main_category ?? "Other")}</span>
            {links.map((link) => (
              <span key={String(link.id ?? `${place.id}-${link.source_list_name}`)} className="rounded-md border border-stone-300 px-2 py-0.5 text-xs">
                {jaDisplay(link.source_list_name)}
              </span>
            ))}
          </div>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
            <Meta label="元CSV保存名" value={sourceName} />
            <Meta label="Google補完名" value={googleName} />
            <Meta label={ja.closed.businessStatus} value={place.business_status} />
            <Meta label={ja.places.googleCategory} value={jaGooglePlaceTypes(place.primary_type, place.types)} />
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-end">
          {mapsHref ? (
            <a href={mapsHref} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-ink lg:h-10">
              Googleマップで開く
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          <Link href={`/places/${String(place.id)}`} className="inline-flex h-12 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-medium lg:h-10">
            {ja.places.viewDetail}
          </Link>
          <ArchiveActions placeId={String(place.id)} closedStatus={closedStatus} isArchived={place.is_archived === true} compact />
        </div>
      </div>
    </article>
  );
}

function Meta({ label, value }: { label: string; value: unknown }) {
  const empty = value === null || value === undefined || String(value).trim() === "";
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={empty ? "text-stone-400" : "font-medium text-ink"}>{jaDisplay(value)}</div>
    </div>
  );
}

function firstRelated(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function activeLinks(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((link) => typeof link === "object" && link !== null && (link as { active?: boolean }).active !== false) as Record<string, unknown>[] : [];
}

function normalizeStatus(status: string): ClosedFilter {
  return CLOSED_STATUSES.includes(status as ClosedFilter) ? status as ClosedFilter : "all";
}

function closedFilterLabel(status: ClosedFilter) {
  if (status === "permanently_closed") return ja.closed.permanentlyClosed;
  if (status === "temporarily_closed") return ja.closed.temporarilyClosed;
  if (status === "unknown_closed_candidate") return ja.closed.unknownClosedCandidate;
  if (status === "archived") return ja.closed.archivedView;
  return ja.closed.all;
}

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
