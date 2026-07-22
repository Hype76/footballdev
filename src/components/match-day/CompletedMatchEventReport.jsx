import {
  buildCompletedMatchEventPresentation,
  buildFinalMatchReportSummary,
} from '../../lib/matchday-final-report.js'

function CompletedEventList({ emptyLabel, events, includeEventNotes, match, title }) {
  return (
    <section className="border-t border-[#d7e5dc] pt-4">
      <div className="flex items-center justify-between gap-3">
        <h6 className="text-sm font-black text-[#101828]">{title}</h6>
        <span className="text-xs font-black text-[#047857]">{events.length}</span>
      </div>
      {events.length > 0 ? (
        <ul className="mt-2 divide-y divide-[#d7e5dc]">
          {events.map((event) => {
            const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: includeEventNotes })

            return (
              <li key={event.id} className="py-3 text-sm font-semibold text-[#4b5f55]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">{presentation.team.name}</p>
                    <p className="mt-1 font-black text-[#101828]">{presentation.title}</p>
                  </div>
                  <span>{presentation.minuteLabel}</span>
                </div>
                {presentation.detail ? <p className="mt-1 text-xs leading-5">{presentation.detail}</p> : null}
                {presentation.notes ? <p className="mt-1 text-xs leading-5">Note: {presentation.notes}</p> : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{emptyLabel}</p>
      )}
    </section>
  )
}

function CompletedTimeline({ events, includeEventNotes, match }) {
  return (
    <section className="mt-5 border-t border-[#d7e5dc] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h6 className="text-sm font-black text-[#101828]">Full event timeline</h6>
        <span className="text-xs font-black text-[#047857]">{events.length} events</span>
      </div>
      {events.length > 0 ? (
        <ol className="mt-3 max-h-[32rem] divide-y divide-[#d7e5dc] overflow-y-auto border-y border-[#d7e5dc]">
          {events.map((event) => {
            const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: includeEventNotes })

            return (
              <li key={event.id} className="py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">{presentation.team.name}</p>
                    <p className="mt-1 text-sm font-black text-[#101828]">{presentation.title}</p>
                    {presentation.detail ? <p className="mt-1 text-xs font-semibold text-[#4b5f55]">{presentation.detail}</p> : null}
                    {presentation.notes ? <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Note: {presentation.notes}</p> : null}
                    <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Score after event: {presentation.scoreLabel}</p>
                  </div>
                  <span className="inline-flex w-fit rounded-lg border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#4b5f55]">
                    {presentation.status === 'voided' ? `Voided, ${presentation.minuteLabel}` : presentation.minuteLabel}
                  </span>
                </div>
                {presentation.status === 'voided' ? (
                  <p className="mt-2 text-xs font-semibold leading-5 text-[#475569]">{event.correctionReason || 'Event voided'}</p>
                ) : null}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">No timeline events were recorded for this game.</p>
      )}
    </section>
  )
}

function CompletedMatchResult({ match, result }) {
  return (
    <section className="mb-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4" aria-label="Completed match result">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55]">Normal time</p>
          <p className="mt-1 text-xl font-black text-[#101828]">{result.regulationScore}</p>
        </div>
        {result.extraTimeScore ? (
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55]">After extra time</p>
            <p className="mt-1 text-xl font-black text-[#101828]">{result.extraTimeScore}</p>
          </div>
        ) : null}
        {result.shootoutScore ? (
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55]">Penalty shootout</p>
            <p className="mt-1 text-xl font-black text-[#101828]">{result.shootoutScore}</p>
          </div>
        ) : null}
        {result.shootoutWinner ? (
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55]">Shootout winner</p>
            <p className="mt-1 text-sm font-black text-[#101828]">{result.shootoutWinner}</p>
          </div>
        ) : null}
      </div>
      {result.shootoutEvents.length > 0 ? (
        <ol className="mt-4 divide-y divide-[#d7e5dc] border-y border-[#d7e5dc]">
          {result.shootoutEvents.map((kick) => (
            <li key={kick.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm font-semibold text-[#4b5f55]">
              <span>
                {kick.teamSide === 'opponent' ? (match.opponent || 'Opponent') : (match.teamName || 'Our team')}
                {kick.playerName ? `, ${kick.playerName}` : ''}
              </span>
              <span className="font-black text-[#101828]">
                Kick {kick.kickNumber}: {kick.eventStatus === 'voided' ? `voided, ${kick.voidReason || 'corrected'}` : kick.outcome}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

export function CompletedMatchEventReport({ includeEventNotes = false, match }) {
  const summary = buildFinalMatchReportSummary(match)
  const yellowCardCount = summary.activeCards.filter((event) => event.eventType === 'yellow_card').length
  const redCardCount = summary.activeCards.filter((event) => event.eventType === 'red_card').length

  return (
    <div aria-label="Completed match events">
      <CompletedMatchResult match={match} result={summary.result} />
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
        <CompletedEventList emptyLabel="No active goals were recorded." events={summary.activeGoals} includeEventNotes={includeEventNotes} match={match} title="Goals summary" />
        <section className="border-t border-[#d7e5dc] pt-4">
          <div className="flex items-center justify-between gap-3">
            <h6 className="text-sm font-black text-[#101828]">Cards summary</h6>
            <span className="text-xs font-black text-[#047857]">{summary.activeCards.length}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-[#4b5f55]">{yellowCardCount} yellow, {redCardCount} red</p>
          <CompletedEventList emptyLabel="No active cards were recorded." events={summary.activeCards} includeEventNotes={includeEventNotes} match={match} title="Card events" />
        </section>
        <CompletedEventList emptyLabel="No active substitutions were recorded." events={summary.activeSubstitutions} includeEventNotes={includeEventNotes} match={match} title="Substitutions summary" />
        <CompletedEventList emptyLabel="No active injuries were recorded." events={summary.activeInjuries} includeEventNotes={includeEventNotes} match={match} title="Injuries summary" />
        <CompletedEventList emptyLabel="No active water breaks were recorded." events={summary.activeWaterBreaks} includeEventNotes={includeEventNotes} match={match} title="Water breaks" />
        <CompletedEventList emptyLabel="No other active match events were recorded." events={summary.activeOtherEvents} includeEventNotes={includeEventNotes} match={match} title="Other match events" />
      </div>
      <CompletedTimeline events={summary.timelineEvents} includeEventNotes={includeEventNotes} match={match} />
    </div>
  )
}
