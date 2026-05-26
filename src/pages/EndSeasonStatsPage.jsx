import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canViewEndSeasonStats, useAuth } from '../lib/auth.js'
import { getEndSeasonStats, getTeams, withRequestTimeout } from '../lib/supabase.js'

const fieldClass = 'min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-4 py-5 text-sm font-bold text-[#5f7468] shadow-sm shadow-[#d7eadf]/60'

const seasonRules = [
  {
    label: 'Match day only',
    body: 'Goals, assists, and player votes come from match day records for this calendar year.',
  },
  {
    label: 'Zero still matters',
    body: 'Squad players with no stats remain visible so coaches can review the full group.',
  },
  {
    label: 'Awards are snapshots',
    body: 'Generate awards after records are checked, then use the summary for end-of-season planning.',
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
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState(user?.activeTeamId || '')
  const [stats, setStats] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [awardsGeneratedAt, setAwardsGeneratedAt] = useState('')
  const [sortConfig, setSortConfig] = useState({ field: 'total', direction: 'desc' })

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const [nextTeams, nextStats] = await Promise.all([
          withRequestTimeout(() => getTeams(user), 'Teams could not be loaded.'),
          withRequestTimeout(() => getEndSeasonStats({ user, teamId: selectedTeamId }), 'End of season stats could not be loaded.'),
        ])

        if (isMounted) {
          setTeams(nextTeams)
          setStats(nextStats)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setStats([])
          setErrorMessage(error.message || 'End of season stats could not be loaded.')
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
  }, [selectedTeamId, user])

  const sortedStats = useMemo(() => {
    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1

    return [...stats].sort((left, right) => {
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
  }, [sortConfig, stats])

  const awardSummary = useMemo(() => ({
    goals: getTopPlayers(stats, 'goals'),
    assists: getTopPlayers(stats, 'assists'),
    motmVotes: getTopPlayers(stats, 'motmVotes'),
  }), [stats])

  if (!canViewEndSeasonStats(user)) {
    return <Navigate to="/" replace />
  }

  const selectedTeamName = selectedTeamId
    ? teams.find((team) => team.id === selectedTeamId)?.name || 'Selected team'
    : 'All teams'
  const totalGoals = stats.reduce((total, player) => total + Number(player.goals ?? 0), 0)
  const totalAssists = stats.reduce((total, player) => total + Number(player.assists ?? 0), 0)
  const totalVotes = stats.reduce((total, player) => total + Number(player.motmVotes ?? 0), 0)
  const activePlayers = stats.length

  const generateAwards = () => {
    setAwardsGeneratedAt(new Date().toISOString())
  }

  const updateSort = (field) => {
    setSortConfig((currentSort) => ({
      field,
      direction: currentSort.field === field && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#bfe8cd] bg-white shadow-sm shadow-[#d7eadf]/80">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Season review</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-5xl">
              Turn match day records into a clear end-of-season football review.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475467]">
              Review year-to-date goals, assists, and Player of the Match votes before you publish awards or plan next season.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {seasonRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
                  <p className="text-sm font-black text-[#10231a]">{rule.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#9addb4] bg-[#effbf3] p-5 shadow-sm shadow-[#d7eadf]/80">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Selected view</p>
              <p className="mt-2 break-words text-2xl font-black tracking-tight text-[#101828]">{selectedTeamName}</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">
                {isLoading ? 'Loading current season stats.' : `${activePlayers} squad players included in this review.`}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
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
        description="Stats are calculated from Match Day records and Player of the Match parent polls for the current calendar year."
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <label className="block md:min-w-72">
            <span className={labelClass}>Team</span>
            <select
              value={selectedTeamId}
              onChange={(event) => {
                setSelectedTeamId(event.target.value)
                setAwardsGeneratedAt('')
              }}
              className={fieldClass}
            >
              <option value="">All teams</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={generateAwards}
            disabled={isLoading || stats.length === 0}
            className={primaryButtonClass}
          >
            Generate end of season awards
          </button>
        </div>
      </SectionCard>

      {awardsGeneratedAt ? (
        <SectionCard
          title="Award ceremony summary"
          description={`${selectedTeamName} awards generated from current year Match Day stats.`}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <AwardCard title="Top goal scorer" value={formatWinners(awardSummary.goals, 'goals', 'goals')} />
            <AwardCard title="Top assistant" value={formatWinners(awardSummary.assists, 'assists', 'assists')} />
            <AwardCard title="Top Player of the Match" value={formatWinners(awardSummary.motmVotes, 'votes', 'motmVotes')} />
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Player stats" description="All active squad players are listed, including players with zero Match Day stats.">
        {isLoading ? (
          <p className="rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-5 text-sm font-bold text-[#5f7468] shadow-sm shadow-[#d7eadf]/60">
            Loading end of season stats...
          </p>
        ) : sortedStats.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-[#bfe8cd] shadow-sm shadow-[#d7eadf]/70">
            <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#f8fdf9] text-xs font-black uppercase tracking-[0.14em] text-[#5f7468]">
                <tr className="border-b border-[#d7eadf]">
                  <SortableHeader field="playerName" label="Player" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader field="teamName" label="Team" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="goals" label="Goals" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="assists" label="Assists" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="motmVotes" label="POTM" sortConfig={sortConfig} onSort={updateSort} />
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((player) => (
                  <tr key={player.playerId} className="border-b border-[#d7eadf] bg-white last:border-0 hover:bg-[#f8fdf9]">
                    <td className="px-3 py-3 font-black text-[#101828]">
                      {player.shirtNumber ? `#${player.shirtNumber} ` : ''}{player.playerName}
                    </td>
                    <td className="px-3 py-3 font-semibold text-[#5f7468]">{player.teamName || 'No team'}</td>
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
    <article className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-4 shadow-sm shadow-[#d7eadf]/60">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">{title}</p>
      <p className="mt-3 text-lg font-black text-[#101828]">{value}</p>
    </article>
  )
}

function SeasonMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#bfe8cd] bg-white px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">{label}</p>
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
        } ${isActive ? 'text-[#067a46]' : 'text-[#5f7468]'}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[0.62rem]">{sortLabel}</span>
      </button>
    </th>
  )
}
