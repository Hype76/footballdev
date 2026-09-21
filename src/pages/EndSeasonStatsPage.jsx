import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canViewEndSeasonStats, isClubAdmin, useAuth } from '../lib/auth.js'
import { formatSeasonDate, getCurrentFootballSeasonDateRange, getSeasonDateRangeError } from '../lib/domain/season-stats.js'
import { getAvailableTeamsForUser, getEndSeasonStats, withRequestTimeout } from '../lib/supabase.js'

const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#0f9f6e] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-5 text-sm font-bold text-[#4b5f55] shadow-sm shadow-[#047857]/10'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] shadow-sm shadow-[#047857]/10'
const EMPTY_STATS = []

const seasonRules = [
  {
    label: 'Match day only',
    body: 'Goals and assists use active goal entries within your selected dates. Removed goals and own goals do not count towards individual totals.',
  },
  {
    label: 'Zero still matters',
    body: 'Squad players with no stats remain visible so coaches can review the full group.',
  },
  {
    label: 'Awards are snapshots',
    body: 'Generate POTM awards after records are checked, then use the summary for end-of-season planning.',
  },
]

function getTopPlayers(stats, field) {
  const topValue = Math.max(...stats.map((player) => Number(player[field] ?? 0)), 0)

  if (topValue <= 0) {
    return []
  }

  return stats
    .filter((player) => Number(player[field] ?? 0) === topValue)
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
}

function formatWinners(players, fieldLabel, field) {
  if (players.length === 0) {
    return `No ${fieldLabel} recorded yet.`
  }

  return players.map((player) => `${player.playerName} (${player[field]})`).join(', ')
}

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' })
}

