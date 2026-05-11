import { SectionCard } from '../ui/SectionCard.jsx'

export function CreateTeamSection({
  canCreateMoreTeams,
  isSaving,
  newTeamName,
  onCreateTeam,
  onTeamNameChange,
  teamLimitMessage,
}) {
  return (
    <SectionCard
      title="Create team"
      tourId="create-team-section"
      description={
        canCreateMoreTeams
          ? 'Teams become selectable in assessments once created here.'
          : teamLimitMessage
      }
    >
      <form className="max-w-xl space-y-3" onSubmit={onCreateTeam}>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team name</span>
          <input
            type="text"
            value={newTeamName}
            onChange={(event) => onTeamNameChange(event.target.value)}
            placeholder="U12 Blue"
            required
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving || !canCreateMoreTeams}
          title={canCreateMoreTeams ? undefined : teamLimitMessage}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          Add Team
        </button>
      </form>
    </SectionCard>
  )
}
