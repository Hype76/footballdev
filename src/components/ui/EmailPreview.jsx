import fallbackLogo from '../../assets/football-player-logo.png'
import { buildEmailHtml } from '../../lib/email-builder.js'
import { formatUkDate } from '../../lib/date-format.js'

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

  return formatUkDate(parsedDate.toISOString().slice(0, 10), normalizedValue)
}

function isTextResponseItem(item) {
  const value = String(item?.value ?? '').trim()

  if (!value) {
    return false
  }

  return Number.isNaN(Number(value))
}

export function EmailPreview({
  clubName = 'Club Name',
  planKey = '',
  logoUrl = '',
  playerName = 'Player Name',
  team = '',
  section = 'Trial',
  session = '',
  emailSubject = '',
  emailBody = '',
  recipientNames = '',
  responseItems = [],
  mode = 'scored',
}) {
  const resolvedLogoUrl = logoUrl || fallbackLogo
  const showScoring = mode === 'scored'
  const showEmailTemplate = mode === 'email'
  const visibleResponseItems = mode === 'without-scores'
    ? responseItems.filter(isTextResponseItem)
    : responseItems
  const sharedEmailHtml = showEmailTemplate
    ? buildEmailHtml({
        parentName: recipientNames,
        playerName,
        teamName: team,
        clubName,
        planKey,
        logoUrl,
        emailBody,
        responses: responseItems,
      })
    : ''

  return (
    <div className="print-container">
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-[#cbd5e1] bg-white p-3 shadow-sm shadow-[#2563eb]/10 sm:p-6 lg:p-8">
        <div className="section flex flex-col gap-4 border-b border-[#cbd5e1] pb-5 sm:gap-6 sm:pb-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#2563eb]">
              {showEmailTemplate ? 'Parent Email Template' : 'Development Preview'}
            </p>

            <div className="mt-4">
              <img src={resolvedLogoUrl} alt={clubName} className="max-h-20 w-auto max-w-[150px] object-contain" />
            </div>

            <h2 className="mt-3 text-xl font-black tracking-tight text-[#0f172a] sm:text-2xl">{clubName}</h2>
          </div>

          <div className="inline-flex min-h-11 items-center rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm font-black text-[#1d4ed8] md:shrink-0">
            {section || 'Trial'}
          </div>
        </div>

        <div className="section mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-black text-[#475569]">Player</p>
            <h3 className="mt-2 break-words text-2xl font-black tracking-tight text-[#0f172a] sm:text-3xl">{playerName}</h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="section rounded-lg border border-[#cbd5e1] bg-[#eff6ff] px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">Team</p>
              <p className="mt-2 text-sm font-semibold text-[#475569]">{team || 'Not provided'}</p>
            </div>
            <div className="section rounded-lg border border-[#cbd5e1] bg-[#eff6ff] px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">Session</p>
              <p className="mt-2 text-sm font-semibold text-[#475569]">{formatSessionForDisplay(session)}</p>
            </div>
            <div className="section rounded-lg border border-[#cbd5e1] bg-[#eff6ff] px-4 py-3 sm:col-span-2">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">Section</p>
              <p className="mt-2 text-sm font-semibold text-[#475569]">{section}</p>
            </div>
          </div>
        </div>

        {showEmailTemplate ? (
          <div className="section mt-6 rounded-lg border border-[#cbd5e1] bg-[#eff6ff] p-4 sm:rounded-lg sm:p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">
              Email Subject
            </p>
            <p className="mt-4 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#475569]">
              {emailSubject || 'No email subject available.'}
            </p>
          </div>
        ) : null}

        {showScoring ? (
          <div className="section mt-6 rounded-lg border border-[#cbd5e1] bg-[#eff6ff] p-4 sm:rounded-lg sm:p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Development Responses</p>

            {visibleResponseItems.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-[#475569]">No responses provided.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {visibleResponseItems.map((item) => (
                  <div key={item.label} className="section rounded-lg border border-[#cbd5e1] bg-white px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">{item.label}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#475569]">
                      {formatPreviewValue(item.value)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : showEmailTemplate ? (
          <div className="section mt-6 rounded-lg border border-[#cbd5e1] bg-[#eff6ff] p-4 sm:rounded-lg sm:p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Parent Message</p>
            <div className="mt-4 overflow-hidden rounded-lg border border-[#cbd5e1] bg-white text-sm font-semibold leading-6 text-[#475569]">
              {emailBody ? (
                <div dangerouslySetInnerHTML={{ __html: sharedEmailHtml }} />
              ) : (
                <p className="p-4">No parent email template is available for this development record yet.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="section mt-6 rounded-lg border border-[#cbd5e1] bg-[#eff6ff] p-4 sm:rounded-lg sm:p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Development Responses</p>

            {visibleResponseItems.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-[#475569]">No selected text fields were provided.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {visibleResponseItems.map((item) => (
                  <div key={item.label} className="section rounded-lg border border-[#cbd5e1] bg-white px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">{item.label}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#475569]">
                      {formatPreviewValue(item.value)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