export function EndSeasonStatsPage() {
  const { user } = useAuth()
  const canUseClubWideSeasonView = isClubAdmin(user)
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState(user?.activeTeamId || '')
  const [dateRange, setDateRange] = useState(() => getCurrentFootballSeasonDateRange())
  const [stats, setStats] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadedStatsKey, setLoadedStatsKey] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [awardsGeneratedAt, setAwardsGeneratedAt] = useState('')
  const [sortConfig, setSortConfig] = useState({ field: 'total', direction: 'desc' })

  useEffect(() => {
    let isMounted = true

    async function loadTeams() {
      try {
        const nextTeams = await withRequestTimeout(() => getAvailableTeamsForUser(user), 'Teams could not be loaded.')

        if (isMounted) {
          setTeams(nextTeams)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setTeams([])
        }
      }
    }

    if (user) {
      void loadTeams()
    }

    return () => {
      isMounted = false
    }
  }, [user])

  const dateRangeError = getSeasonDateRangeError(dateRange.startDate, dateRange.endDate)
  const statsRequestKey = `${selectedTeamId}|${dateRange.startDate}|${dateRange.endDate}`

  useEffect(() => {
    let isMounted = true

    async function loadStats() {
      setStats([])
      setLoadedStatsKey('')
      setAwardsGeneratedAt('')
      setErrorMessage('')

      if (dateRangeError) {
        setIsLoading(false)
        setErrorMessage(dateRangeError)
        return
      }

      setIsLoading(true)

      try {
        const nextStats = await withRequestTimeout(
          () => getEndSeasonStats({
            user,
            teamId: selectedTeamId,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
          }),
          'End of season stats could not be loaded.',
        )

        if (isMounted) {
          setStats(nextStats)
          setLoadedStatsKey(statsRequestKey)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'End of season stats could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadStats()
    }

    return () => {
      isMounted = false
    }
  }, [dateRange.endDate, dateRange.startDate, dateRangeError, selectedTeamId, statsRequestKey, user])

  const canDisplayStats = !isLoading && !dateRangeError && loadedStatsKey === statsRequestKey
  const displayedStats = useMemo(
    () => (canDisplayStats ? stats : EMPTY_STATS),
    [canDisplayStats, stats],
  )

  const sortedStats = useMemo(() => {
    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1

    return [...displayedStats].sort((left, right) => {
      let result = 0

      if (sortConfig.field === 'playerName') {
        result = compareText(left.playerName, right.playerName)
      } else if (sortConfig.field === 'teamName') {
        result = compareText(left.teamName || 'No team', right.teamName || 'No team')
      } else if (sortConfig.field === 'goals') {
        result = Number(left.goals ?? 0) - Number(right.goals ?? 0)
      } else if (sortConfig.field === 'assists') {
        result = Number(left.assists ?? 0) - Number(right.assists ?? 0)
      } else if (sortConfig.field === 'motmVotes') {
        result = Number(left.motmVotes ?? 0) - Number(right.motmVotes ?? 0)
      } else {
        const totalLeft = Number(left.goals ?? 0) + Number(left.assists ?? 0) + Number(left.motmVotes ?? 0)
        const totalRight = Number(right.goals ?? 0) + Number(right.assists ?? 0) + Number(right.motmVotes ?? 0)
        result = totalLeft - totalRight
      }

      if (result !== 0) {
        return result * directionMultiplier
      }

      return compareText(left.playerName, right.playerName)
    })
  }, [displayedStats, sortConfig])

  const awardSummary = useMemo(() => ({
    goals: getTopPlayers(displayedStats, 'goals'),
    assists: getTopPlayers(displayedStats, 'assists'),
    motmVotes: getTopPlayers(displayedStats, 'motmVotes'),
  }), [displayedStats])

  if (!canViewEndSeasonStats(user)) {
    return <Navigate to="/" replace />
  }

  const selectedTeamName = selectedTeamId
    ? teams.find((team) => team.id === selectedTeamId)?.name || 'Selected team'
    : canUseClubWideSeasonView ? 'All teams' : user?.activeTeamName || 'Selected team'
  const totalGoals = displayedStats.reduce((total, player) => total + Number(player.goals ?? 0), 0)
  const totalAssists = displayedStats.reduce((total, player) => total + Number(player.assists ?? 0), 0)
  const totalVotes = displayedStats.reduce((total, player) => total + Number(player.motmVotes ?? 0), 0)
  const activePlayers = displayedStats.length

  const generateAwards = () => {
    if (canDisplayStats && displayedStats.length > 0) {
      setAwardsGeneratedAt(new Date().toISOString())
    }
  }

  const updateDate = (field, value) => {
    setAwardsGeneratedAt('')
    setLoadedStatsKey('')
    setDateRange((currentRange) => ({ ...currentRange, [field]: value }))
  }

  const updateSort = (field) => {
    setSortConfig((currentSort) => ({
      field,
      direction: currentSort.field === field && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Season review</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black leading-[1.06] tracking-tight text-[#101828] sm:text-4xl">
              Turn match day records into a clear end-of-season football review.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
              Review goals, assists, and Player of the Match awards for the selected dates before you publish awards or plan next season.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {seasonRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-4 shadow-sm shadow-[#047857]/10">
                  <p className="text-sm font-black text-[#101828]">{rule.label}</p>
                  <p className={`mt-2 ${bodyTextClass}`}>{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-5 shadow-sm shadow-[#047857]/10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Selected view</p>
              <p className="mt-2 break-words text-2xl font-black tracking-tight text-[#101828]">{selectedTeamName}</p>
              <p className={`mt-2 ${bodyTextClass}`}>
                {isLoading ? 'Loading selected period stats.' : `${activePlayers} squad players included in this review.`}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SeasonMetric label="Players" value={isLoading ? '...' : activePlayers} />
              <SeasonMetric label="Goals" value={isLoading ? '...' : totalGoals} />
              <SeasonMetric label="Assists" value={isLoading ? '...' : totalAssists} />
              <SeasonMetric label="POTM" value={isLoading ? '...' : totalVotes} />
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Stats unavailable" message={errorMessage} /> : null}

      <SectionCard
        title="Season view"
        description="Choose the dates to include. The default football season runs from 1 July to 30 June. Stats use Match Day records and Player of the Match awards within the selected dates."
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          {canUseClubWideSeasonView ? (
            <label className="block md:min-w-72">
              <span className={labelClass}>Team</span>
              <select
                value={selectedTeamId}
                onChange={(event) => {
                  setSelectedTeamId(event.target.value)
                  setAwardsGeneratedAt('')
                  setLoadedStatsKey('')
                }}
                className={fieldClass}
              >
                <option value="">All teams</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="block md:min-w-72">
              <span className={labelClass}>Team</span>
              <div className={`${fieldClass} flex items-center`}>{selectedTeamName}</div>
            </div>
          )}

          <label className="block">
            <span className={labelClass}>From</span>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(event) => updateDate('startDate', event.target.value)}
              className={fieldClass}
              aria-describedby={dateRangeError ? 'season-date-range-error' : undefined}
            />
          </label>

          <label className="block">
            <span className={labelClass}>To</span>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(event) => updateDate('endDate', event.target.value)}
              className={fieldClass}
              aria-describedby={dateRangeError ? 'season-date-range-error' : undefined}
            />
          </label>

          <button
            type="button"
            onClick={generateAwards}
            disabled={!canDisplayStats || displayedStats.length === 0}
            className={primaryButtonClass}
          >
            Generate end of season awards
          </button>
        </div>
        {dateRangeError ? <p id="season-date-range-error" className="mt-3 text-sm font-bold text-[#b42318]">{dateRangeError}</p> : null}
      </SectionCard>

      {awardsGeneratedAt ? (
        <SectionCard
          title="Award ceremony summary"
          description={`${selectedTeamName} awards generated from Match Day stats between ${formatSeasonDate(dateRange.startDate)} and ${formatSeasonDate(dateRange.endDate)}, inclusive. Joint winners share the award when they have the same highest total.`}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <AwardCard title="Top goal scorer" value={formatWinners(awardSummary.goals, 'goals', 'goals')} />
            <AwardCard title="Top assistant" value={formatWinners(awardSummary.assists, 'assists', 'assists')} />
            <AwardCard title="Most POTM awards" value={formatWinners(awardSummary.motmVotes, 'POTM awards', 'motmVotes')} />
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Player stats" description="All active squad players are listed for the selected dates. Manual score corrections do not assign goals or assists to a player.">
        {isLoading ? (
          <p className={emptyStateClass}>
            Loading end of season stats...
          </p>
        ) : dateRangeError ? (
          <p className={emptyStateClass}>Correct the date range to load player stats.</p>
        ) : sortedStats.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-[#d7e5dc] shadow-sm shadow-[#047857]/10">
            <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#ecfdf5] text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
                <tr className="border-b border-[#d7e5dc]">
                  <SortableHeader field="playerName" label="Player" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader field="teamName" label="Team" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="goals" label="Goals" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="assists" label="Assists" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="motmVotes" label="POTM" sortConfig={sortConfig} onSort={updateSort} />
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((player) => (
                  <tr key={player.playerId} className="border-b border-[#d7e5dc] bg-white last:border-0 hover:bg-[#ecfdf5]">
                    <td className="px-3 py-3 font-black text-[#101828]">
                      {player.shirtNumber ? `#${player.shirtNumber} ` : ''}{player.playerName}
                    </td>
                    <td className="px-3 py-3 font-semibold text-[#4b5f55]">{player.teamName || 'No team'}</td>
                    <td className="px-3 py-3 text-right font-black text-[#101828]">{player.goals}</td>
                    <td className="px-3 py-3 text-right font-black text-[#101828]">{player.assists}</td>
                    <td className="px-3 py-3 text-right font-black text-[#101828]">{player.motmVotes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ) : (
          <p className={emptyStateClass}>
            No squad players are available for this team.
          </p>
        )}
      </SectionCard>
    </div>
  )
}

function AwardCard({ title, value }) {
  return (
    <article className={`${panelClass} p-4`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{title}</p>
      <p className="mt-3 text-lg font-black text-[#101828]">{value}</p>
    </article>
  )
}

function SeasonMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{label}</p>
      <p className="mt-2 break-words text-2xl font-black text-[#101828]">{value}</p>
    </div>
  )
}

function SortableHeader({ align = 'left', field, label, onSort, sortConfig }) {
  const isActive = sortConfig.field === field
  const directionLabel = isActive && sortConfig.direction === 'asc' ? 'ascending' : 'descending'
  const sortLabel = isActive ? (sortConfig.direction === 'asc' ? 'Asc' : 'Desc') : 'Sort'

  return (
    <th className={`px-3 py-3 ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={`Sort ${label} ${directionLabel}`}
        className={`inline-flex items-center gap-1 font-black uppercase tracking-[0.14em] transition hover:text-[#101828] ${
          align === 'right' ? 'justify-end' : 'justify-start'
        } ${isActive ? 'text-[#047857]' : 'text-[#4b5f55]'}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[0.62rem]">{sortLabel}</span>
      </button>
    </th>
  )
}
