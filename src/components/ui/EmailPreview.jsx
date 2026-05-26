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
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-[#bddcca] bg-white p-3 shadow-sm shadow-[#067a46]/10 sm:p-6 lg:p-8">
        <div className="section flex flex-col gap-4 border-b border-[#bddcca] pb-5 sm:gap-6 sm:pb-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#067a46]">
              {showEmailTemplate ? 'Parent Email Template' : 'Development Preview'}
            </p>

            <div className="mt-4">
              <img src={resolvedLogoUrl} alt={clubName} className="max-h-20 w-auto max-w-[150px] object-contain" />
            </div>

            <h2 className="mt-3 text-xl font-black tracking-tight text-[#10231a] sm:text-2xl">{clubName}</h2>
          </div>

          <div className="inline-flex min-h-11 items-center rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 py-3 text-sm font-black text-[#067a46] md:shrink-0">
            {section || 'Trial'}
          </div>
        </div>

        <div className="section mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-black text-[#456653]">Player</p>
            <h3 className="mt-2 break-words text-2xl font-black tracking-tight text-[#10231a] sm:text-3xl">{playerName}</h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="section rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Team</p>
              <p className="mt-2 text-sm font-semibold text-[#456653]">{team || 'Not provided'}</p>
            </div>
            <div className="section rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Session</p>
              <p className="mt-2 text-sm font-semibold text-[#456653]">{formatSessionForDisplay(session)}</p>
            </div>
            <div className="section rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 sm:col-span-2">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Section</p>
              <p className="mt-2 text-sm font-semibold text-[#456653]">{section}</p>
            </div>
          </div>
        </div>

        {showEmailTemplate ? (
          <div className="section mt-6 rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 sm:rounded-lg sm:p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">
              Email Subject
            </p>
            <p className="mt-4 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#456653]">
              {emailSubject || 'No email subject available.'}
            </p>
          </div>
        ) : null}

        {showScoring ? (
          <div className="section mt-6 rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 sm:rounded-lg sm:p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Development Responses</p>

            {visibleResponseItems.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-[#456653]">No responses provided.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {visibleResponseItems.map((item) => (
                  <div key={item.label} className="section rounded-lg border border-[#bddcca] bg-white px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">{item.label}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#456653]">
                      {formatPreviewValue(item.value)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : showEmailTemplate ? (
          <div className="section mt-6 rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 sm:rounded-lg sm:p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Parent Message</p>
            <div className="mt-4 overflow-hidden rounded-lg border border-[#bddcca] bg-white text-sm font-semibold leading-6 text-[#456653]">
              {emailBody ? (
                <div dangerouslySetInnerHTML={{ __html: sharedEmailHtml }} />
              ) : (
                <p className="p-4">No parent email template is available for this development record yet.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="section mt-6 rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 sm:rounded-lg sm:p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Development Responses</p>

            {visibleResponseItems.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-[#456653]">No selected text fields were provided.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {visibleResponseItems.map((item) => (
                  <div key={item.label} className="section rounded-lg border border-[#bddcca] bg-white px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">{item.label}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#456653]">
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
