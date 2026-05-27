import { getRoleLabel } from '../../lib/auth.js'
import { Pagination } from '../ui/Pagination.jsx'

function getStaffDisplayName(member) {
  return String(member?.name || member?.username || member?.email || 'Unnamed staff').trim()
}

const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#66756c] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'
const secondaryButtonClass = 'inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] shadow-sm shadow-[#047857]/10'

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
    <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10" data-tour-id="team-staff-section">
      <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Step 3: Access audit</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Control team access</h2>
        <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
          Select one club team, rename it if needed, then check exactly which staff can work inside that team.
        </p>
      </div>
      {isLoading ? (
        <div className={`${panelClass} m-5 px-4 py-4 text-sm font-semibold text-[#4b5f55] sm:m-6`}>
          Loading teams...
        </div>
      ) : teamAssignments.length === 0 ? (
        <div className={`${panelClass} m-5 px-4 py-6 sm:m-6`}>
          <p className="text-base font-black text-[#101828]">No teams have been created yet.</p>
          <p className={`mt-2 ${bodyTextClass}`}>
            Create the first team above before adding players, sessions, staff access, or match day records.
          </p>
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
    <div className={`${panelClass} p-4`}>
      <p className="text-sm font-black text-[#101828]">Club teams</p>
      <p className={`mt-1 ${bodyTextClass}`}>Choose a team to manage its staff access.</p>
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
                  ? 'border-[#047857] bg-[#ecfdf5] shadow-sm shadow-[#047857]/15'
                  : 'border-[#d7e5dc] bg-white hover:border-[#047857] hover:bg-[#ecfdf5]',
              ].join(' ')}
            >
              <span className="block text-sm font-black text-[#101828]">{team.name}</span>
              <span className="mt-1 block text-xs font-black uppercase tracking-[0.14em] text-[#047857]">
                {team.staffIds.length} staff allocated
              </span>
              <span className="mt-2 grid gap-2 text-xs font-semibold text-[#4b5f55] sm:grid-cols-2">
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
    <div className={`${panelClass} p-4`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Team name</span>
              <input
                type="text"
                value={teamNameDrafts[selectedTeam.id] ?? selectedTeam.name}
                onChange={(event) => onTeamNameDraftChange(selectedTeam.id, event.target.value)}
                className={fieldClass}
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
              className={`${secondaryButtonClass} md:w-auto`}
            >
              Save name
            </button>
          </div>
          <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
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
          Delete team
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
    <div className="mt-5 rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
      <p className="text-sm font-black text-[#101828]">Add existing staff</p>
      <p className={`mt-1 ${bodyTextClass}`}>
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
            className={fieldClass}
          />
        </label>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={staffToAddId}
          onChange={(event) => onStaffToAddChange(event.target.value)}
          className={fieldClass}
        >
          <option value="">Select staff member</option>
          {availableStaff.map((member) => (
            <option key={member.id} value={member.id}>
              {getStaffDisplayName(member)}, Email: {member.email}, Role: {getRoleLabel(member)}
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
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add to team
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
        <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-6 shadow-sm shadow-[#047857]/10">
          <p className="text-sm font-black text-[#101828]">No staff are allocated to this team yet.</p>
          <p className={`mt-2 ${bodyTextClass}`}>
            Add the coach or manager who should see this squad before session work starts.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {paginatedSelectedTeamStaff.items.map((member) => (
            <div
              key={member.id}
              className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-black text-[#101828]">
                    {getStaffDisplayName(member)}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-[#4b5f55]">{member.email}</p>
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#047857]">
                    {getRoleLabel(member)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  title={isSaving ? 'Please wait while staff allocation is being saved.' : undefined}
                  onClick={() => void onRemoveStaff(member.id)}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
