import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { CreateStaffLoginSection } from '../components/teams/CreateStaffLoginSection.jsx'
import { CreateTeamSection } from '../components/teams/CreateTeamSection.jsx'
import { TeamStaffAllocationsSection } from '../components/teams/TeamStaffAllocationsSection.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { useToast } from '../components/ui/toast-context.js'
import {
  getStaffDisplayName,
  initialCoachForm,
  normalizeStaffEmail,
  PARTIAL_TEAM_DATA_MESSAGE,
  STAFF_PAGE_SIZE,
  TEAM_PAGE_SIZE,
} from '../hooks/teams/teamManagementUtils.js'
import {
  canAssignRole,
  canManageTeamSettings,
  canManageUsers,
  getRoleLabel,
  useAuth,
  verifyCurrentUserPassword,
} from '../lib/auth.js'
import {
  createStaffInvite,
  createClubRole,
  createTeam,
  deleteTeam,
  getClubRoles,
  getClubUserInvites,
  getClubUsers,
  getEvaluations,
  getPlayers,
  readViewCacheValue,
  getTeamStaffAssignments,
  getTeams,
  replaceTeamStaffAssignments,
  updateTeamSettings,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'
import { canAddStaffAccessEmail, createLimitUpgradeMessage, getUniqueStaffAccessEmails, isWithinPlanLimit } from '../lib/plans.js'

const teamSetupRules = [
  {
    label: 'Team owns context',
    body: 'Players, sessions, staff access, and match day records should all point to the right team.',
  },
  {
    label: 'Staff get scoped access',
    body: 'Give coaches access only to the squads they actually work with.',
  },
  {
    label: 'Create before intake',
    body: 'Create teams first so player records, parent invites, and development notes land in the right place.',
  },
]

const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] shadow-sm shadow-[#047857]/10'
const PENDING_INVITE_PREFIX = 'invite:'

function pendingInviteToStaffMember(invite) {
  const inviteId = String(invite?.id ?? '').trim()

  return {
    id: `${PENDING_INVITE_PREFIX}${inviteId}`,
    clubId: invite.clubId,
    email: invite.email,
    username: invite.email,
    name: invite.email,
    role: invite.roleKey,
    roleLabel: `${invite.roleLabel} Pending invite`,
    roleRank: invite.roleRank,
    teamId: invite.teamId,
    pendingInvite: true,
    inviteId,
  }
}

function mergeUsersWithPendingInvites(userRows, inviteRows) {
  const acceptedEmails = new Set(userRows.map((member) => normalizeStaffEmail(member)).filter(Boolean))
  const pendingMembers = inviteRows
    .filter((invite) => !invite.acceptedAt && !acceptedEmails.has(normalizeStaffEmail(invite)))
    .map(pendingInviteToStaffMember)

  return [...userRows, ...pendingMembers]
}

function isTeamScopedStaffMember(member) {
  return !['admin', 'super_admin'].includes(String(member?.role ?? ''))
}

export function TeamManagementPage() {
  const { refreshTeamSelection, user } = useAuth()
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
  const [teamStats, setTeamStats] = useState(() => {
    const cachedStats = readViewCacheValue(cacheKey, 'teamStats', {})
    return cachedStats && typeof cachedStats === 'object' ? cachedStats : {}
  })
  const [newTeamName, setNewTeamName] = useState('')
  const [teamNameDrafts, setTeamNameDrafts] = useState({})
  const [coachForm, setCoachForm] = useState(initialCoachForm)
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [staffToAddId, setStaffToAddId] = useState('')
  const [staffSearch, setStaffSearch] = useState('')
  const [teamPage, setTeamPage] = useState(1)
  const [staffPage, setStaffPage] = useState(1)
  const [teamDeleteTarget, setTeamDeleteTarget] = useState(null)
  const [isCreateTeamModalOpen, setIsCreateTeamModalOpen] = useState(false)
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
        const [teamsResult, usersResult, invitesResult, assignmentsResult, rolesResult, playersResult, evaluationsResult] = await Promise.allSettled([
          withRequestTimeout(() => getTeams(user), 'Could not load teams.'),
          withRequestTimeout(() => getClubUsers(user), 'Could not load club users.'),
          withRequestTimeout(() => getClubUserInvites(user), 'Could not load pending staff invites.'),
          withRequestTimeout(() => getTeamStaffAssignments(user), 'Could not load team assignments.'),
          withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load development records.'),
        ])

        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : []
        const nextAcceptedUsers = usersResult.status === 'fulfilled' ? usersResult.value : []
        const nextInvites = invitesResult.status === 'fulfilled' ? invitesResult.value : []
        const nextUsers = mergeUsersWithPendingInvites(nextAcceptedUsers, nextInvites)
        const nextAssignments = assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : []
        const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value : []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : []
        const nextEvaluations = evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : []
        const nextTeamStats = buildTeamStats(nextTeams, nextPlayers, nextEvaluations)
        const hasFailure =
          teamsResult.status === 'rejected' ||
          usersResult.status === 'rejected' ||
          invitesResult.status === 'rejected' ||
          assignmentsResult.status === 'rejected' ||
          rolesResult.status === 'rejected' ||
          playersResult.status === 'rejected' ||
          evaluationsResult.status === 'rejected'

        if (!isMounted) {
          return
        }

        if (teamsResult.status === 'rejected') {
          console.error(teamsResult.reason)
        }

        if (usersResult.status === 'rejected') {
          console.error(usersResult.reason)
        }

        if (invitesResult.status === 'rejected') {
          console.error(invitesResult.reason)
        }

        if (assignmentsResult.status === 'rejected') {
          console.error(assignmentsResult.reason)
        }

        if (rolesResult.status === 'rejected') {
          console.error(rolesResult.reason)
        }
        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }
        if (evaluationsResult.status === 'rejected') {
          console.error(evaluationsResult.reason)
        }

        setTeams(nextTeams)
        setUsers(nextUsers.filter((member) => member.role !== 'super_admin'))
        setAssignments(nextAssignments)
        setRoles(nextRoles)
        setTeamStats(nextTeamStats)
        setTeamNameDrafts(Object.fromEntries(nextTeams.map((team) => [team.id, team.name])))
        writeViewCache(cacheKey, {
          teams: nextTeams,
          users: nextUsers.filter((member) => member.role !== 'super_admin'),
          assignments: nextAssignments,
          roles: nextRoles,
          teamStats: nextTeamStats,
        })

        if (hasFailure) {
          setErrorMessage(PARTIAL_TEAM_DATA_MESSAGE)
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

  const teamScopedUsers = useMemo(
    () => users.filter(isTeamScopedStaffMember),
    [users],
  )

  const teamAssignments = useMemo(
    () => {
      const teamScopedStaffIds = new Set(teamScopedUsers.map((member) => member.id))

      return teams.map((team) => ({
        ...team,
        staffIds: assignments
          .filter((assignment) => assignment.teamId === team.id && teamScopedStaffIds.has(assignment.userId))
          .map((assignment) => assignment.userId),
      }))
    },
    [assignments, teamScopedUsers, teams],
  )

  const assignableRoles = useMemo(
    () => roles.filter((role) => canAssignRole(user, role)),
    [roles, user],
  )
  const selectedTeam = useMemo(
    () => teamAssignments.find((team) => team.id === selectedTeamId) ?? teamAssignments[0] ?? null,
    [selectedTeamId, teamAssignments],
  )
  const selectedTeamStaff = useMemo(
    () =>
      selectedTeam
        ? teamScopedUsers
            .filter((member) => selectedTeam.staffIds.includes(member.id))
            .sort((left, right) => getStaffDisplayName(left).localeCompare(getStaffDisplayName(right)))
        : [],
    [selectedTeam, teamScopedUsers],
  )
  const selectedTeamStaffEmails = useMemo(
    () => new Set(selectedTeamStaff.map((member) => normalizeStaffEmail(member)).filter(Boolean)),
    [selectedTeamStaff],
  )
  const availableStaffForSelectedTeam = useMemo(
    () =>
      selectedTeam
        ? teamScopedUsers
            .filter((member) => {
              if (selectedTeam.staffIds.includes(member.id)) {
                return false
              }

              if (selectedTeamStaffEmails.has(normalizeStaffEmail(member))) {
                return false
              }

              return true
            })
            .sort((left, right) => getStaffDisplayName(left).localeCompare(getStaffDisplayName(right)))
        : [],
    [selectedTeam, selectedTeamStaffEmails, teamScopedUsers],
  )
  const filteredAvailableStaffForSelectedTeam = useMemo(
    () => {
      const searchTerm = String(staffSearch ?? '').trim().toLowerCase()

      if (!searchTerm) {
        return availableStaffForSelectedTeam
      }

      return availableStaffForSelectedTeam.filter((member) => {
        const searchableText = [
          getStaffDisplayName(member),
          member.email,
          getRoleLabel(member),
        ]
          .join(' ')
          .toLowerCase()

        return searchableText.includes(searchTerm)
      })
    },
    [availableStaffForSelectedTeam, staffSearch],
  )
  const paginatedTeams = useMemo(
    () => getPaginatedItems(teamAssignments, teamPage, TEAM_PAGE_SIZE),
    [teamAssignments, teamPage],
  )
  const paginatedSelectedTeamStaff = useMemo(
    () => getPaginatedItems(selectedTeamStaff, staffPage, STAFF_PAGE_SIZE),
    [selectedTeamStaff, staffPage],
  )
  const staffAccessEmailCount = useMemo(() => getUniqueStaffAccessEmails(users, []).size, [users])
  const serverEnforcesTeamLimit = user?.role === 'admin' || user?.role === 'super_admin'
  const canCreateMoreTeams = serverEnforcesTeamLimit || isWithinPlanLimit(user, 'teams', teams.length)
  const canCreateMoreStaff = isWithinPlanLimit(user, 'staffLogins', staffAccessEmailCount)
  const teamLimitMessage = createLimitUpgradeMessage(user, 'teams', 'Teams')
  const staffLimitMessage = createLimitUpgradeMessage(user, 'staffLogins', 'Staff logins')
  const allocatedStaffCount = useMemo(
    () => {
      const teamScopedStaffIds = new Set(teamScopedUsers.map((member) => member.id))
      return new Set(assignments.map((assignment) => assignment.userId).filter((staffId) => teamScopedStaffIds.has(staffId))).size
    },
    [assignments, teamScopedUsers],
  )
  const unallocatedStaffCount = Math.max(0, teamScopedUsers.length - allocatedStaffCount)
  const playerTotal = useMemo(
    () => Object.values(teamStats).reduce((total, stats) => total + Number(stats?.playerCount ?? 0), 0),
    [teamStats],
  )

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
      teamStats,
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
      if (!serverEnforcesTeamLimit && !isWithinPlanLimit(user, 'teams', teams.length)) {
        throw new Error(createLimitUpgradeMessage(user, 'teams', 'Teams'))
      }

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
        teamId: '',
      }))
      await refreshTeamSelection?.()
      setMessage('Team created.')
      showToast({ title: 'Team created', message: `${createdTeam.name} has been added.` })
      setIsCreateTeamModalOpen(false)
      return true
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not create team.')
      showToast({ title: 'Team not created', message: error.message || 'Could not create team.', tone: 'error' })
      return false
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
    const [usersResult, invitesResult, rolesResult] = await Promise.allSettled([
      withRequestTimeout(() => getClubUsers(user), 'Could not load club users.'),
      withRequestTimeout(() => getClubUserInvites(user), 'Could not load pending staff invites.'),
      withRequestTimeout(() => getClubRoles(user), 'Could not load club roles.'),
    ])

    const nextAcceptedUsers = usersResult.status === 'fulfilled' ? usersResult.value.filter((member) => member.role !== 'super_admin') : users.filter((member) => !member.pendingInvite)
    const nextInvites = invitesResult.status === 'fulfilled' ? invitesResult.value : []
    const nextUsers = mergeUsersWithPendingInvites(nextAcceptedUsers, nextInvites)
    const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value : roles

    if (usersResult.status === 'rejected') {
      console.error(usersResult.reason)
    }

    if (invitesResult.status === 'rejected') {
      console.error(invitesResult.reason)
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

      const selectedTeamId = String(coachForm.teamId ?? '').trim()
      const normalizedCoachEmail = normalizeStaffEmail(coachForm.email)

      if (!canAddStaffAccessEmail(user, normalizedCoachEmail, users, [])) {
        throw new Error(createLimitUpgradeMessage(user, 'staffLogins', 'Staff logins'))
      }

      const currentTeam = teamAssignments.find((team) => team.id === selectedTeamId)
      const currentTeamEmails = new Set(
        users
          .filter((member) => (currentTeam?.staffIds ?? []).includes(member.id))
          .map((member) => normalizeStaffEmail(member))
          .filter(Boolean),
      )

      if (currentTeamEmails.has(normalizedCoachEmail)) {
        throw new Error('This email already has access to the selected team.')
      }

      const createdStaff = await createStaffInvite({
        user,
        email: coachForm.email,
        role: selectedRole,
        teamId: selectedTeamId,
      })

      await refreshUsersAndRoles()
      const nextAssignments = await getTeamStaffAssignments(user)
      setAssignments(nextAssignments)
      setCoachForm({
        email: '',
        teamId: '',
        roleKey: selectedRole.roleKey || 'coach',
        customRoleLabel: '',
      })
      writeTeamCache({
        assignments: nextAssignments,
      })
      setMessage(createdStaff.kind === 'invite' ? 'Staff invite sent.' : 'Staff access updated.')
      showToast({
        title: createdStaff.kind === 'invite' ? 'Staff invite sent' : 'Staff access updated',
        message: createdStaff.kind === 'invite'
          ? `${coachForm.email} has been sent a staff invite.`
          : `${coachForm.email} can now access the selected team.`,
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
      await deleteTeam(teamDeleteTarget.id, user)
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
      const userToAdd = users.find((member) => String(member.id) === String(userId))
      const targetTeam = teamAssignments.find((team) => String(team.id) === String(teamId))
      const targetTeamEmails = new Set(
        users
          .filter((member) => (targetTeam?.staffIds ?? []).includes(member.id))
          .map((member) => normalizeStaffEmail(member))
          .filter(Boolean),
      )
      const userToAddEmail = normalizeStaffEmail(userToAdd)

      if (userToAddEmail && targetTeamEmails.has(userToAddEmail)) {
        setErrorMessage('This email already has access to this team.')
        showToast({
          title: 'Staff not added',
          message: 'This email already has access to this team.',
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
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div>
            <div className="px-5 py-6 sm:px-6 lg:px-8">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Team setup</p>
              <h1 className="mt-3 max-w-5xl text-3xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-4xl">
                Create the football structure first.
              </h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
                Teams decide where players, staff access, sessions, and match day records live. Set up the squads first, then give coaches scoped access.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {teamSetupRules.map((rule) => (
                  <div key={rule.label} className={`${panelClass} px-4 py-4`}>
                    <p className="text-sm font-black text-[#101828]">{rule.label}</p>
                    <p className={`mt-2 ${bodyTextClass}`}>{rule.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid content-between border-t border-[#d7e5dc] bg-[#ecfdf5] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#4b5f55]">Club setup</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{teams.length} teams configured</p>
              <p className={`mt-2 ${bodyTextClass}`}>
                {allocatedStaffCount} staff accounts are allocated to at least one team.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <TeamSetupMetric label="Teams" value={teams.length} />
              <TeamSetupMetric label="Staff" value={teamScopedUsers.length} />
              <TeamSetupMetric label="Allocated" value={allocatedStaffCount} />
              <TeamSetupMetric label="Players" value={playerTotal} />
            </div>
            <p className={`mt-4 ${bodyTextClass}`}>
              {unallocatedStaffCount > 0
                ? `${unallocatedStaffCount} staff accounts still need team scope.`
                : 'Every visible staff account has team scope or is ready to review.'}
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
          title={errorMessage === PARTIAL_TEAM_DATA_MESSAGE ? 'Team data is only partly available' : 'Action could not be completed'}
          message={errorMessage}
        />
      ) : null}

      <CreateTeamSection
        canCreateMoreTeams={canCreateMoreTeams}
        hasTeams={teams.length > 0}
        isSaving={isSaving}
        onOpenCreateTeam={() => setIsCreateTeamModalOpen(true)}
        teamLimitMessage={teamLimitMessage}
      />

      <CreateStaffLoginSection
        assignableRoles={assignableRoles}
        canCreateMoreStaff={canCreateMoreStaff}
        coachForm={coachForm}
        isSaving={isSaving}
        onCoachFormChange={handleCoachFormChange}
        onCreateCoach={handleCreateCoach}
        staffLimitMessage={staffLimitMessage}
        teams={teams}
      />

      <TeamStaffAllocationsSection
        availableStaff={filteredAvailableStaffForSelectedTeam}
        isLoading={isLoading}
        isSaving={isSaving}
        onAddExistingStaff={handleAddExistingStaffToTeam}
        onDeleteTeam={handleDeleteTeam}
        onRemoveStaff={handleRemoveStaffFromSelectedTeam}
        onSaveTeamName={handleTeamNameSave}
        onSelectedTeamChange={setSelectedTeamId}
        onStaffPageChange={setStaffPage}
        onStaffSearchChange={setStaffSearch}
        onStaffToAddChange={setStaffToAddId}
        onTeamNameDraftChange={(teamId, value) =>
          setTeamNameDrafts((current) => ({
            ...current,
            [teamId]: value,
          }))
        }
        onTeamPageChange={setTeamPage}
        paginatedSelectedTeamStaff={paginatedSelectedTeamStaff}
        paginatedTeams={paginatedTeams}
        selectedTeam={selectedTeam}
        selectedTeamStaff={selectedTeamStaff}
        staffPage={staffPage}
        staffPageSize={STAFF_PAGE_SIZE}
        staffSearch={staffSearch}
        staffToAddId={staffToAddId}
        teamAssignments={teamAssignments}
        teamStats={teamStats}
        teamNameDrafts={teamNameDrafts}
        teamPage={teamPage}
        teamPageSize={TEAM_PAGE_SIZE}
      />

      <ConfirmModal
        isOpen={Boolean(teamDeleteTarget)}
        isBusy={isSaving}
        title="Delete team"
        message="This cannot be undone from the app."
        items={[
          `Team: ${teamDeleteTarget?.name || 'Selected team'}`,
          `${teamDeleteTarget?.staffIds?.length ?? 0} staff allocations for this team`,
        ]}
        confirmLabel="Delete team"
        onCancel={() => setTeamDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteTeam(password)}
      />

      <CreateTeamModal
        canCreateMoreTeams={canCreateMoreTeams}
        isBusy={isSaving}
        isOpen={isCreateTeamModalOpen}
        newTeamName={newTeamName}
        onCancel={() => setIsCreateTeamModalOpen(false)}
        onCreateTeam={handleCreateTeam}
        onTeamNameChange={setNewTeamName}
        teamLimitMessage={teamLimitMessage}
      />
    </div>
  )
}

function CreateTeamModal({
  canCreateMoreTeams,
  isBusy,
  isOpen,
  newTeamName,
  onCancel,
  onCreateTeam,
  onTeamNameChange,
  teamLimitMessage,
}) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/55 px-4 py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-team-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-xl"
      >
        <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Team setup</p>
          <h2 id="create-team-title" className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Create team</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            Create the team space before adding players, sessions, staff access, or match day records.
          </p>
        </div>

        <form onSubmit={onCreateTeam}>
          <div className="px-5 py-5 sm:px-6">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Team name</span>
              <input
                type="text"
                value={newTeamName}
                onChange={(event) => onTeamNameChange(event.target.value)}
                placeholder="U12 Blue, U14 Girls, First Team"
                required
                className="min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#66756c] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]"
              />
            </label>
            {!canCreateMoreTeams ? (
              <p className="mt-3 rounded-lg border border-[#fedf89] bg-[#fffbeb] px-4 py-3 text-sm font-black text-[#93370d]">{teamLimitMessage}</p>
            ) : null}
          </div>

          <div className="grid gap-3 border-t border-[#d7e5dc] bg-white px-5 py-4 sm:grid-cols-2 sm:px-6">
            <button
              type="submit"
              disabled={isBusy || !canCreateMoreTeams}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? 'Creating...' : 'Create team'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isBusy}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function TeamSetupMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{value}</p>
    </div>
  )
}

function buildTeamStats(teams, players, evaluations) {
  const stats = Object.fromEntries(
    teams.map((team) => [
      team.id,
      {
        playerCount: 0,
        assessmentCount: 0,
      },
    ]),
  )
  const teamIdByName = new Map(teams.map((team) => [String(team.name ?? '').trim().toLowerCase(), team.id]))

  players.forEach((player) => {
    const teamId = player.teamId || teamIdByName.get(String(player.team ?? '').trim().toLowerCase())

    if (teamId && stats[teamId]) {
      stats[teamId].playerCount += 1
    }
  })

  evaluations.forEach((evaluation) => {
    const teamId = evaluation.teamId || teamIdByName.get(String(evaluation.team ?? '').trim().toLowerCase())

    if (teamId && stats[teamId]) {
      stats[teamId].assessmentCount += 1
    }
  })

  return stats
}
