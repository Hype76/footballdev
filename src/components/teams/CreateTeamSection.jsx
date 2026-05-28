export function CreateTeamSection({
  canCreateMoreTeams,
  isSaving,
  onOpenCreateTeam,
  teamLimitMessage,
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10" data-tour-id="create-team-section">
      <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Step 1: Squad base</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Create the first team</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
          {canCreateMoreTeams
            ? 'Add the team or age group before players, sessions, staff access, and match day records.'
            : teamLimitMessage}
        </p>
      </div>

      <div className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <p className="text-sm font-semibold leading-6 text-[#4b5f55]">
          Keep team creation focused. Add the team name first, then assign staff and players after the team exists.
        </p>
        <button
          type="button"
          onClick={onOpenCreateTeam}
          disabled={isSaving || !canCreateMoreTeams}
          title={canCreateMoreTeams ? undefined : teamLimitMessage}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
        >
          Add team
        </button>
      </div>
    </section>
  )
}
