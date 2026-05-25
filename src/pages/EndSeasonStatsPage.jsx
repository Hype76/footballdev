import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canViewEndSeasonStats, useAuth } from '../lib/auth.js'
import { getEndSeasonStats, getTeams, withRequestTimeout } from '../lib/supabase.js'

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
      <PageHeader
        eyebrow="Team"
        title="End of Season Stats"
        description="Review year-to-date Match Day goals, assists, and Player of the Match votes for squad players."
      />

      {errorMessage ? <NoticeBanner title="Stats unavailable" message={errorMessage} /> : null}

      <SectionCard
        title="Season view"
        description="Stats are calculated from Match Day records and Player of the Match parent polls for the current calendar year."
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <label className="block md:min-w-72">
            <span className="mb-2 block text-sm font-black text-slate-950">Team</span>
            <select
              value={selectedTeamId}
              onChange={(event) => {
                setSelectedTeamId(event.target.value)
                setAwardsGeneratedAt('')
              }}
              className="min-h-11 border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
            className="inline-flex min-h-11 items-center justify-center bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
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
          <p className="border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
            Loading end of season stats...
          </p>
        ) : sortedStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                <tr className="border-b border-slate-200">
                  <SortableHeader field="playerName" label="Player" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader field="teamName" label="Team" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="goals" label="Goals" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="assists" label="Assists" sortConfig={sortConfig} onSort={updateSort} />
                  <SortableHeader align="right" field="motmVotes" label="POTM" sortConfig={sortConfig} onSort={updateSort} />
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((player) => (
                  <tr key={player.playerId} className="border-b border-slate-200 last:border-0">
                    <td className="px-3 py-3 font-bold text-slate-950">
                      {player.shirtNumber ? `#${player.shirtNumber} ` : ''}{player.playerName}
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-600">{player.teamName || 'No team'}</td>
                    <td className="px-3 py-3 text-right font-bold text-slate-950">{player.goals}</td>
                    <td className="px-3 py-3 text-right font-bold text-slate-950">{player.assists}</td>
                    <td className="px-3 py-3 text-right font-bold text-slate-950">{player.motmVotes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
            No squad players are available for this team.
          </p>
        )}
      </SectionCard>
    </div>
  )
}

function AwardCard({ title, value }) {
  return (
    <article className="border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">{title}</p>
      <p className="mt-3 text-lg font-bold text-slate-950">{value}</p>
    </article>
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
        className={`inline-flex items-center gap-1 font-black uppercase tracking-[0.14em] transition hover:text-slate-950 ${
          align === 'right' ? 'justify-end' : 'justify-start'
        } ${isActive ? 'text-emerald-700' : 'text-slate-500'}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[0.62rem]">{sortLabel}</span>
      </button>
    </th>
  )
}
