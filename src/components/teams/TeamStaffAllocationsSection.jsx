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
    <section className="border border-slate-200 bg-white p-5 sm:p-6" data-tour-id="team-staff-section">
      <div className="mb-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Step 3</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Control team access</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Select one club team, rename it if needed, then manage the staff currently allocated to that team.
        </p>
      </div>
      {isLoading ? (
        <div className="border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-600">
          Loading teams...
        </div>
      ) : teamAssignments.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-600">
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
    <div className="border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-black text-slate-950">Club teams</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">Choose a team to manage its staff access.</p>
      <div className="mt-4 space-y-2">
        {paginatedTeams.items.map((team) => {
          const stats = teamStats?.[team.id] ?? { playerCount: 0, assessmentCount: 0 }

          return (
            <button
              key={team.id}
              type="button"
              onClick={() => onSelectedTeamChange(team.id)}
              className={[
                'w-full border px-4 py-3 text-left transition',
                selectedTeam?.id === team.id
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:bg-emerald-50',
              ].join(' ')}
            >
              <span className="block text-sm font-black text-slate-950">{team.name}</span>
              <span className="mt-1 block text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                {team.staffIds.length} staff allocated
              </span>
              <span className="mt-2 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-2">
                <span>{stats.playerCount} players</span>
                <span>{stats.assessmentCount} assessments</span>
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
    <div className="border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-950">Team name</span>
              <input
                type="text"
                value={teamNameDrafts[selectedTeam.id] ?? selectedTeam.name}
                onChange={(event) => onTeamNameDraftChange(selectedTeam.id, event.target.value)}
                className="min-h-12 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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
              className="inline-flex min-h-12 w-full items-center justify-center border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
            >
              Save Name
            </button>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {selectedTeamStaff.length} staff allocated to this team.
          </p>
        </div>
        <button
          type="button"
          disabled={isSaving}
          title={isSaving ? 'Please wait while team details are being saved.' : undefined}
          onClick={() => void onDeleteTeam(selectedTeam.id)}
          className="inline-flex min-h-12 items-center justify-center border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
    <div className="mt-5 border border-slate-200 bg-white p-4">
      <p className="text-sm font-black text-slate-950">Add existing staff</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Search club staff, then add the selected person to this team.
      </p>
      <div className="mt-3 grid gap-3">
        <label className="block">
          <span className="mb-2 block text-sm font-black text-slate-950">Search staff</span>
          <input
            type="search"
            value={staffSearch}
            onChange={(event) => onStaffSearchChange(event.target.value)}
            placeholder="Search by name, email, or role"
            className="min-h-12 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={staffToAddId}
          onChange={(event) => onStaffToAddChange(event.target.value)}
          className="min-h-12 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
          title={
            isSaving
              ? 'Please wait while staff allocation is being saved.'
              : !staffToAddId
                ? 'Select a staff member before adding them to this team.'
                : undefined
          }
          onClick={() => void onAddExistingStaff()}
          className="inline-flex min-h-12 items-center justify-center bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
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
      <p className="text-sm font-black text-slate-950">Allocated staff</p>
      {selectedTeamStaff.length === 0 ? (
        <div className="mt-3 border border-dashed border-slate-300 bg-white px-4 py-6 text-sm font-semibold text-slate-600">
          No staff are allocated to this team yet.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {paginatedSelectedTeamStaff.items.map((member) => (
            <div
              key={member.id}
              className="border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-black text-slate-950">
                    {getStaffDisplayName(member)}
                  </p>
                  <p className="mt-1 break-words text-sm text-slate-600">{member.email}</p>
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                    {getRoleLabel(member)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  title={isSaving ? 'Please wait while staff allocation is being saved.' : undefined}
                  onClick={() => void onRemoveStaff(member.id)}
                  className="inline-flex min-h-11 items-center justify-center border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
