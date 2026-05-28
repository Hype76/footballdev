import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import {
  createAssessmentSession,
  createPlayer,
  createStaffInvite,
  createTeam,
  deleteTeam,
  getAssignedTeamsForUser,
  getClubSettings,
  getTeams,
  getTeamStaffAssignments,
  getVisibleClubUsers,
  replaceTeamStaffAssignments,
  updateClubSettings,
  updateTeamSettings,
} from '../../lib/supabase.js'
import {
  ONBOARDING_EVENT,
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
      aria-label={complete ? 'Complete' : 'Not complete'}
    >
      {complete ? 'OK' : index + 1}
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
              {step.complete ? 'Ready' : 'Needed'}
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
              <p className={eyebrowClass}>First run setup</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{plan.title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
                {isLoading ? 'Refreshing workspace data.' : `${progress.completedCount} of ${progress.totalCount} setup checks are complete.`}
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
                Skip for now
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

function WaitingForSetupPanel({ plan }) {
  return (
    <section className="mb-6 rounded-lg border border-[#fedf89] bg-[#fffbeb] px-5 py-5 shadow-sm shadow-[#f79009]/10 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#b54708]">Team setup needed</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{plan.title}</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">{plan.description}</p>
        </div>
        <Link
          to={plan.firstAction}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fedf89] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#f79009]/10 transition hover:border-[#f79009] hover:bg-[#fff7ed]"
        >
          Open team workspace
        </Link>
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

const modalInputClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-bold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'
const modalLabelClass = 'mb-2 block text-sm font-black text-[#101828]'

function OnboardingActionModal({
  action,
  onCancel,
  onSaved,
  refreshTeamSelection,
  selectTeam,
  updateCurrentUserDetails,
  user,
}) {
  const [clubForm, setClubForm] = useState({
    name: user?.clubName || '',
    logoUrl: user?.clubLogoUrl || '',
    contactEmail: user?.clubContactEmail || '',
    contactPhone: user?.clubContactPhone || '',
  })
  const [themeForm, setThemeForm] = useState({
    mode: user?.themeMode || 'light',
    accent: user?.themeAccent || 'green',
    buttonStyle: user?.themeButtonStyle || 'solid',
  })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRoleKey, setInviteRoleKey] = useState(action?.roleKey || 'coach')
  const [playerName, setPlayerName] = useState('')
  const [playerSection, setPlayerSection] = useState('Squad')
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sessionType, setSessionType] = useState('training')
  const [teamName, setTeamName] = useState('')
  const [teamEditId, setTeamEditId] = useState('')
  const [teamEditName, setTeamEditName] = useState('')
  const [deleteTeamConfirmId, setDeleteTeamConfirmId] = useState('')
  const [teams, setTeams] = useState([])
  const [staffUsers, setStaffUsers] = useState([])
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
        const shouldLoadTeams = ['branding-theme', 'manage-teams', 'assign-team-admin', 'invite-team-staff', 'add-player', 'create-session'].includes(actionType)
        const shouldLoadStaff = actionType === 'assign-team-admin'
        const [rawTeams, nextUsers, clubSettings] = await Promise.all([
          shouldLoadTeams ? (canManageClubWide ? getTeams(user) : getAssignedTeamsForUser(user)) : Promise.resolve([]),
          shouldLoadStaff ? getVisibleClubUsers(user) : Promise.resolve([]),
          ['club-details', 'branding-theme'].includes(actionType) && user?.clubId ? getClubSettings(user.clubId) : Promise.resolve(null),
        ])

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
            contactEmail: clubSettings.contactEmail || user.clubContactEmail || '',
            contactPhone: clubSettings.contactPhone || user.clubContactPhone || '',
          })
        }

        setTeams(nextTeams)
        const firstTeam = nextTeams[0]
        const currentThemeTeam = nextTeams.find((team) => String(team.id) === String(user.activeTeamId)) || firstTeam
        setTeamEditId((current) => current || firstTeam?.id || '')
        setTeamEditName((current) => current || firstTeam?.name || '')
        setStaffUsers(nextUsers.filter((staffUser) => String(staffUser.role ?? '') === 'head_manager' || Number(staffUser.roleRank ?? 0) >= 70))
        setThemeForm({
          mode: currentThemeTeam?.themeMode || user.themeMode || 'light',
          accent: currentThemeTeam?.themeAccent || user.themeAccent || 'green',
          buttonStyle: currentThemeTeam?.themeButtonStyle || user.themeButtonStyle || 'solid',
        })

        const fallbackTeamId = user.activeTeamId || nextTeams[0]?.id || ''
        setSelectedTeamId((current) => current || fallbackTeamId)
        setSelectedStaffId((current) => current || nextUsers.find((staffUser) => String(staffUser.role ?? '') === 'head_manager')?.id || '')
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

  if (!action) {
    return null
  }

  const title = action.title || 'Setup action'
  const selectedTeam = teams.find((team) => String(team.id) === String(selectedTeamId))

  const handleSave = async (event) => {
    event.preventDefault()

    if (!user) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      if (actionType === 'club-details' || actionType === 'branding-theme') {
        const updatedClub = await updateClubSettings({
          clubId: user.clubId,
          data: clubForm,
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
      } else if (actionType === 'manage-teams') {
        const createdTeam = await createTeam({ user, name: teamName })
        await refreshTeamSelection?.()
        if (createdTeam?.id) {
          await selectTeam(createdTeam.id)
        }
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
            parentContacts: [{ name: '', email: '' }],
          },
        })
      } else if (actionType === 'create-session') {
        if (!selectedTeamId) {
          throw new Error('Choose a team before creating a session.')
        }

        await createAssessmentSession({
          user,
          session: {
            sessionDate,
            sessionType,
            teamId: selectedTeamId,
            team: selectedTeam?.name || user.activeTeamName || '',
          },
        })
      } else {
        onCancel()
        return
      }

      await onSaved?.(action)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'This setup action could not be saved.')
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
        : action.actionLabel

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#101828]/60 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-action-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white shadow-2xl shadow-[#101828]/30"
      >
        <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
          <p className={eyebrowClass}>First run setup</p>
          <h2 id="onboarding-action-title" className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{title}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{action.detail}</p>
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
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className={modalLabelClass}>Contact email</span>
                  <input type="email" value={clubForm.contactEmail} onChange={(event) => setClubForm((current) => ({ ...current, contactEmail: event.target.value }))} className={modalInputClass} />
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
                    <option key={staffUser.id} value={staffUser.id}>{staffUser.name || staffUser.email}</option>
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
            </div>
          ) : null}

          {actionType === 'create-session' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {renderTeamSelect()}
              <label className="block">
                <span className={modalLabelClass}>Date</span>
                <input type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} className={modalInputClass} required />
              </label>
              <label className="block">
                <span className={modalLabelClass}>Type</span>
                <select value={sessionType} onChange={(event) => setSessionType(event.target.value)} className={modalInputClass}>
                  <option value="training">Training</option>
                  <option value="match">Match</option>
                </select>
              </label>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]">
              {errorMessage}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button type="submit" disabled={isSaving || isLoading} className={primaryButtonClass}>
              {isSaving ? 'Saving...' : submitLabel}
            </button>
            <button type="button" onClick={onCancel} disabled={isSaving} className={secondaryButtonClass}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function OnboardingProvider({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { refreshTeamSelection, selectTeam, teamOptions, updateCurrentUserDetails, user } = useAuth()
  const [snapshot, setSnapshot] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeAction, setActiveAction] = useState(null)
  const [showFullSetup, setShowFullSetup] = useState(false)
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
  const shouldShowOnboarding = Boolean(
    plan &&
      plan.kind !== 'waiting' &&
      plan.manualState?.enabled &&
      !plan.manualState?.dismissedAt &&
      !progress.isComplete,
  )
  const shouldShowReopenOnboarding = Boolean(
    plan &&
      plan.kind !== 'waiting' &&
      plan.manualState?.enabled &&
      plan.manualState?.dismissedAt &&
      !progress.isComplete,
  )
  const shouldShowWaitingForSetup = Boolean(plan?.kind === 'waiting')
  const currentPath = location.pathname || '/'
  const fullSetupPaths = new Set(['/', '/coach', '/club-settings', '/user-settings'])
  const shouldUseFullSetup = showFullSetup || fullSetupPaths.has(currentPath)

  useEffect(() => {
    setShowFullSetup(false)
  }, [currentPath, user?.id])

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
    const isTeamAction =
      plan?.title === 'Team manager setup' ||
      plan?.title === 'Coach setup' ||
      stepId.startsWith('team-') ||
      stepId.startsWith('coach-') ||
      stepId === 'assigned-team'

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

      if (step?.actionType && step.actionType !== 'confirm-team') {
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
    } catch (error) {
      console.error(error)
      setErrorMessage('Onboarding could not be skipped.')
    }
  }

  const handleReset = async () => {
    if (!plan || !user) {
      return
    }

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
    } catch (error) {
      console.error(error)
      setErrorMessage('Onboarding could not be reset.')
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
      {shouldShowWaitingForSetup ? <WaitingForSetupPanel plan={plan} /> : null}
      {shouldShowOnboarding && !shouldUseFullSetup ? (
        <CompactOnboardingPanel
          errorMessage={errorMessage}
          handleAction={handleAction}
          handleDismiss={handleDismiss}
          handleReopenFull={() => setShowFullSetup(true)}
          handleReset={handleReset}
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
                <p className={eyebrowClass}>First run setup</p>
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
                      Skip for now
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
                Skip pauses setup. Reset starts this first-run path again for a fresh club launch or testing.
              </p>
              <button
                type="button"
                onClick={handleReset}
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
              <p className={eyebrowClass}>Setup paused</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-[#101828]">{plan.title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
                {progress.completedCount} of {progress.totalCount} setup checks are complete. Reopen setup when the club is ready to finish the next real action.
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
      {activeAction ? (
        <OnboardingActionModal
          action={activeAction}
          onCancel={() => setActiveAction(null)}
          onSaved={async (step) => {
            setActiveAction(null)
            if (step?.id && step.manualLabel) {
              await handleCompleteStep(step.id)
            }
            window.dispatchEvent(new Event(ONBOARDING_EVENT))
            window.setTimeout(() => {
              scrollToTarget(step?.targetSelector)
            }, 180)
          }}
          refreshTeamSelection={refreshTeamSelection}
          selectTeam={selectTeam}
          updateCurrentUserDetails={updateCurrentUserDetails}
          user={user}
        />
      ) : null}
      {children}
    </>
  )
}
