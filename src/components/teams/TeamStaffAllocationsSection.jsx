import { getRoleLabel } from '../../lib/auth.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

function getStaffDisplayName(member) {
  return String(member?.name || member?.username || member?.email || 'Unnamed staff').trim()
}

export function TeamStaffAllocationsSection({
  availableStaff,
  isLoading,
  isSaving,
  onAddExistingStaff,
  onDeleteTeam,
  onRemoveStaff,
  onSaveTeamName,
  onSelectedTeamChange,
  onStaffPageChange,
  onStaffSearchChange,
  onStaffToAddChange,
  onTeamNameDraftChange,
  onTeamPageChange,
  paginatedSelectedTeamStaff,
  paginatedTeams,
  selectedTeam,
  selectedTeamStaff,
  staffPage,
  staffPageSize,
  staffSearch,
  staffToAddId,
  teamAssignments,
  teamNameDrafts,
  teamPage,
  teamPageSize,
}) {
  return (
    <SectionCard
      title="Team staff allocations"
      tourId="team-staff-section"
      description="Select one club team, then manage the staff currently allocated to that team."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading teams...
        </div>
      ) : teamAssignments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No teams created yet.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(220px,360px)_minmax(0,1fr)]">
          <TeamList
            onSelectedTeamChange={onSelectedTeamChange}
            onTeamPageChange={onTeamPageChange}
            paginatedTeams={paginatedTeams}
            selectedTeam={selectedTeam}
            teamAssignments={teamAssignments}
            teamPage={teamPage}
            teamPageSize={teamPageSize}
          />

          {selectedTeam ? (
            <SelectedTeamPanel
              availableStaff={availableStaff}
              isSaving={isSaving}
              onAddExistingStaff={onAddExistingStaff}
              onDeleteTeam={onDeleteTeam}
              onRemoveStaff={onRemoveStaff}
              onSaveTeamName={onSaveTeamName}
              onStaffPageChange={onStaffPageChange}
              onStaffSearchChange={onStaffSearchChange}
              onStaffToAddChange={onStaffToAddChange}
              onTeamNameDraftChange={onTeamNameDraftChange}
              paginatedSelectedTeamStaff={paginatedSelectedTeamStaff}
              selectedTeam={selectedTeam}
              selectedTeamStaff={selectedTeamStaff}
              staffPage={staffPage}
              staffPageSize={staffPageSize}
              staffSearch={staffSearch}
              staffToAddId={staffToAddId}
              teamNameDrafts={teamNameDrafts}
            />
          ) : null}
        </div>
      )}
    </SectionCard>
  )
}

function TeamList({
  onSelectedTeamChange,
  onTeamPageChange,
  paginatedTeams,
  selectedTeam,
  teamAssignments,
  teamPage,
  teamPageSize,
}) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <p className="text-sm font-semibold text-[var(--text-primary)]">Club teams</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Choose a team to manage its staff access.</p>
      <div className="mt-4 space-y-2">
        {paginatedTeams.items.map((team) => (
          <button
            key={team.id}
            type="button"
            onClick={() => onSelectedTeamChange(team.id)}
            className={[
              'w-full rounded-lg border px-4 py-3 text-left transition',
              selectedTeam?.id === team.id
                ? 'border-[var(--accent)] bg-[var(--panel-soft)]'
                : 'border-[var(--border-color)] bg-[var(--panel-bg)] hover:bg-[var(--panel-soft)]',
            ].join(' ')}
          >
            <span className="block text-sm font-semibold text-[var(--text-primary)]">{team.name}</span>
            <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              {team.staffIds.length} staff allocated
            </span>
          </button>
        ))}
      </div>
      <Pagination
        currentPage={teamPage}
        onPageChange={onTeamPageChange}
        pageSize={teamPageSize}
        totalItems={teamAssignments.length}
      />
    </div>
  )
}

