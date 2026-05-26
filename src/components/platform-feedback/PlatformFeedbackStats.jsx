export function PlatformFeedbackStats({ feedbackStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {feedbackStats.map((item) => (
        <div
          key={item.label}
          className="overflow-hidden rounded-lg border border-[#d7eadf] bg-white p-5 shadow-sm shadow-[#d7eadf]/70 transition hover:border-[#20a464]"
        >
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">{item.label}</p>
          <p className="mt-3 text-4xl font-black tracking-tight text-[#10231a]">{item.value}</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#5f7468]">{item.caption}</p>
        </div>
      ))}
    </div>
  )
}
