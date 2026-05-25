export function CreateTeamSection({
  canCreateMoreTeams,
  isSaving,
  newTeamName,
  onCreateTeam,
  onTeamNameChange,
  teamLimitMessage,
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/70" data-tour-id="create-team-section">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Step 1</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Create team</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {canCreateMoreTeams
              ? 'Add the team or age group before players, sessions, and staff allocations.'
              : teamLimitMessage}
          </p>
        </div>
      </div>

      <form className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" onSubmit={onCreateTeam}>
        <label className="block">
          <span className="mb-2 block text-sm font-black text-slate-950">Team name</span>
          <input
            type="text"
            value={newTeamName}
            onChange={(event) => onTeamNameChange(event.target.value)}
            placeholder="U12 Blue"
            required
            className="min-h-12 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving || !canCreateMoreTeams}
          title={canCreateMoreTeams ? undefined : teamLimitMessage}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
        >
          Add team
        </button>
      </form>
    </section>
  )
}
