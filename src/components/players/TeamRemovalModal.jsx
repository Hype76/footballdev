import { useEffect, useState } from 'react'

const scopes = [
  {
    value: 'team_only',
    title: 'Remove from Team only',
    description: 'Removes the Player\'s active membership from this Team. Existing event participation, including future events, remains unchanged.',
  },
  {
    value: 'team_and_future_events',
    title: 'Remove from Team and future events',
    description: 'Removes the Player from this Team and from upcoming events belonging to this Team. Past events and historical records remain unchanged.',
  },
]

export function TeamRemovalModal({
  errorMessage = '',
  isBusy = false,
  isLoadingPreview = false,
  isOpen,
  onCancel,
  onConfirm,
  onScopeChange,
  player,
  preview,
}) {
  const [scope, setScope] = useState('team_only')

  useEffect(() => {
    if (!isOpen) return undefined
    const timeoutId = window.setTimeout(() => {
      setScope('team_only')
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [isOpen])

  if (!isOpen) return null

  const chooseScope = (nextScope) => {
    setScope(nextScope)
    onScopeChange(nextScope)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#101828]/70 px-4 py-6">
      <div role="dialog" aria-modal="true" aria-labelledby="team-removal-title" className="relative max-h-[calc(100dvh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white shadow-2xl shadow-[#101828]/25">
        <div className="border-b border-[#fecdca] bg-[#fff5f5] px-5 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#b42318]">Team membership</p>
          <h2 id="team-removal-title" className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#101828]">
            Remove {player?.playerName || 'this Player'} from Team
          </h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
            Choose whether already configured future event participation should stay or be removed. The Player record and historical records are preserved.
          </p>
        </div>
        <button type="button" onClick={onCancel} disabled={isBusy} aria-label="Close this window" className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-sm font-black text-[#101828] transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
          X
        </button>

        <div className="space-y-4 px-5 py-5 sm:px-6">
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-sm font-semibold text-[#4b5f55]">
            <p className="font-black text-[#101828]">{player?.playerName || 'Selected Player'}</p>
            <p className="mt-1">Team: {player?.team || 'Selected Team'}</p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-black text-[#101828]">Removal scope</legend>
            {scopes.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#d7e5dc] bg-white p-4 transition hover:border-[#047857] hover:bg-[#f7faf8]">
                <input type="radio" name="team-removal-scope" value={option.value} checked={scope === option.value} onChange={() => chooseScope(option.value)} className="mt-1 h-4 w-4 accent-[#b42318]" />
                <span>
                  <span className="block text-sm font-black text-[#101828]">{option.title}</span>
                  <span className="mt-1 block text-sm font-semibold leading-6 text-[#4b5f55]">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {scope === 'team_only' ? (
            <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] p-4 text-sm font-semibold leading-6 text-[#93370d]">
              The Player may still appear in already configured future events for this Team. Invitations, reminders, and response links for those events remain unchanged.
            </div>
          ) : null}

          <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4">
            <p className="text-sm font-black text-[#065f46]">Server impact preview</p>
            {isLoadingPreview ? (
              <p className="mt-2 text-sm font-semibold text-[#4b5f55]">Calculating the current Team and event impact...</p>
            ) : preview ? (
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <Impact label="Team membership affected" value={preview.teamMembershipAffected ?? 1} />
                <Impact label="Upcoming standalone events affected" value={preview.upcomingStandaloneEventsAffected ?? 0} />
                <Impact label="Recurring occurrences affected" value={preview.recurringOccurrencesAffected ?? 0} />
                <Impact label="Unsent invitations suppressed" value={preview.unsentInvitationsSuppressed ?? 0} />
                <Impact label="Historical records preserved" value={preview.historicalRecordsPreserved ? 'Yes' : 'No'} />
              </dl>
            ) : (
              <p className="mt-2 text-sm font-semibold text-[#4b5f55]">Impact counts are unavailable. Refresh before confirming.</p>
            )}
          </div>

          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-sm font-semibold leading-6 text-[#4b5f55]">
            Delete Player record remains a separate protected action. This Team removal does not delete or anonymise the Player, Development, Match, Training, RSVP, Chat, Formation Board, Resource, delivery, or audit history.
          </div>

          {errorMessage ? <p role="alert" className="rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-bold text-[#b42318]">{errorMessage}</p> : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onCancel} disabled={isBusy} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60">
              Cancel
            </button>
            <button type="button" onClick={() => onConfirm(scope)} disabled={isBusy || isLoadingPreview || !preview} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
              {isBusy ? 'Removing...' : scope === 'team_only' ? 'Remove from Team only' : 'Remove from Team and future events'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Impact({ label, value }) {
  return (
    <div className="rounded-lg border border-[#bbf7d0] bg-white px-3 py-3">
      <dt className="font-semibold text-[#4b5f55]">{label}</dt>
      <dd className="mt-1 font-black text-[#101828]">{value}</dd>
    </div>
  )
}
