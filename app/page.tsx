import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { ArrowRight, ClipboardCheck, Database, ListChecks, Sparkles, UploadCloud } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ja, jaCategory, jaSceneTag, jaStatus } from "@/lib/i18n/ja";
import { reviewSourceUrlCandidate } from "@/lib/import/source-url-review";
import { detectClosedPlace } from "@/lib/places/closed";
import { safeQuery } from "@/lib/supabase/queries";
import { isAdminEnabled, type getSupabaseRead } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type DashboardData = {
  totalPlaces: number;
  usablePlaces: number;
  googleEnrichedPlaces: number;
  sourceUrlConfirmedPlaces: number;
  coordinatePointPlaces: number;
  needsReviewPlaces: number;
  errorPlaces: number;
  totalSourceLinks: number;
  activeSourceLinks: number;
  pendingEnrichment: number;
  sourceUrlConflictCount: number;
  closedCandidateCount: number;
  permanentlyClosedCount: number;
  temporarilyClosedCount: number;
  archivedPlaces: number;
  aiClassifiedCount: number;
  manualOverrideCount: number;
  otherCategoryCount: number;
  missingRegionCount: number;
  missingRegionWithAddressCount: number;
  otherWithHintCount: number;
  otherWithoutHintCount: number;
  missingRestaurantSceneCount: number;
  latestBatch: Record<string, unknown> | null;
  byCategory: Array<{ main_category: string | null; count: number }>;
  byList: Array<{ source_list_name: string | null; count: number }>;
  byRegion: Array<{ travel_region: string | null; count: number }>;
  bySceneTag: Array<{ scene_tag: string; count: number }>;
  byEnrichmentStatus: Array<{ enrichment_status: string | null; count: number }>;
  byApiStrategy: Array<{ name: string; count: number }>;
  byRiskFlag: Array<{ name: string; count: number }>;
  categoryCards: CategoryCardData[];
};

type CategoryCardData = {
  category: string;
  slug: string;
  total: number;
  want: number;
  samples: string[];
};