function SelectedTeamPanel({
  availableStaff,
  isSaving,
  onAddExistingStaff,
  onDeleteTeam,
  onRemoveStaff,
  onSaveTeamName,
  onStaffPageChange,
  onStaffSearchChange,
  onStaffToAddChange,
  onTeamNameDraftChange,
  paginatedSelectedTeamStaff,
  selectedTeam,
  selectedTeamStaff,
  staffPage,
  staffPageSize,
  staffSearch,
  staffToAddId,
  teamNameDrafts,
}) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team name</span>
              <input
                type="text"
                value={teamNameDrafts[selectedTeam.id] ?? selectedTeam.name}
                onChange={(event) => onTeamNameDraftChange(selectedTeam.id, event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="button"
              disabled={
                isSaving ||
                String(teamNameDrafts[selectedTeam.id] ?? selectedTeam.name).trim() === selectedTeam.name
              }
              onClick={() => void onSaveTeamName(selectedTeam.id)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              Save Name
            </button>
          </div>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {selectedTeamStaff.length} staff allocated to this team.
          </p>
        </div>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void onDeleteTeam(selectedTeam.id)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Delete Team
        </button>
      </div>

      <AddExistingStaffPanel
        availableStaff={availableStaff}
        isSaving={isSaving}
        onAddExistingStaff={onAddExistingStaff}
        onStaffSearchChange={onStaffSearchChange}
        onStaffToAddChange={onStaffToAddChange}
        staffSearch={staffSearch}
        staffToAddId={staffToAddId}
      />

      <AllocatedStaffList
        isSaving={isSaving}
        onRemoveStaff={onRemoveStaff}
        onStaffPageChange={onStaffPageChange}
        paginatedSelectedTeamStaff={paginatedSelectedTeamStaff}
        selectedTeamStaff={selectedTeamStaff}
        staffPage={staffPage}
        staffPageSize={staffPageSize}
      />
    </div>
  )
}

function AddExistingStaffPanel({
  availableStaff,
  isSaving,
  onAddExistingStaff,
  onStaffSearchChange,
  onStaffToAddChange,
  staffSearch,
  staffToAddId,
}) {
  return (
    <div className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
      <p className="text-sm font-semibold text-[var(--text-primary)]">Add existing staff</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Search club staff, then add the selected person to this team.
      </p>
      <div className="mt-3 grid gap-3">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Search staff</span>
          <input
            type="search"
            value={staffSearch}
            onChange={(event) => onStaffSearchChange(event.target.value)}
            placeholder="Search by name, email, or role"
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={staffToAddId}
          onChange={(event) => onStaffToAddChange(event.target.value)}
          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
        >
          <option value="">Select staff member</option>
          {availableStaff.map((member) => (
            <option key={member.id} value={member.id}>
              {getStaffDisplayName(member)} | {member.email} | {getRoleLabel(member)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={isSaving || !staffToAddId}
          onClick={() => void onAddExistingStaff()}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add To Team
        </button>
      </div>
    </div>
  )
}

function AllocatedStaffList({
  isSaving,
  onRemoveStaff,
  onStaffPageChange,
  paginatedSelectedTeamStaff,
  selectedTeamStaff,
  staffPage,
  staffPageSize,
}) {
  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-[var(--text-primary)]">Allocated staff</p>
      {selectedTeamStaff.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No staff are allocated to this team yet.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {paginatedSelectedTeamStaff.items.map((member) => (
            <div
              key={member.id}
              className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-[var(--text-primary)]">
                    {getStaffDisplayName(member)}
                  </p>
                  <p className="mt-1 break-words text-sm text-[var(--text-muted)]">{member.email}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {getRoleLabel(member)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void onRemoveStaff(member.id)}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination
        currentPage={staffPage}
        onPageChange={onStaffPageChange}
        pageSize={staffPageSize}
        totalItems={selectedTeamStaff.length}
      />
    </div>
  )
}
