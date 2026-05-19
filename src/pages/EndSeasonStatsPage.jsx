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

export function EndSeasonStatsPage() {
  const { user } = useAuth()
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState(user?.activeTeamId || '')
  const [stats, setStats] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [awardsGeneratedAt, setAwardsGeneratedAt] = useState('')

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

  const sortedStats = useMemo(
    () =>
      [...stats].sort((left, right) => {
        const totalLeft = left.goals + left.assists + left.motmVotes
        const totalRight = right.goals + right.assists + right.motmVotes

        if (totalRight !== totalLeft) {
          return totalRight - totalLeft
        }

        return left.playerName.localeCompare(right.playerName)
      }),
    [stats],
  )

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

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Team"
        title="End of Season Stats"
        description="Review year-to-date Match Day goals, assists, and Man of the Match votes for squad players."
      />

      {errorMessage ? <NoticeBanner title="Stats unavailable" message={errorMessage} /> : null}

      <SectionCard
        title="Season view"
        description="Stats are calculated from Match Day records and Man of the Match parent polls for the current calendar year."
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <label className="block md:min-w-72">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
            <select
              value={selectedTeamId}
              onChange={(event) => {
                setSelectedTeamId(event.target.value)
                setAwardsGeneratedAt('')
              }}
              className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text-primary)]"
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
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
            <AwardCard title="Top Man of the Match" value={formatWinners(awardSummary.motmVotes, 'votes', 'motmVotes')} />
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Player stats" description="All active squad players are listed, including players with zero Match Day stats.">
        {isLoading ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading end of season stats...
          </p>
        ) : sortedStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                <tr className="border-b border-[var(--border-color)]">
                  <th className="px-3 py-3">Player</th>
                  <th className="px-3 py-3">Team</th>
                  <th className="px-3 py-3 text-right">Goals</th>
                  <th className="px-3 py-3 text-right">Assists</th>
                  <th className="px-3 py-3 text-right">MOTM</th>
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((player) => (
                  <tr key={player.playerId} className="border-b border-[var(--border-color)] last:border-0">
                    <td className="px-3 py-3 font-semibold text-[var(--text-primary)]">
                      {player.shirtNumber ? `#${player.shirtNumber} ` : ''}{player.playerName}
                    </td>
                    <td className="px-3 py-3 text-[var(--text-muted)]">{player.teamName || 'No team'}</td>
                    <td className="px-3 py-3 text-right font-semibold text-[var(--text-primary)]">{player.goals}</td>
                    <td className="px-3 py-3 text-right font-semibold text-[var(--text-primary)]">{player.assists}</td>
                    <td className="px-3 py-3 text-right font-semibold text-[var(--text-primary)]">{player.motmVotes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No squad players are available for this team.
          </p>
        )}
      </SectionCard>
    </div>
  )
}

function AwardCard({ title, value }) {
  return (
    <article className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{title}</p>
      <p className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{value}</p>
    </article>
  )
}