export default async function DashboardPage() {
  const adminEnabled = isAdminEnabled();
  const { data, error } = await safeQuery<DashboardData>(
    { totalPlaces: 0, usablePlaces: 0, googleEnrichedPlaces: 0, sourceUrlConfirmedPlaces: 0, coordinatePointPlaces: 0, needsReviewPlaces: 0, errorPlaces: 0, totalSourceLinks: 0, activeSourceLinks: 0, pendingEnrichment: 0, sourceUrlConflictCount: 0, closedCandidateCount: 0, permanentlyClosedCount: 0, temporarilyClosedCount: 0, archivedPlaces: 0, aiClassifiedCount: 0, manualOverrideCount: 0, otherCategoryCount: 0, missingRegionCount: 0, missingRegionWithAddressCount: 0, otherWithHintCount: 0, otherWithoutHintCount: 0, missingRestaurantSceneCount: 0, latestBatch: null, byCategory: [], byList: [], byRegion: [], bySceneTag: [], byEnrichmentStatus: [], byApiStrategy: [], byRiskFlag: [], categoryCards: [] },
    async (supabase) => {
      const apiReadySummary = readApiReadySummary();
      const [places, sourceLinks, activeSourceLinks, pending, latestBatch, classifications, links, enrichmentRows, enrichedRows, closedRows, gapRows, categoryRows] = await Promise.all([
        supabase.from("places").select("id", { count: "exact", head: true }),
        supabase.from("source_links").select("id", { count: "exact", head: true }),
        supabase.from("source_links").select("id", { count: "exact", head: true }).eq("active", true),
        supabase.from("places").select("id", { count: "exact", head: true }).eq("enrichment_status", "pending_enrichment"),
        supabase.from("import_batches").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        fetchClassificationDashboardRows(supabase),
        fetchAllRows<{ source_list_name: string | null }>(supabase, "source_links", "source_list_name", { active: true }),
        fetchAllRows<{ enrichment_status: string | null }>(supabase, "places", "enrichment_status"),
        fetchAllRows<SourceUrlConflictRow>(supabase, "places", "name, latitude, longitude, google_maps_url, raw_import, raw_google", { enrichment_status: "enriched" }),
        fetchClosedDashboardRows(supabase),
        fetchGapDashboardRows(supabase),
        fetchCategoryCardRows(supabase)
      ]);
      const activeClosedRows = closedRows.filter((row) => row.is_archived !== true).map((row) => detectClosedPlace(row)).filter(Boolean);
      const statusCounts = countStatuses(enrichmentRows);
      const googleEnrichedPlaces = statusCounts.enriched ?? 0;
      const sourceUrlConfirmedPlaces = statusCounts.source_url_confirmed ?? 0;
      const coordinatePointPlaces = statusCounts.coordinate_point ?? 0;

      return {
        totalPlaces: places.count ?? 0,
        usablePlaces: googleEnrichedPlaces + sourceUrlConfirmedPlaces + coordinatePointPlaces,
        googleEnrichedPlaces,
        sourceUrlConfirmedPlaces,
        coordinatePointPlaces,
        needsReviewPlaces: statusCounts.needs_review ?? 0,
        errorPlaces: statusCounts.error ?? 0,
        totalSourceLinks: sourceLinks.count ?? 0,
        activeSourceLinks: activeSourceLinks.count ?? 0,
        pendingEnrichment: pending.count ?? 0,
        sourceUrlConflictCount: enrichedRows.filter(hasSourceUrlConflict).length,
        closedCandidateCount: activeClosedRows.length,
        permanentlyClosedCount: activeClosedRows.filter((item) => item?.status === "permanently_closed").length,
        temporarilyClosedCount: activeClosedRows.filter((item) => item?.status === "temporarily_closed").length,
        archivedPlaces: closedRows.filter((row) => row.is_archived === true).length,
        aiClassifiedCount: classifications.filter((row) => row.classification_source === "ai").length,
        manualOverrideCount: classifications.filter((row) => row.manual_override === true).length,
        otherCategoryCount: classifications.filter((row) => row.main_category === "Other").length,
        missingRegionCount: classifications.filter((row) => isMissing(row.area_label) || isMissing(row.travel_region)).length,
        missingRegionWithAddressCount: gapRows.filter((row) => isMissing(row.classification?.area_label) || isMissing(row.classification?.travel_region)).filter(hasAddressSignal).length,
        otherWithHintCount: gapRows.filter((row) => row.classification?.main_category === "Other" && hasOtherHint(row)).length,
        otherWithoutHintCount: gapRows.filter((row) => row.classification?.main_category === "Other" && !hasOtherHint(row)).length,
        missingRestaurantSceneCount: classifications.filter((row) => row.main_category === "Restaurant" && (!Array.isArray(row.scene_tags) || row.scene_tags.length === 0)).length,
        latestBatch: latestBatch.data ?? null,
        byCategory: groupRows(classifications, "main_category"),
        byList: groupRows(links, "source_list_name"),
        byRegion: groupRows(classifications, "travel_region").filter((item) => item.travel_region),
        bySceneTag: groupSceneTags(classifications),
        byEnrichmentStatus: orderedStatusRows(enrichmentRows),
        byApiStrategy: objectRows(apiReadySummary.by_api_strategy),
        byRiskFlag: objectRows(apiReadySummary.risk_flag_counts),
        categoryCards: buildCategoryCards(categoryRows)
      };
    }
  );

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-5 border-b border-stone-300 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase text-moss">{ja.dashboard.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold">{ja.dashboard.title}</h1>
          <p className="mt-3 max-w-3xl text-stone-700">
            {ja.dashboard.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {adminEnabled ? (
            <Link href="/review" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white">
              <ClipboardCheck className="h-4 w-4" />
              {ja.dashboard.reviewPlaces}
            </Link>
          ) : null}
          <Link href="/places" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white">
            <ListChecks className="h-4 w-4" />
            {ja.dashboard.browsePlaces}
          </Link>
        </div>
      </section>

      {error ? <SetupNotice error={error} /> : null}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">カテゴリから探す</h2>
          <Link href="/categories" className="text-sm font-semibold text-moss">すべて見る</Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.categoryCards.map((card) => (
            <Link key={card.slug} href={`/category/${card.slug}`} className="rounded-lg border border-stone-300 bg-white p-4 hover:border-moss">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">{jaCategory(card.category)}</h3>
                  <p className="mt-1 text-sm text-stone-600">行ってみたい {card.want} / 全 {card.total}</p>
                </div>
                <ArrowRight className="mt-1 h-5 w-5 text-moss" />
              </div>
              <div className="mt-4 space-y-2">
                {card.samples.map((sample) => (
                  <div key={sample} className="truncate rounded-md bg-paper px-3 py-2 text-sm text-stone-800">{sample}</div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        <StatCard label={ja.dashboard.totalPlaces} value={data.totalPlaces} icon={<Database className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.usablePlaces} value={data.usablePlaces} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.googleEnrichedPlaces} value={data.googleEnrichedPlaces} icon={<Sparkles className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.sourceUrlConfirmedPlaces} value={data.sourceUrlConfirmedPlaces} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.coordinatePointPlaces} value={data.coordinatePointPlaces} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.needsReviewPlaces} value={data.needsReviewPlaces} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.errorPlaces} value={data.errorPlaces} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.sourceLinks} value={data.totalSourceLinks} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.activeSourceLinks} value={data.activeSourceLinks} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.pendingEnrichment} value={data.pendingEnrichment} icon={<Sparkles className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.sourceUrlConflicts} value={data.sourceUrlConflictCount} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.latestImport} value={data.latestBatch ? jaStatus(data.latestBatch.status ?? "completed") : ja.dashboard.none} icon={<UploadCloud className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.closedCandidates} value={data.closedCandidateCount} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.permanentlyClosed} value={data.permanentlyClosedCount} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.temporarilyClosed} value={data.temporarilyClosedCount} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label={ja.dashboard.archivedPlaces} value={data.archivedPlaces} icon={<Database className="h-5 w-5" />} />
        <StatCard label="AI分類済み" value={data.aiClassifiedCount} icon={<Sparkles className="h-5 w-5" />} />
        <StatCard label="手動優先" value={data.manualOverrideCount} icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label="Otherカテゴリ" value={data.otherCategoryCount} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label="地域未分類" value={data.missingRegionCount} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label="住所あり地域未分類" value={data.missingRegionWithAddressCount} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label="ヒントありOther" value={data.otherWithHintCount} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label="ヒントなしOther" value={data.otherWithoutHintCount} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label="シーン未設定" value={data.missingRestaurantSceneCount} icon={<ListChecks className="h-5 w-5" />} />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <SummaryPanel title={ja.dashboard.byCategory} rows={data.byCategory.map((item) => [item.main_category ?? "Other", item.count])} />
        <SummaryPanel title={ja.dashboard.byList} rows={data.byList.map((item) => [item.source_list_name ?? "Unknown", item.count])} />
        <SummaryPanel title={ja.dashboard.travelRegions} rows={data.byRegion.map((item) => [item.travel_region ?? "Unknown", item.count])} />
        <SummaryPanel title={ja.dashboard.bySceneTag} rows={data.bySceneTag.map((item) => [jaSceneTag(item.scene_tag), item.count])} />
        <SummaryPanel title="API戦略別" rows={data.byApiStrategy.map((item) => [jaDisplayApiStrategy(item.name), item.count])} />
        <SummaryPanel title="リスクフラグ別" rows={data.byRiskFlag.map((item) => [jaDisplayRiskFlag(item.name), item.count])} />
      </section>

      <section>
        <SummaryPanel title={ja.dashboard.byEnrichmentStatus} rows={data.byEnrichmentStatus.map((item) => [jaStatus(item.enrichment_status ?? "unknown"), item.count])} />
      </section>

      <section className="rounded-lg border border-stone-300 bg-white p-4">
        <h2 className="text-base font-semibold">{ja.dashboard.seedGuideTitle}</h2>
        <p className="mt-2 text-sm text-stone-700">{ja.dashboard.seedGuideDescription}</p>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {ja.dashboard.seedGuideSteps.map((step) => (
            <div key={step} className="rounded-md border border-stone-200 bg-paper px-3 py-2 font-mono text-sm">
              {step}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {adminEnabled ? <QuickLink href="/closed" title={ja.dashboard.closedCandidates} /> : null}
        {adminEnabled ? <QuickLink href="/review" title={ja.dashboard.reviewPlaces} /> : null}
        <QuickLink href="/places" title={ja.dashboard.browsePlaces} />
        {adminEnabled ? <QuickLink href="/imports" title={ja.dashboard.importHistory} /> : null}
      </section>
    </div>
  );
}

function groupRows<T extends Record<string, unknown>, K extends keyof T & string>(rows: T[], key: K) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = String(row[key] ?? "Unknown");
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ [key]: name, count })) as Array<Record<K, string> & { count: number }>;
}

