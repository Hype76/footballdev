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

const staffAccessRules = [
  {
    label: 'Least access first',
    body: 'Give staff the lowest role that lets them complete their football work.',
  },
  {
    label: 'Email owns access',
    body: 'Invites and existing logins are matched by email, so duplicate addresses should be avoided.',
  },
  {
    label: 'Review as roles change',
    body: 'Remove or lower access when coaches change teams or leave the club.',
  },
]

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
  const pendingAccessCount = pendingInvites.length
  const visibleRoleCount = assignableRoles.length

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
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/80">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Staff control</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-5xl">
              Give every coach the right view, no more.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475467]">
              Invite staff by email, assign their club role, and keep access tidy as coaches move teams or leave the club.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {staffAccessRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-4 shadow-sm shadow-slate-200/60">
                  <p className="text-sm font-black text-[#101828]">{rule.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-slate-200 bg-[#f9fafb] p-5 shadow-sm shadow-slate-200/70">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#667085]">Access state</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{activeAndPendingEmailCount} staff emails tracked</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">
                {pendingAccessCount} pending invites and {members.length} active users are visible to this account.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <AccessMetric label="Active" value={members.length} />
              <AccessMetric label="Pending" value={pendingAccessCount} />
              <AccessMetric label="Roles" value={visibleRoleCount} />
              <AccessMetric label="Plan count" value={activeAndPendingEmailCount} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#667085]">
              {canAddMoreUsers ? 'Staff invite capacity is available.' : staffLimitMessage}
            </p>
          </div>
        </div>
      </section>

      {message ? (
        <div className="rounded-lg border border-[#b7efce] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#067a46] shadow-sm shadow-slate-200/60">
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

function AccessMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm shadow-slate-200/60">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{value}</p>
    </div>
  )
}
