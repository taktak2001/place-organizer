export function StatCard({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-300 bg-white p-4">
      <div className="flex items-center justify-between gap-3 text-sm text-stone-600">
        <span>{label}</span>
        {icon ? <span className="text-moss">{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}