function orderedStatusRows(rows: Array<{ enrichment_status: string | null }>) {
  const counts = countStatuses(rows);
  return ["pending_enrichment", "enriched", "source_url_confirmed", "coordinate_point", "not_found", "needs_review", "error"]
    .map((status) => ({ enrichment_status: status, count: counts[status] ?? 0 }));
}

function countStatuses(rows: Array<{ enrichment_status: string | null }>) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const status = row.enrichment_status ?? "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function groupSceneTags(rows: ClassificationDashboardRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const tags = Array.isArray(row.scene_tags) ? row.scene_tags.map(String).filter(Boolean) : [];
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([scene_tag, count]) => ({ scene_tag, count }));
}

async function fetchAllRows<T extends Record<string, unknown>>(
  supabase: ReturnType<typeof getSupabaseRead>,
  table: string,
  columns: string,
  equals?: Record<string, unknown>
) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(columns).range(from, from + 999);
    for (const [key, value] of Object.entries(equals ?? {})) {
      query = query.eq(key, value);
    }
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fetchClosedDashboardRows(supabase: ReturnType<typeof getSupabaseRead>) {
  try {
    return await fetchAllRows<ClosedDashboardRow>(supabase, "places", "business_status, raw_google, archive_reason, is_archived");
  } catch (error) {
    if (isMissingColumnError(error)) {
      const rows = await fetchAllRows<ClosedDashboardRow>(supabase, "places", "business_status, raw_google");
      return rows.map((row) => ({ ...row, archive_reason: null, is_archived: false }));
    }
    throw error;
  }
}

