import { getPublicSupabaseEnvStatus } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function DebugEnvPage() {
  const status = getPublicSupabaseEnvStatus();
  const rows = [
    ["has NEXT_PUBLIC_SUPABASE_URL", String(status.hasUrl)],
    ["has NEXT_PUBLIC_SUPABASE_ANON_KEY", String(status.hasAnonKey)],
    ["NEXT_PUBLIC_ENABLE_ADMIN value", String(status.enableAdmin)],
    ["VERCEL_ENV", status.vercelEnv ?? "unset"],
    ["NODE_ENV", status.nodeEnv ?? "unset"]
  ];

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-medium uppercase text-moss">DEBUG</p>
        <h1 className="mt-1 text-3xl font-semibold">環境変数チェック</h1>
        <p className="mt-2 text-sm text-stone-700">
          値そのものは表示せず、公開接続に必要な環境変数が読み込まれているかだけ確認します。
        </p>
      </header>

      <section className="rounded-lg border border-stone-300 bg-white p-4">
        <dl className="grid gap-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-2">
              <dt className="text-stone-600">{label}</dt>
              <dd className="font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {status.missing.length > 0 ? (
        <section className="rounded-lg border border-clay bg-white p-4 text-sm text-stone-800">
          <div className="font-semibold">不足している公開接続情報</div>
          <ul className="mt-2 list-inside list-disc">
            {status.missing.map((name) => (
              <li key={name}>missing {name}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-lg border border-stone-300 bg-white p-4 text-sm font-semibold text-moss">
          公開Supabase接続情報は読み込まれています。
        </section>
      )}
    </div>
  );
}
