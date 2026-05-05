import fallbackLogo from '../../assets/player-feedback-logo.png'
import { buildEmailHtml } from '../../lib/email-builder.js'

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

  const parsedSourceDate = new Date(normalizedValue)
  const dateOnlyValue = /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? normalizedValue
    : Number.isNaN(parsedSourceDate.getTime())
      ? ''
      : parsedSourceDate.toISOString().slice(0, 10)

  if (!dateOnlyValue) {
    return normalizedValue
  }

  const parsedDate = new Date(`${dateOnlyValue}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsedDate)
}

export function EmailPreview({
  clubName = 'Club Name',
  logoUrl = '',
  playerName = 'Player Name',
  team = '',
  section = 'Trial',
  session = '',
  summary = '',
  emailSubject = '',
  emailBody = '',
  recipientNames = '',
  responseItems = [],
  mode = 'scored',
}) {
  const resolvedLogoUrl = logoUrl || fallbackLogo
  const showScoring = mode === 'scored'
  const showEmailTemplate = mode === 'email'
  const sharedEmailHtml = showEmailTemplate
    ? buildEmailHtml({
        parentName: recipientNames,
        playerName,
        teamName: team,
        clubName,
        logoUrl,
        emailBody,
        responses: responseItems,
      })
    : ''

  return (
    <div className="print-container" data-pdf-root>
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-[22px] border border-[var(--border-color)] bg-white p-3 shadow-sm shadow-slate-200/40 sm:rounded-[28px] sm:p-6 lg:p-8">
        <div className="section flex flex-col gap-4 border-b border-[#e7ece3] pb-5 sm:gap-6 sm:pb-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5a6b5b]">
              {showEmailTemplate ? 'Parent Email Template' : 'Assessment PDF'}
            </p>

            <div className="mt-4">
              <img src={resolvedLogoUrl} alt={clubName} className="max-h-20 w-auto max-w-[150px] object-contain" />
            </div>

            <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{clubName}</h2>
          </div>

          <div className="inline-flex min-h-11 items-center rounded-2xl bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#4f6552] md:shrink-0">
            {section || 'Trial'}
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
            <div className="section rounded-2xl border border-[#e7ece3] bg-[#fbfcf9] px-4 py-3 sm:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b]">Section</p>
              <p className="mt-2 text-sm font-medium text-slate-700">{section}</p>
            </div>
          </div>
        </div>

        <div className="section mt-6 rounded-[22px] border border-[#e7ece3] bg-[#fbfcf9] p-4 sm:rounded-[24px] sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">
            {showEmailTemplate ? 'Email Subject' : 'Summary'}
          </p>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
            {showEmailTemplate ? emailSubject || 'No email subject available.' : summary || 'No written summary provided.'}
          </p>
        </div>

        {showScoring ? (
          <div className="section mt-6 rounded-[22px] border border-[#e7ece3] bg-[#fbfcf9] p-4 sm:rounded-[24px] sm:p-5">
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
        ) : showEmailTemplate ? (
          <div className="section mt-6 rounded-[22px] border border-[#e7ece3] bg-[#fbfcf9] p-4 sm:rounded-[24px] sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Parent Message</p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-[#e7ece3] bg-white text-sm leading-6 text-slate-700">
              {emailBody ? (
                <div dangerouslySetInnerHTML={{ __html: sharedEmailHtml }} />
              ) : (
                <p className="p-4">No parent email template is available for this assessment yet.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="section mt-6 rounded-[22px] border border-[#e7ece3] bg-[#fbfcf9] p-4 sm:rounded-[24px] sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Scores</p>
            <p className="mt-4 text-sm leading-6 text-slate-700">Scores are not included in this PDF.</p>
          </div>
        )}
      </section>
    </div>
  )
}
