import { formatSessionForInput } from '../../hooks/evaluations/evaluationFormUtils.js'
import { canManageUsers } from '../../lib/auth.js'
import { PLAYER_CONTACT_TYPES } from '../../lib/supabase.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const eyebrowLabelClass = 'mb-2 block text-xs font-black uppercase tracking-[0.12em] text-[#067a46]'
const inputClass = 'min-h-11 w-full rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const helperClass = 'mt-2 text-xs font-semibold leading-5 text-[#667085]'
const contactCardClass = 'flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3 text-sm font-semibold text-[#101828] shadow-sm shadow-slate-200/60'

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
          <span className={labelClass}>Section</span>
          <select
            name="section"
            value={formData.section}
            onChange={onFieldChange}
            required
            className={inputClass}
          >
            {evaluationSections.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
        </label>

        <label className="block min-w-0">
          <span className={labelClass}>Team</span>
          <select
            name="team"
            value={formData.team}
            onChange={onFieldChange}
            required
            className={inputClass}
          >
            <option value="">Select team</option>
            {availableTeams.map((team) => (
              <option key={team.id} value={team.name}>
                {team.name}
              </option>
            ))}
          </select>
          <p className={helperClass}>
            {canManageUsers(user)
              ? 'Managers and admins can record development notes against any club team.'
              : 'Choose the team this player record should sit under. Session selection is optional.'}
          </p>
        </label>

        <label className="block min-w-0">
          <span className={labelClass}>Player Name</span>
          <select
            name="playerName"
            value={formData.playerName}
            onChange={onFieldChange}
            required
            disabled={playerOptions.length === 0}
            className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
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
          <span className={labelClass}>Coach</span>
          <input
            type="text"
            name="coachName"
            value={formData.coachName}
            readOnly
            className="min-h-11 w-full rounded-lg border border-[#abefc6] bg-[#ecfdf3] px-4 py-3 text-sm font-semibold text-[#101828] outline-none"
          />
        </label>

        <div className="min-w-0 md:col-span-2">
          <span className={labelClass}>{contactLabel} Email Recipients</span>
          {parentContacts.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {parentContacts.map((contact, index) => (
                <label
                  key={`${contact.email || contact.name}-${index}`}
                  className={contactCardClass}
                >
                  <input
                    type="checkbox"
                    checked={selectedParentContactIndexes.includes(index)}
                    onChange={() => onToggleParentContact(index)}
                    className="h-4 w-4 accent-[#067a46]"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{contact.name || (contact.type === PLAYER_CONTACT_TYPES.self ? 'Player' : 'Parent/Guardian')}</span>
                    <span className="block break-words text-xs font-semibold text-[#667085]">{contact.email || 'No email entered'}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block min-w-0">
                <span className={eyebrowLabelClass}>
                  {contactLabel} Name
                </span>
                <input
                  type="text"
                  name="parentName"
                  value={formData.parentName}
                  onChange={onFieldChange}
                  className={inputClass}
                />
              </label>
              <label className="block min-w-0">
                <span className={eyebrowLabelClass}>
                  {contactLabel} Email
                </span>
                <input
                  type="email"
                  name="parentEmail"
                  value={formData.parentEmail}
                  onChange={onFieldChange}
                  className={inputClass}
                />
              </label>
            </div>
          )}
          <p className={helperClass}>
            Selected {contactNounPlural} are used only when this record is sent with a {contactNoun} email template.
          </p>
        </div>

        <label className="block min-w-0">
          <span className={labelClass}>Session</span>
          <input
            type="date"
            name="session"
            value={formatSessionForInput(formData.session)}
            onChange={onFieldChange}
            className={inputClass}
          />
          <p className={helperClass}>Current session: {readableSession}</p>
        </label>
      </div>
    </SectionCard>
  )
}
