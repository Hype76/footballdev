function formatPreviewValue(value) {
  if (typeof value === 'number') {
    return value
  }

  const normalizedValue = String(value ?? '').trim()
  return normalizedValue || 'Not provided'
}

function formatSessionForDisplay(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return 'Not scheduled'
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedDate)
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
    <div className="print-container">
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-[24px] border border-[#dbe3d6] bg-white p-4 shadow-sm shadow-slate-200/40 sm:rounded-[28px] sm:p-6 lg:p-8">
        <div className="section flex flex-col gap-4 border-b border-[#e7ece3] pb-5 sm:gap-6 sm:pb-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5a6b5b]">Feedback Preview</p>

            {logoUrl ? (
              <div className="mt-4">
                <img src={logoUrl} alt={clubName} className="max-h-20 w-auto max-w-[150px] object-contain" />
              </div>
            ) : (
              <p className="mt-4 text-lg font-semibold tracking-tight text-slate-900">{clubName}</p>
            )}

            <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{clubName}</h2>
          </div>

          <div className="inline-flex min-h-11 items-center rounded-2xl bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#4f6552]">
            Decision: {decision}
          </div>
        </div>

        <div className="section mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-slate-500">Player</p>
            <h3 className="mt-2 break-words text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{playerName}</h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="section rounded-2xl border border-[#e7ece3] bg-[#fbfcf9] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b]">Team</p>
              <p className="mt-2 text-sm font-medium text-slate-700">{team || 'Not provided'}</p>
            </div>
            <div className="section rounded-2xl border border-[#e7ece3] bg-[#fbfcf9] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b]">Session</p>
              <p className="mt-2 text-sm font-medium text-slate-700">{formatSessionForDisplay(session)}</p>
            </div>
          </div>
        </div>

        <div className="section mt-6 rounded-[24px] border border-[#e7ece3] bg-[#fbfcf9] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Evaluation Responses</p>

          {responseItems.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No responses provided.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {responseItems.map((item) => (
                <div key={item.label} className="section rounded-2xl border border-[#e2e7de] bg-white px-4 py-3">
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
    </div>
  )
}
