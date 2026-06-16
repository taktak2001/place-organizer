"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { ja } from "@/lib/i18n/ja";

type Props = {
  placeId: string;
  place: Record<string, unknown>;
  classification: Record<string, unknown> | null;
};

export function PlaceEditForm({ placeId, place, classification }: Props) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setSaving(true);
    setMessage(null);
    const body = {
      google_place_id: formData.get("google_place_id"),
      name: formData.get("name"),
      address: formData.get("address"),
      main_category: formData.get("main_category"),
      sub_category: formData.get("sub_category"),
      scene_tags: String(formData.get("scene_tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      area_label: formData.get("area_label"),
      travel_region: formData.get("travel_region"),
      visited_status: formData.get("visited_status"),
      priority: formData.get("priority"),
      manual_override: true,
      classification_source: "manual"
    };
    const response = await fetch(`/api/places/${placeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setSaving(false);
    setMessage(response.ok ? ja.placeDetail.saved : ja.placeDetail.saveFailed);
  }

  return (
    <form action={submit} className="grid gap-3 rounded-lg border border-stone-300 bg-white p-4 md:grid-cols-2">
      <EditInput name="google_place_id" label={ja.placeDetail.googlePlaceId} value={place.google_place_id} />
      <EditInput name="name" label={ja.places.name} value={place.name} />
      <EditInput name="address" label={ja.placeDetail.address} value={place.address} />
      <EditInput name="main_category" label={ja.places.category} value={classification?.main_category} />
      <EditInput name="sub_category" label={ja.places.subCategory} value={classification?.sub_category} />
      <EditInput name="scene_tags" label={ja.places.scene} value={Array.isArray(classification?.scene_tags) ? classification.scene_tags.join(", ") : ""} />
      <EditInput name="area_label" label={ja.placeDetail.area} value={classification?.area_label} />
      <EditInput name="travel_region" label={ja.placeDetail.travelRegion} value={classification?.travel_region} />
      <EditInput name="visited_status" label={ja.places.visitedStatus} value={classification?.visited_status ?? "want"} />
      <EditInput name="priority" label={ja.placeDetail.priority} value={classification?.priority} />
      <div className="flex items-end gap-3">
        <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">
          <Save className="h-4 w-4" />
          {saving ? ja.placeDetail.saving : ja.placeDetail.saveChanges}
        </button>
        {message ? <span className="pb-2 text-sm text-stone-600">{message}</span> : null}
      </div>
    </form>
  );
}

function EditInput({ name, label, value }: { name: string; label: string; value: unknown }) {
  return (
    <label>
      <span className="text-xs font-medium uppercase text-stone-600">{label}</span>
      <input name={name} defaultValue={String(value ?? "")} className="mt-1 h-10 w-full rounded-md border border-stone-300 px-3 outline-none" />
    </label>
  );
}
