import { useState } from 'react'
import { canRemoveClubUser, canUpdateClubUserName } from '../../lib/supabase.js'
import { getRoleLabel } from '../../lib/auth.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const bodyTextClass = 'text-sm font-semibold text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] shadow-sm shadow-[#047857]/10'
const fieldClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-bold text-[#101828] outline-none transition focus:border-[#047857] focus:ring-2 focus:ring-[#d1fae5]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'

export function ActiveUsersSection({
  isLoading,
  isSaving,
  memberPage,
  members,
  nameDrafts,
  onClubRoleChangeRequest,
  onMemberPageChange,
  onNameDraftChange,
  onRemoveMember,
  onRoleChangeRequest,
  onUpdateMemberName,
  pageSize,
  paginatedMembers,
  user,
}) {
  return (
    <SectionCard
      title="Active users"
      tourId="active-users-section"
      description="Review active staff, keep names readable, and manage each accepted team assignment without changing the club profile role."
    >
      {isLoading ? (
        <div className={`${panelClass} px-4 py-4 text-sm font-semibold text-[#4b5f55]`}>
          Loading active users...
        </div>
      ) : members.length === 0 ? (
        <div className={`${panelClass} px-4 py-6 text-sm font-semibold text-[#4b5f55]`}>
          No active users found for this club.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedMembers.items.map((member) => (
            <div
              key={member.id}
              className={`${panelClass} px-4 py-4`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="break-words text-sm font-black text-[#101828]">{member.email}</p>
                  <p className={`mt-1 ${bodyTextClass}`}>{member.name || 'No display name yet'}</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[#047857]">
                    Club role: {getRoleLabel(member)}
                  </div>
                  {canRemoveClubUser(user, member) ? (
                    <button
                      type="button"
                      disabled={isSaving}
                      title={isSaving ? 'Please wait while user access is being updated.' : undefined}
                      onClick={() => onRemoveMember(member)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#f2b8b5] bg-[#fff4f3] px-4 py-3 text-sm font-black text-[#9b1c17] transition hover:bg-[#ffe7e5] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              {member.clubRoleOptions?.length ? (
                <ClubRoleControl
                  key={`${member.id}:${member.role}`}
                  isSaving={isSaving}
                  member={member}
                  onClubRoleChangeRequest={onClubRoleChangeRequest}
                />
              ) : null}
              <div className="mt-4 border-t border-[#d7e5dc] pt-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Team assignments</p>
                {member.teamAssignments?.length ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {member.teamAssignments.map((assignment) => (
                      <TeamAssignmentRoleControl
                        key={`${assignment.assignmentId}:${assignment.teamRoleKey}`}
                        assignment={assignment}
                        isSaving={isSaving}
                        member={member}
                        onRoleChangeRequest={onRoleChangeRequest}
                      />
                    ))}
                  </div>
                ) : (
                  <p className={`mt-2 ${bodyTextClass}`}>No accepted team assignment is visible in this access scope.</p>
                )}
              </div>
              {canUpdateClubUserName(user, member) ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
                      Display name
                    </span>
                    <input
                      type="text"
                      value={nameDrafts[member.id] ?? ''}
                      onChange={(event) => onNameDraftChange(member.id, event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={isSaving || String(nameDrafts[member.id] ?? '').trim() === String(member.name ?? '').trim()}
                    title={
                      isSaving
                        ? 'Please wait while user access is being updated.'
                        : String(nameDrafts[member.id] ?? '').trim() === String(member.name ?? '').trim()
                          ? 'Change the display name before saving.'
                          : undefined
                    }
                    onClick={() => onUpdateMemberName(member)}
                    className={secondaryButtonClass}
                  >
                    Save name
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          <Pagination
            currentPage={memberPage}
            onPageChange={onMemberPageChange}
            pageSize={pageSize}
            totalItems={members.length}
          />
        </div>
      )}
    </SectionCard>
  )
}

function ClubRoleControl({ isSaving, member, onClubRoleChangeRequest }) {
  const [roleKey, setRoleKey] = useState(member.role || '')
  const selectedRole = member.clubRoleOptions.find((role) => role.roleKey === roleKey)
  const unchanged = roleKey === member.role

  return (
    <div className="mt-4 grid gap-2 border-t border-[#d7e5dc] pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="block">
        <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Club-level role</span>
        <select
          aria-label={`Club role for ${member.name || member.email || 'staff member'}`}
          value={roleKey}
          disabled={isSaving}
          onChange={(event) => setRoleKey(event.target.value)}
          className={fieldClass}
        >
          {member.clubRoleOptions.map((role) => (
            <option key={role.roleKey} value={role.roleKey}>{role.roleLabel}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={isSaving || unchanged || !selectedRole}
        title={unchanged ? 'Choose a different club role before continuing.' : undefined}
        onClick={() => onClubRoleChangeRequest(member, selectedRole)}
        className={secondaryButtonClass}
      >
        Review club role change
      </button>
    </div>
  )
}

function TeamAssignmentRoleControl({ assignment, isSaving, member, onRoleChangeRequest }) {
  const [roleKey, setRoleKey] = useState(assignment.teamRoleKey || '')
  const selectedRole = assignment.roleOptions.find((role) => role.roleKey === roleKey)
  const unchanged = roleKey === assignment.teamRoleKey
  const grantCeiling = Math.max(0, ...assignment.roleOptions.map((role) => Number(role.roleRank ?? 0)))
  const targetAboveGrantCeiling = Number(assignment.teamRoleRank ?? 0) > grantCeiling

  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-black text-[#101828]">{assignment.teamName}</p>
        <span className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#047857]">
          {assignment.teamRoleLabel || 'Assigned role'}
        </span>
      </div>
      {targetAboveGrantCeiling ? (
        <p className={`mt-3 ${bodyTextClass}`}>
          This assignment is above your grant ceiling and cannot be changed from your current team authority.
        </p>
      ) : assignment.roleOptions.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Team role</span>
            <select
              aria-label={`Team role for ${member.name || member.email || 'staff member'} in ${assignment.teamName}`}
              value={roleKey}
              disabled={isSaving || !assignment.assignmentId}
              onChange={(event) => setRoleKey(event.target.value)}
              className={fieldClass}
            >
              {assignment.roleOptions.map((role) => (
                <option key={role.roleKey} value={role.roleKey}>{role.roleLabel}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={isSaving || !assignment.assignmentId || unchanged || !selectedRole}
            title={unchanged ? 'Choose a different role before continuing.' : undefined}
            onClick={() => onRoleChangeRequest(member, assignment, selectedRole)}
            className={secondaryButtonClass}
          >
            Review role change
          </button>
        </div>
      ) : (
        <p className={`mt-3 ${bodyTextClass}`}>Role changes are unavailable from your current authority.</p>
      )}
    </div>
  )
}
