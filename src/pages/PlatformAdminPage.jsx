import { useEffect, useMemo, useState } from 'react'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { isSuperAdmin, useAuth } from '../lib/auth.js'
import {
  createPlatformClub,
  deletePlatformClub,
  getPlatformStats,
  readViewCacheValue,
  updatePlatformClubStatus,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const cacheKey = 'platform-admin-dashboard'

function formatDate(value) {
  if (!value) {
    return 'No activity yet'
  }

  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'No activity yet'
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedDate)
}

export function PlatformAdminPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState(() => readViewCacheValue(cacheKey, 'stats', null))
  const [selectedClubId, setSelectedClubId] = useState('All')
  const [isLoading, setIsLoading] = useState(() => !stats)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isSavingClub, setIsSavingClub] = useState(false)
  const [updatingClubId, setUpdatingClubId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [newClubForm, setNewClubForm] = useState({
    name: '',
    contactEmail: '',
    contactPhone: '',
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

  const visibleClubs = useMemo(() => {
    const clubs = stats?.clubs ?? []
    return selectedClubId === 'All' ? clubs : clubs.filter((club) => club.id === selectedClubId)
  }, [selectedClubId, stats])

  const refreshStats = () => {
    setRefreshKey((current) => current + 1)
  }

  const handleNewClubChange = (fieldName, value) => {
    setNewClubForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
    setErrorMessage('')
    setSuccessMessage('')
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

  const handleDeleteClub = async (club) => {
    const confirmed = window.confirm(
      `Delete ${club.name}? This removes the club workspace, users, players, evaluations, teams, and settings from the app.`,
    )

    if (!confirmed) {
      return
    }

    setUpdatingClubId(club.id)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await deletePlatformClub({
        user,
        clubId: club.id,
      })
      if (selectedClubId === club.id) {
        setSelectedClubId('All')
      }
      setSuccessMessage('Club deleted.')
      refreshStats()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Club could not be deleted.')
    } finally {
      setUpdatingClubId('')
    }
  }

  if (!isSuperAdmin(user)) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader
          eyebrow="Platform"
          title="Platform dashboard"
          description="This area is only available to platform administrators."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Platform dashboard"
        description="View platform usage, clubs, teams, and adult user emails without exposing player personal details."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Platform data is not fully available"
          message={errorMessage}
        />
      ) : null}

      {successMessage ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
          {successMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Clubs', stats?.totals?.clubs ?? 0],
          ['Adult users', stats?.totals?.users ?? 0],
          ['Teams', stats?.totals?.teams ?? 0],
          ['Players', stats?.totals?.players ?? 0],
          ['Assessments', stats?.totals?.evaluations ?? 0],
          ['Shared exports', stats?.totals?.communications ?? 0],
          ['7 day assessments', stats?.totals?.recentEvaluations ?? 0],
          ['7 day shares', stats?.totals?.recentCommunications ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-[var(--text-primary)]">{value}</p>
          </div>
        ))}
      </div>

      <SectionCard
        title="Manage clubs"
        description="Create clubs, suspend access, reactivate access, or delete unused club workspaces."
      >
        <form onSubmit={handleCreateClub} className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club name</span>
            <input
              required
              value={newClubForm.name}
              onChange={(event) => handleNewClubChange('name', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact email</span>
            <input
              type="email"
              value={newClubForm.contactEmail}
              onChange={(event) => handleNewClubChange('contactEmail', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact phone</span>
            <input
              value={newClubForm.contactPhone}
              onChange={(event) => handleNewClubChange('contactPhone', event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={isSavingClub}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingClub ? 'Adding...' : 'Add Club'}
          </button>
        </form>
      </SectionCard>

      <SectionCard
        title="Club usage"
        description="Operational usage only. Player names and child contact details are intentionally excluded."
      >
        <div className="mb-5 max-w-sm">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club filter</span>
            <select
              value={selectedClubId}
              onChange={(event) => setSelectedClubId(event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading platform stats...
          </div>
        ) : visibleClubs.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No clubs found yet.
          </div>
        ) : (
          <div className="space-y-4">
            {visibleClubs.map((club) => (
              <div key={club.id} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
                      Latest activity: {formatDate(club.latestActivityAt)}
                    </p>
                    {club.suspendedAt ? (
                      <p className="mt-2 text-sm text-[var(--text-muted)]">Suspended: {formatDate(club.suspendedAt)}</p>
                    ) : null}
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        disabled={updatingClubId === club.id}
                        onClick={() => void handleToggleClubStatus(club)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {club.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                      <button
                        type="button"
                        disabled={updatingClubId === club.id}
                        onClick={() => void handleDeleteClub(club)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-4 lg:min-w-[620px]">
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Users</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.userCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Teams</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.teamCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Players</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.playerCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Shares</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.communicationCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Trial</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.trialPlayerCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Squad</p>
                      <p className="mt-2 font-semibold text-[var(--text-primary)]">{club.squadPlayerCount}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Adult user emails</p>
                    <div className="mt-3 space-y-2">
                      {club.users.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No users found.</p>
                      ) : (
                        club.users.map((member) => (
                          <div key={member.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                            <p className="break-words text-sm font-semibold text-[var(--text-primary)]">{member.email}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">{member.roleLabel}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Teams and role mix</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {club.teams.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No teams found.</p>
                      ) : (
                        club.teams.map((team) => (
                          <span
                            key={team.id}
                            className="rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium text-[var(--text-primary)]"
                          >
                            {team.name}
                          </span>
                        ))
                      )}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {club.roleCounts.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">No role data found.</p>
                      ) : (
                        club.roleCounts.map((role) => (
                          <div key={role.label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
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
          </div>
        )}
      </SectionCard>
    </div>
  )
}
