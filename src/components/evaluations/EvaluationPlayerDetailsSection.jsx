import { formatSessionForInput } from '../../hooks/evaluations/evaluationFormUtils.js'
import { canManageUsers } from '../../lib/auth.js'
import { PLAYER_CONTACT_TYPES } from '../../lib/supabase.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function EvaluationPlayerDetailsSection({
  availableTeams,
  contactLabel,
  contactNoun,
  contactNounPlural,
  evaluationSections,
  formData,
  onFieldChange,
  onToggleParentContact,
  parentContacts,
  readableSession,
  savedPlayers,
  selectedParentContactIndexes,
  user,
}) {
  const selectedSection = String(formData.section ?? '').trim()
  const selectedTeam = String(formData.team ?? '').trim()
  const playerOptions = savedPlayers
    .filter((player) => !selectedSection || player.section === selectedSection)
    .filter((player) => !selectedTeam || player.team === selectedTeam)
    .sort((left, right) => left.playerName.localeCompare(right.playerName))

  return (
    <SectionCard
      storageKey="development-record-player-details-v2"
      title="Player details"
      description="Choose the exact player and team before scoring. This keeps development history, parent messages, and match-day records aligned."
    >
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="block min-w-0">
          <span className="mb-2 block text-sm font-bold text-slate-950">Section</span>
          <select
            name="section"
            value={formData.section}
            onChange={onFieldChange}
            required
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          >
            {evaluationSections.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
        </label>

        <label className="block min-w-0">
          <span className="mb-2 block text-sm font-bold text-slate-950">Team</span>
          <select
            name="team"
            value={formData.team}
            onChange={onFieldChange}
            required
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          >
            <option value="">Select team</option>
            {availableTeams.map((team) => (
              <option key={team.id} value={team.name}>
                {team.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
            {canManageUsers(user)
              ? 'Managers and admins can record development notes against any club team.'
              : 'Choose the team this player record should sit under. Session selection is optional.'}
          </p>
        </label>

        <label className="block min-w-0">
          <span className="mb-2 block text-sm font-bold text-slate-950">Player Name</span>
          <select
            name="playerName"
            value={formData.playerName}
            onChange={onFieldChange}
            required
            disabled={playerOptions.length === 0}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {playerOptions.length === 0 ? `No ${selectedSection || 'matching'} players available` : 'Select player'}
            </option>
            {playerOptions.map((player) => (
              <option key={player.id} value={player.playerName}>
                {player.playerName}
              </option>
            ))}
          </select>
        </label>

        <label className="block min-w-0">
          <span className="mb-2 block text-sm font-bold text-slate-950">Coach</span>
          <input
            type="text"
            name="coachName"
            value={formData.coachName}
            readOnly
            className="min-h-11 w-full rounded-md border border-slate-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none"
          />
        </label>

        <div className="min-w-0 md:col-span-2">
          <span className="mb-2 block text-sm font-bold text-slate-950">{contactLabel} Email Recipients</span>
          {parentContacts.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {parentContacts.map((contact, index) => (
                <label
                  key={`${contact.email || contact.name}-${index}`}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950"
                >
                  <input
                    type="checkbox"
                    checked={selectedParentContactIndexes.includes(index)}
                    onChange={() => onToggleParentContact(index)}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{contact.name || (contact.type === PLAYER_CONTACT_TYPES.self ? 'Player' : 'Parent/Guardian')}</span>
                    <span className="block break-words text-xs text-slate-500">{contact.email || 'No email entered'}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                  {contactLabel} Name
                </span>
                <input
                  type="text"
                  name="parentName"
                  value={formData.parentName}
                  onChange={onFieldChange}
                  className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                  {contactLabel} Email
                </span>
                <input
                  type="email"
                  name="parentEmail"
                  value={formData.parentEmail}
                  onChange={onFieldChange}
                  className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                />
              </label>
            </div>
          )}
          <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
            Selected {contactNounPlural} are used only when this record is sent with a {contactNoun} email template.
          </p>
        </div>

        <label className="block min-w-0">
          <span className="mb-2 block text-sm font-bold text-slate-950">Session</span>
          <input
            type="date"
            name="session"
            value={formatSessionForInput(formData.session)}
            onChange={onFieldChange}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
          <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">Current session: {readableSession}</p>
        </label>
      </div>
    </SectionCard>
  )
}
