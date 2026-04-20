import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageUsers, getRoleLabel, useAuth } from '../lib/auth.js'
import {
  bulkCopyTeamStaff,
  createTeam,
  deleteTeam,
  getClubUsers,
  readViewCache,
  getTeamStaffAssignments,
  getTeams,
  replaceTeamStaffAssignments,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

export function TeamManagementPage() {
  const { user } = useAuth()
  const [teams, setTeams] = useState([])
  const [users, setUsers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [newTeamName, setNewTeamName] = useState('')
  const [copySourceTeamId, setCopySourceTeamId] = useState('')
  const [copyTargetTeamIds, setCopyTargetTeamIds] = useState([])
  const [copySelectedUserIds, setCopySelectedUserIds] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const cacheKey = user?.clubId ? `team-management:${user.clubId}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    if (cachedValue) {
      setTeams(Array.isArray(cachedValue.teams) ? cachedValue.teams : [])
      setUsers(Array.isArray(cachedValue.users) ? cachedValue.users : [])
      setAssignments(Array.isArray(cachedValue.assignments) ? cachedValue.assignments : [])
      setCopySourceTeamId(cachedValue.copySourceTeamId || '')
      setIsLoading(false)
    }

    const loadData = async () => {
      setErrorMessage('')

      try {
        const [teamsResult, usersResult, assignmentsResult] = await Promise.allSettled([
          withRequestTimeout(() => getTeams(user), 'Could not load teams.'),
          withRequestTimeout(() => getClubUsers(user), 'Could not load club users.'),
          withRequestTimeout(() => getTeamStaffAssignments(user), 'Could not load team assignments.'),
        ])

        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : []
        const nextUsers = usersResult.status === 'fulfilled' ? usersResult.value : []
        const nextAssignments = assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : []
        const hasFailure =
          teamsResult.status === 'rejected' || usersResult.status === 'rejected' || assignmentsResult.status === 'rejected'

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

        setTeams(nextTeams)
        setUsers(nextUsers.filter((member) => member.role !== 'super_admin'))
        setAssignments(nextAssignments)
        setCopySourceTeamId(nextTeams[0]?.id || '')
        writeViewCache(cacheKey, {
          teams: nextTeams,
          users: nextUsers.filter((member) => member.role !== 'super_admin'),
          assignments: nextAssignments,
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
  }, [cacheKey, user])

  if (!canManageUsers(user)) {
    return <Navigate to="/dashboard" replace />
  }

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
        writeViewCache(cacheKey, {
          teams: nextTeams,
          users,
          assignments,
          copySourceTeamId: nextTeams[0]?.id || '',
        })
        return nextTeams
      })
      setNewTeamName('')
      setMessage('Team created.')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not create team.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteTeam = async (teamId) => {
    if (!window.confirm('Delete this team and its staff allocations?')) {
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
      writeViewCache(cacheKey, {
        teams: nextTeams,
        users,
        assignments: nextAssignments,
        copySourceTeamId: nextTeams[0]?.id || '',
      })
      setMessage('Team deleted.')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not delete team.')
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
        writeViewCache(cacheKey, {
          teams,
          users,
          assignments: mergedAssignments,
          copySourceTeamId,
        })
        return mergedAssignments
      })
      setMessage('Team staff updated.')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not update team staff.')
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
      writeViewCache(cacheKey, {
        teams,
        users,
        assignments: nextAssignments,
        copySourceTeamId,
      })
      setMessage('Staff copied to selected teams.')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not bulk copy staff.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Teams"
        title="Manage club teams"
        description="Create teams, allocate staff to each team, and bulk copy current staff across multiple teams."
      />

      {message ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
          {errorMessage}
        </div>
      ) : null}

      <SectionCard
        title="Create team"
        description="Teams become selectable in assessments once created here."
      >
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleCreateTeam}>
          <input
            type="text"
            value={newTeamName}
            onChange={(event) => setNewTeamName(event.target.value)}
            placeholder="U12 Blue"
            required
            className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add Team
          </button>
        </form>
      </SectionCard>

      <SectionCard
        title="Bulk copy staff"
        description="Pick a source team and copy all staff, or only selected staff, into one or more target teams."
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
                <p className="text-sm font-semibold text-[var(--text-primary)]">Choose which staff to copy</p>
                <div className="mt-3 space-y-2">
                  {users.filter((member) => sourceTeamStaffIds.includes(member.id)).length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">No staff allocated to the source team.</p>
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
              Bulk Copy Staff
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Team staff allocations"
        description="Assign current club staff to each team. Managers can bulk copy or edit allocations at any time."
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
                    <p className="text-lg font-semibold text-[var(--text-primary)]">{team.name}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {team.staffIds.length} staff allocated
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleDeleteTeam(team.id)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete Team
                  </button>
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
