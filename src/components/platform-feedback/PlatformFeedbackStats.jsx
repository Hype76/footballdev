export function PlatformFeedbackStats({ feedbackStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {feedbackStats.map((item) => (
        <div
          key={item.label}
          className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#f7faf8]"
        >
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">{item.label}</p>
          <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{item.value}</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">{item.caption}</p>
        </div>
      ))}
    </div>
  )
}
