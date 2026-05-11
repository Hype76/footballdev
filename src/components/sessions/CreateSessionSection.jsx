import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function CreateSessionSection({
  form,
  isLoading,
  isSaving,
  onChange,
  onSubmit,
  teams,
}) {
  return (
    <SectionCard
      title="Create session"
      tourId="create-session-section"
      description="Use a date only. Times are not required for assessments."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading session setup...
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No teams are available yet. Create a team first, then sessions can be planned.
        </div>
      ) : (
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
            <select
              name="teamId"
              value={form.teamId}
              onChange={onChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Session Type</span>
            <select
              name="sessionType"
              value={form.sessionType}
              onChange={onChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="">Select session type</option>
              <option value="training">Training</option>
              <option value="match">Match</option>
            </select>
          </label>

          {form.sessionType === 'match' ? (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Opponent</span>
              <input
                type="text"
                name="opponent"
                value={form.opponent}
                onChange={onChange}
                placeholder="Opposition team"
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Date</span>
            <input
              type="date"
              name="sessionDate"
              value={form.sessionDate}
              onChange={onChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player list</span>
            <select
              name="section"
              value={form.section}
              onChange={onChange}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              {EVALUATION_SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Create Session'}
            </button>
          </div>
        </form>
      )}
    </SectionCard>
  )
}
