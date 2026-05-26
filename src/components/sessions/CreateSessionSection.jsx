import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { SectionCard } from '../ui/SectionCard.jsx'
import { SessionStatePanel } from './SessionStatePanel.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#0f172a]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d8e3ee] bg-white px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]'
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60'

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
      description="Create one training or match block before adding the player queue."
    >
      {isLoading ? (
        <SessionStatePanel
          eyebrow="Loading setup"
          title="Checking teams and saved sessions."
          body="The session builder needs the club team list before a training or match block can be created."
          action="This usually takes a moment."
        />
      ) : teams.length === 0 ? (
        <SessionStatePanel
          eyebrow="Setup required"
          title="Create a team before planning sessions."
          body="Sessions must belong to a real football group so player queues, notes, and development records stay in the right workspace."
          action="Go to Teams and create the first team, then return here."
        />
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