async function fetchClassificationDashboardRows(supabase: ReturnType<typeof getSupabaseRead>) {
  try {
    return await fetchAllRows<ClassificationDashboardRow>(supabase, "place_classifications", "main_category, travel_region, area_label, scene_tags, manual_override, classification_source");
  } catch (error) {
    if (isMissingColumnError(error)) {
      const rows = await fetchAllRows<ClassificationDashboardRow>(supabase, "place_classifications", "main_category, travel_region, area_label, scene_tags");
      return rows.map((row) => ({ ...row, manual_override: false, classification_source: "rule" }));
    }
    throw error;
  }
}

function isMissingColumnError(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42703";
}

type SourceUrlConflictRow = Record<string, unknown> & {
  name: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string | null;
  raw_import: Record<string, unknown> | null;
  raw_google: Record<string, unknown> | null;
};

type ClosedDashboardRow = Record<string, unknown> & {
  business_status: string | null;
  raw_google: Record<string, unknown> | null;
  archive_reason: string | null;
  is_archived: boolean | null;
};

type ClassificationDashboardRow = Record<string, unknown> & {
  main_category: string | null;
  travel_region: string | null;
  area_label: string | null;
  scene_tags: string[] | null;
  manual_override: boolean | null;
  classification_source: string | null;
};

type GapDashboardRow = {
  address: string | null;
  raw_google: Record<string, unknown> | null;
  source_links?: Array<{ source_list_name: string | null; active: boolean | null }>;
  classification: {
    main_category: string | null;
    area_label: string | null;
    travel_region: string | null;
  } | null;
};

type CategoryCardRow = {
  id: string;
  name: string;
  is_archived?: boolean | null;
  source_links?: Array<{ source_list_name: string | null; active: boolean | null }>;
  place_classifications?: Array<{ main_category: string | null }>;
};

const DASHBOARD_CATEGORY_CARDS = [
  ["restaurant", "Restaurant"],
  ["cafe", "Cafe"],
  ["art", "Art"],
  ["fashion", "Fashion"],
  ["hotel", "Hotel"],
  ["bath", "Bath"]
] as const;

function isMissing(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text === "Unknown" || text === "未分類";
}

function hasSourceUrlConflict(place: SourceUrlConflictRow) {
  return reviewSourceUrlCandidate(place).reasons.length > 0;
}

async function fetchGapDashboardRows(supabase: ReturnType<typeof getSupabaseRead>) {
  const rows = await fetchAllRows<Record<string, unknown>>(
    supabase,
    "places",
    "address, raw_google, source_links(source_list_name, active), place_classifications(main_category, area_label, travel_region)"
  );
  return rows.map((row) => ({
    address: typeof row.address === "string" ? row.address : null,
    raw_google: typeof row.raw_google === "object" && row.raw_google !== null ? row.raw_google as Record<string, unknown> : null,
    source_links: Array.isArray(row.source_links) ? row.source_links as GapDashboardRow["source_links"] : [],
    classification: firstDashboardClassification(row.place_classifications)
  }));
}

async function fetchCategoryCardRows(supabase: ReturnType<typeof getSupabaseRead>) {
  return await fetchAllRows<CategoryCardRow>(
    supabase,
    "places",
    "id, name, is_archived, source_links(source_list_name, active), place_classifications(main_category)"
  );
}

