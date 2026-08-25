import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import {
  PlatformDataHygieneSection,
  PlatformOperationalSummarySection,
  PlatformPlanMixSection,
  PlatformStaffRoleSummarySection,
} from '../components/platform/PlatformDashboardCards.jsx'
import { PlatformAdminStaffSection } from '../components/platform/PlatformAdminStaffSection.jsx'
import { ManageClubsSection } from '../components/platform/ManageClubsSection.jsx'
import { PlatformAccountManagementSection } from '../components/platform/PlatformAccountManagementSection.jsx'
import { PlatformFeedbackSection } from '../components/platform/PlatformFeedbackSection.jsx'
import { PlatformBannerManagementSection } from '../components/platform/PlatformBannerManagementSection.jsx'
import { PlatformHeroSection, PlatformStatGrid } from '../components/platform/PlatformHeroSection.jsx'
import { PlatformAnalyticsSection } from '../components/platform/PlatformAnalyticsSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { isSuperAdmin, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { logPlatformStatsDiagnostic, normalizePlatformStatsPayload } from '../lib/domain/platform-normalizers.js'
import { PLAN_KEYS } from '../lib/plans.js'
import {
  DEFAULT_PLATFORM_BANNERS,
  PLATFORM_BANNER_AUDIENCES,
} from '../lib/platform-banner-config.js'
import {
  formatPlatformDate,
  getClubManagementStats,
  getFeedbackStats,
  getPlanBreakdown,
  getPlatformDashboardStats,
} from '../lib/platform-admin-stats.js'
import {
  createPlatformClub,
  changeStaffRoleAssignment,
  deletePlatformFeedback,
  deletePlatformClub,
  deletePlatformTeam,
  getPlatformFeedback,
  getPlatformFeedbackAttachmentUrl,
  getPlatformFeedbackReports,
  getPlatformBanners,
  getPlatformAnalytics,
  getPlatformStats,
  readViewCacheValue,
  setPlatformClubArchived,
  setPlatformTeamArchived,
  updatePlatformFeedback,
  updatePlatformFeedbackReportStatus,
  updatePlatformBanner,
  updatePlatformClubStatus,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const cacheKey = 'platform-admin-dashboard'
const feedbackCacheKey = 'platform-admin-feedback'
const PLATFORM_FEEDBACK_PAGE_SIZE = 6
const CLUB_PAGE_SIZE = 6
const DEFAULT_ANALYTICS_FILTERS = Object.freeze({
  preset: '30_days',
  startDate: '',
  endDate: '',
  role: 'all',
  platform: 'all',
  clubId: 'all',
  plan: 'all',
  route: 'all',
  activityType: 'all',
  environment: 'production',
  pageFamily: 'all',
  includeInternal: false,
  includeFpTest: false,
})

const ANALYTICS_QUERY_KEYS = Object.freeze({
  preset: 'analytics_range',
  startDate: 'analytics_start',
  endDate: 'analytics_end',
  role: 'analytics_role',
  platform: 'analytics_platform',
  clubId: 'analytics_club',
  plan: 'analytics_plan',
  activityType: 'analytics_activity',
  environment: 'analytics_environment',
  pageFamily: 'analytics_page',
  includeInternal: 'analytics_internal',
  includeFpTest: 'analytics_fp_test',
})

function readAnalyticsFilters(searchParams) {
  const next = { ...DEFAULT_ANALYTICS_FILTERS }
  for (const [filterKey, queryKey] of Object.entries(ANALYTICS_QUERY_KEYS)) {
    const value = searchParams.get(queryKey)
    if (value === null) continue
    next[filterKey] = ['includeInternal', 'includeFpTest'].includes(filterKey) ? value === 'true' : value
  }
  if (!['today', '7_days', '30_days', '90_days', 'custom'].includes(next.preset)) next.preset = '30_days'
  if (!['all', 'authentication', 'navigation', 'meaningful_action'].includes(next.activityType)) next.activityType = 'all'
  if (!['all', 'production', 'preview', 'test', 'local'].includes(next.environment)) next.environment = 'production'
  if (next.clubId !== 'all' && !/^[0-9a-f-]{36}$/i.test(next.clubId)) next.clubId = 'all'
  return next
}

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

  if (code === 'team_must_be_archived_before_delete') {
    return 'Move this Team to the archive before permanently deleting it.'
  }

  if (code === 'club_must_be_archived_before_delete') {
    return 'Move this Club to the archive before permanently deleting it.'
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
  analytics: {
    title: 'Platform Analytics',
    description: 'Review privacy-safe usage, adoption, page, role, club, day, and time reporting.',
  },
  banners: {
    title: 'Platform Banners',
    description: 'Manage separate announcements for landing pages, logged-in users, and the Parent Portal.',
  },
  staff: {
    title: 'Platform Admins',
    description: 'Review platform roles and manage trusted Platform Admin accounts.',
  },
  hygiene: {
    title: 'Data Hygiene',
    description: 'Review active, archived, communication, and recent admin record quality without destructive cleanup.',
  },
}

export function PlatformAdminPage({ section = 'dashboard' }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { session, user } = useAuth()
  const { showToast } = useToast()
  const pageMeta = PAGE_META[section] || PAGE_META.dashboard
  const showDashboard = section === 'dashboard'
  const showClubManagement = section === 'clubs'
  const showAnalytics = section === 'analytics'
  const showBanners = section === 'banners'
  const showPlatformStaff = section === 'staff'
  const showDataHygiene = section === 'hygiene'
  const showLegacyFeedback = section === 'feedback-legacy'
  const [stats, setStats] = useState(() => readCachedPlatformStats())
  const [analyticsReport, setAnalyticsReport] = useState(null)
  const [analyticsFilters, setAnalyticsFilters] = useState(() => readAnalyticsFilters(searchParams))
  const [analyticsErrorMessage, setAnalyticsErrorMessage] = useState('')
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false)
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
  const [clubRecordView, setClubRecordView] = useState('active')
  const [feedbackPage, setFeedbackPage] = useState(1)
  const [clubPage, setClubPage] = useState(1)
  const [feedbackDeleteTarget, setFeedbackDeleteTarget] = useState(null)
  const [platformAdminDeleteTarget, setPlatformAdminDeleteTarget] = useState(null)
  const [clubDeleteTarget, setClubDeleteTarget] = useState(null)
  const [teamDeleteTarget, setTeamDeleteTarget] = useState(null)
  const [clubArchiveTarget, setClubArchiveTarget] = useState(null)
  const [teamArchiveTarget, setTeamArchiveTarget] = useState(null)
  const [accountActionTarget, setAccountActionTarget] = useState(null)
  const [isLoading, setIsLoading] = useState(() => !stats)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(() => feedbackItems.length === 0 && feedbackReports.length === 0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isSavingClub, setIsSavingClub] = useState(false)
  const [isSavingPlatformAdmin, setIsSavingPlatformAdmin] = useState(false)
  const [isBannerLoading, setIsBannerLoading] = useState(true)
  const [savingBannerKey, setSavingBannerKey] = useState('')
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
  const [bannerErrorMessage, setBannerErrorMessage] = useState('')
  const [bannerDrafts, setBannerDrafts] = useState(DEFAULT_PLATFORM_BANNERS)
  const [createdClubInvite, setCreatedClubInvite] = useState(null)
  const [newClubForm, setNewClubForm] = useState({
    name: '',
    contactEmail: '',
    contactPhone: '',
    ownerEmail: '',
    planKey: 'small_club',
    billingArrangement: 'immediate',
    billingStartDate: '',
  })
  const [platformAdminForm, setPlatformAdminForm] = useState({
    name: '',
    email: '',
    password: '',
  })

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    for (const [filterKey, queryKey] of Object.entries(ANALYTICS_QUERY_KEYS)) {
      const value = analyticsFilters[filterKey]
      const defaultValue = DEFAULT_ANALYTICS_FILTERS[filterKey]
      if (value === defaultValue || value === '' || value === false) next.delete(queryKey)
      else next.set(queryKey, String(value))
    }
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [analyticsFilters, searchParams, setSearchParams])

  const loadAnalytics = async ({ refresh = false } = {}) => {
    if (!isSuperAdmin(user) || !session?.access_token) return

    setIsAnalyticsLoading(true)
    setAnalyticsErrorMessage('')

    try {
      const report = await getPlatformAnalytics({
        accessToken: session.access_token,
        filters: analyticsFilters,
        refresh,
      })
      setAnalyticsReport(report)
    } catch (error) {
      console.error({ code: error?.code || 'platform_analytics_load_failed' })
      setAnalyticsErrorMessage('Aggregate analytics could not be loaded. Existing platform controls remain available.')
    } finally {
      setIsAnalyticsLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      if (!isSuperAdmin(user) || !session?.access_token) return
      setIsAnalyticsLoading(true)
      setAnalyticsErrorMessage('')

      try {
        const report = await getPlatformAnalytics({
          accessToken: session.access_token,
          filters: analyticsFilters,
        })
        if (isMounted) setAnalyticsReport(report)
      } catch (error) {
        console.error({ code: error?.code || 'platform_analytics_load_failed' })
        if (isMounted) setAnalyticsErrorMessage('Aggregate analytics could not be loaded. Existing platform controls remain available.')
      } finally {
        if (isMounted) setIsAnalyticsLoading(false)
      }
    }

    void load()
    return () => {
      isMounted = false
    }
  }, [analyticsFilters, session?.access_token, user])

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

  useEffect(() => {
    let isMounted = true

    const loadBanner = async () => {
      if (!isSuperAdmin(user)) {
        setIsBannerLoading(false)
        return
      }

      setBannerErrorMessage('')

      try {
        const nextBanners = await withRequestTimeout(
          () => getPlatformBanners({ user }),
          'Could not load banner controls.',
        )

        if (isMounted) {
          setBannerDrafts(nextBanners)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setBannerErrorMessage('Banner controls could not be loaded. Refresh the page and try again.')
        }
      } finally {
        if (isMounted) {
          setIsBannerLoading(false)
        }
      }
    }

    void loadBanner()

    return () => {
      isMounted = false
    }
  }, [user])

  const workspaceArchiveCount = useMemo(() => {
    const clubs = stats?.clubs ?? []
    const archivedClubCount = clubs.filter((club) => Boolean(club.archivedAt)).length
    const archivedTeamCount = clubs
      .filter((club) => !club.archivedAt)
      .reduce((total, club) => total + (club.teams ?? []).filter((team) => Boolean(team.archivedAt)).length, 0)

    return archivedClubCount + archivedTeamCount
  }, [stats])

  const visibleClubs = useMemo(() => {
    const clubs = stats?.clubs ?? []
    const scopedClubs = clubs.flatMap((club) => {
      const teams = Array.isArray(club.teams) ? club.teams : []

      if (clubRecordView === 'archived') {
        if (club.archivedAt) {
          return [{ ...club, teamCount: teams.length, teams }]
        }

        const archivedTeams = teams.filter((team) => Boolean(team.archivedAt))
        return archivedTeams.length > 0 ? [{ ...club, teams: archivedTeams }] : []
      }

      if (club.archivedAt) {
        return []
      }

      const activeTeams = teams.filter((team) => !team.archivedAt)
      return [{ ...club, teamCount: activeTeams.length, teams: activeTeams }]
    })
    const selectedClubs = selectedClubId === 'All'
      ? scopedClubs
      : scopedClubs.filter((club) => club.id === selectedClubId)
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
  }, [clubRecordView, clubSearchTerm, selectedClubId, stats])
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
      ...(fieldName === 'billingArrangement' && value !== 'complimentary' && current.planKey === 'individual'
        ? { planKey: 'single_team' }
        : {}),
      ...(fieldName === 'planKey' && [PLAN_KEYS.individual, PLAN_KEYS.pilot].includes(value)
        ? { billingArrangement: 'complimentary', billingStartDate: '' }
        : {}),
      ...(fieldName === 'billingArrangement' && value !== 'deferred'
        ? { billingStartDate: '' }
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

  const handleBannerChange = (bannerKey, fieldName, value) => {
    setBannerDrafts((current) => ({
      ...current,
      [bannerKey]: {
        ...current[bannerKey],
        [fieldName]: value,
      },
    }))
    setBannerErrorMessage('')
    setSuccessMessage('')
  }

  const handleSaveBanner = async (event, bannerKey) => {
    event.preventDefault()
    setSavingBannerKey(bannerKey)
    setBannerErrorMessage('')
    setSuccessMessage('')

    try {
      const nextBanner = await updatePlatformBanner({
        user,
        bannerKey,
        draft: bannerDrafts[bannerKey],
      })
      const audience = PLATFORM_BANNER_AUDIENCES.find((item) => item.bannerKey === bannerKey)
      const audienceLabel = audience?.label ?? 'Platform'
      setBannerDrafts((current) => ({
        ...current,
        [bannerKey]: nextBanner,
      }))
      setSuccessMessage(nextBanner.enabled
        ? `${audienceLabel} banner enabled and saved.`
        : `${audienceLabel} banner disabled and saved.`)
      showToast({
        title: 'Banner saved',
        message: nextBanner.enabled
          ? `The ${audienceLabel.toLowerCase()} banner is enabled.`
          : `The ${audienceLabel.toLowerCase()} banner is disabled.`,
      })
    } catch (error) {
      console.error(error)
      setBannerErrorMessage(error.message || 'Banner settings could not be saved.')
    } finally {
      setSavingBannerKey('')
    }
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
        throw new Error(result.message || 'Platform Admin accounts could not be saved.')
      }

      setPlatformAdminForm({
        name: '',
        email: '',
        password: '',
      })
      setSuccessMessage('Platform admin Coach saved.')
      showToast({ title: 'Platform admin saved', message: 'Platform admin Coach access has been saved.' })
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Platform Admin accounts could not be saved.')
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
        throw new Error(result.message || 'Platform admin Coach could not be deleted.')
      }

      setSuccessMessage('Platform admin Coach deleted.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Platform admin Coach could not be deleted.')
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
        billingArrangement: newClubForm.billingArrangement,
        billingStartDate: newClubForm.billingStartDate,
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
        billingArrangement: 'immediate',
        billingStartDate: '',
      })
      setCreatedClubInvite(inviteUrl
        ? {
            url: inviteUrl,
            sent: Boolean(ownerInvite?.sent),
            emailFailed: Boolean(ownerInvite?.emailFailed),
            deliveryStatus: ownerInvite?.deliveryStatus || (ownerInvite?.sent ? 'accepted' : 'skipped'),
            deliveryReason: ownerInvite?.deliveryReason || '',
            deliveryMessage: ownerInvite?.deliveryMessage || '',
            roleLabel: ownerInvite?.roleLabel || '',
            scope: ownerInvite?.scope || '',
          }
        : null)
      setSuccessMessage(ownerInvite?.sent ? 'Workspace created and invite accepted for delivery.' : 'Workspace created. Review the invite delivery status below.')
      showToast({
        title: 'Workspace saved',
        message: ownerInvite?.sent ? `The ${ownerInvite?.roleLabel || 'owner'} invite was accepted for delivery.` : 'The invite link is ready.',
      })
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Workspace could not be created.')
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
            : fieldName === 'planKey' && value === PLAN_KEYS.pilot
              ? {
                  clubId: club.id,
                  planKey: value,
                  billingMode: 'unpaid',
                  isPlanComped: true,
                  planStatus: 'active',
                }
            : fieldName === 'billingConfiguration'
              ? {
                  clubId: club.id,
                  billingArrangement: value.billingArrangement,
                  billingStartDate: value.billingStartDate,
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

      const successTitle = fieldName === 'teamLimitOverride'
        ? 'Team allowance saved'
        : fieldName === 'billingConfiguration'
          ? 'Billing access saved'
          : 'Club plan saved'
      setSuccessMessage(result.message || 'Club settings updated.')
      showToast({ title: successTitle, message: result.message || 'Club settings have been updated.' })
      patchClubStats(result.club)
      refreshStats()
      return { success: true, result }
    } catch (error) {
      console.error(error)
      const message = error.message || 'Club plan could not be updated.'
      setErrorMessage(message)
      return { success: false, message }
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleArchiveClub = (club) => {
    if (!club?.id || club.archivedAt) {
      setErrorMessage('This Club record cannot be archived. Refresh the platform data and try again.')
      return
    }

    setClubArchiveTarget(club)
    setErrorMessage('')
    setSuccessMessage('')
  }

  const confirmArchiveClub = async () => {
    if (!clubArchiveTarget?.id || updatingClubId) {
      return
    }

    setUpdatingClubId(clubArchiveTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await setPlatformClubArchived({
        user,
        clubId: clubArchiveTarget.id,
        archived: true,
      })
      if (selectedClubId === clubArchiveTarget.id) {
        setSelectedClubId('All')
      }
      setClubRecordView('archived')
      setClubSearchTerm(clubArchiveTarget.name || '')
      setClubPage(1)
      setSuccessMessage('Club moved to the archive.')
      showToast({ title: 'Club archived', message: 'Review the archived Club below, then restore it or permanently delete it.' })
      setClubArchiveTarget(null)
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club could not be archived.')
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleRestoreClub = async (club) => {
    if (!club?.id || !club.archivedAt || updatingClubId) {
      setErrorMessage('This archived Club record is incomplete. Refresh the platform data and try again.')
      return
    }

    setUpdatingClubId(club.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await setPlatformClubArchived({ user, clubId: club.id, archived: false })
      setSuccessMessage('Club restored from the archive.')
      showToast({ title: 'Club restored', message: `${club.name} is available in active workspaces again.` })
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club could not be restored.')
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleArchiveTeam = (club, team) => {
    if (!club?.id || !team?.id || team.archivedAt) {
      setErrorMessage('This Team record cannot be archived. Refresh the platform data and try again.')
      return
    }

    setTeamArchiveTarget({
      ...team,
      clubName: club.name,
      clubId: club.id,
    })
    setErrorMessage('')
    setSuccessMessage('')
  }

  const confirmArchiveTeam = async () => {
    if (!teamArchiveTarget?.id || !teamArchiveTarget?.clubId || updatingTeamId) {
      return
    }

    setUpdatingTeamId(teamArchiveTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await setPlatformTeamArchived({
        user,
        teamId: teamArchiveTarget.id,
        clubId: teamArchiveTarget.clubId,
        archived: true,
      })
      setSuccessMessage('Team moved to the archive.')
      showToast({ title: 'Team archived', message: `${teamArchiveTarget.name} can be restored from the archive.` })
      setTeamArchiveTarget(null)
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Team could not be archived.')
    } finally {
      setUpdatingTeamId('')
    }
  }

  const handleRestoreTeam = async (club, team) => {
    if (!club?.id || !team?.id || !team.archivedAt || updatingTeamId) {
      setErrorMessage('This archived Team record is incomplete. Refresh the platform data and try again.')
      return
    }

    setUpdatingTeamId(team.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await setPlatformTeamArchived({ user, teamId: team.id, clubId: club.id, archived: false })
      setSuccessMessage('Team restored from the archive.')
      showToast({ title: 'Team restored', message: `${team.name} is available in active workspaces again.` })
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Team could not be restored.')
    } finally {
      setUpdatingTeamId('')
    }
  }

  const handleDeleteClub = async (club) => {
    if (!club?.id) {
      setErrorMessage('This club record is incomplete. Refresh the platform data and try again.')
      return
    }

    if (!club.archivedAt) {
      setErrorMessage('Move this Club to the archive before permanently deleting it.')
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

    if (!team.archivedAt) {
      setErrorMessage('Move this Team to the archive before permanently deleting it.')
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
      setSuccessMessage('Archived Team permanently deleted.')
      setTeamDeleteTarget(null)
      refreshStats()
    } catch (error) {
      console.error(error)
      setConfirmErrorMessage(getPlatformActionErrorMessage(error, 'Team could not be deleted.'))
    } finally {
      setUpdatingTeamId('')
    }
  }

  const handleAccountAction = async (club, member, action, nextRole = null) => {
    if (!club?.id || !member?.id) {
      setErrorMessage('This user record is incomplete. Refresh the platform data and try again.')
      return
    }

    if (action !== 'role') {
      setErrorMessage('Use Club access below to remove or restore a Club assignment without deleting the account.')
      return
    }

    setAccountActionTarget({
      ...member,
      clubId: club.id,
      clubName: club.name,
      action,
      nextRole,
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
      if (accountActionTarget.action !== 'role') {
        throw new Error('Use Club access below to change a Club assignment safely.')
      }

      await verifyCurrentUserPassword(user.email, password)
      await changeStaffRoleAssignment({
        user,
        assignmentId: accountActionTarget.membershipId,
        roleKey: accountActionTarget.nextRole?.roleKey,
        requestSource: 'platform_admin',
      })
      setSuccessMessage('Coach role updated.')
      showToast({
        title: 'Coach role updated',
        message: `${accountActionTarget.name || accountActionTarget.email} is now ${accountActionTarget.nextRole?.roleLabel}.`,
      })

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
    setConfirmErrorMessage('')
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
      setSuccessMessage('Archived Club permanently deleted.')
      setClubDeleteTarget(null)
      refreshStats()
    } catch (error) {
      console.error(error)
      setConfirmErrorMessage(getPlatformActionErrorMessage(error, 'Club could not be deleted.'))
    } finally {
      setUpdatingClubId('')
    }
  }

  const platformTotals = stats?.totals ?? {}
  const planBreakdown = getPlanBreakdown(stats?.clubs ?? [])
  const feedbackStats = getFeedbackStats(feedbackItems, feedbackReports)
  const openIssueCount = feedbackStats.find((item) => item.label === 'Open items')?.value ?? 0
  const dashboardStats = getPlatformDashboardStats(analyticsReport, { openIssueCount })
  const isDashboardLoading = isLoading || isAnalyticsLoading || !analyticsReport
  const platformAdmins = stats?.platformAdmins ?? []
  const clubManagementStats = getClubManagementStats(stats)

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
    <div className="platform-admin-theme space-y-5 sm:space-y-6">
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
            status={isDashboardLoading ? 'Refreshing verified stats' : 'Verified stats loaded'}
            detail={analyticsReport?.generatedAt
              ? `Last refresh: ${formatPlatformDate(analyticsReport.generatedAt)}`
              : 'Waiting for the verified analytics report'}
            actionLabel="Refresh platform stats"
            onAction={refreshStats}
          />

          {analyticsReport ? (
            <PlatformStatGrid items={dashboardStats} />
          ) : (
            <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-5 text-sm font-bold text-[var(--text-muted)]" role="status">
              Loading verified dashboard metrics.
            </p>
          )}

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <PlatformPlanMixSection planBreakdown={planBreakdown} />
            <PlatformOperationalSummarySection
              analyticsReport={analyticsReport}
              openIssueCount={openIssueCount}
              platformTotals={platformTotals}
            />
          </div>
        </div>
      ) : null}

      {showAnalytics ? (
        <PlatformAnalyticsSection
          errorMessage={analyticsErrorMessage}
          filters={analyticsFilters}
          isLoading={isAnalyticsLoading}
          onFiltersChange={setAnalyticsFilters}
          onFiltersReset={() => setAnalyticsFilters({ ...DEFAULT_ANALYTICS_FILTERS })}
          onRefresh={() => void loadAnalytics({ refresh: true })}
          report={analyticsReport}
        />
      ) : null}

      {showBanners ? (
        <PlatformBannerManagementSection
          banners={bannerDrafts}
          errorMessage={bannerErrorMessage}
          isLoading={isBannerLoading}
          savingBannerKey={savingBannerKey}
          onChange={handleBannerChange}
          onSubmit={handleSaveBanner}
        />
      ) : null}

      {showPlatformStaff ? (
        <div className="space-y-5">
          <PlatformStaffRoleSummarySection platformTotals={platformTotals} />
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
        </div>
      ) : null}

      {showDataHygiene ? (
        <PlatformDataHygieneSection platformTotals={platformTotals} />
      ) : null}

      {showClubManagement ? (
        <div className="space-y-5">
          <PlatformHeroSection
            eyebrow="Club control centre"
            title="Manage club access, plans, teams, and adult Coach accounts from one place."
            description="This area avoids showing child personal details and focuses only on club level operations."
            status={isLoading ? 'Refreshing club data' : 'Club data loaded'}
            detail="Filter by club, review billing state, suspend access, or remove unused workspaces."
          />

          <PlatformStatGrid items={clubManagementStats} />
        </div>
      ) : null}

      {showClubManagement ? (
        <ManageClubsSection
          accessToken={session?.access_token || ''}
          createdInvite={createdClubInvite}
          form={newClubForm}
          isSaving={isSavingClub}
          onChange={handleNewClubChange}
          onSubmit={handleCreateClub}
        />
      ) : null}

      {showLegacyFeedback ? (
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

      {showLegacyFeedback ? (
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
          accessToken={session?.access_token || ''}
          archiveCount={workspaceArchiveCount}
          clubPage={clubPage}
          isLoading={isLoading}
          onAccountAction={handleAccountAction}
          onArchiveClub={handleArchiveClub}
          onArchiveTeam={handleArchiveTeam}
          onClubPageChange={setClubPage}
          onClubPlanChange={handleClubPlanChange}
          onDeleteClub={handleDeleteClub}
          onDeleteTeam={handleDeleteTeam}
          onRecordViewChange={(nextView) => {
            setClubRecordView(nextView === 'archived' ? 'archived' : 'active')
            setSelectedClubId('All')
            setClubPage(1)
          }}
          onRestoreClub={handleRestoreClub}
          onRestoreTeam={handleRestoreTeam}
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
          recordView={clubRecordView}
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
        isOpen={Boolean(clubArchiveTarget)}
        isBusy={Boolean(updatingClubId)}
        title="Archive Club before deletion"
        message="Step 1 of 2. This removes the workspace from active access while retaining its records. You will then see the permanent delete option in the Archive view."
        items={[
          `Club: ${clubArchiveTarget?.name || 'Selected Club'}`,
          `${clubArchiveTarget?.teamCount ?? 0} Teams retained`,
          `${clubArchiveTarget?.playerCount ?? 0} player records retained`,
          'The workspace can be restored from the archive.',
        ]}
        confirmLabel="Archive and continue"
        onCancel={() => setClubArchiveTarget(null)}
        onConfirm={confirmArchiveClub}
      />

      <ConfirmModal
        isOpen={Boolean(teamArchiveTarget)}
        isBusy={Boolean(updatingTeamId)}
        title="Archive Team"
        message="This removes the Team from active access while retaining its linked records and identifiers."
        items={[
          `Team: ${teamArchiveTarget?.name || 'Selected Team'}`,
          `Club: ${teamArchiveTarget?.clubName || 'No Club entered'}`,
          'The Team can be restored from the archive.',
        ]}
        confirmLabel="Archive Team"
        onCancel={() => setTeamArchiveTarget(null)}
        onConfirm={confirmArchiveTeam}
      />

      <ConfirmModal
        isOpen={Boolean(clubDeleteTarget)}
        isBusy={Boolean(updatingClubId)}
        title="Permanently delete archived Club"
        message="This permanently deletes an archived Club workspace and cannot be undone from the app."
        items={[
          `Club: ${clubDeleteTarget?.name || 'Selected club'}`,
          `${clubDeleteTarget?.userCount ?? 0} adult users`,
          `${clubDeleteTarget?.teamCount ?? 0} teams`,
          `${clubDeleteTarget?.playerCount ?? 0} player records`,
          `${clubDeleteTarget?.evaluationCount ?? 0} development records`,
          'Club settings and related workspace data',
        ]}
        confirmLabel="Permanently delete Club"
        errorMessage={confirmErrorMessage}
        onCancel={() => {
          setClubDeleteTarget(null)
          setConfirmErrorMessage('')
        }}
        requirePassword
        onConfirm={(password) => void confirmDeleteClub(password)}
      />

      <ConfirmModal
        isOpen={Boolean(teamDeleteTarget)}
        isBusy={Boolean(updatingTeamId)}
        title="Permanently delete archived Team"
        message="This permanently deletes an archived Team and cannot be undone from the app."
        items={[
          `Team: ${teamDeleteTarget?.name || 'Selected team'}`,
          `Club: ${teamDeleteTarget?.clubName || 'No club entered'}`,
          'Team Coach allocations linked to this team',
          'Team links on sessions will be cleared by the database where required',
          'Other team links follow database delete rules and may be cleared or block deletion',
        ]}
        confirmLabel="Permanently delete Team"
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
        title="Confirm Coach role change"
        message="Review the Coach, current role, new role, scope, and access consequence before confirming."
        items={[
          `Name: ${accountActionTarget?.name || 'No name entered'}`,
          `Email: ${accountActionTarget?.email || 'No email entered'}`,
          `Club: ${accountActionTarget?.clubName || 'No club entered'}`,
          `Current role: ${accountActionTarget?.roleLabel || 'User'}`,
          `New role: ${accountActionTarget?.nextRole?.roleLabel || 'No role selected'}`,
          `Scope: ${accountActionTarget?.clubName || 'Selected club'}`,
          Number(accountActionTarget?.nextRole?.roleRank ?? 0) < Number(accountActionTarget?.roleRank ?? 0)
            ? 'Consequence: This removes some Club management authority immediately.'
            : 'Consequence: This grants only the selected club role authority.',
          'The Parent login and access to other Clubs are not changed.',
          'No Coach email or notification will be sent.',
        ]}
        confirmLabel="Change role"
        onCancel={() => setAccountActionTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmAccountAction(password)}
      />
    </div>
  )
}
