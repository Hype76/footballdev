import { useState } from 'react'
import { getRoleLabel } from '../../lib/auth.js'
import { Pagination } from '../ui/Pagination.jsx'

function getStaffDisplayName(member) {
  return String(member?.name || member?.username || member?.email || 'Unnamed Coach').trim()
}

function getStaffRoleLabel(member) {
  return member?.teamRoleLabel || (member?.pendingInvite ? member.roleLabel : getRoleLabel(member))
}

function StaffStateBadge({ member }) {
  return member?.pendingInvite ? (
    <span className="inline-flex min-h-7 items-center rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 text-xs font-black text-[#9a3412]">
      Pending invited
    </span>
  ) : (
    <span className="inline-flex min-h-7 items-center rounded-lg border border-[#bbf7d0] bg-[#dcfce7] px-3 text-xs font-black text-[#166534]">
      Active
    </span>
  )
}

const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#66756c] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'
const secondaryButtonClass = 'inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] shadow-sm shadow-[#047857]/10'

export function TeamStaffAllocationsSection({
  availableStaff,
  canDeleteTeam,
  canManageStaffAllocations,
  canRenameTeam,
  isLoading,
  isSaving,
  onAddExistingStaff,
  onDeleteTeam,
  onRemoveStaff,
  onRoleChangeRequest,
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
  teamRoleOptions,
  teamRoleAuthorityMessage,
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10" data-tour-id="team-staff-section">
      <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Step 3: Access audit</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Control team access</h2>
        <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
          Select one club team, rename it if needed, then check exactly which Coaches can work inside that team.
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
            Create a new team above before adding players, sessions, Coach access, or match day records.
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
              canDeleteTeam={canDeleteTeam}
              canManageStaffAllocations={canManageStaffAllocations}
              canRenameTeam={canRenameTeam}
              isSaving={isSaving}
              onAddExistingStaff={onAddExistingStaff}
              onDeleteTeam={onDeleteTeam}
              onRemoveStaff={onRemoveStaff}
              onRoleChangeRequest={onRoleChangeRequest}
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
              teamRoleOptions={teamRoleOptions}
              teamRoleAuthorityMessage={teamRoleAuthorityMessage}
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
      <p className={`mt-1 ${bodyTextClass}`}>Choose a Team to manage its Coach access.</p>
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
                {team.staffIds.length} Coaches allocated
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
  canDeleteTeam,
  canManageStaffAllocations,
  canRenameTeam,
  isSaving,
  onAddExistingStaff,
  onDeleteTeam,
  onRemoveStaff,
  onRoleChangeRequest,
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
  teamRoleOptions,
  teamRoleAuthorityMessage,
}) {
  return (
    <div className={`${panelClass} p-4`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          {canRenameTeam ? (
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
          ) : (
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Managed team</p>
              <p className="mt-2 text-xl font-black text-[#101828]">{selectedTeam.name}</p>
            </div>
          )}
          <p className="mt-2 text-sm font-semibold text-[#4b5f55]">
            {selectedTeamStaff.length} Coaches allocated to this team.
          </p>
        </div>
        {canDeleteTeam ? (
          <button
          type="button"
          disabled={isSaving}
          title={isSaving ? 'Please wait while team details are being saved.' : undefined}
          onClick={() => void onDeleteTeam(selectedTeam.id)}
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#f4b6b6] bg-[#fff5f5] px-4 py-3 text-sm font-black text-[#b42318] transition hover:bg-[#ffe4e4] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Delete team
          </button>
        ) : null}
      </div>

      {canManageStaffAllocations ? (
        <AddExistingStaffPanel
          availableStaff={availableStaff}
          isSaving={isSaving}
          onAddExistingStaff={onAddExistingStaff}
          onStaffSearchChange={onStaffSearchChange}
          onStaffToAddChange={onStaffToAddChange}
          staffSearch={staffSearch}
          staffToAddId={staffToAddId}
        />
      ) : null}

      <AllocatedStaffList
        isSaving={isSaving}
        canManageStaffAllocations={canManageStaffAllocations}
        onRemoveStaff={onRemoveStaff}
        onRoleChangeRequest={onRoleChangeRequest}
        onStaffPageChange={onStaffPageChange}
        paginatedSelectedTeamStaff={paginatedSelectedTeamStaff}
        selectedTeamStaff={selectedTeamStaff}
        staffPage={staffPage}
        staffPageSize={staffPageSize}
        teamRoleOptions={teamRoleOptions}
        teamRoleAuthorityMessage={teamRoleAuthorityMessage}
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
      <p className="text-sm font-black text-[#101828]">Add existing Coaches</p>
      <p className={`mt-1 ${bodyTextClass}`}>
        Search active or pending Coaches, then assign the selected person to this team.
      </p>
      <div className="mt-3 grid gap-3">
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#101828]">Search Coaches</span>
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
          <option value="">Select Coach</option>
          {availableStaff.map((member) => (
            <option key={member.id} value={member.id}>
              {getStaffDisplayName(member)}, Email: {member.email}, Role: {getStaffRoleLabel(member)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={isSaving || !staffToAddId}
          title={
            isSaving
              ? 'Please wait while Coach allocation is being saved.'
              : !staffToAddId
                ? 'Select a Coach before adding them to this team.'
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
  canManageStaffAllocations,
  isSaving,
  onRemoveStaff,
  onRoleChangeRequest,
  onStaffPageChange,
  paginatedSelectedTeamStaff,
  selectedTeamStaff,
  staffPage,
  staffPageSize,
  teamRoleOptions,
  teamRoleAuthorityMessage,
}) {
  return (
    <div className="mt-5">
      <p className="text-sm font-black text-[#101828]">Allocated Coaches</p>
      <p className={`mt-1 ${bodyTextClass}`}>{teamRoleAuthorityMessage}</p>
      {selectedTeamStaff.length === 0 ? (
        <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-6 shadow-sm shadow-[#047857]/10">
          <p className="text-sm font-black text-[#101828]">No Coaches are allocated to this team yet.</p>
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
                    {getStaffRoleLabel(member)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StaffStateBadge member={member} />
                    <span className="inline-flex min-h-7 items-center rounded-lg border border-[#bbf7d0] bg-[#dcfce7] px-3 text-xs font-black text-[#166534]">
                      Assigned
                    </span>
                  </div>
                  {!member.pendingInvite ? (
                    <TeamRoleControl
                      key={`${member.assignmentId}:${member.teamRoleKey}`}
                      isSaving={isSaving}
                      member={member}
                      onRoleChangeRequest={onRoleChangeRequest}
                      teamRoleOptions={teamRoleOptions}
                    />
                  ) : null}
                </div>
                {canManageStaffAllocations ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    title={isSaving ? 'Please wait while Coach allocation is being saved.' : undefined}
                    onClick={() => void onRemoveStaff(member.id)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove
                  </button>
                ) : null}
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

function TeamRoleControl({ isSaving, member, onRoleChangeRequest, teamRoleOptions }) {
  const [roleKey, setRoleKey] = useState(member.teamRoleKey || '')
  const grantCeiling = Math.max(0, ...teamRoleOptions.map((role) => Number(role.roleRank ?? 0)))
  const targetAboveGrantCeiling = Number(member.teamRoleRank ?? 0) > grantCeiling
  const selectedRole = teamRoleOptions.find((role) => role.roleKey === roleKey)
  const unchanged = roleKey === member.teamRoleKey

  if (targetAboveGrantCeiling) {
    return (
      <p className="mt-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 text-xs font-semibold leading-5 text-[#4b5f55]">
        This Coach role is above your grant ceiling and cannot be changed from your current team authority.
      </p>
    )
  }

  return (
    <div className="mt-3 grid gap-2">
      <label className="block">
        <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
          Team role
        </span>
        <select
          aria-label={`Team role for ${getStaffDisplayName(member)}`}
          value={roleKey}
          disabled={isSaving || !member.assignmentId}
          onChange={(event) => setRoleKey(event.target.value)}
          className={fieldClass}
        >
          {teamRoleOptions.map((role) => (
            <option key={role.roleKey} value={role.roleKey}>
              {role.roleLabel}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={isSaving || !member.assignmentId || unchanged || !selectedRole}
        title={unchanged ? 'Choose a different role before continuing.' : undefined}
        onClick={() => onRoleChangeRequest(member, selectedRole)}
        className={secondaryButtonClass}
      >
        Review role change
      </button>
    </div>
  )
}
