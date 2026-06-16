"use client";

import { useState } from "react";
import { ja } from "@/lib/i18n/ja";

type Props = {
  placeId: string;
  closedStatus?: string | null;
  isArchived?: boolean | null;
  compact?: boolean;
};

export function ArchiveActions({ placeId, closedStatus, isArchived, compact = false }: Props) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const buttonClass = compact
    ? "rounded-md border border-line px-3 py-2 text-sm font-medium disabled:opacity-50"
    : "rounded-md border border-line px-4 py-2 text-sm font-medium disabled:opacity-50";

  async function patch(body: Record<string, unknown>, success: string) {
    setSaving(true);
    setMessage(null);
    const response = await fetch(`/api/places/${placeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setSaving(false);
    setMessage(response.ok ? success : ja.placeDetail.saveFailed);
    if (response.ok) window.location.reload();
  }

  if (isArchived) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => patch({ is_archived: false, archived_at: null, archive_reason: null }, ja.closed.restored)}
          className={buttonClass}
        >
          {ja.closed.restore}
        </button>
        {message ? <span className="text-sm text-stone-600">{message}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={saving}
        onClick={() => patch({ is_archived: true, archived_at: new Date().toISOString(), archive_reason: archiveReason(closedStatus) }, ja.closed.archived)}
        className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {ja.closed.archive}
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => patch({ is_archived: false, archived_at: null, archive_reason: "not_closed" }, ja.closed.notArchived)}
        className={buttonClass}
      >
        {ja.closed.doNotArchive}
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => patch({ is_archived: false, archived_at: null, archive_reason: null, enrichment_status: "needs_review" }, ja.closed.returnedToReview)}
        className={buttonClass}
      >
        {ja.closed.returnToReview}
      </button>
      {message ? <span className="text-sm text-stone-600">{message}</span> : null}
    </div>
  );
}

function archiveReason(status: string | null | undefined) {
  if (status === "permanently_closed") return "closed_permanently";
  if (status === "temporarily_closed") return "closed_temporarily";
  return "closed_candidate";
}
