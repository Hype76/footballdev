import { formatSessionForInput } from '../../hooks/evaluations/evaluationFormUtils.js'
import { canManageUsers } from '../../lib/auth.js'
import { PLAYER_CONTACT_TYPES } from '../../lib/supabase.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function EvaluationPlayerDetailsSection({
  availableTeams,
  contactLabel,
  contactNoun,
  contactNounPlural,
  formData,
  onFieldChange,
  onToggleParentContact,
  parentContacts,
  readableSession,
  savedPlayers,
  selectedParentContactIndexes,
  user,
}) {
  return (
    <SectionCard
      title="Player details"
      description="Core details stay consistent while the club-configured assessment fields adapt below."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Name</span>
          <input
            type="text"
            name="playerName"
            value={formData.playerName}
            onChange={onFieldChange}
            required
            list="saved-player-list"
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
          <datalist id="saved-player-list">
            {savedPlayers.map((player) => (
              <option key={player.id} value={player.playerName} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
          <select
            name="team"
            value={formData.team}
            onChange={onFieldChange}
            required
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          >
            <option value="">Select team</option>
            {availableTeams.map((team) => (
              <option key={team.id} value={team.name}>
                {team.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            {canManageUsers(user)
              ? 'Managers and admins can assess against any club team.'
              : 'Choose the team this assessment should sit under. Session selection is optional.'}
          </p>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Coach</span>
          <input
            type="text"
            name="coachName"
            value={formData.coachName}
            readOnly
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
        </label>

        <div className="md:col-span-2">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">{contactLabel} Email Recipients</span>
          {parentContacts.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {parentContacts.map((contact, index) => (
                <label
                  key={`${contact.email || contact.name}-${index}`}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={selectedParentContactIndexes.includes(index)}
                    onChange={() => onToggleParentContact(index)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{contact.name || (contact.type === PLAYER_CONTACT_TYPES.self ? 'Player' : 'Parent/Guardian')}</span>
                    <span className="block break-words text-xs text-[var(--text-muted)]">{contact.email || 'No email entered'}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {contactLabel} Name
                </span>
                <input
                  type="text"
                  name="parentName"
                  value={formData.parentName}
                  onChange={onFieldChange}
                  className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {contactLabel} Email
                </span>
                <input
                  type="email"
                  name="parentEmail"
                  value={formData.parentEmail}
                  onChange={onFieldChange}
                  className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>
            </div>
          )}
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            Selected {contactNounPlural} are used for {contactNoun} email templates.
          </p>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Session</span>
          <input
            type="date"
            name="session"
            value={formatSessionForInput(formData.session)}
            onChange={onFieldChange}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Current session: {readableSession}</p>
        </label>
      </div>
    </SectionCard>
  )
}
