import { safeSupabaseError, type SafeSupabaseError } from "@/lib/supabase/queries";
import { getPublicSupabaseEnvStatus, getSupabaseRead } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type QueryResult = {
  name: string;
  success: boolean;
  count: number | null;
  error: SafeSupabaseError | null;
};

export default async function DebugSupabaseReadPage() {
  const env = getPublicSupabaseEnvStatus();
  const results: QueryResult[] = [];

  if (env.missing.length === 0) {
    const supabase = getSupabaseRead();
    results.push(
      await countQuery("places count", () => supabase.from("places").select("id", { count: "exact", head: true })),
      await countQuery("place_classifications count", () => supabase.from("place_classifications").select("id", { count: "exact", head: true })),
      await countQuery("source_links count", () => supabase.from("source_links").select("id", { count: "exact", head: true }))
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-medium uppercase text-moss">DEBUG</p>
        <h1 className="mt-1 text-3xl font-semibold">Supabase read check</h1>
        <p className="mt-2 text-sm text-stone-700">
          anon keyで公開読み取りができるか確認します。値そのもの、URL全文、API key全文は表示しません。
        </p>
      </header>

      <section className="rounded-lg border border-stone-300 bg-white p-4">
        <dl className="grid gap-3 text-sm">
          <DebugRow label="has env URL" value={String(env.hasUrl)} />
          <DebugRow label="has env anon key" value={String(env.hasAnonKey)} />
          <DebugRow label="NEXT_PUBLIC_ENABLE_ADMIN value" value={String(env.enableAdmin)} />
          <DebugRow label="VERCEL_ENV" value={env.vercelEnv ?? "unset"} />
          <DebugRow label="NODE_ENV" value={env.nodeEnv ?? "unset"} />
        </dl>
      </section>

      {env.missing.length > 0 ? (
        <section className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-800">
          <div className="font-semibold">不足している公開接続情報</div>
          <ul className="mt-2 list-inside list-disc">
            {env.missing.map((name) => <li key={name}>missing {name}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3">
        {results.map((result) => (
          <div key={result.name} className="rounded-lg border border-stone-300 bg-white p-4 text-sm">
            <h2 className="font-semibold">{result.name}</h2>
            <dl className="mt-3 grid gap-2">
              <DebugRow label="success" value={String(result.success)} />
              <DebugRow label="count" value={result.count === null ? "null" : String(result.count)} />
            </dl>
            {result.error ? <ErrorDetails error={result.error} /> : null}
          </div>
        ))}
      </section>
    </div>
  );
}

async function countQuery(name: string, query: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<QueryResult> {
  const { count, error } = await query();
  if (error) {
    return {
      name,
      success: false,
      count: null,
      error: safeSupabaseError(error, name)
    };
  }
  return { name, success: true, count: count ?? 0, error: null };
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      <dt className="text-stone-600">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}

function ErrorDetails({ error }: { error: SafeSupabaseError }) {
  return (
    <dl className="mt-3 grid gap-2 rounded-md bg-paper p-3">
      <DebugRow label="error.message" value={error.message} />
      {error.code ? <DebugRow label="error.code" value={error.code} /> : null}
      {error.details ? <DebugRow label="error.details" value={error.details} /> : null}
      {error.hint ? <DebugRow label="error.hint" value={error.hint} /> : null}
    </dl>
  );
}
