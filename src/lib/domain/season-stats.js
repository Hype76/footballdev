import { supabase } from '../supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function isValidIsoDate(value) {
  const date = normalizeText(value)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false
  }

  const parsedDate = new Date(`${date}T00:00:00.000Z`)

  return Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date
}

export function formatSeasonDate(value) {
  if (!isValidIsoDate(value)) {
    return ''
  }

  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function getCurrentFootballSeasonDateRange(today = new Date()) {
  const year = today.getFullYear()
  const startYear = today.getMonth() < 6 ? year - 1 : year

  return {
    startDate: `${startYear}-07-01`,
    endDate: `${startYear + 1}-06-30`,
  }
}

export function getSeasonDateRangeError(startDate, endDate) {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    return 'Enter valid From and To dates in YYYY-MM-DD format.'
  }

  if (startDate > endDate) {
    return 'The From date must be on or before the To date.'
  }

  return ''
}

function assertSeasonStatsAccess(user) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin') {
    throw new Error('Manager access is required for end of season stats.')
  }

  if (user.role === 'admin') {
    return
  }

  if (Number(user.roleRank ?? 0) < 20 || !normalizeText(user.activeTeamId)) {
    throw new Error('Team access is required for end of season stats.')
  }
}

export async function getEndSeasonStats({ user, teamId = '', startDate = '', endDate = '' } = {}) {
  assertSeasonStatsAccess(user)
  const isClubAdmin = user?.role === 'admin'
  const safeTeamId = isClubAdmin ? normalizeText(teamId) || null : normalizeText(user.activeTeamId)
  const safeStartDate = normalizeText(startDate)
  const safeEndDate = normalizeText(endDate)
  const dateRangeError = safeStartDate || safeEndDate
    ? getSeasonDateRangeError(safeStartDate, safeEndDate)
    : ''

  if (dateRangeError) {
    throw new Error(dateRangeError)
  }

  const rpcName = safeStartDate && safeEndDate
    ? 'get_end_season_stats_range'
    : 'get_end_season_stats'
  const rpcArgs = safeStartDate && safeEndDate
    ? {
        team_id_value: safeTeamId,
        start_date_value: safeStartDate,
        end_date_value: safeEndDate,
      }
    : { team_id_value: safeTeamId }

  const { data, error } = await supabase.rpc(rpcName, rpcArgs)

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map((row) => ({
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName),
    shirtNumber: normalizeText(row.shirt_number ?? row.shirtNumber),
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: normalizeText(row.team_name ?? row.teamName),
    goals: Number(row.goals ?? 0),
    assists: Number(row.assists ?? 0),
    motmVotes: Number(row.motm_votes ?? row.motmVotes ?? 0),
  }))
}
