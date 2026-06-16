import { ImportClient } from "@/components/ImportClient";
import { ja } from "@/lib/i18n/ja";

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium uppercase text-moss">{ja.importPage.eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold">{ja.importPage.title}</h1>
        <p className="mt-2 max-w-3xl text-stone-700">
          {ja.importPage.description}
        </p>
      </div>
      <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-800">
        {ja.importPage.developerNotice}
      </div>
      <ImportClient />
    </div>
  );
}
