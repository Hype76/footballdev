import { formatSessionDate } from '../../lib/session-page-utils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function TournamentResultsSection({
  form,
  games,
  isLoading,
  isSaving,
  isSessionLocked,
  onChange,
  onDeleteGame,
  onSubmit,
  selectedSession,
}) {
  if (selectedSession?.sessionType !== 'tournament') {
    return null
  }

  return (
    <SectionCard
      title="Tournament results"
      description="Add each game result for this tournament session. A team can play multiple games in one tournament."
    >
      <div className="space-y-5">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={onSubmit}>
          <label className="block xl:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Opponent</span>
            <input
              type="text"
              name="opponent"
              value={form.opponent}
              onChange={onChange}
              required
              placeholder="Opponent team"
              disabled={isSessionLocked}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">{selectedSession.team || 'Our team'} score</span>
            <input
              type="number"
              name="teamScore"
              value={form.teamScore}
              onChange={onChange}
              required
              min="0"
              disabled={isSessionLocked}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Opponent score</span>
            <input
              type="number"
              name="opponentScore"
              value={form.opponentScore}
              onChange={onChange}
              required
              min="0"
              disabled={isSessionLocked}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Game date</span>
            <input
              type="date"
              name="gameDate"
              value={form.gameDate}
              onChange={onChange}
              disabled={isSessionLocked}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="block md:col-span-2 xl:col-span-4">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Notes</span>
            <input
              type="text"
              name="notes"
              value={form.notes}
              onChange={onChange}
              placeholder="Optional game note"
              disabled={isSessionLocked}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isSaving || isSessionLocked}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Add Result'}
            </button>
          </div>
        </form>

        {isLoading ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading tournament results...
          </div>
        ) : games.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No tournament game results have been added yet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {games.map((game) => (
              <div key={game.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {selectedSession.team || 'Team'} {game.teamScore} - {game.opponentScore} {game.opponent}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {game.gameDate ? formatSessionDate(game.gameDate) : formatSessionDate(selectedSession.sessionDate)}
                    </p>
                    {game.notes ? <p className="mt-2 text-sm text-[var(--text-muted)]">{game.notes}</p> : null}
                  </div>
                  <button
                    type="button"
                    disabled={isSaving || isSessionLocked}
                    onClick={() => void onDeleteGame(game.id)}
                    className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-red-500/40 bg-red-600/20 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}
