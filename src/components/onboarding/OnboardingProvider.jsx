import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ConfirmModal } from '../ui/ConfirmModal.jsx'
import { getRoleLabel, useAuth } from '../../lib/auth.js'
import {
  createAssessmentSession,
  createParentPortalInvites,
  createPlayer,
  createStaffInvite,
  createTeam,
  deleteTeam,
  getAssignedTeamsForUser,
  getClubUserInvites,
  getClubSettings,
  getParentLinkingPlayers,
  getTeams,
  getTeamStaffAssignments,
  getVisibleClubUsers,
  importClubLogoFromUrl,
  replaceTeamStaffAssignments,
  updateClubSettings,
  updateTeamSettings,
  uploadClubLogo,
} from '../../lib/supabase.js'
import { sendParentPortalInvite } from '../../lib/email-builder.js'
import {
  ONBOARDING_EVENT,
  ONBOARDING_OPEN_EVENT,
  buildOnboardingPlan,
  dismissOnboarding,
  getOnboardingProgress,
  loadOnboardingSnapshot,
  reopenOnboarding,
  resetOnboarding,
  saveOnboardingStep,
} from '../../lib/onboarding.js'
import { themeAccentOptions, themeButtonStyleOptions, themeModeOptions } from '../../lib/theme.js'

const eyebrowClass = 'text-[11px] font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5]'
const ONBOARDING_TARGET_STORAGE_KEY = 'football-onboarding-target-selector'
const FIXTURE_SETUP_STORAGE_KEY = 'football-open-fixture-setup'
const FIXTURE_SETUP_EVENT = 'football-open-fixture-setup'

function scrollToTarget(selector) {
  const targetSelector = String(selector ?? '').trim()

  if (!targetSelector) {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    return false
  }

  const target = document.querySelector(targetSelector)

  if (!target) {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    return false
  }

  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1')
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
  target.focus({ preventScroll: true })
  return true
}

function patchUserOnboarding(user, scope, patch = {}) {
  if (scope === 'workspace') {
    return {
      ...user,
      workspaceOnboardingCompletedSteps:
        patch.completedSteps ?? user.workspaceOnboardingCompletedSteps ?? [],
      workspaceOnboardingDismissedAt:
        patch.dismissedAt !== undefined ? patch.dismissedAt : user.workspaceOnboardingDismissedAt,
      workspaceOnboardingEnabled:
        patch.enabled !== undefined ? patch.enabled : user.workspaceOnboardingEnabled,
      workspaceOnboardingResetAt:
        patch.resetAt !== undefined ? patch.resetAt : user.workspaceOnboardingResetAt,
    }
  }

  return {
    ...user,
    userOnboardingCompletedSteps:
      patch.completedSteps ?? user.userOnboardingCompletedSteps ?? [],
    userOnboardingDismissedAt:
      patch.dismissedAt !== undefined ? patch.dismissedAt : user.userOnboardingDismissedAt,
    userOnboardingEnabled:
      patch.enabled !== undefined ? patch.enabled : user.userOnboardingEnabled,
    userOnboardingResetAt:
      patch.resetAt !== undefined ? patch.resetAt : user.userOnboardingResetAt,
  }
}

function StepMarker({ index, complete }) {
  return (
    <span
      className={[
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-xs font-black',
        complete
          ? 'border-[#047857] bg-[#047857] text-white'
          : 'border-[#d7e5dc] bg-white text-[#4b5f55]',
      ].join(' ')}
      aria-label={complete ? 'Completed' : 'Not completed'}
    >
      {complete ? 'Done' : index + 1}
    </span>
  )
}

function ConstraintRule({ body, title }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
      <p className="text-sm font-black text-[#101828]">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{body}</p>
    </div>
  )
}

function ActionButton({ children, className, onAction, step }) {
  return (
    <button
      type="button"
      onClick={() => onAction(step)}
      className={className}
    >
      {children}
    </button>
  )
}

