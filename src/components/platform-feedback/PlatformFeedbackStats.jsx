export function PlatformFeedbackStats({ feedbackStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {feedbackStats.map((item) => (
        <div
          key={item.label}
          className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10 transition hover:border-[#2563eb] hover:bg-[#f8fafc]"
        >
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">{item.label}</p>
          <p className="mt-3 text-4xl font-black tracking-tight text-[#0f172a]">{item.value}</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#475569]">{item.caption}</p>
        </div>
      ))}
    </div>
  )
}
