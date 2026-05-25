import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { CONTACT_TYPE_OPTIONS } from '../../hooks/players/addPlayerUtils.js'

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
      className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 sm:px-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Player details</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Create the football record</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
              {canAddMorePlayers ? 'Add the player once, then use their profile for development records, parent links, and match day work.' : playerLimitMessage}
            </p>
          </div>
          <span className="inline-flex min-h-10 w-fit items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
            Trial or Squad
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="m-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-600 sm:m-6">
          Loading player setup...
        </div>
      ) : availableTeams.length === 0 ? (
        <div className="m-5 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm font-bold text-slate-600 sm:m-6">
          No teams are available yet. Create a team first, then add players into Trial or Squad.
        </div>
      ) : (
        <form className="grid gap-5 px-5 py-5 sm:px-6 md:grid-cols-2 xl:grid-cols-4" onSubmit={onAddPlayer}>
          <label className="block xl:col-span-2">
            <span className="mb-2 block text-sm font-black text-slate-900">Player name</span>
            <input
              type="text"
              name="playerName"
              value={playerForm.playerName}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-black text-slate-900">Shirt number</span>
            <input
              type="text"
              name="shirtNumber"
              value={playerForm.shirtNumber}
              onChange={onChange}
              inputMode="numeric"
              className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-black text-slate-900">Section</span>
            <select
              name="section"
              value={playerForm.section}
              onChange={onChange}
              className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            >
              {EVALUATION_SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </label>

          <label className="block xl:col-span-2">
            <span className="mb-2 block text-sm font-black text-slate-900">Team</span>
            <select
              name="team"
              value={playerForm.teamId || ''}
              onChange={onChange}
              required
              className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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
              className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAddingPlayer ? 'Adding...' : 'Add player'}
            </button>
          </div>

          <div className="md:col-span-2 xl:col-span-4">
            <span className="mb-2 block text-sm font-black text-slate-900">Primary contact type</span>
            <div className="grid gap-3 md:grid-cols-3">
              {CONTACT_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-12 items-start gap-3 rounded-md border px-4 py-3 text-sm transition ${
                    normalizedContactType === option.value
                      ? 'border-emerald-500 bg-emerald-50 text-slate-950'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="contactType"
                    value={option.value}
                    checked={normalizedContactType === option.value}
                    onChange={onChange}
                    className="mt-1 h-4 w-4 accent-emerald-700"
                  />
                  <span>
                    <span className="block font-black text-slate-950">{option.label}</span>
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
                    <span className="block text-sm font-black text-slate-900">{group.title}</span>
                    <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">{group.description}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddParentContact(group.type)}
                    className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-slate-100"
                  >
                    {group.addLabel}
                  </button>
                </div>
                <div className="space-y-3">
                  {contacts.map((contact, index) => (
                    <div key={`${group.type}-${index}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                            {group.nameLabel}
                          </span>
                          <input
                            type="text"
                            value={contact.name}
                            onChange={(event) => onParentContactChange(group.type, index, 'name', event.target.value)}
                            className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                            {group.emailLabel}
                          </span>
                          <input
                            type="email"
                            value={contact.email}
                            onChange={(event) => onParentContactChange(group.type, index, 'email', event.target.value)}
                            className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveParentContact(group.type, index)}
                        className="mt-3 inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-slate-100"
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
            <span className="mb-2 block text-sm font-black text-slate-900">Player positions</span>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                name="positionDraft"
                value={playerForm.positionDraft}
                onChange={onChange}
                placeholder="Add position, for example Striker"
                className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
              <button
                type="button"
                onClick={onAddPosition}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-slate-100 sm:w-auto"
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
                    className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-black text-slate-950 transition hover:bg-slate-100"
                  >
                    {position} remove
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">Add one or more positions for this player.</p>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
