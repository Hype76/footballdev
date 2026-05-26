import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const emptyClass = 'rounded-lg border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-4 py-6 text-sm font-semibold text-[#667085]'
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'

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
      description="Use a date only. Times are not required for development records."
    >
      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-4 text-sm font-semibold text-[#667085]">
          Loading session setup...
        </div>
      ) : teams.length === 0 ? (
        <div className={emptyClass}>
          No teams are available yet. Create a team first, then sessions can be planned.
        </div>
      ) : (
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={onSubmit}>
          <label className="block">
            <span className={labelClass}>Team</span>
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
            <span className={labelClass}>Session Type</span>
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
              <span className={labelClass}>Opponent</span>
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
            <span className={labelClass}>Date</span>
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
            <span className={labelClass}>Player list</span>
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
              className={primaryButtonClass}
            >
              {isSaving ? 'Saving...' : 'Create session'}
            </button>
          </div>
        </form>
      )}
    </SectionCard>
  )
}
