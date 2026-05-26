export function CreateTeamSection({
  canCreateMoreTeams,
  isSaving,
  newTeamName,
  onCreateTeam,
  onTeamNameChange,
  teamLimitMessage,
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-sm shadow-[#067a46]/10" data-tour-id="create-team-section">
      <div className="border-b border-[#bddcca] bg-[#f6fbf8] px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Step 1 / squad base</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">Create the first team</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#456653]">
          {canCreateMoreTeams
            ? 'Add the team or age group before players, sessions, staff access, and match day records.'
            : teamLimitMessage}
        </p>
      </div>

      <form className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" onSubmit={onCreateTeam}>
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#10231a]">Team name</span>
          <input
            type="text"
            value={newTeamName}
            onChange={(event) => onTeamNameChange(event.target.value)}
            placeholder="U12 Blue, U14 Girls, First Team"
            required
            className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition placeholder:text-[#6b8577] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving || !canCreateMoreTeams}
          title={canCreateMoreTeams ? undefined : teamLimitMessage}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
        >
          Add team
        </button>
      </form>
    </section>
  )
}
