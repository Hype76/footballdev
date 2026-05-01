import fallbackLogo from '../../assets/player-feedback-logo.png'

export function BlankPrintForm({ clubName, logoUrl, fields }) {
  const resolvedLogoUrl = logoUrl || fallbackLogo

  return (
    <div className="print-only hidden bg-white text-slate-900">
      <div className="print-container mx-auto max-w-3xl p-8">
        <div className="section border-b border-slate-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Printable Blank Form</p>
          <div className="mt-4">
            <img src={resolvedLogoUrl} alt={clubName} className="max-h-20 w-auto max-w-[150px] object-contain" />
          </div>
          <h1 className="mt-3 text-3xl font-semibold">{clubName}</h1>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {['Player Name', 'Team', 'Coach', 'Parent Email', 'Session', 'Section'].map((label) => (
            <div key={label} className="section rounded-2xl border border-slate-200 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
              <div className="mt-4 h-6 border-b border-slate-300" />
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-4">
          {fields.map((field) => (
            <div key={field.id} className="section rounded-2xl border border-slate-200 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{field.label}</p>
              {field.type === 'textarea' ? (
                <div className="mt-4 h-28 rounded-2xl border border-slate-200 bg-slate-50" />
              ) : (
                <div className="mt-4 h-10 rounded-2xl border border-slate-200 bg-slate-50" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
