import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { CONTACT_TYPE_OPTIONS } from '../../hooks/players/addPlayerUtils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function AddPlayerFormSection({
  availableTeams,
  canAddMorePlayers,
  contactGroups,
  isAddingPlayer,
  isLoading,
  normalizedContactType,
  onAddParentContact,
  onAddPlayer,
  onAddPosition,
  onChange,
  onParentContactChange,
  onRemoveParentContact,
  onRemovePosition,
  playerForm,
  playerLimitMessage,
  preparedContacts,
}) {
  return (
    <SectionCard
      title="Player details"
      tourId="add-player-form-section"
      description={canAddMorePlayers ? 'Add the player once, then start assessments from the player profile.' : playerLimitMessage}
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading player setup...
        </div>
      ) : availableTeams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No teams are available yet. Create a team first, then add players into Trial or Squad.
        </div>
      ) : (
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={onAddPlayer}>
          <label className="block xl:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Name</span>
            <input
              type="text"
              name="playerName"
              value={playerForm.playerName}
              onChange={onChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Shirt Number</span>
            <input
              type="text"
              name="shirtNumber"
              value={playerForm.shirtNumber}
              onChange={onChange}
              inputMode="numeric"
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Section</span>
            <select
              name="section"
              value={playerForm.section}
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

          <label className="block xl:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
            <select
              name="team"
              value={playerForm.teamId || ''}
              onChange={onChange}
              required
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="">Select team</option>
              {availableTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isAddingPlayer || !canAddMorePlayers}
              title={canAddMorePlayers ? undefined : playerLimitMessage}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAddingPlayer ? 'Adding...' : 'Add Player'}
            </button>
          </div>

          <div className="md:col-span-2 xl:col-span-4">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Primary Contact Type</span>
            <div className="grid gap-3 md:grid-cols-3">
              {CONTACT_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-11 items-start gap-3 rounded-lg border px-4 py-3 text-sm transition ${
                    normalizedContactType === option.value
                      ? 'border-[var(--accent)] bg-[var(--panel-soft)] text-[var(--text-primary)]'
                      : 'border-[var(--border-color)] bg-[var(--panel-alt)] text-[var(--text-muted)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="contactType"
                    value={option.value}
                    checked={normalizedContactType === option.value}
                    onChange={onChange}
                    className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block font-semibold text-[var(--text-primary)]">{option.label}</span>
                    <span className="mt-1 block text-xs leading-5">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {contactGroups.map((group) => {
            const contacts = preparedContacts.filter((contact) => contact.type === group.type)

            return (
              <div key={group.type} className="md:col-span-2 xl:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <span className="block text-sm font-semibold text-[var(--text-primary)]">{group.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{group.description}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddParentContact(group.type)}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                  >
                    {group.addLabel}
                  </button>
                </div>
                <div className="space-y-3">
                  {contacts.map((contact, index) => (
                    <div key={`${group.type}-${index}`} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                            {group.nameLabel}
                          </span>
                          <input
                            type="text"
                            value={contact.name}
                            onChange={(event) => onParentContactChange(group.type, index, 'name', event.target.value)}
                            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                            {group.emailLabel}
                          </span>
                          <input
                            type="email"
                            value={contact.email}
                            onChange={(event) => onParentContactChange(group.type, index, 'email', event.target.value)}
                            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveParentContact(group.type, index)}
                        className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                      >
                        {group.removeLabel}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          <div className="md:col-span-2 xl:col-span-4">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Positions</span>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                name="positionDraft"
                value={playerForm.positionDraft}
                onChange={onChange}
                placeholder="Add position, for example Striker"
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={onAddPosition}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
              >
                Add Position
              </button>
            </div>
            {playerForm.positions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {playerForm.positions.map((position) => (
                  <button
                    key={position}
                    type="button"
                    onClick={() => onRemovePosition(position)}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                  >
                    {position} remove
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Add one or more positions for this player.</p>
            )}
          </div>
        </form>
      )}
    </SectionCard>
  )
}
