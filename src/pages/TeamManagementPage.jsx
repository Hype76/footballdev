import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { canAssignRole, canManageUsers, getRoleLabel, useAuth } from '../lib/auth.js'
import {
  assignClubUserRole,
  bulkCopyTeamStaff,
  createClubRole,
  createTeam,
  deleteTeam,
  getClubRoles,
  getClubUsers,
  readViewCache,
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
  roleKey: 'coach',
  customRoleLabel: '',
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
  const [copySourceTeamId, setCopySourceTeamId] = useState(() => readViewCacheValue(cacheKey, 'copySourceTeamId', ''))
  const [copyTargetTeamIds, setCopyTargetTeamIds] = useState([])
  const [copySelectedUserIds, setCopySelectedUserIds] = useState([])
  const [isLoading, setIsLoading] = useState(() => teams.length === 0 && users.length === 0 && assignments.length === 0 && roles.length === 0)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

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
        setCopySourceTeamId(nextTeams[0]?.id || '')
        writeViewCache(cacheKey, {
          teams: nextTeams,
          users: nextUsers.filter((member) => member.role !== 'super_admin'),
          assignments: nextAssignments,
          roles: nextRoles,
          copySourceTeamId: nextTeams[0]?.id || '',
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

  const sourceTeamStaffIds =
    teamAssignments.find((team) => team.id === copySourceTeamId)?.staffIds ?? []
  const assignableRoles = useMemo(
    () => roles.filter((role) => canAssignRole(user, role)),
    [roles, user],
  )

  const writeTeamCache = (nextState = {}) => {
    writeViewCache(cacheKey, {
      teams,
      users,
      assignments,
      roles,
      copySourceTeamId,
      ...nextState,
    })
  }

  if (!canManageUsers(user)) {
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
          copySourceTeamId: nextTeams[0]?.id || '',
        })
        return nextTeams
      })
      setTeamNameDrafts((current) => ({
        ...current,
        [createdTeam.id]: createdTeam.name,
      }))
      setNewTeamName('')
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

      await assignClubUserRole({
        user,
        email: coachForm.email,
        role: selectedRole,
      })
      await refreshUsersAndRoles()
      setCoachForm({
        email: '',
        roleKey: selectedRole.roleKey || 'coach',
        customRoleLabel: '',
      })
      setMessage('Coach access created.')
      showToast({ title: 'Coach access created', message: `${coachForm.email} can now join with the selected role.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not create coach access.')
      showToast({ title: 'Coach not created', message: error.message || 'Could not create coach access.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteTeam = async (teamId) => {
    if (!window.confirm('Delete this team and its coach allocations?')) {
      return
    }

    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      await deleteTeam(teamId)
      const nextTeams = teams.filter((team) => team.id !== teamId)
      const nextAssignments = assignments.filter((assignment) => assignment.teamId !== teamId)
      setTeams(nextTeams)
      setAssignments(nextAssignments)
      writeTeamCache({
        teams: nextTeams,
        assignments: nextAssignments,
        copySourceTeamId: nextTeams[0]?.id || '',
      })
      setMessage('Team deleted.')
      showToast({ title: 'Team deleted', message: 'The team and coach allocations were removed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not delete team.')
      showToast({ title: 'Team not deleted', message: error.message || 'Could not delete team.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleTeamStaffToggle = async (teamId, userId, checked) => {
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
      setMessage('Team coaches updated.')
      showToast({ title: 'Coaches updated', message: 'Team coach allocation has been saved.' })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not update team coaches.')
      showToast({ title: 'Coaches not updated', message: error.message || 'Could not update team coaches.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
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

  const handleTeamApprovalToggle = async (teamId, requireApproval) => {
    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      const updatedTeam = await updateTeamSettings({
        teamId,
        data: {
          requireApproval,
        },
      })

      setTeams((current) => {
        const nextTeams = current.map((team) => (team.id === teamId ? updatedTeam : team))
        writeTeamCache({
          teams: nextTeams,
        })
        return nextTeams
      })
      setMessage('Team approval setting updated.')
      showToast({ title: 'Approval setting saved', message: 'Sharing approval has been updated for this team.' })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not update team approval setting.')
      showToast({ title: 'Approval setting failed', message: error.message || 'Could not update team approval setting.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleBulkCopy = async () => {
    setIsSaving(true)
    setMessage('')
    setErrorMessage('')

    try {
      await bulkCopyTeamStaff({
        sourceTeamId: copySourceTeamId,
        targetTeamIds: copyTargetTeamIds,
        selectedUserIds: copySelectedUserIds,
      })

      const nextAssignments = await getTeamStaffAssignments(user)
      setAssignments(nextAssignments)
      writeTeamCache({
        assignments: nextAssignments,
      })
      setMessage('Coaches copied to selected teams.')
      showToast({ title: 'Coaches copied', message: 'Selected coaches were copied to the target teams.' })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not bulk copy coaches.')
      showToast({ title: 'Coaches not copied', message: error.message || 'Could not bulk copy coaches.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Teams"
        title="Manage club teams"
        description="Create teams, allocate coaches to each team, and bulk copy current coaches across multiple teams."
      />

      {message ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      {errorMessage ? (
        <NoticeBanner
          title="Team data is only partly available"
          message="Some team or coach records could not be refreshed. Missing items will appear once the data is entered or the connection settles."
        />
      ) : null}

      <SectionCard
        title="Create team"
        description="Teams become selectable in assessments once created here. You can add coach access from this page as well."
      >
        <div className="grid gap-5 xl:grid-cols-2">
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
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Coach email</span>
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
              Add Coach Access
            </button>
          </form>
        </div>
      </SectionCard>

      <SectionCard
        title="Bulk copy coaches"
        description="Pick a source team and copy all coaches, or only selected coaches, into one or more target teams."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading teams...
          </div>
        ) : teams.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            Create a team first.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Source team</span>
                <select
                  value={copySourceTeamId}
                  onChange={(event) => {
                    setCopySourceTeamId(event.target.value)
                    setCopySelectedUserIds([])
                  }}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Choose which coaches to copy</p>
                <div className="mt-3 space-y-2">
                  {users.filter((member) => sourceTeamStaffIds.includes(member.id)).length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">No coaches allocated to the source team.</p>
                  ) : (
                    users
                      .filter((member) => sourceTeamStaffIds.includes(member.id))
                      .map((member) => (
                        <label
                          key={member.id}
                          className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
                        >
                          <input
                            type="checkbox"
                            checked={copySelectedUserIds.includes(member.id)}
                            onChange={(event) =>
                              setCopySelectedUserIds((current) =>
                                event.target.checked
                                  ? [...new Set([...current, member.id])]
                                  : current.filter((id) => id !== member.id),
                              )
                            }
                            className="h-4 w-4"
                          />
                          <span>{member.email} ({getRoleLabel(member)})</span>
                        </label>
                      ))
                  )}
                </div>
              </div>

              <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Target teams</p>
                <div className="mt-3 space-y-2">
                  {teams
                    .filter((team) => team.id !== copySourceTeamId)
                    .map((team) => (
                      <label
                        key={team.id}
                        className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
                      >
                        <input
                          type="checkbox"
                          checked={copyTargetTeamIds.includes(team.id)}
                          onChange={(event) =>
                            setCopyTargetTeamIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, team.id])]
                                : current.filter((id) => id !== team.id),
                            )
                          }
                          className="h-4 w-4"
                        />
                        <span>{team.name}</span>
                      </label>
                    ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleBulkCopy()}
              disabled={isSaving || !copySourceTeamId || copyTargetTeamIds.length === 0}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Bulk Copy Coaches
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Team coach allocations"
        description="Assign current club coaches to each team. Managers can bulk copy or edit allocations at any time."
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
          <div className="space-y-4">
            {teamAssignments.map((team) => (
              <div
                key={team.id}
                className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team name</span>
                        <input
                          type="text"
                          value={teamNameDrafts[team.id] ?? team.name}
                          onChange={(event) =>
                            setTeamNameDrafts((current) => ({
                              ...current,
                              [team.id]: event.target.value,
                            }))
                          }
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={isSaving || String(teamNameDrafts[team.id] ?? team.name).trim() === team.name}
                        onClick={() => void handleTeamNameSave(team.id)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Save Name
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {team.staffIds.length} coaches allocated
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:items-end">
                    <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={team.requireApproval}
                        disabled={isSaving}
                        onChange={(event) => void handleTeamApprovalToggle(team.id, event.target.checked)}
                        className="h-4 w-4 rounded border-[var(--border-color)]"
                      />
                      <span>Require approval before sharing</span>
                    </label>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => void handleDeleteTeam(team.id)}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Delete Team
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {users.map((member) => (
                    <label
                      key={`${team.id}:${member.id}`}
                      className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
                    >
                      <input
                        type="checkbox"
                        checked={team.staffIds.includes(member.id)}
                        onChange={(event) => void handleTeamStaffToggle(team.id, member.id, event.target.checked)}
                        className="h-4 w-4"
                      />
                      <span>{member.email} ({getRoleLabel(member)})</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
