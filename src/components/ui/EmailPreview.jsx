function formatPreviewValue(value) {
  if (typeof value === 'number') {
    return value
  }

  const normalizedValue = String(value ?? '').trim()
  return normalizedValue || 'Not provided'
}

export function EmailPreview({
  clubName = 'Club Name',
  logoUrl = '',
  playerName = 'Player Name',
  team = '',
  session = '',
  decision = 'Progress',
  responseItems = [],
}) {
  return (
    <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-[24px] border border-[#dbe3d6] bg-white p-4 shadow-sm shadow-slate-200/40 sm:rounded-[28px] sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 border-b border-[#e7ece3] pb-5 sm:gap-6 sm:pb-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[#c9d3c4] bg-[#f5f7f3] text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b] sm:h-16 sm:w-16">
            {logoUrl ? (
              <img src={logoUrl} alt={clubName} className="h-full w-full object-cover" />
            ) : (
              'Logo'
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5a6b5b]">Feedback Preview</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{clubName}</h2>
          </div>
        </div>

        <div className="inline-flex min-h-11 items-center rounded-2xl bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#4f6552]">
          Decision: {decision}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm font-medium text-slate-500">Player</p>
          <h3 className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{playerName}</h3>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#e7ece3] bg-[#fbfcf9] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b]">Team</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{team || 'Not provided'}</p>
          </div>
          <div className="rounded-2xl border border-[#e7ece3] bg-[#fbfcf9] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b]">Session</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{session || 'Not provided'}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[24px] border border-[#e7ece3] bg-[#fbfcf9] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Evaluation Responses</p>

        {responseItems.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No responses provided.</p>
        ) : (
          <div className="mt-4 grid gap-3">
            {responseItems.map((item) => (
              <div key={item.label} className="rounded-2xl border border-[#e2e7de] bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b]">{item.label}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                  {formatPreviewValue(item.value)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
