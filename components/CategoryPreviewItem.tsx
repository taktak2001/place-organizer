import { jaCategoryTag, jaDisplay, jaSceneTag } from "@/lib/i18n/ja";
import { categoryTags, firstRelated, sceneTags } from "@/lib/places/browse";

type Props = {
  category: string;
  place: {
    id?: unknown;
    name?: unknown;
    place_classifications?: unknown;
  };
};

type PreviewTag = {
  label: string;
  tone: "cuisine" | "scene" | "neutral";
};

export function CategoryPreviewItem({ category, place }: Props) {
  const classification = firstRelated(place.place_classifications);
  const tags = previewTags(category, classification);
  return (
    <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-paper px-3 py-2 text-sm text-stone-800">
      <div className="min-w-0 flex-1 truncate font-medium">{String(place.name)}</div>
      {tags.length > 0 ? (
        <div className="flex max-w-36 flex-wrap justify-end gap-1">
          {tags.map((tag) => (
            <span key={`${tag.tone}-${tag.label}`} className={`rounded px-1.5 py-0.5 text-[11px] leading-none ${tagClass(tag.tone)}`}>
              {tag.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function previewTags(category: string, classification: Record<string, unknown> | null): PreviewTag[] {
  if (category === "Restaurant") {
    const cuisines = categoryTags(classification).slice(0, 2).map((tag) => ({ label: jaCategoryTag(tag), tone: "cuisine" as const }));
    const scenes = sceneTags(classification).slice(0, Math.max(0, 3 - cuisines.length)).map((tag) => ({ label: jaSceneTag(tag), tone: "scene" as const }));
    return [...cuisines, ...scenes].slice(0, 3);
  }
  if (category === "Art") {
    return splitTags(classification?.sub_category).slice(0, 2).map((tag) => ({ label: jaDisplay(tag), tone: "neutral" }));
  }
  if (category === "Cafe" || category === "Fashion") {
    return categoryTags(classification).slice(0, 2).map((tag) => ({ label: jaCategoryTag(tag), tone: "cuisine" }));
  }
  return categoryTags(classification).slice(0, 2).map((tag) => ({ label: jaCategoryTag(tag), tone: "neutral" }));
}

function splitTags(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value ?? "").trim();
  return text ? [text] : [];
}

function tagClass(tone: PreviewTag["tone"]) {
  if (tone === "scene") return "bg-accentSoft text-ink";
  if (tone === "cuisine") return "border border-line bg-white text-ink";
  return "bg-white text-stone-600";
}
