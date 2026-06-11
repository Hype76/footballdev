export function CreateTeamSection({
  canCreateMoreTeams,
  hasTeams,
  isSaving,
  onOpenCreateTeam,
  teamLimitMessage,
}) {
  const heading = hasTeams ? 'Manage teams' : 'Create the first team'
  const description = hasTeams
    ? 'Add another team or age group when the club structure changes.'
    : 'Add the team or age group before players, sessions, staff access, and match day records.'
  const buttonLabel = hasTeams ? 'Add another team' : 'Create a new team'

  return (
    <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10" data-tour-id="create-team-section">
      <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Team structure</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{heading}</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
          {canCreateMoreTeams
            ? description
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
          {buttonLabel}
        </button>
      </div>
    </section>
  )
}