function FirstActionCard({ nextStep, onAction, plan }) {
  const actionStep = nextStep || {
    actionLabel: 'Start setup',
    href: plan.firstAction,
    id: 'first-action',
  }

  return (
    <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-4 shadow-sm shadow-[#065f46]/10">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#065f46]">First useful action</p>
      <p className="mt-2 text-lg font-black leading-6 text-[#101828]">{nextStep?.title || plan.title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
        {nextStep?.detail || plan.description}
      </p>
      <ActionButton
        onAction={onAction}
        step={actionStep}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2"
      >
        {nextStep?.actionLabel || 'Start setup'}
      </ActionButton>
    </div>
  )
}

function SetupStepCard({ index, onAction, onComplete, step }) {
  return (
    <article
      className={[
        'rounded-lg border p-4 shadow-sm transition',
        step.complete
          ? 'border-[#d7e5dc] bg-[#ecfdf5] shadow-[#047857]/10'
          : 'border-[#d7e5dc] bg-white shadow-[#047857]/10 hover:border-[#0f9f6e]',
      ].join(' ')}
    >
      <div className="flex gap-3">
        <StepMarker complete={step.complete} index={index} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black leading-6 text-[#101828]">{step.title}</h3>
            <span
              className={[
                'rounded-lg border px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em]',
                step.complete
                  ? 'border-[#d7e5dc] bg-white text-[#065f46]'
                  : 'border-[#fedf89] bg-[#fffbeb] text-[#93370d]',
              ].join(' ')}
            >
              {step.complete ? 'Done' : step.manualLabel ? 'Optional' : 'Needed'}
            </span>
          </div>
          <p className="mt-2 text-sm font-black leading-6 text-[#4b5f55]">{step.rule}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{step.detail}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <ActionButton
              onAction={onAction}
              step={step}
              className={primaryButtonClass}
            >
              {step.actionLabel}
            </ActionButton>
            {!step.complete && step.manualLabel ? (
              <button
                type="button"
                onClick={() => onComplete(step.id)}
                className="inline-flex min-h-10 min-w-[7rem] items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-2 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5]"
              >
                {step.manualLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

function CompactOnboardingPanel({
  errorMessage,
  handleAction,
  handleDismiss,
  handleReopenFull,
  handleReset,
  isLoading,
  nextStep,
  plan,
  progress,
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>Setup checklist</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{plan.title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
                {isLoading ? 'Refreshing workspace data.' : `${progress.completedCount} of ${progress.totalCount} setup steps are done.`}
              </p>
            </div>
            <div className="grid shrink-0 gap-2 sm:grid-cols-2 md:min-w-[17rem]">
              <button
                type="button"
                onClick={handleReopenFull}
                className={secondaryButtonClass}
              >
                View checklist
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className={secondaryButtonClass}
              >
                Hide setup
              </button>
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-lg bg-[#ccfbf1] ring-1 ring-[#d7e5dc]">
            <div
              className="h-full rounded-lg bg-[#047857] transition-all"
              style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>

        <aside className="border-t border-[#bbf7d0] bg-[#ecfdf5] px-5 py-5 sm:px-6 lg:border-l lg:border-t-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#065f46]">Next required action</p>
          <p className="mt-2 text-xl font-black leading-6 text-[#101828]">{nextStep?.title}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{nextStep?.detail}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <ActionButton
              onAction={handleAction}
              step={nextStep || { href: plan.firstAction }}
              className={primaryButtonClass}
            >
              {nextStep?.actionLabel || 'Start setup'}
            </ActionButton>
            <button
              type="button"
              onClick={handleReset}
              className={secondaryButtonClass}
            >
              Reset setup
            </button>
          </div>
        </aside>
      </div>

      {errorMessage ? (
        <div className="border-t border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] sm:px-5">
          {errorMessage}
        </div>
      ) : null}
    </section>
  )
}

function WaitingForSetupPanel({ nextStep, onAction, plan }) {
  const actionStep = nextStep || {
    actionLabel: 'Open team workspace',
    href: plan.firstAction,
    id: 'waiting-action',
  }

  return (
    <section className="mb-6 rounded-lg border border-[#fedf89] bg-[#fffbeb] px-5 py-5 shadow-sm shadow-[#f79009]/10 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#b54708]">Team setup needed</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{plan.title}</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">{plan.description}</p>
        </div>
        <button
          type="button"
          onClick={() => onAction(actionStep)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fedf89] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#f79009]/10 transition hover:border-[#f79009] hover:bg-[#fff7ed]"
        >
          {actionStep.actionLabel || 'Open team workspace'}
        </button>
      </div>
    </section>
  )
}

const roleOptions = {
  admin: { roleKey: 'admin', roleLabel: 'Club Admin', roleRank: 90 },
  head_manager: { roleKey: 'head_manager', roleLabel: 'Team Admin', roleRank: 70 },
  manager: { roleKey: 'manager', roleLabel: 'Manager', roleRank: 50 },
  coach: { roleKey: 'coach', roleLabel: 'Coach', roleRank: 30 },
  assistant_coach: { roleKey: 'assistant_coach', roleLabel: 'Assistant Coach', roleRank: 20 },
}

const PENDING_INVITE_PREFIX = 'invite:'

function pendingInviteToStaffUser(invite) {
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

function mergeStaffUsersWithPendingInvites(users, invites) {
  const acceptedEmails = new Set(users.map((member) => String(member?.email ?? '').trim().toLowerCase()).filter(Boolean))
  const pendingUsers = invites
    .filter((invite) => !invite.acceptedAt && !acceptedEmails.has(String(invite.email ?? '').trim().toLowerCase()))
    .map(pendingInviteToStaffUser)

  return [...users, ...pendingUsers]
}

function isAssignableTeamAdmin(staffUser) {
  const role = String(staffUser?.role ?? '')
  return role !== 'admin' && role !== 'super_admin' && (role === 'head_manager' || Number(staffUser?.roleRank ?? 0) >= 70)
}

const modalInputClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-bold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'
const modalLabelClass = 'mb-2 block text-sm font-black text-[#101828]'

function getPlayerContacts(player) {
  const contacts = Array.isArray(player?.parentContacts) && player.parentContacts.length > 0
    ? player.parentContacts
    : [{ name: player?.parentName || '', email: player?.parentEmail || '' }]

  return contacts
    .map((contact, index) => ({
      id: `${player?.id || 'player'}:${index}`,
      name: String(contact?.name ?? '').trim(),
      email: String(contact?.email ?? '').trim().toLowerCase(),
    }))
    .filter((contact) => contact.email)
}

function isSquadPlayer(player) {
  return String(player?.section ?? '').trim().toLowerCase() === 'squad'
}

function OnboardingActionModal({
  action,
  onCancel,
  onSaved,
  onSkipStep,
  refreshTeamSelection,
  selectTeam,
  updateCurrentUserDetails,
  user,
  wizard = null,
}) {
  const [clubForm, setClubForm] = useState({
    name: user?.clubName || '',
    logoUrl: user?.clubLogoUrl || '',
    contactEmail: user?.clubContactEmail || user?.email || '',
    contactPhone: user?.clubContactPhone || '',
  })
  const [selectedLogoFile, setSelectedLogoFile] = useState(null)
  const [themeForm, setThemeForm] = useState({
    mode: user?.themeMode || 'light',
    accent: user?.themeAccent || 'green',
    buttonStyle: user?.themeButtonStyle || 'solid',
  })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRoleKey, setInviteRoleKey] = useState(action?.roleKey || 'coach')
  const [playerName, setPlayerName] = useState('')
  const [playerSection, setPlayerSection] = useState('Squad')
  const [parentContactName, setParentContactName] = useState('')
  const [parentContactEmail, setParentContactEmail] = useState('')
  const [parentInvitePlayers, setParentInvitePlayers] = useState([])
  const [parentInvitePlayerId, setParentInvitePlayerId] = useState('')
  const [parentInviteContactIds, setParentInviteContactIds] = useState([])
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sessionType, setSessionType] = useState('training')
  const [sessionStartTime, setSessionStartTime] = useState('09:00')
  const [sessionOpponent, setSessionOpponent] = useState('')
  const [teamName, setTeamName] = useState('')
  const [teamEditId, setTeamEditId] = useState('')
  const [teamEditName, setTeamEditName] = useState('')
  const [deleteTeamConfirmId, setDeleteTeamConfirmId] = useState('')
  const [teams, setTeams] = useState([])
  const [clubStaffUsers, setClubStaffUsers] = useState([])
  const [staffUsers, setStaffUsers] = useState([])
  const [teamAssignments, setTeamAssignments] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState(user?.activeTeamId || '')
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const actionType = action?.actionType || ''
  const canManageClubWide = user?.role === 'super_admin' || user?.role === 'admin'

  useEffect(() => {
    let isMounted = true

    async function loadModalData() {
      if (!user) {
        return
      }

      setIsLoading(true)
      setErrorMessage('')

      try {
        const shouldLoadTeams = ['branding-theme', 'manage-teams', 'assign-team-admin', 'invite-team-staff', 'add-player', 'send-parent-invite', 'create-session', 'create-assessment', 'review-setup'].includes(actionType)
        const shouldLoadStaff = ['assign-team-admin', 'review-setup'].includes(actionType)
        const shouldLoadAssignments = ['assign-team-admin', 'review-setup'].includes(actionType)
        const shouldLoadParentInvitePlayers = actionType === 'send-parent-invite'
        const [rawTeams, nextUsers, pendingInvites, nextAssignments, clubSettings] = await Promise.all([
          shouldLoadTeams ? (canManageClubWide ? getTeams(user) : getAssignedTeamsForUser(user)) : Promise.resolve([]),
          shouldLoadStaff ? getVisibleClubUsers(user) : Promise.resolve([]),
          shouldLoadStaff ? getClubUserInvites(user) : Promise.resolve([]),
          shouldLoadAssignments ? getTeamStaffAssignments(user) : Promise.resolve([]),
          ['club-details', 'branding-theme'].includes(actionType) && user?.clubId ? getClubSettings(user.clubId) : Promise.resolve(null),
        ])
        const nextParentInvitePlayers = shouldLoadParentInvitePlayers
          ? (await getParentLinkingPlayers({ user })).filter(isSquadPlayer)
          : []

        if (!isMounted) {
          return
        }

        const nextTeams = canManageClubWide || !user.activeTeamId
          ? rawTeams
          : rawTeams.filter((team) => String(team.id) === String(user.activeTeamId))

        if (clubSettings) {
          setClubForm({
            name: clubSettings.name || user.clubName || '',
            logoUrl: clubSettings.logoUrl || user.clubLogoUrl || '',
            contactEmail: clubSettings.contactEmail || user.clubContactEmail || user.email || '',
            contactPhone: clubSettings.contactPhone || user.clubContactPhone || '',
          })
        }

        setTeams(nextTeams)
        setParentInvitePlayers(nextParentInvitePlayers)
        setParentInvitePlayerId((current) => current || nextParentInvitePlayers.find((player) => getPlayerContacts(player).length > 0)?.id || nextParentInvitePlayers[0]?.id || '')
        const firstTeam = nextTeams[0]
        const currentThemeTeam = nextTeams.find((team) => String(team.id) === String(user.activeTeamId)) || firstTeam
        setTeamEditId((current) => current || firstTeam?.id || '')
        setTeamEditName((current) => current || firstTeam?.name || '')
        const assignableStaffUsers = mergeStaffUsersWithPendingInvites(nextUsers, pendingInvites)
          .filter(isAssignableTeamAdmin)
        setClubStaffUsers(mergeStaffUsersWithPendingInvites(nextUsers, pendingInvites))
        setStaffUsers(assignableStaffUsers)
        setTeamAssignments(nextAssignments)
        setThemeForm({
          mode: currentThemeTeam?.themeMode || user.themeMode || 'light',
          accent: currentThemeTeam?.themeAccent || user.themeAccent || 'green',
          buttonStyle: currentThemeTeam?.themeButtonStyle || user.themeButtonStyle || 'solid',
        })

        const fallbackTeamId = user.activeTeamId || nextTeams[0]?.id || ''
        setSelectedTeamId((current) => current || fallbackTeamId)
        setSelectedStaffId((current) => current || assignableStaffUsers.find((staffUser) => String(staffUser.role ?? '') === 'head_manager')?.id || '')
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(error.message || 'Setup details could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadModalData()

    return () => {
      isMounted = false
    }
  }, [actionType, canManageClubWide, user])

  useEffect(() => {
    const selectedPlayer = parentInvitePlayers.find((player) => String(player.id) === String(parentInvitePlayerId))
    setParentInviteContactIds(getPlayerContacts(selectedPlayer).map((contact) => contact.id))
  }, [parentInvitePlayerId, parentInvitePlayers])

  if (!action) {
    return null
  }

  const title = action.title || 'Setup action'
  const selectedTeam = teams.find((team) => String(team.id) === String(selectedTeamId))
  const selectedParentInvitePlayer = parentInvitePlayers.find((player) => String(player.id) === String(parentInvitePlayerId)) ?? null
  const selectedParentInviteContacts = getPlayerContacts(selectedParentInvitePlayer)

  const handleSave = async (event) => {
    event.preventDefault()

    if (!user) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      let saveMeta = {}

      if (actionType === 'club-details' || actionType === 'branding-theme') {
        let nextLogoUrl = clubForm.logoUrl

        if (selectedLogoFile) {
          nextLogoUrl = await uploadClubLogo({
            clubId: user.clubId,
            file: selectedLogoFile,
            user,
          })
        } else if (clubForm.logoUrl) {
          nextLogoUrl = await importClubLogoFromUrl({
            clubId: user.clubId,
            logoUrl: clubForm.logoUrl,
            user,
          })
        }

        const updatedClub = await updateClubSettings({
          clubId: user.clubId,
          data: {
            ...clubForm,
            logoUrl: nextLogoUrl,
          },
          user,
        })

        if (actionType === 'branding-theme' && teams.length > 0) {
          await Promise.all(
            teams.map((team) =>
              updateTeamSettings({
                teamId: team.id,
                data: {
                  themeMode: themeForm.mode,
                  themeAccent: themeForm.accent,
                  themeButtonStyle: themeForm.buttonStyle,
                },
                user,
              }),
            ),
          )
        }

        updateCurrentUserDetails({
          ...user,
          clubName: updatedClub.name,
          clubLogoUrl: updatedClub.logoUrl,
          clubContactEmail: updatedClub.contactEmail,
          clubContactPhone: updatedClub.contactPhone,
          themeMode: themeForm.mode,
          themeAccent: themeForm.accent,
          themeButtonStyle: themeForm.buttonStyle,
        })
        setSelectedLogoFile(null)
      } else if (actionType === 'manage-teams') {
        await createTeam({ user, name: teamName })
        await refreshTeamSelection?.()
      } else if (actionType === 'invite-staff' || actionType === 'invite-team-staff') {
        const roleKey = actionType === 'invite-team-staff' ? inviteRoleKey : action.roleKey || inviteRoleKey
        const role = roleOptions[roleKey] || roleOptions.coach
        await createStaffInvite({
          user,
          email: inviteEmail,
          role,
          teamId: actionType === 'invite-team-staff' ? selectedTeamId : '',
        })
      } else if (actionType === 'assign-team-admin') {
        if (!selectedTeamId || !selectedStaffId) {
          throw new Error('Choose a team and a team admin.')
        }

        const currentAssignments = await getTeamStaffAssignments(user)
        const existingUserIds = currentAssignments
          .filter((assignment) => String(assignment.teamId) === String(selectedTeamId))
          .map((assignment) => assignment.userId)
        await replaceTeamStaffAssignments(selectedTeamId, [...new Set([...existingUserIds, selectedStaffId])])
        await refreshTeamSelection?.()
      } else if (actionType === 'add-player') {
        if (!selectedTeamId) {
          throw new Error('Choose a team before adding a player.')
        }

        await createPlayer({
          user,
          player: {
            playerName,
            section: playerSection,
            teamId: selectedTeamId,
            team: selectedTeam?.name || user.activeTeamName || '',
            parentContacts: parentContactName || parentContactEmail
              ? [{ name: parentContactName, email: parentContactEmail }]
              : [],
          },
        })
      } else if (actionType === 'send-parent-invite') {
        if (!selectedParentInvitePlayer) {
          throw new Error('Choose a squad player before sending parent invites.')
        }

        const contacts = selectedParentInviteContacts.filter((contact) => parentInviteContactIds.includes(contact.id))

        if (contacts.length === 0) {
          throw new Error('Choose at least one saved parent or guardian email.')
        }

        const invites = await createParentPortalInvites({
          user,
          player: selectedParentInvitePlayer,
          contacts,
        })

        await Promise.all(
          invites.map((invite) =>
            sendParentPortalInvite({
              clubId: invite.clubId,
              inviteLinkId: invite.id,
              parentEmail: invite.email,
              senderEmail: user.email,
              displayName: user.displayName || user.username || user.name,
              existingParentPortalUser: invite.existingParentPortalUser,
              teamName: invite.teamName,
              clubName: invite.clubName || user.clubName,
              playerName: invite.playerName,
              subject: `Family portal invite for ${invite.playerName}`,
              inviteUrl: invite.inviteUrl,
            }),
          ),
        )
      } else if (actionType === 'create-session' || actionType === 'create-assessment') {
        if (!selectedTeamId) {
          throw new Error('Choose a team before creating a session.')
        }

        const createdSession = await createAssessmentSession({
          user,
          session: {
            sessionDate,
            sessionType: actionType === 'create-assessment' ? 'training' : sessionType,
            startTime: sessionStartTime,
            opponent: actionType === 'create-session' && sessionType === 'match' ? sessionOpponent : '',
            teamId: selectedTeamId,
            team: selectedTeam?.name || user.activeTeamName || '',
          },
        })
        saveMeta = {
          navigateTo: `/sessions/start?sessionId=${encodeURIComponent(createdSession.id)}`,
          targetSelector: '[data-tour-id="session-players-section"]',
        }
      } else if (actionType === 'confirm-team') {
        if (!selectedTeamId && !user.activeTeamId) {
          throw new Error('No team is assigned to this account yet.')
        }

        if (selectedTeamId && String(selectedTeamId) !== String(user.activeTeamId || '')) {
          await selectTeam?.(selectedTeamId)
        }
      } else if (actionType === 'review-setup' || actionType === 'feedback-handoff') {
        await onSaved?.(action)
        return
      } else {
        onCancel()
        return
      }

      await onSaved?.(action, saveMeta)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'This setup action could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSkipStep = async () => {
    if (!action?.manualLabel) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await onSkipStep?.(action)
    } catch (error) {
      console.error(error)
      setErrorMessage('This setup step could not be skipped.')
    } finally {
      setIsSaving(false)
    }
  }

  const refreshModalTeams = async () => {
    const nextTeams = await getTeams(user)
    setTeams(nextTeams)
    if (!nextTeams.some((team) => String(team.id) === String(teamEditId))) {
      setTeamEditId(nextTeams[0]?.id || '')
      setTeamEditName(nextTeams[0]?.name || '')
    }
  }

  const handleUpdateTeam = async () => {
    if (!teamEditId) {
      setErrorMessage('Choose a team to edit.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await updateTeamSettings({
        teamId: teamEditId,
        data: { name: teamEditName },
        user,
      })
      await refreshModalTeams()
      window.dispatchEvent(new Event(ONBOARDING_EVENT))
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Team could not be updated.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteTeam = async () => {
    if (!teamEditId) {
      setErrorMessage('Choose a team to delete.')
      return
    }

    if (String(deleteTeamConfirmId) !== String(teamEditId)) {
      setDeleteTeamConfirmId(teamEditId)
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await deleteTeam(teamEditId, user)
      setDeleteTeamConfirmId('')
      await refreshModalTeams()
      window.dispatchEvent(new Event(ONBOARDING_EVENT))
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Team could not be deleted.')
    } finally {
      setIsSaving(false)
    }
  }

  const renderTeamSelect = () => (
    <label className="block">
      <span className={modalLabelClass}>Team</span>
      {!canManageClubWide && selectedTeamId ? (
        <div className="min-h-12 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828]">
          {selectedTeam?.name || user.activeTeamName || 'Assigned team'}
        </div>
      ) : (
        <select
          value={selectedTeamId}
          onChange={(event) => setSelectedTeamId(event.target.value)}
          className={modalInputClass}
          required
        >
          <option value="">Choose team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
      )}
    </label>
  )

  const submitLabel =
    actionType === 'manage-teams'
      ? 'Create team'
      : actionType === 'branding-theme'
        ? 'Save branding'
        : actionType === 'confirm-team'
          ? 'Confirm team'
          : actionType === 'create-assessment'
            ? 'Create assessment session'
            : actionType === 'send-parent-invite'
              ? 'Send parent invite'
              : actionType === 'review-setup' || actionType === 'feedback-handoff'
                ? 'Finish review'
                : action.actionLabel
  const clubAdmins = clubStaffUsers.filter((staffUser) => String(staffUser.role ?? '') === 'admin')
  const teamAdmins = clubStaffUsers.filter(isAssignableTeamAdmin)
  const assignmentRows = teamAssignments.map((assignment) => {
    const staffUser = clubStaffUsers.find((member) => String(member.id) === String(assignment.userId))
    const team = teams.find((entry) => String(entry.id) === String(assignment.teamId))

    return {
      id: assignment.id,
      staffLabel: staffUser?.name || staffUser?.email || assignment.userId,
      status: String(assignment.userId ?? '').startsWith(PENDING_INVITE_PREFIX) ? 'Pending invited, assigned' : 'Active and assigned',
      teamLabel: team?.name || 'Assigned team',
    }
  })
  const wizardEnabled = Boolean(wizard)

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#101828]/60 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-action-title"
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white shadow-2xl shadow-[#101828]/30"
      >
        <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>{wizardEnabled ? wizard.badge : 'Setup checklist'}</p>
              <h2 id="onboarding-action-title" className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
                {wizardEnabled ? wizard.title : title}
              </h2>
              {wizardEnabled ? (
                <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">{wizard.copy}</p>
              ) : null}
              <p className="mt-3 text-base font-black text-[#101828]">{title}</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{action.detail}</p>
            </div>
            {wizardEnabled ? (
              <div className="shrink-0 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10">
                Step {wizard.stepIndex + 1} of {wizard.totalSteps}
              </div>
            ) : null}
          </div>
          {wizardEnabled ? (
            <div className="mt-5 h-3 overflow-hidden rounded-lg bg-[#ccfbf1] ring-1 ring-[#d7e5dc]">
              <div
                className="h-full rounded-lg bg-[#047857] transition-all"
                style={{ width: `${wizard.totalSteps ? ((wizard.stepIndex + 1) / wizard.totalSteps) * 100 : 0}%` }}
              />
            </div>
          ) : null}
        </div>

        <form onSubmit={handleSave} className="grid gap-4 px-5 py-5 sm:px-6">
          {isLoading ? (
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-sm font-black text-[#4b5f55]">
              Loading setup details.
            </div>
          ) : null}

          {actionType === 'club-details' || actionType === 'branding-theme' ? (
            <>
              <label className="block">
                <span className={modalLabelClass}>Club name</span>
                <input value={clubForm.name} onChange={(event) => setClubForm((current) => ({ ...current, name: event.target.value }))} className={modalInputClass} required />
              </label>
              <label className="block">
                <span className={modalLabelClass}>Logo URL</span>
                <input value={clubForm.logoUrl} onChange={(event) => setClubForm((current) => ({ ...current, logoUrl: event.target.value }))} className={modalInputClass} />
              </label>
              <label className="block">
                <span className={modalLabelClass}>Upload logo image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setSelectedLogoFile(event.target.files?.[0] || null)}
                  className="block min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-bold text-[#101828] file:mr-4 file:rounded-lg file:border-0 file:bg-[#047857] file:px-3 file:py-2 file:text-sm file:font-black file:text-white"
                />
                <p className="mt-2 text-xs font-semibold leading-5 text-[#4b5f55]">
                  PNG, JPG, SVG, or WebP. Maximum file size 2MB.
                </p>
              </label>
              {selectedLogoFile ? (
                <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#065f46]">
                  Selected logo: {selectedLogoFile.name}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className={modalLabelClass}>Contact email</span>
                  <input type="email" value={clubForm.contactEmail} onChange={(event) => setClubForm((current) => ({ ...current, contactEmail: event.target.value }))} className={modalInputClass} required={actionType === 'club-details'} />
                </label>
                <label className="block">
                  <span className={modalLabelClass}>Contact phone</span>
                  <input value={clubForm.contactPhone} onChange={(event) => setClubForm((current) => ({ ...current, contactPhone: event.target.value }))} className={modalInputClass} />
                </label>
              </div>
              {actionType === 'branding-theme' ? (
                <div className="grid gap-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 sm:grid-cols-3">
                  <label className="block">
                    <span className={modalLabelClass}>Theme</span>
                    <select value={themeForm.mode} onChange={(event) => setThemeForm((current) => ({ ...current, mode: event.target.value }))} className={modalInputClass}>
                      {themeModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={modalLabelClass}>Accent colour</span>
                    <select value={themeForm.accent} onChange={(event) => setThemeForm((current) => ({ ...current, accent: event.target.value }))} className={modalInputClass}>
                      {themeAccentOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={modalLabelClass}>Button style</span>
                    <select value={themeForm.buttonStyle} onChange={(event) => setThemeForm((current) => ({ ...current, buttonStyle: event.target.value }))} className={modalInputClass}>
                      {themeButtonStyleOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </>
          ) : null}

          {actionType === 'manage-teams' ? (
            <>
              <label className="block">
                <span className={modalLabelClass}>New team name</span>
                <input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Example: U15 Whites" className={modalInputClass} required />
              </label>
              {teams.length > 0 ? (
                <div className="grid gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                  <p className="text-sm font-black text-[#101828]">Edit or delete existing team</p>
                  <label className="block">
                    <span className={modalLabelClass}>Existing team</span>
                    <select
                      value={teamEditId}
                      onChange={(event) => {
                        const nextTeam = teams.find((team) => String(team.id) === String(event.target.value))
                        setTeamEditId(event.target.value)
                        setTeamEditName(nextTeam?.name || '')
                        setDeleteTeamConfirmId('')
                      }}
                      className={modalInputClass}
                    >
                      <option value="">Choose team</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>{team.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={modalLabelClass}>Team name</span>
                    <input value={teamEditName} onChange={(event) => setTeamEditName(event.target.value)} className={modalInputClass} />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={handleUpdateTeam} disabled={isSaving || !teamEditId} className={secondaryButtonClass}>
                      Save team edit
                    </button>
                    <button type="button" onClick={handleDeleteTeam} disabled={isSaving || !teamEditId} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] shadow-sm transition hover:border-[#fda29b] hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60">
                      {String(deleteTeamConfirmId) === String(teamEditId) ? 'Confirm delete team' : 'Delete team'}
                    </button>
                  </div>
                  {String(deleteTeamConfirmId) === String(teamEditId) ? (
                    <div className="rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]">
                      Press Confirm delete team to permanently delete {teamEditName || 'this team'}.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {actionType === 'invite-staff' || actionType === 'invite-team-staff' ? (
            <>
              <label className="block">
                <span className={modalLabelClass}>Email</span>
                <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className={modalInputClass} required />
              </label>
              {actionType === 'invite-team-staff' ? (
                <>
                  {renderTeamSelect()}
                  <label className="block">
                    <span className={modalLabelClass}>Role</span>
                    <select value={inviteRoleKey} onChange={(event) => setInviteRoleKey(event.target.value)} className={modalInputClass}>
                      <option value="manager">Manager</option>
                      <option value="coach">Coach</option>
                      <option value="assistant_coach">Assistant Coach</option>
                    </select>
                  </label>
                </>
              ) : (
                <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828]">
                  Role: {(roleOptions[action.roleKey] || roleOptions.coach).roleLabel}
                </div>
              )}
            </>
          ) : null}

          {actionType === 'assign-team-admin' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {renderTeamSelect()}
              <label className="block">
                <span className={modalLabelClass}>Team admin</span>
                <select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} className={modalInputClass} required>
                  <option value="">Choose team admin</option>
                  {staffUsers.map((staffUser) => (
                    <option key={staffUser.id} value={staffUser.id}>
                      {staffUser.name || staffUser.email}, Role: {staffUser.pendingInvite ? staffUser.roleLabel : getRoleLabel(staffUser)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {actionType === 'add-player' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {renderTeamSelect()}
              <label className="block">
                <span className={modalLabelClass}>Player name</span>
                <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} className={modalInputClass} required />
              </label>
              <label className="block">
                <span className={modalLabelClass}>Section</span>
                <select value={playerSection} onChange={(event) => setPlayerSection(event.target.value)} className={modalInputClass}>
                  <option value="Squad">Squad</option>
                  <option value="Trial">Trial</option>
                </select>
              </label>
              <label className="block">
                <span className={modalLabelClass}>Parent or guardian name</span>
                <input value={parentContactName} onChange={(event) => setParentContactName(event.target.value)} className={modalInputClass} />
              </label>
              <label className="block">
                <span className={modalLabelClass}>Parent or guardian email</span>
                <input type="email" value={parentContactEmail} onChange={(event) => setParentContactEmail(event.target.value)} className={modalInputClass} />
              </label>
            </div>
          ) : null}

          {actionType === 'send-parent-invite' ? (
            <div className="grid gap-4">
              {renderTeamSelect()}
              {parentInvitePlayers.length > 0 ? (
                <label className="block">
                  <span className={modalLabelClass}>Squad player</span>
                  <select
                    value={parentInvitePlayerId}
                    onChange={(event) => setParentInvitePlayerId(event.target.value)}
                    className={modalInputClass}
                    required
                  >
                    <option value="">Choose player</option>
                    {parentInvitePlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.playerName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="rounded-lg border border-[#fedf89] bg-[#fffbeb] px-4 py-3 text-sm font-black text-[#b54708]">
                  Add a squad player before sending parent invites.
                </div>
              )}
              {selectedParentInvitePlayer && selectedParentInviteContacts.length > 0 ? (
                <div className="grid gap-2 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                  <p className="text-sm font-black text-[#101828]">Parent or guardian emails</p>
                  {selectedParentInviteContacts.map((contact) => (
                    <label key={contact.id} className="flex items-start gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3">
                      <input
                        type="checkbox"
                        checked={parentInviteContactIds.includes(contact.id)}
                        onChange={(event) => {
                          setParentInviteContactIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, contact.id])]
                              : current.filter((contactId) => contactId !== contact.id),
                          )
                        }}
                        className="mt-1 h-4 w-4 rounded border-[#d7e5dc] text-[#047857] focus:ring-[#047857]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-[#101828]">{contact.name || 'Parent contact'}</span>
                        <span className="block break-words text-sm font-semibold text-[#4b5f55]">{contact.email}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : selectedParentInvitePlayer ? (
                <div className="rounded-lg border border-[#fedf89] bg-[#fffbeb] px-4 py-3 text-sm font-black text-[#b54708]">
                  This player has no saved parent or guardian email. Add the contact on the player record first.
                </div>
              ) : null}
            </div>
          ) : null}

          {actionType === 'create-session' || actionType === 'create-assessment' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {renderTeamSelect()}
              <label className="block">
                <span className={modalLabelClass}>Date</span>
                <input type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} className={modalInputClass} required />
              </label>
              <label className="block">
                <span className={modalLabelClass}>{actionType === 'create-session' && sessionType === 'match' ? 'Kick-off time' : 'Start time'}</span>
                <input type="time" value={sessionStartTime} onChange={(event) => setSessionStartTime(event.target.value)} className={modalInputClass} required />
              </label>
              {actionType === 'create-session' ? (
                <label className="block">
                  <span className={modalLabelClass}>Type</span>
                  <select value={sessionType} onChange={(event) => setSessionType(event.target.value)} className={modalInputClass}>
                    <option value="training">Training</option>
                    <option value="match">Match</option>
                  </select>
                </label>
              ) : (
                <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold leading-6 text-[#4b5f55] sm:col-span-2">
                  This creates a training context for assessment work. Use the assessment workspace to score players and save results.
                </div>
              )}
              {actionType === 'create-session' && sessionType === 'match' ? (
                <label className="block sm:col-span-2">
                  <span className={modalLabelClass}>Opponent</span>
                  <input value={sessionOpponent} onChange={(event) => setSessionOpponent(event.target.value)} placeholder="Example: Cambourne Town U15" className={modalInputClass} required />
                </label>
              ) : null}
            </div>
          ) : null}

          {actionType === 'confirm-team' ? (
            <div className="grid gap-4">
              {renderTeamSelect()}
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold leading-6 text-[#4b5f55]">
                Confirm this is the team workspace you should use before adding players, creating sessions, or preparing match day.
              </div>
            </div>
          ) : null}

          {actionType === 'review-setup' ? (
            <div className="grid gap-4">
              <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-4 text-sm font-black text-[#065f46]">
                Club setup is ready. Team admins and coaches can now complete team/player setup.
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Club details</p>
                  <p className="mt-2 text-lg font-black text-[#101828]">{clubForm.name || user.clubName || 'Club name missing'}</p>
                  <p className="mt-2 text-sm font-semibold text-[#4b5f55]">{clubForm.contactEmail || 'No contact email'}</p>
                  <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{clubForm.contactPhone || 'No contact phone'}</p>
                </div>
                <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Branding</p>
                  <p className="mt-2 text-sm font-black text-[#101828]">{clubForm.logoUrl ? 'Logo saved' : 'No logo saved'}</p>
                  <p className="mt-2 text-sm font-semibold text-[#4b5f55]">Theme: {themeForm.mode}, {themeForm.accent}, {themeForm.buttonStyle}</p>
                </div>
                <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Teams</p>
                  {teams.length > 0 ? teams.map((team) => (
                    <p key={team.id} className="mt-2 text-sm font-black text-[#101828]">{team.name}</p>
                  )) : <p className="mt-2 text-sm font-semibold text-[#4b5f55]">No teams created yet.</p>}
                </div>
                <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Club admins</p>
                  {clubAdmins.length > 0 ? clubAdmins.map((admin) => (
                    <p key={admin.id} className="mt-2 text-sm font-black text-[#101828]">
                      {admin.email || admin.name} {admin.pendingInvite ? '(pending invited)' : '(active)'}
                    </p>
                  )) : <p className="mt-2 text-sm font-semibold text-[#4b5f55]">Only the current club admin is known.</p>}
                </div>
              </div>
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Team admin assignments</p>
                {assignmentRows.length > 0 ? assignmentRows.map((assignment) => (
                  <p key={assignment.id} className="mt-2 text-sm font-black text-[#101828]">
                    {assignment.staffLabel} to {assignment.teamLabel}, {assignment.status}
                  </p>
                )) : teamAdmins.length > 0 ? (
                  <p className="mt-2 text-sm font-semibold text-[#4b5f55]">Team admins exist but no assignment is saved yet.</p>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-[#4b5f55]">No team admin assignments yet.</p>
                )}
              </div>
              <button type="button" onClick={() => wizard?.openFeedback?.()} className={secondaryButtonClass}>
                Report issue
              </button>
            </div>
          ) : null}

          {actionType === 'feedback-handoff' ? (
            <div className="grid gap-4">
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-sm font-semibold leading-6 text-[#4b5f55]">
                Feedback opens the existing feedback page. This wizard does not create a separate feedback system.
              </div>
              <button type="button" onClick={() => wizard?.openFeedback?.()} className={primaryButtonClass}>
                Open feedback
              </button>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]">
              {errorMessage}
            </div>
          ) : null}

          {action.manualLabel ? (
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold leading-6 text-[#4b5f55]">
              This step can be marked as not needed if it does not fit how this club or team is launching now.
            </div>
          ) : null}

          <div className={action.manualLabel ? 'grid gap-3 lg:grid-cols-3' : 'grid gap-3 sm:grid-cols-2'}>
            <button type="submit" disabled={isSaving || isLoading} className={primaryButtonClass}>
              {isSaving ? 'Saving...' : submitLabel}
            </button>
            {action.manualLabel ? (
              <button type="button" onClick={handleSkipStep} disabled={isSaving || isLoading} className={secondaryButtonClass}>
                {action.manualLabel}
              </button>
            ) : null}
            <button type="button" onClick={onCancel} disabled={isSaving} className={secondaryButtonClass}>
              {wizardEnabled ? 'Close' : 'Cancel'}
            </button>
          </div>
          {wizardEnabled ? (
            <div className="grid gap-2 border-t border-[#d7e5dc] pt-4 sm:grid-cols-3">
              <button type="button" onClick={wizard.onBack} disabled={wizard.stepIndex === 0 || isSaving} className={secondaryButtonClass}>
                Back
              </button>
              <button type="button" onClick={wizard.onNext} disabled={wizard.stepIndex >= wizard.totalSteps - 1 || isSaving} className={secondaryButtonClass}>
                Next
              </button>
              <button type="button" onClick={wizard.onDismiss} disabled={isSaving} className={secondaryButtonClass}>
                Dismiss setup
              </button>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  )
}

export function OnboardingProvider({ children, suppressSetup = false }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { refreshTeamSelection, selectTeam, teamOptions, updateCurrentUserDetails, user } = useAuth()
  const [snapshot, setSnapshot] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeAction, setActiveAction] = useState(null)
  const [isClubAdminWizardOpen, setIsClubAdminWizardOpen] = useState(false)
  const [clubAdminWizardStepIndex, setClubAdminWizardStepIndex] = useState(0)
  const [showFullSetup, setShowFullSetup] = useState(false)
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [stateVersion, setStateVersion] = useState(0)

  useEffect(() => {
    let isMounted = true

    async function loadSnapshot() {
      if (!user?.id) {
        setSnapshot(null)
        return
      }

      setIsLoading(true)
      setErrorMessage('')

      try {
        const nextSnapshot = await loadOnboardingSnapshot(user)

        if (isMounted) {
          setSnapshot(nextSnapshot)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Setup progress could not be refreshed.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadSnapshot()

    const handleStateChange = () => {
      setStateVersion((current) => current + 1)
      void loadSnapshot()
    }

    window.addEventListener(ONBOARDING_EVENT, handleStateChange)

    return () => {
      isMounted = false
      window.removeEventListener(ONBOARDING_EVENT, handleStateChange)
    }
  }, [stateVersion, user, user?.activeTeamId, user?.clubId, user?.id])

  const plan = useMemo(() => buildOnboardingPlan(user, snapshot ?? {}), [snapshot, user])
  const progress = useMemo(() => getOnboardingProgress(plan), [plan])
  const nextStep = plan?.steps?.find((step) => !step.complete) ?? plan?.steps?.[0]
  const isClubAdminSetup = plan?.title === 'Club launch setup'
  const clubAdminSteps = useMemo(() => (isClubAdminSetup ? plan?.steps ?? [] : []), [isClubAdminSetup, plan])
  const clubAdminActiveStep = useMemo(
    () => clubAdminSteps[Math.min(clubAdminWizardStepIndex, Math.max(clubAdminSteps.length - 1, 0))],
    [clubAdminSteps, clubAdminWizardStepIndex],
  )
  const shouldShowOnboarding = Boolean(
    !suppressSetup &&
      plan &&
      plan.kind !== 'waiting' &&
      plan.manualState?.enabled &&
      !plan.manualState?.dismissedAt &&
      !progress.isComplete,
  )
  const shouldShowReopenOnboarding = Boolean(
    !suppressSetup &&
      plan &&
      plan.kind !== 'waiting' &&
      plan.manualState?.enabled &&
      plan.manualState?.dismissedAt &&
      !progress.isComplete,
  )
  const shouldShowWaitingForSetup = Boolean(!suppressSetup && plan?.kind === 'waiting')
  const currentPath = location.pathname || '/'
  const fullSetupPaths = new Set(['/', '/coach', '/club-settings', '/user-settings'])
  const shouldUseFullSetup = showFullSetup || fullSetupPaths.has(currentPath)

  useEffect(() => {
    setShowFullSetup(false)
    setIsClubAdminWizardOpen(false)
  }, [currentPath, user?.id])

  useEffect(() => {
    if (!isClubAdminSetup || !plan?.manualState?.enabled || plan.manualState?.dismissedAt || progress.isComplete) {
      setIsClubAdminWizardOpen(false)
      return
    }

    const firstIncompleteIndex = clubAdminSteps.findIndex((step) => !step.complete)
    setClubAdminWizardStepIndex(firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0)
    setIsClubAdminWizardOpen(true)
  }, [clubAdminSteps, isClubAdminSetup, plan?.manualState?.dismissedAt, plan?.manualState?.enabled, progress.isComplete])

  useEffect(() => {
    const handleOpenOnboarding = async () => {
      if (!plan || !user) {
        return
      }

      try {
        if (plan.manualState?.dismissedAt) {
          await reopenOnboarding({ scope: plan.scope, user })
          updateCurrentUserDetails(patchUserOnboarding(user, plan.scope, { dismissedAt: null, enabled: true }))
        }

        if (isClubAdminSetup) {
          const firstIncompleteIndex = clubAdminSteps.findIndex((step) => !step.complete)
          setClubAdminWizardStepIndex(firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0)
          setIsClubAdminWizardOpen(true)
          return
        }

        setShowFullSetup(true)
      } catch (error) {
        console.error(error)
        setErrorMessage('Onboarding could not be reopened.')
      }
    }

    window.addEventListener(ONBOARDING_OPEN_EVENT, handleOpenOnboarding)

    return () => {
      window.removeEventListener(ONBOARDING_OPEN_EVENT, handleOpenOnboarding)
    }
  }, [clubAdminSteps, isClubAdminSetup, plan, updateCurrentUserDetails, user])

  useEffect(() => {
    const targetSelector = window.sessionStorage.getItem(ONBOARDING_TARGET_STORAGE_KEY)

    if (!targetSelector) {
      return undefined
    }

    window.sessionStorage.removeItem(ONBOARDING_TARGET_STORAGE_KEY)
    const timeoutId = window.setTimeout(() => {
      scrollToTarget(targetSelector)
    }, 180)

    return () => window.clearTimeout(timeoutId)
  }, [currentPath])

  const handleCompleteStep = async (stepId) => {
    if (!plan || !user) {
      return
    }

    try {
      await saveOnboardingStep({ scope: plan.scope, stepId, user })
      const currentSteps =
        plan.scope === 'workspace'
          ? user.workspaceOnboardingCompletedSteps ?? []
          : user.userOnboardingCompletedSteps ?? []
      updateCurrentUserDetails(
        patchUserOnboarding(user, plan.scope, {
          completedSteps: Array.from(new Set([...currentSteps, stepId])),
          dismissedAt: null,
        }),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage('This onboarding step could not be saved.')
    }
  }

  const ensureTeamContextForAction = async (step) => {
    const stepId = String(step?.id ?? '')
    const isClubWideSetup = plan?.title === 'Club launch setup'
    const isTeamAction =
      !isClubWideSetup &&
      (
        plan?.title === 'Team setup' ||
        plan?.title === 'Coach setup' ||
        stepId.startsWith('team-') ||
        stepId.startsWith('coach-') ||
        stepId === 'assigned-team'
      )

    if (!isTeamAction || user?.activeTeamId) {
      return true
    }

    if (teamOptions.length === 1) {
      await selectTeam(teamOptions[0].id)
      return true
    }

    if (teamOptions.length > 1) {
      setErrorMessage('Select a team from the Access view selector before opening this setup action.')
      return false
    }

    setErrorMessage('No team is assigned to this account yet. A club admin needs to assign a team before team setup can continue.')
    return false
  }

  const handleAction = async (step) => {
    const targetHref = String(step?.href || plan?.firstAction || '/coach').trim() || '/coach'
    const targetSelector = String(step?.targetSelector || '').trim()

    try {
      setErrorMessage('')

      const hasTeamContext = await ensureTeamContextForAction(step)

      if (!hasTeamContext) {
        return
      }

      if (step?.actionType === 'create-fixture') {
        if (currentPath === '/match-day') {
          window.dispatchEvent(new CustomEvent(FIXTURE_SETUP_EVENT))
          return
        }

        window.sessionStorage.setItem(FIXTURE_SETUP_STORAGE_KEY, '1')
        navigate('/match-day')
        return
      }

      if (step?.actionType) {
        setActiveAction(step)
        return
      }

      if (targetHref === currentPath) {
        scrollToTarget(targetSelector)
        return
      }

      if (targetSelector) {
        window.sessionStorage.setItem(ONBOARDING_TARGET_STORAGE_KEY, targetSelector)
      }

      navigate(targetHref)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'This setup action could not be opened.')
    }
  }

  const handleDismiss = async () => {
    if (!plan || !user) {
      return
    }

    try {
      const dismissedAt = new Date().toISOString()
      await dismissOnboarding({ scope: plan.scope, user })
      updateCurrentUserDetails(patchUserOnboarding(user, plan.scope, { dismissedAt }))
      setIsClubAdminWizardOpen(false)
    } catch (error) {
      console.error(error)
      setErrorMessage('Onboarding could not be skipped.')
    }
  }

  const handleResetRequest = () => {
    setErrorMessage('')
    setIsResetConfirmOpen(true)
  }

  const handleReset = async () => {
    if (!plan || !user) {
      return
    }

    setIsResetting(true)

    try {
      const resetAt = new Date().toISOString()
      await resetOnboarding({ scope: plan.scope, user })
      updateCurrentUserDetails(
        patchUserOnboarding(user, plan.scope, {
          completedSteps: [],
          dismissedAt: null,
          enabled: true,
          resetAt,
        }),
      )
      setIsResetConfirmOpen(false)
    } catch (error) {
      console.error(error)
      setErrorMessage('Onboarding could not be reset.')
    } finally {
      setIsResetting(false)
    }
  }

  const handleReopen = async () => {
    if (!plan || !user) {
      return
    }

    try {
      await reopenOnboarding({ scope: plan.scope, user })
      updateCurrentUserDetails(patchUserOnboarding(user, plan.scope, { dismissedAt: null, enabled: true }))
    } catch (error) {
      console.error(error)
      setErrorMessage('Onboarding could not be reopened.')
    }
  }

  return (
    <>
      {isClubAdminSetup && isClubAdminWizardOpen && clubAdminActiveStep ? (
        <OnboardingActionModal
          action={clubAdminActiveStep}
          onCancel={() => setIsClubAdminWizardOpen(false)}
          onSaved={async (step, meta = {}) => {
            if (step?.id && (step.manualLabel || step.actionType === 'review-setup' || step.actionType === 'feedback-handoff')) {
              await handleCompleteStep(step.id)
            }
            window.dispatchEvent(new Event(ONBOARDING_EVENT))

            if (meta.navigateTo) {
              if (meta.targetSelector) {
                window.sessionStorage.setItem(ONBOARDING_TARGET_STORAGE_KEY, meta.targetSelector)
              }
              navigate(meta.navigateTo)
              return
            }

            setClubAdminWizardStepIndex((current) => Math.min(current + 1, Math.max(clubAdminSteps.length - 1, 0)))
          }}
          onSkipStep={async (step) => {
            if (step?.id) {
              await handleCompleteStep(step.id)
            }
            window.dispatchEvent(new Event(ONBOARDING_EVENT))
            setClubAdminWizardStepIndex((current) => Math.min(current + 1, Math.max(clubAdminSteps.length - 1, 0)))
          }}
          refreshTeamSelection={refreshTeamSelection}
          selectTeam={selectTeam}
          updateCurrentUserDetails={updateCurrentUserDetails}
          user={user}
          wizard={{
            badge: 'Setup guide',
            copy: 'Follow these steps so the club, team, player, parent, and feedback flow is ready for real use.',
            onBack: () => setClubAdminWizardStepIndex((current) => Math.max(current - 1, 0)),
            onDismiss: handleDismiss,
            onNext: () => setClubAdminWizardStepIndex((current) => Math.min(current + 1, Math.max(clubAdminSteps.length - 1, 0))),
            openFeedback: () => {
              setIsClubAdminWizardOpen(false)
              navigate('/feedback/new?route=/club-admin-setup')
            },
            stepIndex: clubAdminWizardStepIndex,
            title: 'Club setup',
            totalSteps: clubAdminSteps.length,
          }}
        />
      ) : null}
      {isClubAdminSetup ? <>{children}</> : null}
      {isClubAdminSetup ? null : (
      <>
      {shouldShowWaitingForSetup ? <WaitingForSetupPanel nextStep={nextStep} onAction={handleAction} plan={plan} /> : null}
      {shouldShowOnboarding && !shouldUseFullSetup ? (
        <CompactOnboardingPanel
          errorMessage={errorMessage}
          handleAction={handleAction}
          handleDismiss={handleDismiss}
          handleReopenFull={() => setShowFullSetup(true)}
          handleReset={handleResetRequest}
          isLoading={isLoading}
          nextStep={nextStep}
          plan={plan}
          progress={progress}
        />
      ) : null}
      {shouldShowOnboarding && shouldUseFullSetup ? (
        <section className="mb-6 overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
          <div className="border-b border-[#dbe6ef] bg-[#f7faf8] px-5 py-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <p className={eyebrowClass}>Setup checklist</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">
                  {plan.title}
                </h2>
                <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">{plan.description}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)] xl:min-w-[34rem]">
                <div className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
                  <div className="flex items-center justify-between text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
                    <span>Setup progress</span>
                    <span>{progress.completedCount} of {progress.totalCount}</span>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-lg bg-[#ccfbf1] ring-1 ring-[#d7e5dc]">
                    <div
                      className="h-full rounded-lg bg-[#047857] transition-all"
                      style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="mt-3 text-xs font-semibold leading-5 text-[#66756c]">
                    {isLoading ? 'Refreshing workspace data.' : 'Uses live workspace records where possible.'}
                  </p>
                </div>

                <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4 shadow-sm shadow-[#065f46]/10">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#065f46]">Next action</p>
                  <p className="mt-2 text-lg font-black leading-6 text-[#101828]">{nextStep?.title}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <ActionButton
                      onAction={handleAction}
                      step={nextStep || { href: plan.firstAction }}
                      className={primaryButtonClass}
                    >
                      {nextStep?.actionLabel || 'Start setup'}
                    </ActionButton>
                    <button type="button" onClick={handleDismiss} className={secondaryButtonClass}>
                      Hide setup
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FirstActionCard nextStep={nextStep} onAction={handleAction} plan={plan} />
              <ConstraintRule title="Use real club data" body="Create or confirm the records needed for this week of football." />
              <ConstraintRule title="Respect role limits" body="Only complete setup work this account is allowed to manage." />
              <ConstraintRule title="Do one real action" body="Each setup step should make the workspace ready for a real session, match, or parent update." />
            </div>
          </div>

          <div className="bg-white px-5 py-5 sm:px-6 lg:px-8">
            <div className="grid gap-3 lg:grid-cols-2">
              {plan.steps.map((step, index) => (
                <SetupStepCard key={step.id} index={index} onAction={handleAction} onComplete={handleCompleteStep} step={step} />
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10 sm:flex-row sm:items-center sm:justify-between">
              <p className={bodyTextClass}>
                Hide setup removes this panel from the dashboard. You can reopen it from Account settings.
              </p>
              <button
                type="button"
                onClick={handleResetRequest}
                className={secondaryButtonClass}
              >
                Reset setup
              </button>
            </div>
          </div>

          {errorMessage ? (
            <div className="border-t border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] sm:px-5">
              {errorMessage}
            </div>
          ) : null}
        </section>
      ) : null}
      {shouldShowReopenOnboarding ? (
        <section className="mb-6 rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>Setup hidden</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-[#101828]">{plan.title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
                {progress.completedCount} of {progress.totalCount} setup steps are done. Next: {nextStep?.title || 'No required step left'}.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[24rem]">
              <ActionButton
                onAction={handleAction}
                step={nextStep || { href: plan.firstAction }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5]"
              >
                {nextStep?.actionLabel || 'Open next step'}
              </ActionButton>
              <button
                type="button"
                onClick={handleReopen}
                className={primaryButtonClass}
              >
                Reopen setup
              </button>
            </div>
          </div>
          {errorMessage ? (
            <div className="mt-3 rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]">
              {errorMessage}
            </div>
          ) : null}
        </section>
      ) : null}
      {!suppressSetup && activeAction ? (
        <OnboardingActionModal
          action={activeAction}
          onCancel={() => setActiveAction(null)}
          onSaved={async (step, meta = {}) => {
            setActiveAction(null)
            if (step?.id && step.manualLabel) {
              await handleCompleteStep(step.id)
            }
            window.dispatchEvent(new Event(ONBOARDING_EVENT))

            if (meta.navigateTo) {
              if (meta.targetSelector) {
                window.sessionStorage.setItem(ONBOARDING_TARGET_STORAGE_KEY, meta.targetSelector)
              }
              navigate(meta.navigateTo)
              return
            }

            window.setTimeout(() => {
              scrollToTarget(meta.targetSelector || step?.targetSelector)
            }, 180)
          }}
          onSkipStep={async (step) => {
            if (step?.id) {
              await handleCompleteStep(step.id)
            }
            setActiveAction(null)
            window.dispatchEvent(new Event(ONBOARDING_EVENT))
          }}
          refreshTeamSelection={refreshTeamSelection}
          selectTeam={selectTeam}
          updateCurrentUserDetails={updateCurrentUserDetails}
          user={user}
        />
      ) : null}
      <ConfirmModal
        cancelLabel="Keep setup"
        confirmLabel="Reset setup"
        isBusy={isResetting}
        isOpen={isResetConfirmOpen}
        message="This clears the saved onboarding progress for this setup flow. Live club, team, player, session, and invite records are not deleted."
        onCancel={() => setIsResetConfirmOpen(false)}
        onConfirm={handleReset}
        title="Reset onboarding setup?"
      />
      {children}
      </>
      )}
    </>
  )
}
