import { getRoleLabel } from '../../lib/auth.js'
import { Pagination } from '../ui/Pagination.jsx'

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
  teamStats,
  teamNameDrafts,
  teamPage,
  teamPageSize,
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#bfe8cd] bg-white shadow-sm shadow-[#d7eadf]/70" data-tour-id="team-staff-section">
      <div className="border-b border-[#d7eadf] bg-[#f8fdf9] px-5 py-4 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#067a46]">Step 3</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Control team access</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#5f7468]">
          Select one club team, rename it if needed, then manage the staff currently allocated to that team.
        </p>
      </div>
      {isLoading ? (
        <div className="m-5 rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-4 text-sm font-semibold text-[#5f7468] sm:m-6">
          Loading teams...
        </div>
      ) : teamAssignments.length === 0 ? (
        <div className="m-5 rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-4 py-6 text-sm font-semibold text-[#5f7468] sm:m-6">
          No teams created yet.
        </div>
      ) : (
        <div className="grid gap-4 p-5 sm:p-6 xl:grid-cols-[minmax(220px,360px)_minmax(0,1fr)]">
          <TeamList
            onSelectedTeamChange={onSelectedTeamChange}
            onTeamPageChange={onTeamPageChange}
            paginatedTeams={paginatedTeams}
            selectedTeam={selectedTeam}
            teamAssignments={teamAssignments}
            teamStats={teamStats}
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
    </section>
  )
}

function TeamList({
  onSelectedTeamChange,
  onTeamPageChange,
  paginatedTeams,
  selectedTeam,
  teamAssignments,
  teamStats,
  teamPage,
  teamPageSize,
}) {
  return (
    <div className="rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] p-4">
      <p className="text-sm font-black text-[#101828]">Club teams</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-[#5f7468]">Choose a team to manage its staff access.</p>
      <div className="mt-4 space-y-2">
        {paginatedTeams.items.map((team) => {
          const stats = teamStats?.[team.id] ?? { playerCount: 0, assessmentCount: 0 }

          return (
            <button
              key={team.id}
              type="button"
              onClick={() => onSelectedTeamChange(team.id)}
              className={[
                'w-full rounded-lg border px-4 py-3 text-left transition',
                selectedTeam?.id === team.id
                  ? 'border-[#73d99c] bg-[#effbf3] shadow-sm shadow-[#b7efce]'
                  : 'border-[#d7eadf] bg-white hover:border-[#9addb4] hover:bg-[#f8fdf9]',
              ].join(' ')}
            >
              <span className="block text-sm font-black text-[#101828]">{team.name}</span>
              <span className="mt-1 block text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
                {team.staffIds.length} staff allocated
              </span>
              <span className="mt-2 grid gap-2 text-xs font-semibold text-[#5f7468] sm:grid-cols-2">
                <span>{stats.playerCount} players</span>
                <span>{stats.assessmentCount} development records</span>
              </span>
            </button>
          )
        })}
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
    <div className="rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Team name</span>
              <input
                type="text"
                value={teamNameDrafts[selectedTeam.id] ?? selectedTeam.name}
                onChange={(event) => onTeamNameDraftChange(selectedTeam.id, event.target.value)}
                className="min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-white px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#20a464] focus:ring-2 focus:ring-[#d7f8e5]"
              />
            </label>
            <button
              type="button"
              disabled={
                isSaving ||
                String(teamNameDrafts[selectedTeam.id] ?? selectedTeam.name).trim() === selectedTeam.name
              }
              title={
                isSaving
                  ? 'Please wait while team details are being saved.'
                  : String(teamNameDrafts[selectedTeam.id] ?? selectedTeam.name).trim() === selectedTeam.name
                    ? 'Change the team name before saving.'
                    : undefined
              }
              onClick={() => void onSaveTeamName(selectedTeam.id)}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-[#f8fdf9] disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              Save Name
            </button>
          </div>
          <p className="mt-2 text-sm font-semibold text-[#5f7468]">
            {selectedTeamStaff.length} staff allocated to this team.
          </p>
        </div>
        <button
          type="button"
          disabled={isSaving}
          title={isSaving ? 'Please wait while team details are being saved.' : undefined}
          onClick={() => void onDeleteTeam(selectedTeam.id)}
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#f4b6b6] bg-[#fff5f5] px-4 py-3 text-sm font-black text-[#b42318] transition hover:bg-[#ffe4e4] disabled:cursor-not-allowed disabled:opacity-60"
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
    <div className="mt-5 rounded-lg border border-[#d7eadf] bg-white p-4">
      <p className="text-sm font-black text-[#101828]">Add existing staff</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-[#5f7468]">
        Search club staff, then add the selected person to this team.
      </p>
      <div className="mt-3 grid gap-3">
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#101828]">Search staff</span>
          <input
            type="search"
            value={staffSearch}
            onChange={(event) => onStaffSearchChange(event.target.value)}
            placeholder="Search by name, email, or role"
            className="min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
          />
        </label>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={staffToAddId}
          onChange={(event) => onStaffToAddChange(event.target.value)}
          className="min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
        >
          <option value="">Select staff member</option>
          {availableStaff.map((member) => (
            <option key={member.id} value={member.id}>
              {getStaffDisplayName(member)} / {member.email} / {getRoleLabel(member)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={isSaving || !staffToAddId}
          title={
            isSaving
              ? 'Please wait while staff allocation is being saved.'
              : !staffToAddId
                ? 'Select a staff member before adding them to this team.'
                : undefined
          }
          onClick={() => void onAddExistingStaff()}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
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
      <p className="text-sm font-black text-[#101828]">Allocated staff</p>
      {selectedTeamStaff.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-[#9addb4] bg-white px-4 py-6 text-sm font-semibold text-[#5f7468]">
          No staff are allocated to this team yet.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {paginatedSelectedTeamStaff.items.map((member) => (
            <div
              key={member.id}
              className="rounded-lg border border-[#d7eadf] bg-white p-4 shadow-sm shadow-[#d7eadf]/50"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-black text-[#101828]">
                    {getStaffDisplayName(member)}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-[#5f7468]">{member.email}</p>
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
                    {getRoleLabel(member)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  title={isSaving ? 'Please wait while staff allocation is being saved.' : undefined}
                  onClick={() => void onRemoveStaff(member.id)}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