function buildCategoryCards(rows: CategoryCardRow[]): CategoryCardData[] {
  const activeRows = rows.filter((row) => row.is_archived !== true);
  return DASHBOARD_CATEGORY_CARDS.map(([slug, category]) => {
    const places = activeRows
      .filter((row) => firstDashboardClassification(row.place_classifications)?.main_category === category)
      .sort((a, b) => Number(isDashboardWantToGo(b)) - Number(isDashboardWantToGo(a)) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja"));
    return {
      slug,
      category,
      total: places.length,
      want: places.filter(isDashboardWantToGo).length,
      samples: places.slice(0, 3).map((place) => String(place.name ?? "")).filter(Boolean)
    };
  });
}

function isDashboardWantToGo(row: CategoryCardRow) {
  return Array.isArray(row.source_links) && row.source_links.some((link) => link.active !== false && String(link.source_list_name ?? "").includes("行ってみたい"));
}

function firstDashboardClassification(value: unknown): GapDashboardRow["classification"] {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "object" || first === null) return null;
  const record = first as Record<string, unknown>;
  return {
    main_category: typeof record.main_category === "string" ? record.main_category : null,
    area_label: typeof record.area_label === "string" ? record.area_label : null,
    travel_region: typeof record.travel_region === "string" ? record.travel_region : null
  };
}

function hasAddressSignal(row: GapDashboardRow) {
  const raw = row.raw_google ?? {};
  const candidate = typeof raw.candidate_place === "object" && raw.candidate_place !== null ? raw.candidate_place as Record<string, unknown> : raw;
  return Boolean(row.address || candidate.formattedAddress || candidate.formatted_address);
}

function hasOtherHint(row: GapDashboardRow) {
  const listText = (row.source_links ?? []).filter((link) => link.active !== false).map((link) => link.source_list_name).filter(Boolean).join(" ");
  const raw = row.raw_google ?? {};
  const candidate = typeof raw.candidate_place === "object" && raw.candidate_place !== null ? raw.candidate_place as Record<string, unknown> : raw;
  return /art|cafe|restaurant|fashion|hotel|風呂|hospital|病院|クリニック/i.test(listText) ||
    Boolean(candidate.primaryType || candidate.primary_type || (Array.isArray(candidate.types) && candidate.types.length > 0));
}

function readApiReadySummary() {
  const summaryPath = path.join(process.cwd(), "data", "derived", "api-ready-summary.json");
  if (!fs.existsSync(summaryPath)) return { by_api_strategy: {}, risk_flag_counts: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    return {
      by_api_strategy: objectRecord(parsed.by_api_strategy),
      risk_flag_counts: objectRecord(parsed.risk_flag_counts)
    };
  } catch {
    return { by_api_strategy: {}, risk_flag_counts: {} };
  }
}

function objectRecord(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, number> : {};
}

function objectRows(record: Record<string, number>) {
  return Object.entries(record).map(([name, count]) => ({ name, count })).slice(0, 10);
}

function jaDisplayApiStrategy(value: string) {
  const labels: Record<string, string> = {
    place_id_details: "Place ID Details",
    coordinate_bias_search: "座標バイアス検索",
    query_with_bias: "query補助検索",
    source_url_only: "元リンク保持のみ",
    manual_review: "手動確認"
  };
  return labels[value] ?? value;
}

function jaDisplayRiskFlag(value: string) {
  const labels: Record<string, string> = {
    text_search_only_risky: "Text Search単独リスク",
    chain_or_multi_location_risk: "チェーン/複数店舗リスク",
    generic_name_risk: "一般名リスク",
    cid_not_directly_supported: "CID直接非対応",
    no_coordinates: "座標なし",
    no_place_id: "Place IDなし",
    short_url_expansion_failed: "短縮URL展開失敗",
    coordinate_only: "座標のみ",
    event_or_exhibition_name: "展示/イベント名"
  };
  return labels[value] ?? value;
}

function SummaryPanel({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div className="rounded-lg border border-stone-300 bg-white p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-stone-600">{ja.dashboard.noData}</p> : null}
        {rows.map(([name, count]) => (
          <div key={name} className="flex items-center justify-between gap-4 border-b border-stone-200 pb-2 text-sm">
            <span className="truncate">{name}</span>
            <span className="font-semibold">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickLink({ href, title }: { href: string; title: string }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-lg border border-stone-300 bg-white p-4 font-medium hover:border-moss">
      {title}
      <ArrowRight className="h-4 w-4 text-moss" />
    </Link>
  );
}

function SetupNotice({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-800">
      {ja.dashboard.supabaseDisconnected}
      <div className="mt-2 text-xs text-stone-600">{localizeError(error)}</div>
    </div>
  );
}

function localizeError(error: string) {
  if (error.includes("NEXT_PUBLIC_SUPABASE_URL または NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    return ja.dashboard.missingPublicSupabaseEnv;
  }
  if (error.includes("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")) {
    return ja.dashboard.missingSupabaseEnv;
  }
  if (error.includes("NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY")) {
    return ja.dashboard.missingSupabaseEnv;
  }
  return error;
}
