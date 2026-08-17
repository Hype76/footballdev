import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ActiveUsersSection } from '../components/user-access/ActiveUsersSection.jsx'
import { AllocateRoleSection } from '../components/user-access/AllocateRoleSection.jsx'
import { PendingAllocationsSection } from '../components/user-access/PendingAllocationsSection.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { useToast } from '../components/ui/toast-context.js'
import { canAssignRole, canManageUsers, getRoleLabel, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { createLimitUpgradeMessage, isWithinPlanLimit } from '../lib/plans.js'
import { initialUserAccessFormState, INVITE_PAGE_SIZE, MEMBER_PAGE_SIZE } from '../hooks/user-access/userAccessUtils.js'
import {
  canRemoveClubUser,
  canUpdateClubUserName,
  assignClubUserRole,
  createStaffInvite,
  createClubRole,
  deleteClubInvite,
  getClubRoles,
  getClubUserInvites,
  getVisibleClubUsers,
  getTeamStaffAssignments,
  getTeams,
  removeClubUser,
  readViewCacheValue,
  updateClubUserName,
  changeStaffRoleAssignment,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'
import { getPermittedTeamRoleOptions } from '../lib/team-staff-role-policy.js'

const staffAccessRules = [
  {
    label: 'Smallest useful role',
    body: 'Give every coach the lowest role that lets them complete their football work this week.',
  },
  {
    label: 'One email owns access',
    body: 'Invites and existing logins are matched by email, so each Coach should use one address.',
  },
  {
    label: 'Keep access current',
    body: 'Lower or remove access when Coaches change teams, stop coaching, or leave the club.',
  },
]

const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] shadow-sm shadow-[#047857]/10'
const safeTeamRoleDenialCategories = new Set([
  'assignment_inactive',
  'cross_club_target',
  'final_team_admin',
  'grant_ceiling_exceeded',
  'protected_assignment',
  'role_not_supported',
  'target_above_grant_ceiling',
  'team_scope_forbidden',
])

function getSafeTeamRoleErrorMessage(error) {
  if (safeTeamRoleDenialCategories.has(String(error?.code ?? '')) && String(error?.message ?? '').trim()) {
    return error.message
  }

  return 'Could not update the team role. The assignment may be protected or outside your authority.'
}

export function UserAccessPage() {
  const { refreshTeamSelection, user } = useAuth()
  const { showToast } = useToast()
  const accessScope =
    user?.role === 'admin' || user?.role === 'super_admin'
      ? 'club'
      : `${user?.id || 'user'}:${user?.activeTeamId || 'assigned'}`
  const cacheKey = user?.clubId ? `user-access:${user.clubId}:${accessScope}` : ''
  const [roles, setRoles] = useState(() => {
    const cachedRoles = readViewCacheValue(cacheKey, 'roles', [])
    return Array.isArray(cachedRoles) ? cachedRoles : []
  })
  const [members, setMembers] = useState(() => {
    const cachedMembers = readViewCacheValue(cacheKey, 'members', [])
    return Array.isArray(cachedMembers) ? cachedMembers : []
  })
  const [pendingInvites, setPendingInvites] = useState(() => {
    const cachedInvites = readViewCacheValue(cacheKey, 'pendingInvites', [])
    return Array.isArray(cachedInvites) ? cachedInvites : []
  })
  const [teams, setTeams] = useState(() => {
    const cachedTeams = readViewCacheValue(cacheKey, 'teams', [])
    return Array.isArray(cachedTeams) ? cachedTeams : []
  })
  const [assignments, setAssignments] = useState(() => {
    const cachedAssignments = readViewCacheValue(cacheKey, 'assignments', [])
    return Array.isArray(cachedAssignments) ? cachedAssignments : []
  })
  const [formState, setFormState] = useState(initialUserAccessFormState)
  const [isLoading, setIsLoading] = useState(() => roles.length === 0 && members.length === 0 && pendingInvites.length === 0)
  const [isSaving, setIsSaving] = useState(false)
  const [nameDrafts, setNameDrafts] = useState({})
  const [memberPage, setMemberPage] = useState(1)
  const [invitePage, setInvitePage] = useState(1)
  const [inviteDeleteTarget, setInviteDeleteTarget] = useState(null)
  const [memberRemoveTarget, setMemberRemoveTarget] = useState(null)
  const [clubRoleChangeTarget, setClubRoleChangeTarget] = useState(null)
  const [roleChangeTarget, setRoleChangeTarget] = useState(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true

    const loadAccessData = async () => {
      setErrorMessage('')

      try {
        const [rolesResult, membersResult, invitesResult, teamsResult, assignmentsResult] = await Promise.allSettled([
          withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
          withRequestTimeout(() => getVisibleClubUsers(user), 'Could not load active users.'),
          user?.role === 'admin' || user?.role === 'super_admin'
            ? withRequestTimeout(() => getClubUserInvites(user), 'Could not load pending allocations.')
            : Promise.resolve([]),
          withRequestTimeout(() => getTeams(user), 'Could not load team names.'),
          withRequestTimeout(() => getTeamStaffAssignments(user), 'Could not load team assignments.'),
        ])

        if (!isMounted) {
          return
        }

        const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value : []
        const nextMembers = membersResult.status === 'fulfilled' ? membersResult.value : []
        const nextInvites = invitesResult.status === 'fulfilled' ? invitesResult.value : []
        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : []
        const nextAssignments = assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : []
        const hasFailure =
          rolesResult.status === 'rejected' ||
          membersResult.status === 'rejected' ||
          invitesResult.status === 'rejected' ||
          teamsResult.status === 'rejected' ||
          assignmentsResult.status === 'rejected'

        if (rolesResult.status === 'rejected') {
          console.error(rolesResult.reason)
        }

        if (membersResult.status === 'rejected') {
          console.error(membersResult.reason)
        }

        if (invitesResult.status === 'rejected') {
          console.error(invitesResult.reason)
        }

        if (teamsResult.status === 'rejected') {
          console.error(teamsResult.reason)
        }

        if (assignmentsResult.status === 'rejected') {
          console.error(assignmentsResult.reason)
        }

        setRoles(nextRoles)
        setMembers(nextMembers)
        setPendingInvites(nextInvites)
        setTeams(nextTeams)
        setAssignments(nextAssignments)
        setNameDrafts(Object.fromEntries(nextMembers.map((member) => [member.id, member.name || ''])))
        writeViewCache(cacheKey, {
          roles: nextRoles,
          members: nextMembers,
          pendingInvites: nextInvites,
          teams: nextTeams,
          assignments: nextAssignments,
        })
        setFormState((current) => ({
          ...current,
          roleKey: current.roleKey || nextRoles.find((role) => canAssignRole(user, role))?.roleKey || '',
        }))

        if (hasFailure) {
          setErrorMessage('Some club access data could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadAccessData()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, user, userScopeKey])

  const assignableRoles = useMemo(
    () => roles.filter((role) => canAssignRole(user, role)),
    [roles, user],
  )
  const membersWithTeamAssignments = useMemo(() => {
    const teamNames = new Map(teams.map((team) => [String(team.id), team.name]))
    const actorAssignments = new Map(
      assignments
        .filter((assignment) => String(assignment.userId) === String(user?.id))
        .map((assignment) => [String(assignment.teamId), assignment]),
    )
    const isClubScope = user?.role === 'admin' || user?.role === 'super_admin'

    return members.map((member) => ({
      ...member,
      clubRoleOptions:
        isClubScope &&
        String(member.id) !== String(user?.id) &&
        member.role !== 'super_admin'
          ? roles.filter((role) => canAssignRole(user, role))
          : [],
      teamAssignments: assignments
        .filter((assignment) =>
          !String(assignment.userId).startsWith('invite:') &&
          String(assignment.userId) === String(member.id) &&
          (isClubScope || String(assignment.teamId) === String(user?.activeTeamId)),
        )
        .map((assignment) => ({
          assignmentId: assignment.id,
          teamId: assignment.teamId,
          teamName: teamNames.get(String(assignment.teamId)) || 'Assigned team',
          teamRoleKey: assignment.roleKey,
          teamRoleLabel: assignment.roleLabel,
          teamRoleRank: assignment.roleRank,
          roleOptions: getPermittedTeamRoleOptions({
            roles,
            user,
            assignment: actorAssignments.get(String(assignment.teamId)),
          }),
        }))
        .sort((left, right) => left.teamName.localeCompare(right.teamName)),
    }))
  }, [assignments, members, roles, teams, user])
  const paginatedMembers = useMemo(
    () => getPaginatedItems(membersWithTeamAssignments, memberPage, MEMBER_PAGE_SIZE),
    [memberPage, membersWithTeamAssignments],
  )
  const paginatedInvites = useMemo(
    () => getPaginatedItems(pendingInvites, invitePage, INVITE_PAGE_SIZE),
    [invitePage, pendingInvites],
  )
  const activeAndPendingEmailCount = useMemo(() => {
    const emails = new Set()

    members.forEach((member) => {
      const email = String(member.email ?? '').trim().toLowerCase()
      if (email) {
        emails.add(email)
      }
    })

    pendingInvites.forEach((invite) => {
      const email = String(invite.email ?? '').trim().toLowerCase()
      if (email) {
        emails.add(email)
      }
    })

    return emails.size
  }, [members, pendingInvites])
  const canAddMoreUsers = isWithinPlanLimit(user, 'staffLogins', activeAndPendingEmailCount)
  const staffLimitMessage = createLimitUpgradeMessage(user, 'staffLogins', 'Coach logins')
  const pendingAccessCount = pendingInvites.length
  const visibleRoleCount = assignableRoles.length
  const scopeLabel = user?.activeTeamName || (accessScope === 'club' ? 'Whole club' : 'Assigned teams')
  const canManagePendingAllocations = user?.role === 'admin' || user?.role === 'super_admin'

  if (!canManageUsers(user)) {
    return <Navigate to="/" replace />
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setMessage('')
    setErrorMessage('')
    setFormState((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const refreshAccessData = async () => {
    const [rolesResult, membersResult, invitesResult, teamsResult, assignmentsResult] = await Promise.allSettled([
      withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
      withRequestTimeout(() => getVisibleClubUsers(user), 'Could not load active users.'),
      canManagePendingAllocations
        ? withRequestTimeout(() => getClubUserInvites(user), 'Could not load pending allocations.')
        : Promise.resolve([]),
      withRequestTimeout(() => getTeams(user), 'Could not load team names.'),
      withRequestTimeout(() => getTeamStaffAssignments(user), 'Could not load team assignments.'),
    ])

    const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value : []
    const nextMembers = membersResult.status === 'fulfilled' ? membersResult.value : []
    const nextInvites = invitesResult.status === 'fulfilled' ? invitesResult.value : []
    const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : []
    const nextAssignments = assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : []

    if (rolesResult.status === 'rejected') {
      console.error(rolesResult.reason)
    }

    if (membersResult.status === 'rejected') {
      console.error(membersResult.reason)
    }

    if (invitesResult.status === 'rejected') {
      console.error(invitesResult.reason)
    }

    if (teamsResult.status === 'rejected') {
      console.error(teamsResult.reason)
    }

    if (assignmentsResult.status === 'rejected') {
      console.error(assignmentsResult.reason)
    }

    setRoles(nextRoles)
    setMembers(nextMembers)
    setPendingInvites(nextInvites)
    setTeams(nextTeams)
    setAssignments(nextAssignments)
    setNameDrafts(Object.fromEntries(nextMembers.map((member) => [member.id, member.name || ''])))
    writeViewCache(cacheKey, {
      roles: nextRoles,
      members: nextMembers,
      pendingInvites: nextInvites,
      teams: nextTeams,
      assignments: nextAssignments,
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      if (!canAddMoreUsers) {
        throw new Error(staffLimitMessage)
      }

      let selectedRole = assignableRoles.find((role) => role.roleKey === formState.roleKey)

      if (formState.roleKey === '__custom__') {
        if (!formState.customRoleLabel.trim()) {
          throw new Error('Add a custom role name first.')
        }

        selectedRole = await createClubRole({
          user,
          label: formState.customRoleLabel,
          rank: 10,
        })
      }

      if (!selectedRole || !canAssignRole(user, selectedRole)) {
        throw new Error('You cannot assign that role.')
      }

      const createdStaff = await createStaffInvite({
        user,
        email: formState.email,
        role: selectedRole,
        teamId: user?.activeTeamId || '',
      })

      await refreshAccessData()
      setFormState({
        email: '',
        roleKey: assignableRoles[0]?.roleKey || '',
        customRoleLabel: '',
      })
      setMessage(createdStaff.kind === 'invite' ? 'Role invite sent.' : 'User access updated.')
      showToast({
        title: createdStaff.kind === 'invite' ? 'Role invite sent' : 'User access updated',
        message: createdStaff.kind === 'invite'
          ? `${formState.email} has been sent a Coach invite.`
          : `${formState.email} can now access this workspace.`,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not update user access.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteInvite = async (invite) => {
    setInviteDeleteTarget(invite)
  }

  const confirmDeleteInvite = async (password) => {
    if (!inviteDeleteTarget) {
      return
    }

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deleteClubInvite(inviteDeleteTarget.id)
      await refreshAccessData()
      setMessage('Pending access removed.')
      showToast({ title: 'Pending access removed', message: 'The saved allocation has been removed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not remove the pending allocation.')
    } finally {
      setIsSaving(false)
      setInviteDeleteTarget(null)
    }
  }

  const handleRemoveMember = async (member) => {
    if (!canRemoveClubUser(user, member)) {
      setErrorMessage('You can only remove users at your role level or below.')
      return
    }

    setMemberRemoveTarget(member)
  }

  const confirmRemoveMember = async (password) => {
    if (!memberRemoveTarget) {
      return
    }

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await removeClubUser({
        user,
        member: memberRemoveTarget,
      })
      await refreshAccessData()
      setMessage('User removed from this club.')
      showToast({ title: 'User access removed', message: 'The user has been removed from this club.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not remove this user.')
    } finally {
      setIsSaving(false)
      setMemberRemoveTarget(null)
    }
  }

  const handleNameDraftChange = (memberId, value) => {
    setMessage('')
    setErrorMessage('')
    setNameDrafts((current) => ({
      ...current,
      [memberId]: value,
    }))
  }

  const handleUpdateMemberName = async (member) => {
    if (!canUpdateClubUserName(user, member)) {
      setErrorMessage('You can only update names for users at your role level or below.')
      return
    }

    const nextName = String(nameDrafts[member.id] ?? '').trim()

    if (!nextName) {
      setErrorMessage('Enter a name before saving.')
      return
    }

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      const updatedMember = await updateClubUserName({
        user,
        member,
        name: nextName,
      })

      setMembers((current) => current.map((currentMember) => (currentMember.id === updatedMember.id ? updatedMember : currentMember)))
      setNameDrafts((current) => ({
        ...current,
        [updatedMember.id]: updatedMember.name || '',
      }))
      await refreshAccessData()
      setMessage('User name updated.')
      showToast({ title: 'User saved', message: `${updatedMember.name || 'User'} has been updated.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not update this user name.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRoleChangeRequest = (member, assignment, nextRole) => {
    if (!assignment?.assignmentId || !assignment?.teamId || !nextRole?.roleKey) {
      setErrorMessage('This Coach assignment is incomplete. Refresh user access and try again.')
      return
    }

    setMessage('')
    setErrorMessage('')
    setRoleChangeTarget({ assignment, member, nextRole })
  }

  const handleClubRoleChangeRequest = (member, nextRole) => {
    if (!member?.id || !member?.email || !nextRole?.roleKey) {
      setErrorMessage('This club assignment is incomplete. Refresh user access and try again.')
      return
    }

    setMessage('')
    setErrorMessage('')
    setClubRoleChangeTarget({ member, nextRole })
  }

  const confirmClubRoleChange = async (password) => {
    if (!clubRoleChangeTarget) {
      return
    }

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await assignClubUserRole({
        user,
        email: clubRoleChangeTarget.member.email,
        role: clubRoleChangeTarget.nextRole,
      })
      await refreshAccessData()
      await refreshTeamSelection?.()
      setMessage('Club Coach role updated.')
      showToast({
        title: 'Club role updated',
        message: `${clubRoleChangeTarget.member.name || clubRoleChangeTarget.member.email} is now ${clubRoleChangeTarget.nextRole.roleLabel}.`,
      })
    } catch (error) {
      console.error(error)
      const safeMessage = 'Could not update the club role. The role may be protected or outside your authority.'
      setErrorMessage(safeMessage)
      showToast({ title: 'Club role not updated', message: safeMessage, tone: 'error' })
    } finally {
      setIsSaving(false)
      setClubRoleChangeTarget(null)
    }
  }

  const confirmRoleChange = async (password) => {
    if (!roleChangeTarget) {
      return
    }

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await changeStaffRoleAssignment({
        user,
        assignmentId: roleChangeTarget.assignment.assignmentId,
        roleKey: roleChangeTarget.nextRole.roleKey,
        requestSource: 'user_access',
      })
      await refreshAccessData()
      await refreshTeamSelection?.()
      setMessage('Team Coach role updated.')
      showToast({
        title: 'Team role updated',
        message: `${roleChangeTarget.member.name || roleChangeTarget.member.email || 'Coach'} is now ${roleChangeTarget.nextRole.roleLabel} for ${roleChangeTarget.assignment.teamName}.`,
      })
    } catch (error) {
      console.error(error)
      const safeMessage = getSafeTeamRoleErrorMessage(error)
      setErrorMessage(safeMessage)
      showToast({
        title: 'Team role not updated',
        message: safeMessage,
        tone: 'error',
      })
    } finally {
      setIsSaving(false)
      setRoleChangeTarget(null)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Coach access</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black leading-[1.04] tracking-tight text-[#101828] sm:text-4xl">
              Give Coach access only where the work needs it.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
              Invite coaches by email, assign the smallest useful role, and keep workspace access tidy as responsibilities change.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {staffAccessRules.map((rule) => (
                <div key={rule.label} className={`${panelClass} px-4 py-4`}>
                  <p className="text-sm font-black text-[#101828]">{rule.label}</p>
                  <p className={`mt-2 ${bodyTextClass}`}>{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-5 shadow-sm shadow-[#047857]/10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Access state</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{activeAndPendingEmailCount} Coach emails tracked</p>
              <p className={`mt-2 ${bodyTextClass}`}>
                Scope: {scopeLabel}. {members.length} active users are visible to this account.
                {canManagePendingAllocations ? ` ${pendingAccessCount} pending invites are visible.` : ''}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <AccessMetric label="Active" value={members.length} />
              {canManagePendingAllocations ? <AccessMetric label="Pending" value={pendingAccessCount} /> : null}
              <AccessMetric label="Roles" value={visibleRoleCount} />
              <AccessMetric label="Plan count" value={activeAndPendingEmailCount} />
            </div>
            <p className={`mt-4 ${bodyTextClass}`}>
              {canAddMoreUsers ? 'Coach invite capacity is available.' : staffLimitMessage}
            </p>
          </div>
        </div>
      </section>

      {message ? (
        <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#065f46] shadow-sm shadow-[#047857]/10">
          {message}
        </div>
      ) : null}

      {errorMessage ? (
        <NoticeBanner
          title="User access action failed"
          message={errorMessage}
        />
      ) : null}

      <AllocateRoleSection
        assignableRoles={assignableRoles}
        canAddMoreUsers={canAddMoreUsers}
        formState={formState}
        isLoading={isLoading}
        isSaving={isSaving}
        onChange={handleChange}
        onSubmit={handleSubmit}
        staffLimitMessage={staffLimitMessage}
      />

      <ActiveUsersSection
        isLoading={isLoading}
        isSaving={isSaving}
        memberPage={memberPage}
        members={members}
        nameDrafts={nameDrafts}
        onMemberPageChange={setMemberPage}
        onNameDraftChange={handleNameDraftChange}
        onClubRoleChangeRequest={handleClubRoleChangeRequest}
        onRemoveMember={handleRemoveMember}
        onRoleChangeRequest={handleRoleChangeRequest}
        onUpdateMemberName={handleUpdateMemberName}
        pageSize={MEMBER_PAGE_SIZE}
        paginatedMembers={paginatedMembers}
        user={user}
      />

      {canManagePendingAllocations ? (
        <PendingAllocationsSection
          invitePage={invitePage}
          isLoading={isLoading}
          isSaving={isSaving}
          onDeleteInvite={handleDeleteInvite}
          onInvitePageChange={setInvitePage}
          pageSize={INVITE_PAGE_SIZE}
          paginatedInvites={paginatedInvites}
          pendingInvites={pendingInvites}
        />
      ) : null}

      <ConfirmModal
        isOpen={Boolean(clubRoleChangeTarget)}
        isBusy={isSaving}
        title="Confirm club role change"
        message="Review the Coach, current club role, new club role, and access consequence before confirming. Team assignments remain independent."
        itemsTitle="Role change details"
        items={[
          `Coach: ${clubRoleChangeTarget?.member?.name || clubRoleChangeTarget?.member?.email || 'Selected Coach'}`,
          `Current role: ${clubRoleChangeTarget ? getRoleLabel(clubRoleChangeTarget.member) : 'Unknown role'}`,
          `New role: ${clubRoleChangeTarget?.nextRole?.roleLabel || 'Unknown role'}`,
          `Club scope: ${user?.clubName || 'Current club'}`,
          'Consequence: Club permissions refresh immediately after confirmation.',
          'Team assignments: Existing team roles remain unchanged.',
          'Notification: No Coach email or notification will be sent.',
        ]}
        confirmLabel="Confirm club role change"
        onCancel={() => setClubRoleChangeTarget(null)}
        requirePassword
        onConfirm={(password) => confirmClubRoleChange(password)}
      />

      <ConfirmModal
        isOpen={Boolean(roleChangeTarget)}
        isBusy={isSaving}
        title="Confirm team role change"
        message="Review the Coach, current role, new role, team scope, and access consequence before confirming."
        itemsTitle="Role change details"
        items={[
          `Coach: ${roleChangeTarget?.member?.name || roleChangeTarget?.member?.email || 'Selected Coach'}`,
          `Current role: ${roleChangeTarget?.assignment?.teamRoleLabel || 'Unknown role'}`,
          `New role: ${roleChangeTarget?.nextRole?.roleLabel || 'Unknown role'}`,
          `Team scope: ${roleChangeTarget?.assignment?.teamName || 'Unknown team'}`,
          'Consequence: Team permissions refresh immediately after confirmation.',
          'Notification: No Coach email or notification will be sent.',
        ]}
        confirmLabel="Confirm role change"
        onCancel={() => setRoleChangeTarget(null)}
        requirePassword
        onConfirm={(password) => confirmRoleChange(password)}
      />

      <ConfirmModal
        isOpen={Boolean(memberRemoveTarget)}
        isBusy={isSaving}
        title="Remove user access"
        message="This removes the user from this club workspace. It does not delete their email account from the authentication provider."
        items={[
          `User: ${memberRemoveTarget?.name || memberRemoveTarget?.email || 'Selected user'}`,
          `Email: ${memberRemoveTarget?.email || 'No email entered'}`,
          `Role: ${memberRemoveTarget ? getRoleLabel(memberRemoveTarget) : 'Unknown role'}`,
        ]}
        confirmLabel="Remove user"
        onCancel={() => setMemberRemoveTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmRemoveMember(password)}
      />

      <ConfirmModal
        isOpen={Boolean(inviteDeleteTarget)}
        isBusy={isSaving}
        title="Remove pending access"
        message="This removes the saved invite or pending allocation."
        items={[
          `Email: ${inviteDeleteTarget?.email || 'No email entered'}`,
          `Role: ${inviteDeleteTarget?.roleLabel || 'No role entered'}`,
        ]}
        confirmLabel="Remove pending access"
        onCancel={() => setInviteDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteInvite(password)}
      />
    </div>
  )
}

function AccessMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{value}</p>
    </div>
  )
}
