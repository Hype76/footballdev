export function PlatformFeedbackStats({ feedbackStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {feedbackStats.map((item) => (
        <div
          key={item.label}
          className="overflow-hidden rounded-md border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-300"
        >
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{item.label}</p>
          <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{item.value}</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{item.caption}</p>
        </div>
      ))}
    </div>
  )
}
