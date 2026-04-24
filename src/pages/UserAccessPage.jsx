import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canAssignRole, canManageUsers, getRoleLabel, useAuth } from '../lib/auth.js'
import {
  assignClubUserRole,
  createClubRole,
  deleteClubInvite,
  getClubRoles,
  getClubUserInvites,
  getClubUsers,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const initialFormState = {
  email: '',
  roleKey: '',
  customRoleLabel: '',
}

export function UserAccessPage() {
  const { user } = useAuth()
  const cacheKey = user?.clubId ? `user-access:${user.clubId}` : ''
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
  const [formState, setFormState] = useState(initialFormState)
  const [isLoading, setIsLoading] = useState(() => roles.length === 0 && members.length === 0 && pendingInvites.length === 0)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadAccessData = async () => {
      setErrorMessage('')

      try {
        const [rolesResult, membersResult, invitesResult] = await Promise.allSettled([
          withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
          withRequestTimeout(() => getClubUsers(user), 'Could not load active users.'),
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

  if (!canManageUsers(user)) {
    return <Navigate to="/" replace />
  }

  const assignableRoles = useMemo(
    () => roles.filter((role) => canAssignRole(user, role)),
    [roles, user],
  )

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
      withRequestTimeout(() => getClubUsers(user), 'Could not load active users.'),
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

      await assignClubUserRole({
        user,
        email: formState.email,
        role: selectedRole,
      })

      await refreshAccessData()
      setFormState({
        email: '',
        roleKey: assignableRoles[0]?.roleKey || '',
        customRoleLabel: '',
      })
      setMessage('User access updated successfully.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not update user access.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteInvite = async (inviteId) => {
    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      await deleteClubInvite(inviteId)
      await refreshAccessData()
      setMessage('Pending access removed.')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not remove the pending allocation.')
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
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      {errorMessage ? (
        <NoticeBanner
          title="Some access data is unavailable"
          message="Roles, users, or pending allocations could not all be refreshed. Anything missing will appear once the data is available."
        />
      ) : null}

      <SectionCard
        title="Allocate role"
        description="Admins and managers can allocate roles at their level or below. Custom roles are saved to this club."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading roles...
          </div>
        ) : assignableRoles.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No role data entered yet, or role data could not be loaded.
          </div>
        ) : (
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email</span>
              <input
                type="email"
                name="email"
                value={formState.email}
                onChange={handleChange}
                required
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Role</span>
              <select
                name="roleKey"
                value={formState.roleKey}
                onChange={handleChange}
                required
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {assignableRoles.map((role) => (
                  <option key={role.roleKey} value={role.roleKey}>
                    {role.roleLabel}
                  </option>
                ))}
                <option value="__custom__">Other</option>
              </select>
            </label>

            {formState.roleKey === '__custom__' ? (
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Custom role</span>
                <input
                  type="text"
                  name="customRoleLabel"
                  value={formState.customRoleLabel}
                  onChange={handleChange}
                  required={formState.roleKey === '__custom__'}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
                <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                  Custom roles are saved at the support level and can be reused later.
                </p>
              </label>
            ) : null}

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {isSaving ? 'Saving...' : 'Allocate user'}
              </button>
            </div>
          </form>
        )}
      </SectionCard>

      <SectionCard
        title="Active users"
        description="Existing club users are listed here with their current role."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading active users...
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No active users found for this club.
          </div>
        ) : (
          <div className="space-y-3">
            {members.map((member) => (
              <div
                key={member.id}
                className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{member.email}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{member.name || 'No display name yet'}</p>
                  </div>
                  <div className="rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    {getRoleLabel(member)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Pending allocations"
        description="Invited or pre-assigned emails will receive the saved role when they sign in."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading pending allocations...
          </div>
        ) : pendingInvites.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No pending allocations.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{invite.email}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{invite.roleLabel}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleDeleteInvite(invite.id)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
