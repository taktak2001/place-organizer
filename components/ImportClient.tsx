"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, FileUp, Loader2, UploadCloud } from "lucide-react";
import { ja } from "@/lib/i18n/ja";
import type { ParseResult } from "@/types/import";

export function ImportClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sample = useMemo(() => result?.items.slice(0, 5) ?? [], [result]);

  async function parseFile() {
    if (files.length === 0) return;
    setLoading(true);
    setMessage(null);
    const data = new FormData();
    files.forEach((file) => data.append("files", file));
    const response = await fetch("/api/import/parse", { method: "POST", body: data });
    const json = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(json.error ?? ja.importPage.parseFailed);
      return;
    }
    setResult(json);
  }

  async function commitImport() {
    if (!result) return;
    setCommitting(true);
    setMessage(null);
    const response = await fetch("/api/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    });
    const json = await response.json();
    setCommitting(false);
    if (!response.ok) {
      setMessage(json.error ?? ja.importPage.commitFailed);
      return;
    }
    setMessage(ja.importPage.importedCounts(json.inserted_count, json.updated_count));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-stone-300 bg-white p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <label className="flex min-h-28 flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-stone-400 bg-paper px-4 py-6 text-center">
            <FileUp className="mb-2 h-6 w-6 text-moss" aria-hidden />
            <span className="font-medium">{files.length > 0 ? selectedFileLabel(files) : ja.importPage.selectFile}</span>
            <span className="mt-1 text-sm text-stone-600">{ja.importPage.uploadHint}</span>
            <input
              type="file"
              accept=".zip,.csv,.json,.geojson"
              multiple
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          <button
            type="button"
            onClick={parseFile}
            disabled={files.length === 0 || loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {ja.importPage.parse}
          </button>
        </div>
        {message ? <p className="mt-4 rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-800">{message}</p> : null}
      </section>

      {result ? (
        <section className="space-y-5">
          <h2 className="text-xl font-semibold">{ja.importPage.preview}</h2>
          <div className="grid gap-3 md:grid-cols-5">
            <Metric label={ja.importPage.parsedItems} value={result.items.length} />
            <Metric label={ja.importPage.skippedRows} value={result.skipped_rows.length} />
            <Metric label={ja.importPage.duplicateCandidates} value={result.duplicate_candidates.length} />
            <Metric label={ja.importPage.realErrors} value={result.errors.length} />
            <Metric label={ja.importPage.alreadyImported} value={result.already_imported ? ja.importPage.yes : ja.importPage.no} />
          </div>

          {!result.supabase_available ? (
            <div className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-800">
              {ja.importPage.supabaseRequiredForCommit}
            </div>
          ) : null}

          {result.diff ? (
            <div className="space-y-3">
              <h3 className="text-base font-semibold">{ja.importPage.diffPreview}</h3>
              <div className="grid gap-3 md:grid-cols-5">
                <Metric label={ja.importPage.added} value={result.diff.added} />
                <Metric label={ja.importPage.removed} value={result.diff.removed} />
                <Metric label={ja.importPage.unchanged} value={result.diff.unchanged} />
                <Metric label={ja.importPage.listAdded} value={result.diff.list_added} />
                <Metric label={ja.importPage.listRemoved} value={result.diff.list_removed} />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-stone-300 bg-white p-4 text-sm text-stone-700">
              {ja.importPage.initialImport}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={ja.importPage.fileCounts}>
              <div className="grid gap-2">
                {Object.entries(result.file_counts).map(([name, count]) => (
                  <div key={name} className="flex justify-between gap-4 border-b border-stone-200 py-2 text-sm">
                    <span className="truncate">{name}</span>
                    <span className="font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={ja.importPage.listCounts}>
              <div className="grid gap-2">
                {Object.entries(result.list_counts).map(([name, count]) => (
                  <div key={name} className="flex justify-between border-b border-stone-200 py-2 text-sm">
                    <span>{name}</span>
                    <span className="font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={ja.importPage.errors}>
              {result.errors.length === 0 ? (
                <p className="text-sm text-stone-600">{ja.importPage.noParserErrors}</p>
              ) : (
                <ul className="space-y-2 text-sm text-clay">
                  {result.errors.slice(0, 10).map((error, index) => (
                    <li key={`${error.source_file}-${index}`}>{error.source_file} {error.row ? `${error.row}行目` : ""}: {error.message}</li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={ja.importPage.skippedRows}>
              {result.skipped_rows.length === 0 ? (
                <p className="text-sm text-stone-600">スキップ行はありません。</p>
              ) : (
                <ul className="space-y-2 text-sm text-stone-700">
                  {result.skipped_rows.slice(0, 10).map((skipped, index) => (
                    <li key={`${skipped.source_file}-${index}`}>{skipped.source_file} {skipped.row ? `${skipped.row}行目` : ""}: {skipped.message}</li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title={ja.importPage.sampleRows}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-stone-600">
                  <tr>
                    <th className="py-2 pr-4">{ja.importPage.name}</th>
                    <th className="py-2 pr-4">{ja.importPage.list}</th>
                    <th className="py-2 pr-4">{ja.importPage.address}</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.map((item) => (
                    <tr key={`${item.normalized_key}-${item.source_list_name}`} className="border-t border-stone-200">
                      <td className="py-2 pr-4 font-medium">{item.name}</td>
                      <td className="py-2 pr-4">{item.source_list_name}</td>
                      <td className="py-2 pr-4 text-stone-700">{item.address}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <button
            type="button"
            onClick={commitImport}
            disabled={committing || result.already_imported || result.items.length === 0 || !result.supabase_available}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {ja.importPage.commit}
          </button>
        </section>
      ) : null}
    </div>
  );
}

function selectedFileLabel(files: File[]) {
  if (files.length === 1) return files[0].name;
  return ja.importPage.selectedFiles(files.length);
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-stone-300 bg-white p-4">
      <div className="text-sm text-stone-600">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-300 bg-white p-4">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
}
