"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlaceBrowseCard } from "@/components/PlaceBrowseCard";
import type { PlaceRow } from "@/lib/places/browse";

type Props = {
  endpoint: string;
  params: Record<string, string | string[] | boolean | undefined>;
  mode?: "general" | "category";
};

const PAGE_SIZE = 30;

type ApiResponse = {
  places?: PlaceRow[];
  total_count?: number;
  has_more?: boolean;
  query?: string;
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  error?: string;
};

export function InfinitePlaceList({ endpoint, params, mode = "general" }: Props) {
  const [items, setItems] = useState<PlaceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const requestKey = useMemo(() => JSON.stringify({ endpoint, params }), [endpoint, params]);

  const fetchPage = useCallback(async (offset: number, replace = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const url = new URL(endpoint, window.location.origin);
      appendParams(url.searchParams, params);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(PAGE_SIZE));
      const response = await fetch(url.toString(), { cache: "no-store" });
      const json = await response.json().catch(() => ({})) as ApiResponse;
      if (!response.ok) throw new Error(errorText(json));
      const nextItems = Array.isArray(json.places) ? json.places : [];
      setItems((current) => replace ? nextItems : [...current, ...nextItems]);
      setTotal(Number(json.total_count ?? 0));
      setHasMore(Boolean(json.has_more));
      offsetRef.current = offset + nextItems.length;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [endpoint, params]);

  useEffect(() => {
    offsetRef.current = 0;
    setItems([]);
    setTotal(0);
    setHasMore(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    void fetchPage(0, true);
  }, [requestKey, fetchPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (!hasMore || loadingRef.current) return;
      void fetchPage(offsetRef.current);
    }, { rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchPage, hasMore]);

  return (
    <section className="space-y-3 pb-[calc(env(safe-area-inset-bottom)+96px)]">
      <div className="rounded-lg border border-line bg-white p-4 text-sm text-stone-700">
        絞り込み結果: <span className="font-semibold text-ink">{total}</span>件
        <span className="ml-2 text-stone-500">表示中: {items.length}件</span>
      </div>

      {error ? <pre className="whitespace-pre-wrap rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</pre> : null}

      <div className="grid gap-3">
        {items.map((place) => <PlaceBrowseCard key={String(place.id)} place={place} mode={mode} />)}
        {!loading && items.length === 0 && !error ? <div className="rounded-lg border border-line bg-white p-6 text-sm text-stone-600">場所が見つかりません</div> : null}
      </div>

      <div ref={sentinelRef} className="min-h-8" aria-hidden="true" />
      {loading ? <div className="rounded-lg border border-line bg-white p-4 text-center text-sm text-stone-600">読み込み中...</div> : null}
      {!loading && items.length > 0 && !hasMore ? <div className="rounded-lg border border-line bg-white p-4 text-center text-sm text-stone-500">すべて表示しました</div> : null}
    </section>
  );
}

function appendParams(searchParams: URLSearchParams, params: Props["params"]) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false || value === "") continue;
    if (value === true) {
      searchParams.set(key, "1");
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = String(item ?? "").trim();
        if (text) searchParams.append(key, text);
      }
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) searchParams.set(key, text);
  }
}

function errorText(json: ApiResponse) {
  if (typeof json.error === "string") return json.error;
  const parts = [
    json.query ? `query: ${json.query}` : null,
    json.message ? `message: ${json.message}` : null,
    json.code ? `code: ${json.code}` : null,
    json.details ? `details: ${json.details}` : null,
    json.hint ? `hint: ${json.hint}` : null
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : "データ取得に失敗しました";
}
