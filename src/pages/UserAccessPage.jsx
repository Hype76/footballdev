import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ActiveUsersSection } from '../components/user-access/ActiveUsersSection.jsx'
import { AllocateRoleSection } from '../components/user-access/AllocateRoleSection.jsx'
import { PendingAllocationsSection } from '../components/user-access/PendingAllocationsSection.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canAssignRole, canManageUsers, getRoleLabel, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { createLimitUpgradeMessage, isWithinPlanLimit } from '../lib/plans.js'
import { initialUserAccessFormState, INVITE_PAGE_SIZE, MEMBER_PAGE_SIZE } from '../hooks/user-access/userAccessUtils.js'
import {
  canRemoveClubUser,
  canUpdateClubUserName,
  createStaffInvite,
  createClubRole,
  deleteClubInvite,
  getClubRoles,
  getClubUserInvites,
  getVisibleClubUsers,
  removeClubUser,
  readViewCacheValue,
  updateClubUserName,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

export function UserAccessPage() {
  const { user } = useAuth()
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
  const [formState, setFormState] = useState(initialUserAccessFormState)
  const [isLoading, setIsLoading] = useState(() => roles.length === 0 && members.length === 0 && pendingInvites.length === 0)
  const [isSaving, setIsSaving] = useState(false)
  const [nameDrafts, setNameDrafts] = useState({})
  const [memberPage, setMemberPage] = useState(1)
  const [invitePage, setInvitePage] = useState(1)
  const [inviteDeleteTarget, setInviteDeleteTarget] = useState(null)
  const [memberRemoveTarget, setMemberRemoveTarget] = useState(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true

    const loadAccessData = async () => {
      setErrorMessage('')

      try {
        const [rolesResult, membersResult, invitesResult] = await Promise.allSettled([
          withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
          withRequestTimeout(() => getVisibleClubUsers(user), 'Could not load active users.'),
          withRequestTimeout(() => getClubUserInvites(user), 'Could not load pending allocations.'),
        ])

        if (!isMounted) {
          return
        }

        const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value : []
        const nextMembers = membersResult.status === 'fulfilled' ? membersResult.value : []
        const nextInvites = invitesResult.status === 'fulfilled' ? invitesResult.value : []
        const hasFailure =
          rolesResult.status === 'rejected' || membersResult.status === 'rejected' || invitesResult.status === 'rejected'

        if (rolesResult.status === 'rejected') {
          console.error(rolesResult.reason)
        }

        if (membersResult.status === 'rejected') {
          console.error(membersResult.reason)
        }

        if (invitesResult.status === 'rejected') {
          console.error(invitesResult.reason)
        }

        setRoles(nextRoles)
        setMembers(nextMembers)
        setPendingInvites(nextInvites)
        setNameDrafts(Object.fromEntries(nextMembers.map((member) => [member.id, member.name || ''])))
        writeViewCache(cacheKey, {
          roles: nextRoles,
          members: nextMembers,
          pendingInvites: nextInvites,
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
  const paginatedMembers = useMemo(
    () => getPaginatedItems(members, memberPage, MEMBER_PAGE_SIZE),
    [memberPage, members],
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
  const staffLimitMessage = createLimitUpgradeMessage(user, 'staffLogins', 'Staff logins')

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
    const [rolesResult, membersResult, invitesResult] = await Promise.allSettled([
      withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
      withRequestTimeout(() => getVisibleClubUsers(user), 'Could not load active users.'),
      withRequestTimeout(() => getClubUserInvites(user), 'Could not load pending allocations.'),
    ])

    const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value : []
    const nextMembers = membersResult.status === 'fulfilled' ? membersResult.value : []
    const nextInvites = invitesResult.status === 'fulfilled' ? invitesResult.value : []

    if (rolesResult.status === 'rejected') {
      console.error(rolesResult.reason)
    }

    if (membersResult.status === 'rejected') {
      console.error(membersResult.reason)
    }

    if (invitesResult.status === 'rejected') {
      console.error(invitesResult.reason)
    }

    setRoles(nextRoles)
    setMembers(nextMembers)
    setPendingInvites(nextInvites)
    setNameDrafts(Object.fromEntries(nextMembers.map((member) => [member.id, member.name || ''])))
    writeViewCache(cacheKey, {
      roles: nextRoles,
      members: nextMembers,
      pendingInvites: nextInvites,
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
          ? `${formState.email} has been sent a staff invite.`
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

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="User Access"
        title="Allocate club roles"
        description="Add an email, assign a role, and keep your club access structure under control."
      />

      {message ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
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
        onRemoveMember={handleRemoveMember}
        onUpdateMemberName={handleUpdateMemberName}
        pageSize={MEMBER_PAGE_SIZE}
        paginatedMembers={paginatedMembers}
        user={user}
      />

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
        confirmLabel="Remove User"
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
        confirmLabel="Remove Pending Access"
        onCancel={() => setInviteDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteInvite(password)}
      />
    </div>
  )
}
