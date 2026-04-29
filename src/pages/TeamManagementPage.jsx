import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import {
  canAssignRole,
  canManageTeamSettings,
  canManageUsers,
  getRoleLabel,
  useAuth,
  verifyCurrentUserPassword,
} from '../lib/auth.js'
import {
  createStaffUserWithPassword,
  createClubRole,
  createTeam,
  deleteTeam,
  getClubRoles,
  getClubUsers,
  readViewCacheValue,
  getTeamStaffAssignments,
  getTeams,
  replaceTeamStaffAssignments,
  updateTeamSettings,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const initialCoachForm = {
  email: '',
  password: '',
  teamId: '',
  roleKey: 'coach',
  customRoleLabel: '',
}

const TEAM_PAGE_SIZE = 8
const STAFF_PAGE_SIZE = 8

function getStaffDisplayName(member) {
  return String(member?.name || member?.username || member?.email || 'Unnamed staff').trim()
}

export function TeamManagementPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const cacheKey = user?.clubId ? `team-management:${user.clubId}` : ''
  const [teams, setTeams] = useState(() => {
    const cachedTeams = readViewCacheValue(cacheKey, 'teams', [])
    return Array.isArray(cachedTeams) ? cachedTeams : []
  })
  const [users, setUsers] = useState(() => {
    const cachedUsers = readViewCacheValue(cacheKey, 'users', [])
    return Array.isArray(cachedUsers) ? cachedUsers : []
  })
  const [assignments, setAssignments] = useState(() => {
    const cachedAssignments = readViewCacheValue(cacheKey, 'assignments', [])
    return Array.isArray(cachedAssignments) ? cachedAssignments : []
  })
  const [roles, setRoles] = useState(() => {
    const cachedRoles = readViewCacheValue(cacheKey, 'roles', [])
    return Array.isArray(cachedRoles) ? cachedRoles : []
  })
  const [newTeamName, setNewTeamName] = useState('')
  const [teamNameDrafts, setTeamNameDrafts] = useState({})
  const [coachForm, setCoachForm] = useState(initialCoachForm)
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [staffToAddId, setStaffToAddId] = useState('')
  const [teamPage, setTeamPage] = useState(1)
  const [staffPage, setStaffPage] = useState(1)
  const [teamDeleteTarget, setTeamDeleteTarget] = useState(null)
  const [isCoachPasswordVisible, setIsCoachPasswordVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(() => teams.length === 0 && users.length === 0 && assignments.length === 0 && roles.length === 0)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true

    const loadData = async () => {
      setErrorMessage('')

      try {
        const [teamsResult, usersResult, assignmentsResult, rolesResult] = await Promise.allSettled([
          withRequestTimeout(() => getTeams(user), 'Could not load teams.'),
          withRequestTimeout(() => getClubUsers(user), 'Could not load club users.'),
          withRequestTimeout(() => getTeamStaffAssignments(user), 'Could not load team assignments.'),
          withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
        ])

        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : []
        const nextUsers = usersResult.status === 'fulfilled' ? usersResult.value : []
        const nextAssignments = assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : []
        const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value : []
        const hasFailure =
          teamsResult.status === 'rejected' ||
          usersResult.status === 'rejected' ||
          assignmentsResult.status === 'rejected' ||
          rolesResult.status === 'rejected'

        if (!isMounted) {
          return
        }

        if (teamsResult.status === 'rejected') {
          console.error(teamsResult.reason)
        }

        if (usersResult.status === 'rejected') {
          console.error(usersResult.reason)
        }

        if (assignmentsResult.status === 'rejected') {
          console.error(assignmentsResult.reason)
        }

        if (rolesResult.status === 'rejected') {
          console.error(rolesResult.reason)
        }

        setTeams(nextTeams)
        setUsers(nextUsers.filter((member) => member.role !== 'super_admin'))
        setAssignments(nextAssignments)
        setRoles(nextRoles)
        setTeamNameDrafts(Object.fromEntries(nextTeams.map((team) => [team.id, team.name])))
        writeViewCache(cacheKey, {
          teams: nextTeams,
          users: nextUsers.filter((member) => member.role !== 'super_admin'),
          assignments: nextAssignments,
          roles: nextRoles,
        })

        if (hasFailure) {
          setErrorMessage('Some team data could not be loaded. Missing values will show as empty until data is entered.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadData()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, user, userScopeKey])

  const teamAssignments = useMemo(
    () =>
      teams.map((team) => ({
        ...team,
        staffIds: assignments.filter((assignment) => assignment.teamId === team.id).map((assignment) => assignment.userId),
      })),
    [assignments, teams],
  )

  const assignableRoles = useMemo(
    () => roles.filter((role) => canAssignRole(user, role)),
    [roles, user],
  )
  const selectedTeam = useMemo(
    () => teamAssignments.find((team) => team.id === selectedTeamId) ?? teamAssignments[0] ?? null,
    [selectedTeamId, teamAssignments],
  )
  const staffAssignedTeamIds = useMemo(() => {
    const assignedTeamIds = new Map()

    assignments.forEach((assignment) => {
      const userId = String(assignment.userId ?? '').trim()
      const teamId = String(assignment.teamId ?? '').trim()

      if (!userId || !teamId) {
        return
      }

      assignedTeamIds.set(userId, [...(assignedTeamIds.get(userId) ?? []), teamId])
    })

    return assignedTeamIds
  }, [assignments])
  const selectedTeamStaff = useMemo(
    () =>
      selectedTeam
        ? users
            .filter((member) => selectedTeam.staffIds.includes(member.id))
            .sort((left, right) => getStaffDisplayName(left).localeCompare(getStaffDisplayName(right)))
        : [],
    [selectedTeam, users],
  )
  const availableStaffForSelectedTeam = useMemo(
    () =>
      selectedTeam
        ? users
            .filter((member) => {
              if (selectedTeam.staffIds.includes(member.id)) {
                return false
              }

              const assignedTeamIds = staffAssignedTeamIds.get(String(member.id)) ?? []
              return assignedTeamIds.length === 0
            })
            .sort((left, right) => getStaffDisplayName(left).localeCompare(getStaffDisplayName(right)))
        : [],
    [selectedTeam, staffAssignedTeamIds, users],
  )
  const paginatedTeams = useMemo(
    () => getPaginatedItems(teamAssignments, teamPage, TEAM_PAGE_SIZE),
    [teamAssignments, teamPage],
  )
  const paginatedSelectedTeamStaff = useMemo(
    () => getPaginatedItems(selectedTeamStaff, staffPage, STAFF_PAGE_SIZE),
    [selectedTeamStaff, staffPage],
  )

  useEffect(() => {
    if (coachForm.teamId || teams.length === 0) {
      return
    }

    setCoachForm((current) => ({
      ...current,
      teamId: current.teamId || teams[0]?.id || '',
    }))
  }, [coachForm.teamId, teams])

  useEffect(() => {
    if (selectedTeamId && teams.some((team) => team.id === selectedTeamId)) {
      return
    }

    setSelectedTeamId(teams[0]?.id || '')
  }, [selectedTeamId, teams])

  useEffect(() => {
    setStaffPage(1)
  }, [selectedTeamId])

  const writeTeamCache = (nextState = {}) => {
    writeViewCache(cacheKey, {
      teams,
      users,
      assignments,
      roles,
      ...nextState,
    })
  }

  if (!canManageUsers(user) && !canManageTeamSettings(user)) {
    return <Navigate to="/" replace />
  }

  const handleCreateTeam = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      const createdTeam = await createTeam({
        user,
        name: newTeamName,
      })

      setTeams((current) => {
        const nextTeams = [...current, createdTeam].sort((left, right) => left.name.localeCompare(right.name))
        writeTeamCache({
          teams: nextTeams,
        })
        return nextTeams
      })
      setTeamNameDrafts((current) => ({
        ...current,
        [createdTeam.id]: createdTeam.name,
      }))
      setNewTeamName('')
      setCoachForm((current) => ({
        ...current,
        teamId: current.teamId || createdTeam.id,
      }))
      setSelectedTeamId(createdTeam.id)
      setMessage('Team created.')
      showToast({ title: 'Team created', message: `${createdTeam.name} has been added.` })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not create team.')
      showToast({ title: 'Team not created', message: error.message || 'Could not create team.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCoachFormChange = (event) => {
    const { name, value } = event.target
    setMessage('')
    setErrorMessage('')
    setCoachForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const refreshUsersAndRoles = async () => {
    const [usersResult, rolesResult] = await Promise.allSettled([
      withRequestTimeout(() => getClubUsers(user), 'Could not load club users.'),
      withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
    ])

    const nextUsers = usersResult.status === 'fulfilled' ? usersResult.value.filter((member) => member.role !== 'super_admin') : users
    const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value : roles

    if (usersResult.status === 'rejected') {
      console.error(usersResult.reason)
    }

    if (rolesResult.status === 'rejected') {
      console.error(rolesResult.reason)
    }

    setUsers(nextUsers)
    setRoles(nextRoles)
    writeTeamCache({
      users: nextUsers,
      roles: nextRoles,
    })
  }

  const handleCreateCoach = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      let selectedRole = assignableRoles.find((role) => role.roleKey === coachForm.roleKey)

      if (coachForm.roleKey === '__custom__') {
        if (!coachForm.customRoleLabel.trim()) {
          throw new Error('Add a custom role name first.')
        }

        selectedRole = await createClubRole({
          user,
          label: coachForm.customRoleLabel,
          rank: 10,
        })
      }

      if (!selectedRole || !canAssignRole(user, selectedRole)) {
        throw new Error('You cannot assign that role.')
      }

      if (!coachForm.teamId) {
        throw new Error('Choose a team for this staff member.')
      }

      const createdStaff = await createStaffUserWithPassword({
        user,
        email: coachForm.email,
        password: coachForm.password,
        role: selectedRole,
      })

      let nextAssignments = assignments
      const selectedTeamId = String(coachForm.teamId ?? '').trim()
      const createdStaffId = createdStaff?.profile?.id || createdStaff?.id || ''

      if (selectedTeamId && createdStaffId) {
        const existingTeamIds = staffAssignedTeamIds.get(String(createdStaffId)) ?? []
        const isAlreadyAssignedToAnotherTeam = existingTeamIds.some((teamId) => String(teamId) !== selectedTeamId)

        if (isAlreadyAssignedToAnotherTeam) {
          throw new Error('This staff member is already assigned to another team. Remove them from that team before adding them here.')
        }

        const currentTeam = teamAssignments.find((team) => team.id === selectedTeamId)
        const nextStaffIds = [...new Set([...(currentTeam?.staffIds ?? []), createdStaffId])]
        const savedAssignments = await replaceTeamStaffAssignments(selectedTeamId, nextStaffIds)
        nextAssignments = [...assignments.filter((assignment) => assignment.teamId !== selectedTeamId), ...savedAssignments]
        setAssignments(nextAssignments)
      }

      await refreshUsersAndRoles()
      setCoachForm({
        email: '',
        password: '',
        teamId: selectedTeamId,
        roleKey: selectedRole.roleKey || 'coach',
        customRoleLabel: '',
      })
      writeTeamCache({
        assignments: nextAssignments,
      })
      setMessage('Staff access created.')
      showToast({
        title: 'Staff access created',
        message: selectedTeamId
          ? `${coachForm.email} can now log in and access the selected team.`
          : `${coachForm.email} can now log in with the initial password.`,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not create staff access.')
      showToast({ title: 'Staff not created', message: error.message || 'Could not create staff access.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteTeam = async (teamId) => {
    const targetTeam = teamAssignments.find((team) => team.id === teamId)

    if (!targetTeam) {
      return
    }

    setTeamDeleteTarget(targetTeam)
  }

  const confirmDeleteTeam = async (password) => {
    if (!teamDeleteTarget) {
      return
    }

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deleteTeam(teamDeleteTarget.id)
      const nextTeams = teams.filter((team) => team.id !== teamDeleteTarget.id)
      const nextAssignments = assignments.filter((assignment) => assignment.teamId !== teamDeleteTarget.id)
      setTeams(nextTeams)
      setAssignments(nextAssignments)
      writeTeamCache({
        teams: nextTeams,
        assignments: nextAssignments,
        copySourceTeamId: nextTeams[0]?.id || '',
      })
      setMessage('Team deleted.')
      showToast({ title: 'Team deleted', message: 'The team and staff allocations were removed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not delete team.')
      showToast({ title: 'Team not deleted', message: error.message || 'Could not delete team.', tone: 'error' })
    } finally {
      setIsSaving(false)
      setTeamDeleteTarget(null)
    }
  }

  const handleTeamStaffToggle = async (teamId, userId, checked) => {
    if (checked) {
      const existingTeamIds = staffAssignedTeamIds.get(String(userId)) ?? []
      const isAlreadyAssignedToAnotherTeam = existingTeamIds.some((existingTeamId) => String(existingTeamId) !== String(teamId))

      if (isAlreadyAssignedToAnotherTeam) {
        setErrorMessage('This staff member is already assigned to another team. Remove them from that team before adding them here.')
        showToast({
          title: 'Staff not added',
          message: 'This staff member already has team access elsewhere.',
          tone: 'error',
        })
        return
      }
    }

    const currentTeam = teamAssignments.find((team) => team.id === teamId)
    const currentStaffIds = currentTeam?.staffIds ?? []
    const nextStaffIds = checked
      ? [...new Set([...currentStaffIds, userId])]
      : currentStaffIds.filter((id) => id !== userId)

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      const nextAssignments = await replaceTeamStaffAssignments(teamId, nextStaffIds)
      setAssignments((current) => {
        const mergedAssignments = [...current.filter((assignment) => assignment.teamId !== teamId), ...nextAssignments]
        writeTeamCache({
          assignments: mergedAssignments,
        })
        return mergedAssignments
      })
      setMessage('Team staff updated.')
      showToast({ title: 'Staff updated', message: 'Team staff allocation has been saved.' })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not update team staff.')
      showToast({ title: 'Staff not updated', message: error.message || 'Could not update team staff.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddExistingStaffToTeam = async () => {
    if (!selectedTeam || !staffToAddId) {
      setErrorMessage('Choose a staff member to add to this team.')
      return
    }

    await handleTeamStaffToggle(selectedTeam.id, staffToAddId, true)
    setStaffToAddId('')
  }

  const handleRemoveStaffFromSelectedTeam = async (memberId) => {
    if (!selectedTeam) {
      return
    }

    await handleTeamStaffToggle(selectedTeam.id, memberId, false)
  }

  const handleTeamNameSave = async (teamId) => {
    const nextName = String(teamNameDrafts[teamId] ?? '').trim()
    const currentTeam = teams.find((team) => team.id === teamId)

    if (!currentTeam || !nextName || nextName === currentTeam.name) {
      return
    }

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      const updatedTeam = await updateTeamSettings({
        teamId,
        user,
        data: {
          name: nextName,
        },
      })

      setTeams((current) => {
        const nextTeams = current
          .map((team) => (team.id === teamId ? updatedTeam : team))
          .sort((left, right) => left.name.localeCompare(right.name))
        writeTeamCache({
          teams: nextTeams,
        })
        return nextTeams
      })
      setMessage('Team name updated.')
      showToast({ title: 'Team renamed', message: `${currentTeam.name} is now ${updatedTeam.name}.` })
    } catch (error) {
      console.error(error)
      setTeamNameDrafts((current) => ({
        ...current,
        [teamId]: currentTeam.name,
      }))
      setErrorMessage(error.message || 'Could not update team name.')
      showToast({ title: 'Team not renamed', message: error.message || 'Could not update team name.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Teams"
        title="Manage club teams"
        description="Create teams, create staff accounts, and allocate staff to each team."
      />

      {message ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      {errorMessage ? (
        <NoticeBanner
          title="Team data is only partly available"
          message="Some team or staff records could not be refreshed. Missing items will appear once the data is entered or the connection settles."
        />
      ) : null}

      <SectionCard
        title="Create team"
        description="Teams become selectable in assessments once created here. You can add staff access from this page as well."
      >
        <div className="grid gap-5 2xl:grid-cols-2">
          <form className="space-y-3" onSubmit={handleCreateTeam}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team name</span>
              <input
                type="text"
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                placeholder="U12 Blue"
                required
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Add Team
            </button>
          </form>

          <form className="space-y-3" onSubmit={handleCreateCoach}>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Staff email</span>
                <input
                  type="email"
                  name="email"
                  value={coachForm.email}
                  onChange={handleCoachFormChange}
                  required
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Initial password</span>
                <div className="flex rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] focus-within:border-[var(--accent)]">
                  <input
                    type={isCoachPasswordVisible ? 'text' : 'password'}
                    name="password"
                    value={coachForm.password}
                    onChange={handleCoachFormChange}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="min-h-11 min-w-0 flex-1 rounded-l-2xl bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setIsCoachPasswordVisible((current) => !current)}
                    className="min-h-11 rounded-r-2xl px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]"
                  >
                    {isCoachPasswordVisible ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Role</span>
                <select
                  name="roleKey"
                  value={coachForm.roleKey}
                  onChange={handleCoachFormChange}
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

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team access</span>
                <select
                  name="teamId"
                  value={coachForm.teamId}
                  onChange={handleCoachFormChange}
                  required
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                >
                  <option value="">Select team access</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {coachForm.roleKey === '__custom__' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Custom role</span>
                <input
                  type="text"
                  name="customRoleLabel"
                  value={coachForm.customRoleLabel}
                  onChange={handleCoachFormChange}
                  required
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>
            ) : null}

            <button
              type="submit"
              disabled={isSaving || assignableRoles.length === 0}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Add Staff Access
            </button>
          </form>
        </div>
      </SectionCard>

      <SectionCard
        title="Team staff allocations"
        description="Select one club team, then manage the staff currently allocated to that team."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading teams...
          </div>
        ) : teamAssignments.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No teams created yet.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(220px,360px)_minmax(0,1fr)]">
            <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Club teams</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Choose a team to manage its staff access.</p>
              <div className="mt-4 space-y-2">
                {paginatedTeams.items.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setSelectedTeamId(team.id)}
                    className={[
                      'w-full rounded-2xl border px-4 py-3 text-left transition',
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
                onPageChange={setTeamPage}
                pageSize={TEAM_PAGE_SIZE}
                totalItems={teamAssignments.length}
              />
            </div>

            {selectedTeam ? (
              <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team name</span>
                        <input
                          type="text"
                          value={teamNameDrafts[selectedTeam.id] ?? selectedTeam.name}
                          onChange={(event) =>
                            setTeamNameDrafts((current) => ({
                              ...current,
                              [selectedTeam.id]: event.target.value,
                            }))
                          }
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          isSaving ||
                          String(teamNameDrafts[selectedTeam.id] ?? selectedTeam.name).trim() === selectedTeam.name
                        }
                        onClick={() => void handleTeamNameSave(selectedTeam.id)}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
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
                    onClick={() => void handleDeleteTeam(selectedTeam.id)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete Team
                  </button>
                </div>

                <div className="mt-5 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Add existing staff</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    Staff already assigned to another team are hidden here to prevent cross-team access.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <select
                      value={staffToAddId}
                      onChange={(event) => setStaffToAddId(event.target.value)}
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    >
                      <option value="">Select staff member</option>
                      {availableStaffForSelectedTeam.map((member) => (
                        <option key={member.id} value={member.id}>
                          {getStaffDisplayName(member)} | {member.email} | {getRoleLabel(member)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={isSaving || !staffToAddId}
                      onClick={() => void handleAddExistingStaffToTeam()}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Add To Team
                    </button>
                  </div>
                </div>

                <div className="mt-5">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Allocated staff</p>
                  {selectedTeamStaff.length === 0 ? (
                    <div className="mt-3 rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-6 text-sm text-[var(--text-muted)]">
                      No staff are allocated to this team yet.
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {paginatedSelectedTeamStaff.items.map((member) => (
                        <div
                          key={member.id}
                          className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4"
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
                              onClick={() => void handleRemoveStaffFromSelectedTeam(member.id)}
                              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
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
                    onPageChange={setStaffPage}
                    pageSize={STAFF_PAGE_SIZE}
                    totalItems={selectedTeamStaff.length}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <ConfirmModal
        isOpen={Boolean(teamDeleteTarget)}
        isBusy={isSaving}
        title="Delete team"
        message="This cannot be undone from the app."
        items={[
          `Team: ${teamDeleteTarget?.name || 'Selected team'}`,
          `${teamDeleteTarget?.staffIds?.length ?? 0} staff allocations for this team`,
        ]}
        confirmLabel="Delete Team"
        onCancel={() => setTeamDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteTeam(password)}
      />
    </div>
  )
}
