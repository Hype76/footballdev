import { useEffect, useMemo, useState } from 'react'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { Pagination } from '../components/ui/Pagination.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { isSuperAdmin, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { PLAN_OPTIONS, getPlanName } from '../lib/plans.js'
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
  getPlatformStats,
  readViewCacheValue,
  updatePlatformFeedback,
  updatePlatformClubStatus,
  updatePlatformUserStatus,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const cacheKey = 'platform-admin-dashboard'
const feedbackCacheKey = 'platform-admin-feedback'
const PLATFORM_FEEDBACK_PAGE_SIZE = 6
const CLUB_PAGE_SIZE = 6

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
  const pageMeta = PAGE_META[section] || PAGE_META.dashboard
  const showDashboard = section === 'dashboard'
  const showClubManagement = section === 'clubs'
  const [stats, setStats] = useState(() => readViewCacheValue(cacheKey, 'stats', null))
  const [feedbackItems, setFeedbackItems] = useState(() => {
    const cachedItems = readViewCacheValue(feedbackCacheKey, 'feedbackItems', [])
    return Array.isArray(cachedItems) ? cachedItems : []
  })
  const [feedbackDrafts, setFeedbackDrafts] = useState({})
  const [selectedClubId, setSelectedClubId] = useState('All')
  const [feedbackPage, setFeedbackPage] = useState(1)
  const [clubPage, setClubPage] = useState(1)
  const [feedbackDeleteTarget, setFeedbackDeleteTarget] = useState(null)
  const [clubDeleteTarget, setClubDeleteTarget] = useState(null)
  const [teamDeleteTarget, setTeamDeleteTarget] = useState(null)
  const [accountActionTarget, setAccountActionTarget] = useState(null)
  const [isLoading, setIsLoading] = useState(() => !stats)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(() => feedbackItems.length === 0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isSavingClub, setIsSavingClub] = useState(false)
  const [isSavingPlatformAdmin, setIsSavingPlatformAdmin] = useState(false)
  const [updatingClubId, setUpdatingClubId] = useState('')
  const [updatingTeamId, setUpdatingTeamId] = useState('')
  const [updatingUserId, setUpdatingUserId] = useState('')
  const [updatingFeedbackId, setUpdatingFeedbackId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [newClubForm, setNewClubForm] = useState({
    name: '',
    contactEmail: '',
    contactPhone: '',
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

        setStats(nextStats)
        writeViewCache(cacheKey, {
          stats: nextStats,
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
        const nextFeedbackItems = await withRequestTimeout(
          () => getPlatformFeedback(user),
          'Could not load platform feedback.',
        )

        if (!isMounted) {
          return
        }

        setFeedbackItems(nextFeedbackItems)
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
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Platform feedback could not be refreshed right now.')
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
  }, [refreshKey, user])

  const visibleClubs = useMemo(() => {
    const clubs = stats?.clubs ?? []
    return selectedClubId === 'All' ? clubs : clubs.filter((club) => club.id === selectedClubId)
  }, [selectedClubId, stats])
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
  }

  const confirmDeleteFeedback = async (password) => {
    if (!feedbackDeleteTarget) {
      return
    }

    setUpdatingFeedbackId(feedbackDeleteTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deletePlatformFeedback({
        user,
        feedbackId: feedbackDeleteTarget.id,
      })
      setSuccessMessage('Feedback deleted.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Feedback could not be deleted.')
    } finally {
      setUpdatingFeedbackId('')
      setFeedbackDeleteTarget(null)
    }
  }

  const handleNewClubChange = (fieldName, value) => {
    setNewClubForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  const handlePlatformAdminChange = (fieldName, value) => {
    setPlatformAdminForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
    setErrorMessage('')
    setSuccessMessage('')
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
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Platform admin staff could not be saved.')
    } finally {
      setIsSavingPlatformAdmin(false)
    }
  }

  const handleCreateClub = async (event) => {
    event.preventDefault()
    setIsSavingClub(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await createPlatformClub({
        user,
        name: newClubForm.name,
        contactEmail: newClubForm.contactEmail,
        contactPhone: newClubForm.contactPhone,
      })
      setNewClubForm({
        name: '',
        contactEmail: '',
        contactPhone: '',
      })
      setSuccessMessage('Club created.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club could not be created.')
    } finally {
      setIsSavingClub(false)
    }
  }

  const handleToggleClubStatus = async (club) => {
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
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club status could not be updated.')
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleClubPlanChange = async (club, fieldName, value) => {
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
        body: JSON.stringify({
          clubId: club.id,
          planKey: fieldName === 'planKey' ? value : club.planKey,
          planStatus: fieldName === 'planStatus' ? value : club.planStatus,
          isPlanComped: fieldName === 'isPlanComped' ? value : club.isPlanComped,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Club plan could not be updated.')
      }

      setSuccessMessage(result.message || 'Club plan updated.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club plan could not be updated.')
    } finally {
      setUpdatingClubId('')
    }
  }

  const handleDeleteClub = async (club) => {
    setClubDeleteTarget(club)
  }

  const handleDeleteTeam = async (club, team) => {
    setTeamDeleteTarget({
      ...team,
      clubName: club.name,
      clubId: club.id,
    })
  }

  const confirmDeleteTeam = async (password) => {
    if (!teamDeleteTarget) {
      return
    }

    setUpdatingTeamId(teamDeleteTarget.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deletePlatformTeam({
        user,
        teamId: teamDeleteTarget.id,
      })
      setSuccessMessage('Team deleted.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Team could not be deleted.')
    } finally {
      setUpdatingTeamId('')
      setTeamDeleteTarget(null)
    }
  }

  const handleAccountAction = async (club, member, action) => {
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
  const feedbackStats = getFeedbackStats(feedbackItems)

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
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      {showDashboard ? (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-8">
            <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[var(--accent)] opacity-15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 left-10 h-52 w-52 rounded-full bg-sky-400 opacity-10 blur-3xl" />
            <div className="relative grid gap-6 xl:grid-cols-[1.35fr_0.65fr] xl:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">Live platform overview</p>
                <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl">
                  Clean operational numbers across clubs, teams, users, and player feedback.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">
                  This dashboard shows platform level health without exposing child names or player personal details.
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)]/80 p-5 backdrop-blur">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-[var(--accent)] shadow-[0_0_24px_var(--accent)] animate-pulse" />
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {isLoading ? 'Refreshing live stats' : 'Live stats loaded'}
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                  Last refresh: {formatPlatformDate(new Date().toISOString())}
                </p>
                <button
                  type="button"
                  onClick={refreshStats}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:-translate-y-0.5 hover:bg-[var(--panel-soft)]"
                >
                  Refresh platform stats
                </button>
              </div>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {dashboardStats.map((item) => (
              <div
                key={item.label}
                className="group relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 transition duration-300 hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[var(--accent)] opacity-70" />
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">{item.label}</p>
                    <p className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">{item.value}</p>
                  </div>
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--accent)] opacity-70 transition group-hover:scale-150 group-hover:opacity-100" />
                </div>
                <p className="mt-4 text-sm font-semibold text-[var(--text-primary)]">{item.caption}</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{item.detail}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <SectionCard
              title="Platform admin staff"
              description="Create owner level staff accounts for trusted platform operators."
            >
              <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                <form className="grid gap-4" onSubmit={handleCreatePlatformAdmin}>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Name</span>
                    <input
                      type="text"
                      value={platformAdminForm.name}
                      onChange={(event) => handlePlatformAdminChange('name', event.target.value)}
                      placeholder="Staff member name"
                      className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email</span>
                    <input
                      type="email"
                      value={platformAdminForm.email}
                      onChange={(event) => handlePlatformAdminChange('email', event.target.value)}
                      required
                      placeholder="admin@example.com"
                      className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Temporary password</span>
                    <input
                      type="password"
                      value={platformAdminForm.password}
                      onChange={(event) => handlePlatformAdminChange('password', event.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSavingPlatformAdmin}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingPlatformAdmin ? 'Saving...' : 'Add Platform Admin'}
                  </button>
                  <p className="text-sm leading-6 text-[var(--text-muted)]">
                    This creates or promotes the account to platform admin access on this environment.
                  </p>
                </form>

                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Current platform admins</p>
                  <div className="mt-3 space-y-2">
                    {platformAdmins.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
                        No platform admins found.
                      </p>
                    ) : (
                      platformAdmins.map((admin) => (
                        <div key={admin.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-semibold text-[var(--text-primary)]">
                                {admin.name || 'No name entered'}
                              </p>
                              <p className="mt-1 break-words text-sm text-[var(--text-muted)]">{admin.email}</p>
                            </div>
                            <span
                              className={[
                                'inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]',
                                admin.status === 'suspended'
                                  ? 'bg-red-500/15 text-red-300'
                                  : 'bg-[var(--button-primary)] text-[var(--button-primary-text)]',
                              ].join(' ')}
                            >
                              {admin.status === 'suspended' ? 'Suspended' : 'Active'}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Plan mix"
              description="How active club workspaces are currently distributed."
            >
              <div className="space-y-3">
                {Object.entries(planBreakdown).length > 0 ? (
                  Object.entries(planBreakdown).map(([planName, count]) => (
                    <div key={planName} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{planName}</p>
                        <p className="text-lg font-semibold text-[var(--accent)]">{count}</p>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel-bg)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all duration-700"
                          style={{
                            width: `${Math.max(8, Math.round((count / Math.max(1, platformTotals.clubs ?? 1)) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-sm text-[var(--text-muted)]">
                    No plan data is available yet.
                  </p>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Data hygiene"
              description="Separated live records from archived and internal platform records."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Active players</p>
                  <p className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{platformTotals.players ?? 0}</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{platformTotals.archivedPlayers ?? 0} archived records excluded</p>
                </div>
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Share rows</p>
                  <p className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{platformTotals.communications ?? 0}</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{platformTotals.communicationRows ?? 0} total communication rows</p>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}

      {showClubManagement ? (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-8">
            <div className="pointer-events-none absolute -right-24 top-0 h-56 w-56 rounded-full bg-[var(--accent)] opacity-15 blur-3xl" />
            <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">Club control centre</p>
                <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl">
                  Manage club access, plans, teams, and adult staff accounts from one place.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">
                  This area avoids showing child personal details and focuses only on club level operations.
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)]/80 p-5 backdrop-blur">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-[var(--accent)] shadow-[0_0_24px_var(--accent)] animate-pulse" />
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {isLoading ? 'Refreshing club data' : 'Club data loaded'}
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                  Filter by club, review billing state, suspend access, or remove unused workspaces.
                </p>
              </div>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {clubManagementStats.map((item) => (
              <div
                key={item.label}
                className="group relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 transition duration-300 hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[var(--accent)] opacity-70" />
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">{item.label}</p>
                <p className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">{item.value}</p>
                <p className="mt-3 text-sm text-[var(--text-muted)]">{item.caption}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showClubManagement ? (
      <SectionCard
        title="Manage clubs"
        description="Create clubs, suspend access, reactivate access, or delete unused club workspaces."
      >
        <form onSubmit={handleCreateClub} className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club name</span>
            <input
              required
              value={newClubForm.name}
              onChange={(event) => handleNewClubChange('name', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact email</span>
            <input
              type="email"
              value={newClubForm.contactEmail}
              onChange={(event) => handleNewClubChange('contactEmail', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact phone</span>
            <input
              value={newClubForm.contactPhone}
              onChange={(event) => handleNewClubChange('contactPhone', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={isSavingClub}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingClub ? 'Adding...' : 'Add Club'}
          </button>
        </form>
      </SectionCard>
      ) : null}

      {showDashboard ? (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-8">
            <div className="pointer-events-none absolute -right-24 top-0 h-56 w-56 rounded-full bg-[var(--accent)] opacity-15 blur-3xl" />
            <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">Feedback command centre</p>
                <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl">
                  Track product feedback, votes, public comments, and roadmap status.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">
                  Admin replies are visible to users, so clubs can see what is planned, in progress, or complete.
                </p>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)]/80 p-5 backdrop-blur">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-[var(--accent)] shadow-[0_0_24px_var(--accent)] animate-pulse" />
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {isFeedbackLoading ? 'Refreshing feedback' : 'Feedback board loaded'}
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                  Prioritise product work from the most requested ideas.
                </p>
              </div>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {feedbackStats.map((item) => (
              <div
                key={item.label}
                className="group relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 transition duration-300 hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[var(--accent)] opacity-70" />
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">{item.label}</p>
                <p className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">{item.value}</p>
                <p className="mt-3 text-sm text-[var(--text-muted)]">{item.caption}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showDashboard ? (
      <SectionCard
        title="Platform feedback"
        description="Review product feedback, update status, add internal notes, or remove completed items."
      >
        {isFeedbackLoading ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading feedback...
          </div>
        ) : feedbackItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No platform feedback has been submitted yet.
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedFeedbackItems.items.map((item) => {
              const draft = feedbackDrafts[item.id] ?? {
                status: item.status,
                adminComment: '',
              }

              return (
                <div key={item.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
                  <div className="grid gap-4 xl:grid-cols-[1fr_220px]">
                    <div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{item.message}</p>
                      <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                        {item.clubName} | {item.createdByEmail || 'No email'} | {item.voteCount} votes
                      </p>
                    </div>
                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Status</span>
                        <select
                          value={draft.status}
                          onChange={(event) => handleFeedbackDraftChange(item.id, 'status', event.target.value)}
                          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        >
                          <option value="open">Open</option>
                          <option value="planned">Planned</option>
                          <option value="in_progress">In progress</option>
                          <option value="done">Done</option>
                          <option value="declined">Declined</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {item.comments?.length ? (
                    <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">Visible comments</p>
                      <div className="mt-3 space-y-3">
                        {item.comments.map((comment) => (
                          <div key={comment.id} className="rounded-lg bg-[var(--panel-alt)] px-4 py-3">
                            <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{comment.message}</p>
                            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                              Platform admin | {formatPlatformDate(comment.createdAt)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <label className="mt-4 block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Add public comment</span>
                    <textarea
                      rows="3"
                      value={draft.adminComment}
                      onChange={(event) => handleFeedbackDraftChange(item.id, 'adminComment', event.target.value)}
                      placeholder="This will be visible to users on the feedback board."
                      className="min-h-24 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    />
                  </label>

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      disabled={updatingFeedbackId === item.id}
                      onClick={() => void handleSaveFeedback(item)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={updatingFeedbackId === item.id}
                      onClick={() => void handleDeleteFeedback(item)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
            <Pagination
              currentPage={feedbackPage}
              onPageChange={setFeedbackPage}
              pageSize={PLATFORM_FEEDBACK_PAGE_SIZE}
              totalItems={feedbackItems.length}
            />
          </div>
        )}
      </SectionCard>
      ) : null}

      {showClubManagement ? (
      <SectionCard
        title="Account management"
        description="Manage clubs, teams, and adult user access. Player names and child contact details are intentionally excluded."
      >
        <div className="mb-5 max-w-sm">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club filter</span>
            <select
              value={selectedClubId}
              onChange={(event) => {
                setSelectedClubId(event.target.value)
                setClubPage(1)
              }}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="All">All clubs</option>
              {(stats?.clubs ?? []).map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading platform stats...
          </div>
        ) : visibleClubs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No clubs found yet.
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedVisibleClubs.items.map((club) => (
              <div key={club.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
                <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-lg font-semibold text-[var(--text-primary)]">{club.name}</p>
                      <span
                        className={[
                          'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]',
                          club.status === 'suspended'
                            ? 'bg-red-500/15 text-red-300'
                            : 'bg-[var(--button-primary)] text-[var(--button-primary-text)]',
                        ].join(' ')}
                      >
                        {club.status === 'suspended' ? 'Suspended' : 'Active'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      Contact: {club.contactEmail || 'No email entered'}
                      {club.contactPhone ? ` | ${club.contactPhone}` : ''}
                    </p>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      Latest activity: {formatPlatformDate(club.latestActivityAt)}
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Plan</span>
                        <select
                          value={club.planKey || 'small_club'}
                          disabled={updatingClubId === club.id}
                          onChange={(event) => void handleClubPlanChange(club, 'planKey', event.target.value)}
                          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
                        >
                          {PLAN_OPTIONS.map((plan) => (
                            <option key={plan.key} value={plan.key}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Billing status</span>
                        <select
                          value={club.planStatus || 'active'}
                          disabled={updatingClubId === club.id}
                          onChange={(event) => void handleClubPlanChange(club, 'planStatus', event.target.value)}
                          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
                        >
                          <option value="active">Active</option>
                          <option value="trialing">Trialing</option>
                          <option value="past_due">Past due</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </label>
                      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] md:mt-7">
                        <input
                          type="checkbox"
                          checked={Boolean(club.isPlanComped)}
                          disabled={updatingClubId === club.id}
                          onChange={(event) => void handleClubPlanChange(club, 'isPlanComped', event.target.checked)}
                          className="h-4 w-4"
                        />
                        <span>Free access</span>
                      </label>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">
                      Current plan: {getPlanName(club)}{club.isPlanComped ? ' | Free access enabled' : ''}
                    </p>
                    {club.suspendedAt ? (
                      <p className="mt-2 text-sm text-[var(--text-muted)]">Suspended: {formatPlatformDate(club.suspendedAt)}</p>
                    ) : null}
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        disabled={updatingClubId === club.id}
                        onClick={() => void handleToggleClubStatus(club)}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {club.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                      <button
                        type="button"
                        disabled={updatingClubId === club.id}
                        onClick={() => void handleDeleteClub(club)}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="grid w-full gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4 2xl:max-w-[620px]">
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Users</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.userCount}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Teams</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.teamCount}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Players</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.playerCount}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Shares</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.communicationCount}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Trial</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.trialPlayerCount}</p>
                    </div>
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Squad</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.squadPlayerCount}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Adult user accounts</p>
                    <div className="mt-3 space-y-2">
                      {club.users.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No users found.</p>
                      ) : (
                        club.users.map((member) => (
                          <div key={member.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                              <div className="min-w-0">
                                <p className="break-words text-sm font-semibold text-[var(--text-primary)]">
                                  {member.name || 'No name entered'}
                                </p>
                                <p className="mt-1 break-words text-sm text-[var(--text-muted)]">{member.email}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className="rounded-full border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                                    {member.roleLabel}
                                  </span>
                                  <span
                                    className={[
                                      'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]',
                                      member.status === 'suspended'
                                        ? 'bg-red-500/15 text-red-300'
                                        : 'bg-[var(--button-primary)] text-[var(--button-primary-text)]',
                                    ].join(' ')}
                                  >
                                    {member.status === 'suspended' ? 'Suspended' : 'Active'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                                <button
                                  type="button"
                                  disabled={updatingUserId === member.id}
                                  onClick={() =>
                                    void handleAccountAction(
                                      club,
                                      member,
                                      member.status === 'suspended' ? 'reactivate' : 'suspend',
                                    )
                                  }
                                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                                </button>
                                <button
                                  type="button"
                                  disabled={updatingUserId === member.id}
                                  onClick={() => void handleAccountAction(club, member, 'delete')}
                                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Teams</p>
                    <div className="mt-3 space-y-2">
                      {club.teams.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No teams found.</p>
                      ) : (
                        club.teams.map((team) => (
                          <div
                            key={team.id}
                            className="flex flex-col gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="text-sm font-semibold text-[var(--text-primary)]">{team.name}</span>
                            <button
                              type="button"
                              disabled={updatingTeamId === team.id}
                              onClick={() => void handleDeleteTeam(club, team)}
                              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Delete Team
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {club.roleCounts.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No role data found.</p>
                      ) : (
                        club.roleCounts.map((role) => (
                          <div key={role.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{role.label}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                              {role.count} users
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <Pagination
              currentPage={clubPage}
              onPageChange={setClubPage}
              pageSize={CLUB_PAGE_SIZE}
              totalItems={visibleClubs.length}
            />
          </div>
        )}
      </SectionCard>
      ) : null}

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
        onCancel={() => setFeedbackDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteFeedback(password)}
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
          `${clubDeleteTarget?.evaluationCount ?? 0} assessments`,
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
        ]}
        confirmLabel="Delete Team"
        onCancel={() => setTeamDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteTeam(password)}
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
