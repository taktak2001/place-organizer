import Link from "next/link";
import { ja, jaStatus } from "@/lib/i18n/ja";
import { safeQuery } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const { data: batches, error } = await safeQuery<Record<string, unknown>[]>([], async (supabase) => {
    const { data, error: queryError } = await supabase
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (queryError) throw queryError;
    return data ?? [];
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase text-moss">{ja.imports.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold">{ja.imports.title}</h1>
        </div>
        <Link href="/import" className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-[#222A31]">{ja.imports.newImport}</Link>
      </div>

      {error ? <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-700">{error}</div> : null}

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-paper text-stone-700">
            <tr>
              <th className="px-4 py-3">{ja.imports.createdAt}</th>
              <th className="px-4 py-3">{ja.imports.fileName}</th>
              <th className="px-4 py-3">{ja.imports.status}</th>
              <th className="px-4 py-3">{ja.imports.totalCount}</th>
              <th className="px-4 py-3">{ja.imports.parsedCount}</th>
              <th className="px-4 py-3">{ja.imports.insertedCount}</th>
              <th className="px-4 py-3">{ja.imports.updatedCount}</th>
              <th className="px-4 py-3">{ja.imports.duplicateCount}</th>
              <th className="px-4 py-3">{ja.imports.errorCount}</th>
              <th className="px-4 py-3">{ja.imports.fileHash}</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={String(batch.id)} className="border-t border-line">
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(batch.created_at)}</td>
                <td className="px-4 py-3">{String(batch.filename ?? "")}</td>
                <td className="px-4 py-3">{jaStatus(batch.status)}</td>
                <td className="px-4 py-3">{String(batch.total_count ?? 0)}</td>
                <td className="px-4 py-3">{String(batch.parsed_count ?? 0)}</td>
                <td className="px-4 py-3">{String(batch.inserted_count ?? 0)}</td>
                <td className="px-4 py-3">{String(batch.updated_count ?? 0)}</td>
                <td className="px-4 py-3">{String(batch.duplicate_count ?? 0)}</td>
                <td className="px-4 py-3">{String(batch.error_count ?? 0)}</td>
                <td className="max-w-48 truncate px-4 py-3 font-mono text-xs">{String(batch.file_hash ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {batches.length === 0 ? <div className="p-6 text-sm text-stone-600">{ja.imports.noImports}</div> : null}
      </div>
    </div>
  );
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ja-JP");
}
