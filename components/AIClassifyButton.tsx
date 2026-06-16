"use client";

import { useState } from "react";

type Props = {
  placeId: string;
  manualOverride?: boolean;
};

export function AIClassifyButton({ placeId, manualOverride }: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function classify(apply: boolean) {
    setLoading(true);
    setMessage(null);
    const response = await fetch(`/api/places/${placeId}/classify-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply, force: false })
    });
    const json = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(String(json.error ?? "AI分類に失敗しました"));
      return;
    }
    if (json.skipped) {
      setMessage(String(json.reason ?? "手動分類が優先されています"));
      return;
    }
    setMessage(apply ? "AI分類を保存しました" : suggestionMessage(json.classification));
    if (apply) window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={loading || manualOverride} onClick={() => classify(false)} className="rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-50">
        AI分類を提案
      </button>
      <button type="button" disabled={loading || manualOverride} onClick={() => classify(true)} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        AIで再分類
      </button>
      {manualOverride ? <span className="text-sm text-stone-600">手動分類が優先されています</span> : null}
      {message ? <span className="text-sm text-stone-600">{message}</span> : null}
    </div>
  );
}

function suggestionMessage(classification: Record<string, unknown> | undefined) {
  if (!classification) return "AI分類候補を取得しました";
  return `候補: ${String(classification.main_category ?? "Other")} / ${String(classification.area_label ?? "未分類")} / ${String(classification.travel_region ?? "未分類")}`;
}
