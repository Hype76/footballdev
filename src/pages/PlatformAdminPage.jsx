import { useEffect, useMemo, useState } from 'react'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { PlatformDataHygieneSection, PlatformPlanMixSection } from '../components/platform/PlatformDashboardCards.jsx'
import { PlatformAdminStaffSection } from '../components/platform/PlatformAdminStaffSection.jsx'
import { ManageClubsSection } from '../components/platform/ManageClubsSection.jsx'
import { PlatformAccountManagementSection } from '../components/platform/PlatformAccountManagementSection.jsx'
import { PlatformFeedbackSection } from '../components/platform/PlatformFeedbackSection.jsx'
import { PlatformHeroSection, PlatformStatGrid } from '../components/platform/PlatformHeroSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { isSuperAdmin, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { logPlatformStatsDiagnostic, normalizePlatformStatsPayload } from '../lib/domain/platform-normalizers.js'
import {
  formatPlatformDate,
  getClubManagementStats,
  getFeedbackStats,
  getPlanBreakdown,
  getPlatformDashboardStats,
} from '../lib/platform-admin-stats.js'
import {
  createPlatformClub,
  deletePlatformFeedback,
  deletePlatformClub,
  deletePlatformTeam,
  deletePlatformUser,
  getPlatformFeedback,
  getPlatformFeedbackAttachmentUrl,
  getPlatformFeedbackReports,
  getPlatformStats,
  readViewCacheValue,
  updatePlatformFeedback,
  updatePlatformFeedbackReportStatus,
  updatePlatformClubStatus,
  updatePlatformUserStatus,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const cacheKey = 'platform-admin-dashboard'
const feedbackCacheKey = 'platform-admin-feedback'
const PLATFORM_FEEDBACK_PAGE_SIZE = 6
const CLUB_PAGE_SIZE = 6

function getPlatformActionErrorMessage(error, fallbackMessage) {
  const code = String(error?.code || error?.status || error?.statusCode || '').trim()
  const message = String(error?.message || '').trim()

  if (code === 'missing_password') {
    return 'Enter your password to confirm this action.'
  }

  if (code === 'invalid_password') {
    return 'That password was not accepted.'
  }

  if (code === 'unauthenticated' || code === '401') {
    return 'Your session has expired. Sign in again before retrying this action.'
  }

  if (code === 'forbidden' || code === '403') {
    return 'You do not have permission to delete teams.'
  }

  if (code === 'invalid_team_id' || code === 'invalid_club_id' || code === 'validation_error') {
    return message || 'Selected team details are invalid. Refresh the platform data and try again.'
  }

  if (code === 'team_not_found') {
    return 'This team could not be found.'
  }

  if (code === 'team_club_mismatch') {
    return 'This team belongs to a different club than expected.'
  }

  if (code === 'deletion_conflict' || code === '409') {
    return 'This team cannot be deleted because linked records still depend on it.'
  }

  if (code === 'audit_failed') {
    return 'The team could not be deleted because the audit log could not be written.'
  }

  if (code === 'server_error' || code === '500') {
    return 'The server could not complete this action. Please contact support with reference FPO-V1-TEAMDELETE-SERVERERR-007.'
  }

  if (code === 'network_error' || message.toLowerCase().includes('failed to fetch')) {
    return 'Network failure. Check your connection and try again.'
  }

  return message || fallbackMessage || 'The server could not complete this action. Please contact support with reference FPO-V1-TEAMDELETE-SERVERERR-007.'
}

function readCachedPlatformStats() {
  const cachedStats = readViewCacheValue(cacheKey, 'stats', null)

  if (!cachedStats) {
    return null
  }

  const normalizedStats = normalizePlatformStatsPayload(cachedStats)
  const cachedClubCount = Array.isArray(cachedStats?.clubs) ? cachedStats.clubs.length : 0
  const normalizedClubCount = normalizedStats.clubs.length

  if (cachedClubCount !== normalizedClubCount) {
    logPlatformStatsDiagnostic('ignored_invalid_cached_platform_clubs', {
      source: 'session-cache',
      invalidClubRows: cachedClubCount - normalizedClubCount,
    })
  }

  return normalizedStats
}

const PAGE_META = {
  dashboard: {
    title: 'Platform dashboard',
    description: 'Monitor platform usage, club growth, and operational health without exposing player personal details.',
  },
  clubs: {
    title: 'Club and team management',
    description: 'Manage clubs, teams, adult user access, and platform controlled plan overrides.',
  },
}

export function PlatformAdminPage({ section = 'dashboard' }) {
  const { session, user } = useAuth()
  const { showToast } = useToast()
  const pageMeta = PAGE_META[section] || PAGE_META.dashboard
  const showDashboard = section === 'dashboard'
  const showClubManagement = section === 'clubs'
  const [stats, setStats] = useState(() => readCachedPlatformStats())
  const [feedbackItems, setFeedbackItems] = useState(() => {
    const cachedItems = readViewCacheValue(feedbackCacheKey, 'feedbackItems', [])
    return Array.isArray(cachedItems) ? cachedItems : []
  })
  const [feedbackReports, setFeedbackReports] = useState(() => {
    const cachedItems = readViewCacheValue(feedbackCacheKey, 'feedbackReports', [])
    return Array.isArray(cachedItems) ? cachedItems : []
  })
  const [feedbackDrafts, setFeedbackDrafts] = useState({})
  const [selectedClubId, setSelectedClubId] = useState('All')
  const [clubSearchTerm, setClubSearchTerm] = useState('')
  const [feedbackPage, setFeedbackPage] = useState(1)
  const [clubPage, setClubPage] = useState(1)
  const [feedbackDeleteTarget, setFeedbackDeleteTarget] = useState(null)
  const [platformAdminDeleteTarget, setPlatformAdminDeleteTarget] = useState(null)
  const [clubDeleteTarget, setClubDeleteTarget] = useState(null)
  const [teamDeleteTarget, setTeamDeleteTarget] = useState(null)
  const [accountActionTarget, setAccountActionTarget] = useState(null)
  const [isLoading, setIsLoading] = useState(() => !stats)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(() => feedbackItems.length === 0 && feedbackReports.length === 0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isSavingClub, setIsSavingClub] = useState(false)
  const [isSavingPlatformAdmin, setIsSavingPlatformAdmin] = useState(false)
  const [deletingPlatformAdminId, setDeletingPlatformAdminId] = useState('')
  const [updatingClubId, setUpdatingClubId] = useState('')
  const [updatingTeamId, setUpdatingTeamId] = useState('')
  const [updatingUserId, setUpdatingUserId] = useState('')
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState('')
  const [openingAttachmentId, setOpeningAttachmentId] = useState('')
  const [updatingReportId, setUpdatingReportId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [confirmErrorMessage, setConfirmErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [createdClubInvite, setCreatedClubInvite] = useState(null)
  const [newClubForm, setNewClubForm] = useState({
    name: '',
    contactEmail: '',
    contactPhone: '',
    ownerEmail: '',
    planKey: 'small_club',
    billingMode: 'paid',
  })
  const [platformAdminForm, setPlatformAdminForm] = useState({
    name: '',
    email: '',
    password: '',
  })

  useEffect(() => {
    let isMounted = true

    const loadStats = async () => {
      if (!isSuperAdmin(user)) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const nextStats = await withRequestTimeout(() => getPlatformStats(user), 'Could not load platform stats.')

        if (!isMounted) {
          return
        }

        const normalizedStats = normalizePlatformStatsPayload(nextStats)
        setStats(normalizedStats)
        writeViewCache(cacheKey, {
          stats: normalizedStats,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Platform stats could not be refreshed right now.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadStats()

    return () => {
      isMounted = false
    }
  }, [refreshKey, user])

  useEffect(() => {
    let isMounted = true

    const loadFeedback = async () => {
      if (!isSuperAdmin(user)) {
        setIsFeedbackLoading(false)
        return
      }

      try {
        const [nextFeedbackItems, nextFeedbackReports] = await withRequestTimeout(
          () => Promise.all([
            getPlatformFeedback(user),
            getPlatformFeedbackReports({
              user,
              accessToken: session?.access_token || '',
            }),
          ]),
          'Could not load platform feedback.',
        )

        if (!isMounted) {
          return
        }

        setFeedbackItems(nextFeedbackItems)
        setFeedbackReports(nextFeedbackReports)
        setFeedbackDrafts(
          nextFeedbackItems.reduce((drafts, item) => {
            drafts[item.id] = {
              status: item.status,
              adminComment: '',
            }
            return drafts
          }, {}),
        )
        writeViewCache(feedbackCacheKey, {
          feedbackItems: nextFeedbackItems,
          feedbackReports: nextFeedbackReports,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Feedback reports could not be loaded. Please contact support with reference FPO-V1-FEEDBACK-VISIBILITY-011.')
        }
      } finally {
        if (isMounted) {
          setIsFeedbackLoading(false)
        }
      }
    }

    void loadFeedback()

    return () => {
      isMounted = false
    }
  }, [refreshKey, session?.access_token, user])

  const visibleClubs = useMemo(() => {
    const clubs = stats?.clubs ?? []
    const selectedClubs = selectedClubId === 'All' ? clubs : clubs.filter((club) => club.id === selectedClubId)
    const normalizedSearchTerm = clubSearchTerm.trim().toLowerCase()

    if (!normalizedSearchTerm) {
      return selectedClubs
    }

    return selectedClubs.filter((club) => {
      const searchableText = [
        club.name,
        club.contactEmail,
        club.contactPhone,
        club.status,
        club.planKey,
        club.planStatus,
        ...(club.users ?? []).flatMap((member) => [member.name, member.email, member.roleLabel]),
        ...(club.teams ?? []).map((team) => team.name),
      ]
        .join(' ')
        .toLowerCase()

      return searchableText.includes(normalizedSearchTerm)
    })
  }, [clubSearchTerm, selectedClubId, stats])
  const paginatedFeedbackItems = useMemo(
    () => getPaginatedItems(feedbackItems, feedbackPage, PLATFORM_FEEDBACK_PAGE_SIZE),
    [feedbackItems, feedbackPage],
  )
  const paginatedVisibleClubs = useMemo(
    () => getPaginatedItems(visibleClubs, clubPage, CLUB_PAGE_SIZE),
    [clubPage, visibleClubs],
  )

  const refreshStats = () => {
    setRefreshKey((current) => current + 1)
  }

  const patchClubStats = (updatedClub) => {
    if (!updatedClub?.id) {
      return
    }

    setStats((current) => {
      if (!current?.clubs) {
        return current
      }

      const nextStats = {
        ...current,
        clubs: current.clubs.map((club) =>
          club.id === updatedClub.id
            ? {
                ...club,
                planKey: updatedClub.planKey,
                planStatus: updatedClub.planStatus,
                isPlanComped: updatedClub.isPlanComped,
                teamLimitOverride: updatedClub.teamLimitOverride ?? null,
                teamLimitOverrideUpdatedAt: updatedClub.teamLimitOverrideUpdatedAt ?? '',
                planTeamLimit: updatedClub.planTeamLimit,
                effectiveTeamLimit: updatedClub.effectiveTeamLimit,
                stripeSubscriptionId: updatedClub.stripeSubscriptionId,
                currentPeriodEnd: updatedClub.currentPeriodEnd,
                planUpdatedAt: updatedClub.planUpdatedAt,
              }
            : club,
        ),
      }

      writeViewCache(cacheKey, {
        stats: nextStats,
      })

      return nextStats
    })
  }

  const handleFeedbackDraftChange = (feedbackId, fieldName, value) => {
    setFeedbackDrafts((current) => ({
      ...current,
      [feedbackId]: {
        status: current[feedbackId]?.status ?? 'open',
        adminComment: current[feedbackId]?.adminComment ?? '',
        [fieldName]: value,
      },
    }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleSaveFeedback = async (item) => {
    const draft = feedbackDrafts[item.id] ?? {
      status: item.status,
      adminComment: '',
    }

    setUpdatingFeedbackId(item.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await updatePlatformFeedback({
        user,
        feedbackId: item.id,
        data: draft,
      })
      setSuccessMessage('Feedback updated.')
      showToast({ title: 'Feedback saved', message: 'Platform feedback status has been updated.' })
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Feedback could not be updated.')
    } finally {
      setUpdatingFeedbackId('')
    }
  }

  const handleDeleteFeedback = async (item) => {
    setFeedbackDeleteTarget(item)
    setConfirmErrorMessage('')
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleSupportReportStatusChange = async (report, action) => {
    setUpdatingReportId(report.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const updatedReport = await updatePlatformFeedbackReportStatus({
        user,
        accessToken: session?.access_token || '',
        reportId: report.id,
        action,
      })
      setFeedbackReports((currentReports) => {
        const nextReports = currentReports.map((item) => (item.id === updatedReport.id ? updatedReport : item))
        writeViewCache(feedbackCacheKey, {
          feedbackItems,
          feedbackReports: nextReports,
        })
        return nextReports
      })
      setSuccessMessage(action === 'closed' ? 'Issue report closed.' : 'Issue report marked reviewed.')
      showToast({
        title: 'Issue report updated',
        message: action === 'closed' ? 'The issue report has been closed.' : 'The issue report has been marked reviewed.',
      })
    } catch (error) {
      console.error(error)
      setErrorMessage('Issue report could not be updated. Please try again.')
    } finally {
      setUpdatingReportId('')
    }
  }

  const handleSupportReportAttachmentOpen = async (report) => {
    setOpeningAttachmentId(report.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const result = await getPlatformFeedbackAttachmentUrl({
        user,
        accessToken: session?.access_token || '',
        reportId: report.id,
      })
      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Screenshot attachment could not be opened. Please try again.')
    } finally {
      setOpeningAttachmentId('')
    }
  }

  const confirmDeleteFeedback = async (password) => {
    if (!feedbackDeleteTarget) {
      return
    }

    setUpdatingFeedbackId(feedbackDeleteTarget.id)
    setErrorMessage('')
    setConfirmErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deletePlatformFeedback({
        user,
        feedbackId: feedbackDeleteTarget.id,
      })
      setSuccessMessage('Feedback deleted.')
      setFeedbackDeleteTarget(null)
      refreshStats()
    } catch (error) {
      console.error(error)
      setConfirmErrorMessage(getPlatformActionErrorMessage(error, 'Feedback could not be deleted.'))
    } finally {
      setUpdatingFeedbackId('')
    }
  }

  const handleNewClubChange = (fieldName, value) => {
    setNewClubForm((current) => ({
      ...current,
      [fieldName]: value,
      ...(fieldName === 'billingMode' && value === 'paid' && current.planKey === 'individual'
        ? { planKey: 'single_team' }
        : {}),
    }))
    setErrorMessage('')
    setConfirmErrorMessage('')
    setSuccessMessage('')
    setCreatedClubInvite(null)
  }

  const handlePlatformAdminChange = (fieldName, value) => {
    setPlatformAdminForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
    setErrorMessage('')
    setConfirmErrorMessage('')
    setSuccessMessage('')
    setCreatedClubInvite(null)
  }

  const handleCreatePlatformAdmin = async (event) => {
    event.preventDefault()
    setIsSavingPlatformAdmin(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/.netlify/functions/manage-platform-admin-staff', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(platformAdminForm),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Platform admin staff could not be saved.')
      }

      setPlatformAdminForm({
        name: '',
        email: '',
        password: '',
      })
      setSuccessMessage('Platform admin staff user saved.')
      showToast({ title: 'Platform admin saved', message: 'Platform admin staff access has been saved.' })
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Platform admin staff could not be saved.')
    } finally {
      setIsSavingPlatformAdmin(false)
    }
  }

  const handleDeletePlatformAdmin = (platformAdmin) => {
    setPlatformAdminDeleteTarget(platformAdmin)
    setConfirmErrorMessage('')
    setErrorMessage('')
    setSuccessMessage('')
  }

  const confirmDeletePlatformAdmin = async (password) => {
    if (!platformAdminDeleteTarget?.id) {
      return
    }

    setDeletingPlatformAdminId(platformAdminDeleteTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)

      const response = await fetch('/.netlify/functions/manage-platform-admin-staff', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session?.access_token || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId: platformAdminDeleteTarget.id,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Platform admin staff user could not be deleted.')
      }

      setSuccessMessage('Platform admin staff user deleted.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Platform admin staff user could not be deleted.')
    } finally {
      setDeletingPlatformAdminId('')
      setPlatformAdminDeleteTarget(null)
    }
  }

  const handleCreateClub = async (event) => {
    event.preventDefault()
    setIsSavingClub(true)
    setErrorMessage('')
    setConfirmErrorMessage('')
    setSuccessMessage('')
    setCreatedClubInvite(null)

    try {
      const createdClub = await createPlatformClub({
        user,
        name: newClubForm.name,
        contactEmail: newClubForm.contactEmail,
        contactPhone: newClubForm.contactPhone,
        ownerEmail: newClubForm.ownerEmail,
        planKey: newClubForm.planKey,
        billingMode: newClubForm.billingMode,
        accessToken: session?.access_token || '',
      })
      const inviteUrl = String(createdClub?.ownerInvite?.url ?? '').trim()
      const ownerInvite = createdClub?.ownerInvite
      setNewClubForm({
        name: '',
        contactEmail: '',
        contactPhone: '',
        ownerEmail: '',
        planKey: 'small_club',
        billingMode: 'paid',
      })
      setCreatedClubInvite(inviteUrl
        ? {
            url: inviteUrl,
            sent: Boolean(ownerInvite?.sent),
            emailFailed: Boolean(ownerInvite?.emailFailed),
            deliveryStatus: ownerInvite?.deliveryStatus || (ownerInvite?.sent ? 'accepted' : 'skipped'),
            deliveryReason: ownerInvite?.deliveryReason || '',
            deliveryMessage: ownerInvite?.deliveryMessage || '',
          }
        : null)
      setSuccessMessage(ownerInvite?.sent ? 'Club created and invite accepted for delivery.' : 'Club created. Review the invite delivery status below.')
      showToast({
        title: 'Club saved',
        message: ownerInvite?.sent ? 'The club admin invite was accepted for delivery.' : 'The invite link is ready.',
      })
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club could not be created.')
    } finally {
      setIsSavingClub(false)
    }
  }

  const handleToggleClubStatus = async (club) => {
    if (!club?.id) {
      setErrorMessage('This club record is incomplete. Refresh the platform data and try again.')
      return
    }

    const nextStatus = club.status === 'suspended' ? 'active' : 'suspended'
    setUpdatingClubId(club.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await updatePlatformClubStatus({
        user,
        clubId: club.id,
        status: nextStatus,
      })
      setSuccessMessage(nextStatus === 'suspended' ? 'Club suspended.' : 'Club reactivated.')
      showToast({ title: 'Club saved', message: nextStatus === 'suspended' ? 'Club has been suspended.' : 'Club has been reactivated.' })
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club status could not be updated.')
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleClubPlanChange = async (club, fieldName, value) => {
    if (!club?.id) {
      setErrorMessage('This club record is incomplete. Refresh the platform data and try again.')
      return
    }

    setUpdatingClubId(club.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/.netlify/functions/update-platform-club-billing', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          fieldName === 'teamLimitOverride'
            ? {
                clubId: club.id,
                teamLimitOverride: value,
              }
            : {
                clubId: club.id,
                [fieldName]: value,
              },
        ),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Club plan could not be updated.')
      }

      const successTitle = fieldName === 'teamLimitOverride' ? 'Team allowance saved' : 'Club plan saved'
      setSuccessMessage(result.message || 'Club settings updated.')
      showToast({ title: successTitle, message: result.message || 'Club settings have been updated.' })
      patchClubStats(result.club)
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club plan could not be updated.')
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleDeleteClub = async (club) => {
    if (!club?.id) {
      setErrorMessage('This club record is incomplete. Refresh the platform data and try again.')
      return
    }

    setClubDeleteTarget(club)
    setConfirmErrorMessage('')
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handleDeleteTeam = async (club, team) => {
    if (!club?.id || !team?.id) {
      setErrorMessage('This team record is incomplete. Refresh the platform data and try again.')
      return
    }

    setTeamDeleteTarget({
      ...team,
      clubName: club.name,
      clubId: club.id,
    })
    setConfirmErrorMessage('')
    setErrorMessage('')
    setSuccessMessage('')
  }

  const confirmDeleteTeam = async (password) => {
    if (!teamDeleteTarget?.id || !teamDeleteTarget?.clubId) {
      setConfirmErrorMessage('Selected team details are missing. Refresh the platform data and try again.')
      return
    }

    if (updatingTeamId) {
      return
    }

    setUpdatingTeamId(teamDeleteTarget.id)
    setErrorMessage('')
    setConfirmErrorMessage('')
    setSuccessMessage('')

    try {
      await deletePlatformTeam({
        user,
        teamId: teamDeleteTarget.id,
        clubId: teamDeleteTarget.clubId,
        password,
        accessToken: session?.access_token || '',
      })
      setSuccessMessage('Team deleted.')
      setTeamDeleteTarget(null)
      refreshStats()
    } catch (error) {
      console.error(error)
      setConfirmErrorMessage(getPlatformActionErrorMessage(error, 'Team could not be deleted.'))
    } finally {
      setUpdatingTeamId('')
    }
  }

  const handleAccountAction = async (club, member, action) => {
    if (!club?.id || !member?.id) {
      setErrorMessage('This user record is incomplete. Refresh the platform data and try again.')
      return
    }

    setAccountActionTarget({
      ...member,
      clubId: club.id,
      clubName: club.name,
      action,
    })
  }

  const confirmAccountAction = async (password) => {
    if (!accountActionTarget) {
      return
    }

    setUpdatingUserId(accountActionTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)

      if (accountActionTarget.action === 'delete') {
        await deletePlatformUser({
          user,
          targetUserId: accountActionTarget.id,
        })
        setSuccessMessage('User access deleted.')
      } else {
        const nextStatus = accountActionTarget.action === 'suspend' ? 'suspended' : 'active'
        await updatePlatformUserStatus({
          user,
          targetUserId: accountActionTarget.id,
          status: nextStatus,
        })
        setSuccessMessage(nextStatus === 'suspended' ? 'User suspended.' : 'User reactivated.')
      }

      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'User account action could not be completed.')
    } finally {
      setUpdatingUserId('')
      setAccountActionTarget(null)
    }
  }

  const confirmDeleteClub = async (password) => {
    if (!clubDeleteTarget) {
      return
    }

    setUpdatingClubId(clubDeleteTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deletePlatformClub({
        user,
        clubId: clubDeleteTarget.id,
      })
      if (selectedClubId === clubDeleteTarget.id) {
        setSelectedClubId('All')
      }
      setSuccessMessage('Club deleted.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club could not be deleted.')
    } finally {
      setUpdatingClubId('')
      setClubDeleteTarget(null)
    }
  }

  const platformTotals = stats?.totals ?? {}
  const planBreakdown = getPlanBreakdown(stats?.clubs ?? [])
  const dashboardStats = getPlatformDashboardStats(stats)
  const platformAdmins = stats?.platformAdmins ?? []
  const clubManagementStats = getClubManagementStats(stats)
  const feedbackStats = getFeedbackStats(feedbackItems, feedbackReports)

  if (!isSuperAdmin(user)) {
    return (
      <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Platform"
        title={pageMeta.title}
        description="This area is only available to platform administrators."
      />
      </div>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Platform"
        title={pageMeta.title}
        description={pageMeta.description}
      />

      {errorMessage ? (
        <NoticeBanner
          title="Platform data is not fully available"
          message={errorMessage}
        />
      ) : null}

      {successMessage ? (
        <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857] shadow-sm shadow-[#047857]/10">
          {successMessage}
        </div>
      ) : null}

      {showDashboard ? (
        <div className="space-y-5">
          <PlatformHeroSection
            eyebrow="Live platform overview"
            title="Clean operational numbers across clubs, teams, users, and player feedback."
            description="This dashboard shows platform level health without exposing child names or player personal details."
            status={isLoading ? 'Refreshing live stats' : 'Live stats loaded'}
            detail={`Last refresh: ${formatPlatformDate(new Date().toISOString())}`}
            actionLabel="Refresh platform stats"
            onAction={refreshStats}
          />

          <PlatformStatGrid items={dashboardStats} />

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <PlatformAdminStaffSection
              currentUserId={user?.id}
              deletingAdminId={deletingPlatformAdminId}
              form={platformAdminForm}
              isSaving={isSavingPlatformAdmin}
              onChange={handlePlatformAdminChange}
              onDelete={handleDeletePlatformAdmin}
              onSubmit={handleCreatePlatformAdmin}
              platformAdmins={platformAdmins}
            />

            <PlatformPlanMixSection planBreakdown={planBreakdown} platformTotals={platformTotals} />

            <PlatformDataHygieneSection platformTotals={platformTotals} />
          </div>
        </div>
      ) : null}

      {showClubManagement ? (
        <div className="space-y-5">
          <PlatformHeroSection
            eyebrow="Club control centre"
            title="Manage club access, plans, teams, and adult staff accounts from one place."
            description="This area avoids showing child personal details and focuses only on club level operations."
            status={isLoading ? 'Refreshing club data' : 'Club data loaded'}
            detail="Filter by club, review billing state, suspend access, or remove unused workspaces."
          />

          <PlatformStatGrid items={clubManagementStats} />
        </div>
      ) : null}

      {showClubManagement ? (
        <ManageClubsSection
          createdInvite={createdClubInvite}
          form={newClubForm}
          isSaving={isSavingClub}
          onChange={handleNewClubChange}
          onSubmit={handleCreateClub}
        />
      ) : null}

      {showDashboard ? (
        <div className="space-y-5">
          <PlatformHeroSection
            eyebrow="Feedback command centre"
            title="Track product feedback, votes, public comments, and roadmap status."
            description="Admin replies are visible to users, so clubs can see what is planned, in progress, or complete."
            status={isFeedbackLoading ? 'Refreshing feedback' : 'Feedback board loaded'}
            detail="Prioritise product work from the most requested ideas."
          />

          <PlatformStatGrid items={feedbackStats} />
        </div>
      ) : null}

      {showDashboard ? (
        <PlatformFeedbackSection
          drafts={feedbackDrafts}
          feedbackItems={feedbackItems}
          isLoading={isFeedbackLoading}
          onDelete={handleDeleteFeedback}
          onDraftChange={handleFeedbackDraftChange}
          onPageChange={setFeedbackPage}
          onSave={handleSaveFeedback}
          onSupportReportAttachmentOpen={handleSupportReportAttachmentOpen}
          onSupportReportStatusChange={handleSupportReportStatusChange}
          page={feedbackPage}
          pageSize={PLATFORM_FEEDBACK_PAGE_SIZE}
          paginatedItems={paginatedFeedbackItems}
          activeAttachmentId={openingAttachmentId}
          activeReportId={updatingReportId}
          supportReports={feedbackReports}
          updatingFeedbackId={updatingFeedbackId}
        />
      ) : null}

      {showClubManagement ? (
        <PlatformAccountManagementSection
          clubPage={clubPage}
          isLoading={isLoading}
          onAccountAction={handleAccountAction}
          onClubPageChange={setClubPage}
          onClubPlanChange={handleClubPlanChange}
          onDeleteClub={handleDeleteClub}
          onDeleteTeam={handleDeleteTeam}
          onSelectedClubChange={(nextClubId) => {
            setSelectedClubId(nextClubId)
            setClubPage(1)
          }}
          onClubSearchChange={(nextSearchTerm) => {
            setClubSearchTerm(nextSearchTerm)
            setClubPage(1)
          }}
          onToggleClubStatus={handleToggleClubStatus}
          paginatedClubs={paginatedVisibleClubs}
          pageSize={CLUB_PAGE_SIZE}
          clubSearchTerm={clubSearchTerm}
          selectedClubId={selectedClubId}
          stats={stats}
          updatingClubId={updatingClubId}
          updatingTeamId={updatingTeamId}
          updatingUserId={updatingUserId}
          visibleClubs={visibleClubs}
        />
      ) : null}

      <ConfirmModal
        isOpen={Boolean(platformAdminDeleteTarget)}
        isBusy={Boolean(deletingPlatformAdminId)}
        title="Delete platform admin"
        message="This removes platform admin access and deletes the linked sign-in account for this environment."
        items={[
          `Name: ${platformAdminDeleteTarget?.name || 'No name entered'}`,
          `Email: ${platformAdminDeleteTarget?.email || 'No email entered'}`,
          'Platform admin profile and sign-in access will be removed.',
        ]}
        confirmLabel="Delete Admin"
        onCancel={() => setPlatformAdminDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeletePlatformAdmin(password)}
      />

      <ConfirmModal
        isOpen={Boolean(feedbackDeleteTarget)}
        isBusy={Boolean(updatingFeedbackId)}
        title="Delete platform feedback"
        message="This removes the feedback item and its comments from the feedback board."
        items={[
          `Feedback: ${feedbackDeleteTarget?.message || 'Selected feedback'}`,
          `Club: ${feedbackDeleteTarget?.clubName || 'No club entered'}`,
          `${feedbackDeleteTarget?.voteCount ?? 0} votes`,
        ]}
        confirmLabel="Delete Feedback"
        errorMessage={confirmErrorMessage}
        onCancel={() => {
          setFeedbackDeleteTarget(null)
          setConfirmErrorMessage('')
        }}
        requirePassword
        onConfirm={confirmDeleteFeedback}
      />

      <ConfirmModal
        isOpen={Boolean(clubDeleteTarget)}
        isBusy={Boolean(updatingClubId)}
        title="Delete club workspace"
        message="This is a platform admin action and cannot be undone from the app."
        items={[
          `Club: ${clubDeleteTarget?.name || 'Selected club'}`,
          `${clubDeleteTarget?.userCount ?? 0} adult users`,
          `${clubDeleteTarget?.teamCount ?? 0} teams`,
          `${clubDeleteTarget?.playerCount ?? 0} player records`,
          `${clubDeleteTarget?.evaluationCount ?? 0} development records`,
          'Club settings and related workspace data',
        ]}
        confirmLabel="Delete Club"
        onCancel={() => setClubDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteClub(password)}
      />

      <ConfirmModal
        isOpen={Boolean(teamDeleteTarget)}
        isBusy={Boolean(updatingTeamId)}
        title="Delete team"
        message="This is a platform admin action and cannot be undone from the app."
        items={[
          `Team: ${teamDeleteTarget?.name || 'Selected team'}`,
          `Club: ${teamDeleteTarget?.clubName || 'No club entered'}`,
          'Team staff allocations linked to this team',
          'Team links on sessions will be cleared by the database where required',
          'Other team links follow database delete rules and may be cleared or block deletion',
        ]}
        confirmLabel="Delete team"
        errorMessage={confirmErrorMessage}
        onCancel={() => {
          setTeamDeleteTarget(null)
          setConfirmErrorMessage('')
        }}
        requirePassword
        onConfirm={confirmDeleteTeam}
      />

      <ConfirmModal
        isOpen={Boolean(accountActionTarget)}
        isBusy={Boolean(updatingUserId)}
        title={
          accountActionTarget?.action === 'delete'
            ? 'Delete user access'
            : accountActionTarget?.action === 'suspend'
              ? 'Suspend user access'
              : 'Reactivate user access'
        }
        message="This platform admin action requires your password before it can continue."
        items={[
          `Name: ${accountActionTarget?.name || 'No name entered'}`,
          `Email: ${accountActionTarget?.email || 'No email entered'}`,
          `Club: ${accountActionTarget?.clubName || 'No club entered'}`,
          `Role: ${accountActionTarget?.roleLabel || 'User'}`,
          accountActionTarget?.action === 'delete'
            ? 'The user profile, club membership, and team allocations will be removed from the app.'
            : 'The user will be blocked from using their workspace until reactivated.',
        ]}
        confirmLabel={
          accountActionTarget?.action === 'delete'
            ? 'Delete User'
            : accountActionTarget?.action === 'suspend'
              ? 'Suspend User'
              : 'Reactivate User'
        }
        onCancel={() => setAccountActionTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmAccountAction(password)}
      />
    </div>
  )
}
