import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { AIClassifyButton } from "@/components/AIClassifyButton";
import { ArchiveActions } from "@/components/ArchiveActions";
import { PlaceEditForm } from "@/components/PlaceEditForm";
import { classifyDisplayRegion } from "@/lib/classification/display-region";
import { ja, jaCategory, jaDisplay, jaGooglePlaceTypes, jaStatus } from "@/lib/i18n/ja";
import { googleDisplayName, googleMapsUri, hasNameDifference, hasUrlDifference, isCandidateOnly, preferredGoogleMapsUrl, sourceGoogleMapsUrl, sourceSavedName } from "@/lib/import/source-fields";
import { closedStatusLabel, detectClosedPlace } from "@/lib/places/closed";
import { safeQuery } from "@/lib/supabase/queries";
import { isAdminEnabled } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlaceDetailPage({ params }: { params: { id: string } }) {
  const adminEnabled = isAdminEnabled();
  const { data: place, error } = await safeQuery<Record<string, unknown> | null>(null, async (supabase) => {
    const { data, error: queryError } = await supabase
      .from("places")
      .select("*, place_classifications(*), source_links(*)")
      .eq("id", params.id)
      .single();
    if (queryError) throw queryError;
    return data;
  });

  if (!place) {
    return (
      <div className="rounded-lg border border-stone-300 bg-white p-6">
        <h1 className="text-xl font-semibold">{ja.placeDetail.notFound}</h1>
        {error ? <p className="mt-2 text-sm text-stone-600">{error}</p> : null}
        <Link href="/places" className="mt-4 inline-block text-sm font-medium text-moss">{ja.placeDetail.backToPlaces}</Link>
      </div>
    );
  }

  const classification = firstRelated(place.place_classifications);
  const links = sourceLinks(place.source_links);
  const sourceName = sourceSavedName(place.raw_import, place.name);
  const googleName = googleDisplayName(place.raw_google);
  const sourceMapsUrl = sourceGoogleMapsUrl(place.raw_import);
  const enrichedMapsUrl = googleMapsUri(place.raw_google);
  const preferredMapsUrl = preferredGoogleMapsUrl({
    rawGoogle: place.raw_google,
    placeGoogleMapsUrl: place.google_maps_url,
    rawImport: place.raw_import,
    latitude: place.latitude,
    longitude: place.longitude
  });
  const nameDiff = hasNameDifference(sourceName, googleName);
  const urlDiff = hasUrlDifference(sourceMapsUrl, enrichedMapsUrl);
  const candidateOnly = isCandidateOnly(place.raw_google);
  const closed = detectClosedPlace(place);
  const displayRegion = classifyDisplayRegion({
    country: stringOrNull(classification?.country),
    prefecture: stringOrNull(classification?.prefecture),
    city: stringOrNull(classification?.city),
    ward: stringOrNull(classification?.ward),
    area_label: stringOrNull(classification?.area_label),
    travel_region: stringOrNull(classification?.travel_region),
    address: stringOrNull(place.address),
    raw_google_summary: rawGoogleSummary(place.raw_google)
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/places" className="text-sm font-medium text-moss">{ja.placeDetail.breadcrumb}</Link>
        <p className="mt-3 text-sm font-medium uppercase text-moss">{ja.placeDetail.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold">{String(sourceName ?? place.name)}</h1>
          {nameDiff ? <span className="rounded-md bg-clay px-2 py-1 text-xs font-semibold text-white">名称差分あり</span> : null}
          {urlDiff ? <span className="rounded-md bg-clay px-2 py-1 text-xs font-semibold text-white">URL差分あり</span> : null}
        </div>
        <p className="mt-2 max-w-3xl text-stone-700">
          <span className="font-medium">{ja.placeDetail.address}: </span>
          {String(place.address ?? "")}
        </p>
        {preferredMapsUrl ? (
          <a href={preferredMapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-moss">
            {ja.placeDetail.openInGoogleMaps}
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
        {place.enrichment_status === "source_url_confirmed" ? (
          <div className="mt-4 rounded-lg border border-stone-300 bg-paper p-4 text-sm text-stone-700">
            <p className="font-medium text-ink">{ja.placeDetail.sourceUrlConfirmedNotice}</p>
            <p className="mt-1">{ja.placeDetail.candidateNotice}</p>
          </div>
        ) : null}
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <InfoPanel title="名称・URL比較" rows={[
          ["元CSVの保存名", sourceName],
          ["Google補完後の名称", googleName],
          ["元Google Maps URL", sourceMapsUrl],
          ["補完後Google Maps URL", enrichedMapsUrl],
          ["優先Google Maps URL", preferredMapsUrl],
          ["補完候補", candidateOnly ? "参考候補" : null]
        ]} />
        <InfoPanel title={ja.placeDetail.classification} rows={[
          [ja.placeDetail.main, jaCategory(classification?.main_category)],
          [ja.placeDetail.sub, jaDisplay(classification?.sub_category)],
          [ja.placeDetail.scenes, Array.isArray(classification?.scene_tags) ? classification.scene_tags.join(", ") : ""],
          [ja.placeDetail.visited, jaStatus(classification?.visited_status)],
          [ja.placeDetail.priority, jaDisplay(classification?.priority)],
          [ja.placeDetail.confidence, classification?.confidence],
          [ja.placeDetail.reason, classification?.reason],
          ["分類ソース", jaDisplay(classification?.classification_source)],
          ["手動優先", classification?.manual_override ? "はい" : "いいえ"],
          ["AIモデル", classification?.ai_model],
          ["AI分類日時", classification?.ai_classified_at]
        ]} />
        <InfoPanel title={ja.placeDetail.regionClassification} rows={[
          ["表示地域グループ", jaDisplay(classification?.region_group ?? displayRegion.region_group)],
          ["表示地域", jaDisplay(classification?.region_filter_label ?? displayRegion.region_filter_label)],
          [ja.placeDetail.country, jaDisplay(classification?.country)],
          [ja.placeDetail.prefecture, jaDisplay(classification?.prefecture)],
          [ja.placeDetail.city, jaDisplay(classification?.city)],
          [ja.placeDetail.ward, jaDisplay(classification?.ward)],
          [ja.placeDetail.area, jaDisplay(classification?.area_label)],
          [ja.placeDetail.station, jaDisplay(classification?.nearest_station)],
          [ja.placeDetail.travelRegion, jaDisplay(classification?.travel_region)]
        ]} />
        <InfoPanel title={ja.placeDetail.importInfo} rows={[
          [ja.placeDetail.enrichment, jaStatus(place.enrichment_status)],
          ["API戦略", apiReadyValue(place.raw_google, "api_strategy")],
          ["リスクフラグ", apiReadyRiskFlags(place.raw_google)],
          ["正規化Place ID", place.normalized_place_id],
          ["Place ID信頼度", jaPlaceIdConfidence(place.place_id_confidence)],
          ["Place ID確認理由", place.place_id_review_reason],
          ["Place ID候補", placeIdCandidateSummary(place.place_id_candidate)],
          [ja.closed.businessStatus, place.business_status],
          [ja.closed.title, closed ? closedStatusLabel(closed.status) : null],
          [ja.closed.archivedView, place.is_archived ? "はい" : null],
          ["アーカイブ理由", place.archive_reason],
          [ja.placeDetail.googleMapsUrl, preferredMapsUrl],
          [ja.placeDetail.googlePlaceId, place.google_place_id],
          [ja.placeDetail.normalizedKey, place.normalized_key],
          [ja.placeDetail.website, candidateOnly ? null : place.website_url],
          [ja.placeDetail.rating, candidateOnly ? null : ratingLabel(place.rating, place.user_ratings_total)],
          [ja.placeDetail.googleCategory, candidateOnly ? "補完候補" : googleTypeLabel(place)],
          [ja.placeDetail.openingHours, candidateOnly ? null : openingHoursSummary(place)]
        ]} />
      </section>

      {adminEnabled ? (
        <section className="rounded-lg border border-stone-300 bg-white p-4">
          <h2 className="text-base font-semibold">{ja.closed.title}</h2>
          <p className="mt-2 text-sm text-stone-700">
            閉業や誤登録の整理は論理アーカイブで行います。元CSV由来のGoogle Maps URLとリスト所属は保持されます。
          </p>
          <div className="mt-4">
            <ArchiveActions placeId={params.id} closedStatus={closed?.status ?? null} isArchived={place.is_archived === true} />
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-stone-300 bg-white p-4">
        <h2 className="text-base font-semibold">{ja.placeDetail.rawGoogleSummary}</h2>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          {googleSummaryRows(place.raw_google).map(([label, value]) => (
            <div key={label} className="grid grid-cols-3 gap-2">
              <dt className="text-stone-600">{label}</dt>
              <dd className="col-span-2 break-words">{jaDisplay(value)}</dd>
            </div>
          ))}
        </dl>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-moss">{ja.placeDetail.rawGoogle}</summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-paper p-3 text-xs">{JSON.stringify(place.raw_google ?? {}, null, 2)}</pre>
        </details>
      </section>

      <section className="rounded-lg border border-stone-300 bg-white p-4">
        <h2 className="text-base font-semibold">{ja.placeDetail.sourceLists}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map((link) => (
            <span
              key={String(link.id)}
              className={`rounded-md border px-3 py-1 text-sm ${link.active === false ? "border-stone-200 text-stone-400" : "border-stone-300"}`}
            >
              {jaDisplay(link.source_list_name)}
              {link.active === false ? "（無効）" : ""}
            </span>
          ))}
        </div>
      </section>

      {adminEnabled ? (
        <section>
          <h2 className="mb-3 text-base font-semibold">{ja.placeDetail.editClassification}</h2>
          <div className="mb-3 rounded-lg border border-stone-300 bg-white p-4">
            <h3 className="text-sm font-semibold">AI分類</h3>
            <p className="mt-1 text-sm text-stone-700">AI分類は補助です。手動分類が優先されている場合は上書きしません。</p>
            <div className="mt-3">
              <AIClassifyButton placeId={params.id} manualOverride={classification?.manual_override === true} />
            </div>
          </div>
          <PlaceEditForm placeId={params.id} place={place} classification={classification} />
        </section>
      ) : null}

      <section className="rounded-lg border border-stone-300 bg-white p-4">
        <h2 className="text-base font-semibold">{ja.placeDetail.rawImport}</h2>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-moss">{ja.placeDetail.rawImport}</summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-paper p-3 text-xs">{JSON.stringify(place.raw_import ?? {}, null, 2)}</pre>
        </details>
      </section>
    </div>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, unknown]> }) {
  return (
    <div className="rounded-lg border border-stone-300 bg-white p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-3 gap-2">
            <dt className="text-stone-600">{label}</dt>
            <dd className="col-span-2 break-words">{String(value ?? "")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function firstRelated(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function sourceLinks(value: unknown): Array<Record<string, unknown> & { active?: boolean }> {
  return Array.isArray(value)
    ? value.filter((link) => typeof link === "object" && link !== null) as Array<Record<string, unknown> & { active?: boolean }>
    : [];
}

function googleSummaryRows(rawGoogle: unknown): Array<[string, unknown]> {
  const raw = typeof rawGoogle === "object" && rawGoogle !== null ? rawGoogle as Record<string, unknown> : {};
  return [
    ["Google補完後の名称", googleDisplayName(raw)],
    [ja.placeDetail.googlePlaceId, raw.id],
    [ja.placeDetail.address, raw.formattedAddress],
    [ja.placeDetail.googleCategory, googleTypeLabel({ primary_type: raw.primaryType, types: raw.types })],
    [ja.placeDetail.rating, ratingLabel(raw.rating, raw.userRatingCount)],
    [ja.placeDetail.website, raw.websiteUri],
    [ja.placeDetail.openingHours, openingHoursSummary({ current_opening_hours: raw.currentOpeningHours, regular_opening_hours: raw.regularOpeningHours })]
  ];
}

function rawGoogleSummary(rawGoogle: unknown) {
  const raw = jsonRecord(rawGoogle);
  if (!raw) return null;
  const candidate = jsonRecord(raw.candidate_place);
  const source = candidate ?? raw;
  return {
    displayName: source.displayName,
    name: source.name,
    formattedAddress: source.formattedAddress ?? source.formatted_address ?? null,
    address: source.address ?? null
  };
}

function ratingLabel(rating: unknown, total: unknown) {
  if (rating === null || rating === undefined || String(rating).trim() === "") return null;
  const totalText = total === null || total === undefined ? "" : ` (${String(total)}件)`;
  return `${String(rating)}${totalText}`;
}

function openingHoursSummary(source: Record<string, unknown>) {
  const current = jsonRecord(source.current_opening_hours) ?? jsonRecord(source.regular_opening_hours);
  const weekdayDescriptions = current?.weekdayDescriptions;
  if (Array.isArray(weekdayDescriptions) && weekdayDescriptions.length > 0) {
    return weekdayDescriptions.slice(0, 2).join(" / ");
  }
  const openNow = current?.openNow;
  if (typeof openNow === "boolean") return openNow ? "営業中" : "営業時間外";
  return null;
}

function jsonRecord(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function stringOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function googleTypeLabel(place: Record<string, unknown>) {
  return jaGooglePlaceTypes(place.primary_type, place.types);
}

function apiReadyValue(rawGoogle: unknown, key: string) {
  const apiReady = jsonRecord(jsonRecord(rawGoogle)?.api_ready);
  return apiReady?.[key] ?? null;
}

function apiReadyRiskFlags(rawGoogle: unknown) {
  const flags = apiReadyValue(rawGoogle, "risk_flags");
  return Array.isArray(flags) ? flags.map(String).join(", ") : null;
}

function jaPlaceIdConfidence(value: unknown) {
  const labels: Record<string, string> = {
    high: "高",
    medium: "中",
    low: "低",
    confirmed: "承認済み",
    rejected: "却下済み"
  };
  const text = String(value ?? "");
  return labels[text] ?? value;
}

function placeIdCandidateSummary(value: unknown) {
  const candidate = jsonRecord(value);
  if (!candidate) return null;
  const name = jsonRecord(candidate.displayName)?.text;
  const id = candidate.id;
  const score = typeof candidate.score === "number" ? `score ${candidate.score.toFixed(2)}` : null;
  return [name, id, score].filter(Boolean).join(" / ");
}
