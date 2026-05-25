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
  const inputClass =
    'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'

  return (
    <SectionCard
      title="Create session"
      tourId="create-session-section"
      description="Use a date only. Times are not required for assessments."
    >
      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading session setup...
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          No teams are available yet. Create a team first, then sessions can be planned.
        </div>
      ) : (
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Team</span>
            <select
              name="teamId"
              value={form.teamId}
              onChange={onChange}
              required
              className={inputClass}
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
            <span className="mb-2 block text-sm font-bold text-slate-950">Session Type</span>
            <select
              name="sessionType"
              value={form.sessionType}
              onChange={onChange}
              required
              className={inputClass}
            >
              <option value="">Select session type</option>
              <option value="training">Training</option>
              <option value="match">Match</option>
            </select>
          </label>

          {form.sessionType === 'match' ? (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-950">Opponent</span>
              <input
                type="text"
                name="opponent"
                value={form.opponent}
                onChange={onChange}
                placeholder="Opposition team"
                className={inputClass}
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Date</span>
            <input
              type="date"
              name="sessionDate"
              value={form.sessionDate}
              onChange={onChange}
              required
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Player list</span>
            <select
              name="section"
              value={form.section}
              onChange={onChange}
              className={inputClass}
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
              title={isSaving ? 'Please wait while this session is being created.' : undefined}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Create Session'}
            </button>
          </div>
        </form>
      )}
    </SectionCard>
  )
}
