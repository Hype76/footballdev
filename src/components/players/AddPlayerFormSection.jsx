import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { CONTACT_TYPE_OPTIONS } from '../../hooks/players/addPlayerUtils.js'
import { PlayerStatePanel } from './PlayerStatePanel.jsx'

const fieldClass = 'min-h-12 w-full rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 text-sm font-bold text-[#0f172a] outline-none transition placeholder:text-[#64748b] focus:border-[#2563eb] focus:ring-2 focus:ring-[#cbd5e1]'
const labelClass = 'mb-2 block text-sm font-black text-[#0f172a]'
const secondaryButtonClass = 'inline-flex items-center justify-center rounded-lg border border-[#cbd5e1] bg-white text-sm font-black text-[#0f172a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#2563eb] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60'

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
    <section
      data-tour-id="add-player-form-section"
      className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10"
    >
      <div className="border-b border-[#cbd5e1] bg-[#f8fafc] px-5 py-5 sm:px-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">Player details</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#0f172a]">Create the football record</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#475569]">
              {canAddMorePlayers ? 'Add the player once, then use their profile for development records, parent links, and match day work.' : playerLimitMessage}
            </p>
          </div>
          <span className="inline-flex min-h-10 w-fit items-center rounded-lg border border-[#cbd5e1] bg-white px-4 text-sm font-black text-[#0f172a]">
            Trial or Squad
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="m-5 sm:m-6">
          <PlayerStatePanel
            action="This usually takes a moment."
            body="The player form needs the team list before a footballer can be saved into Trial or Squad."
            eyebrow="Loading player setup"
            title="Checking teams and player capacity."
          />
        </div>
      ) : availableTeams.length === 0 ? (
        <div className="m-5 sm:m-6">
          <PlayerStatePanel
            action="Go to Teams, create the first team, then return here."
            body="Players need a real team so parent links, sessions, match day, and development records stay in the right football workspace."
            eyebrow="Setup required"
            title="Create a team before adding players."
          />
        </div>
      ) : (
        <form className="grid gap-5 px-5 py-5 sm:px-6 md:grid-cols-2 xl:grid-cols-4" onSubmit={onAddPlayer}>
          <label className="block xl:col-span-2">
            <span className={labelClass}>Player name</span>
            <input
              type="text"
              name="playerName"
              value={playerForm.playerName}
              onChange={onChange}
              required
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Shirt number</span>
            <input
              type="text"
              name="shirtNumber"
              value={playerForm.shirtNumber}
              onChange={onChange}
              inputMode="numeric"
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Section</span>
            <select
              name="section"
              value={playerForm.section}
              onChange={onChange}
              className={fieldClass}
            >
              {EVALUATION_SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </label>

          <label className="block xl:col-span-2">
            <span className={labelClass}>Team</span>
            <select
              name="team"
              value={playerForm.teamId || ''}
              onChange={onChange}
              required
              className={fieldClass}
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
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAddingPlayer ? 'Adding...' : 'Add player'}
            </button>
          </div>

          <div className="md:col-span-2 xl:col-span-4">
            <span className={labelClass}>Primary contact type</span>
            <div className="grid gap-3 md:grid-cols-3">
              {CONTACT_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-12 items-start gap-3 rounded-lg border px-4 py-3 text-sm font-semibold transition ${
                    normalizedContactType === option.value
                      ? 'border-[#2563eb] bg-[#eff6ff] text-[#0f172a] shadow-sm shadow-[#2563eb]/10'
                      : 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569] shadow-sm shadow-[#2563eb]/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="contactType"
                    value={option.value}
                    checked={normalizedContactType === option.value}
                    onChange={onChange}
                    className="mt-1 h-4 w-4 accent-[#2563eb]"
                  />
                  <span>
                    <span className="block font-black text-[#0f172a]">{option.label}</span>
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
                    <span className="block text-sm font-black text-[#0f172a]">{group.title}</span>
                    <span className="mt-1 block text-xs font-semibold leading-5 text-[#475569]">{group.description}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddParentContact(group.type)}
                    className={`${secondaryButtonClass} min-h-10 px-3 py-2 text-xs`}
                  >
                    {group.addLabel}
                  </button>
                </div>
                <div className="space-y-3">
                  {contacts.map((contact, index) => (
                    <div key={`${group.type}-${index}`} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-3 shadow-sm shadow-[#2563eb]/10">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-[#475569]">
                            {group.nameLabel}
                          </span>
                          <input
                            type="text"
                            value={contact.name}
                            onChange={(event) => onParentContactChange(group.type, index, 'name', event.target.value)}
                            className={fieldClass}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-[#475569]">
                            {group.emailLabel}
                          </span>
                          <input
                            type="email"
                            value={contact.email}
                            onChange={(event) => onParentContactChange(group.type, index, 'email', event.target.value)}
                            className={fieldClass}
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveParentContact(group.type, index)}
                        className={`${secondaryButtonClass} mt-3 min-h-10 px-3 py-2 text-xs`}
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
            <span className={labelClass}>Player positions</span>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                name="positionDraft"
                value={playerForm.positionDraft}
                onChange={onChange}
                placeholder="Add position, for example Striker"
                className={fieldClass}
              />
              <button
                type="button"
                onClick={onAddPosition}
                className={`${secondaryButtonClass} min-h-12 w-full px-5 py-3 sm:w-auto`}
              >
                Add position
              </button>
            </div>
            {playerForm.positions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {playerForm.positions.map((position) => (
                  <button
                    key={position}
                    type="button"
                    onClick={() => onRemovePosition(position)}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm font-black text-[#0f172a] transition hover:bg-[#eff6ff]"
                  >
                    Remove {position}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs font-bold leading-5 text-[#475569]">Add one or more positions for this player.</p>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
