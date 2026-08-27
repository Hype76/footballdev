import { resolveTeamNotificationDisplayName } from '../../../src/lib/team-notification-display.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function buildScopedNotificationTitle(label, { clubName = '', teamName = '' } = {}) {
  return [normalizeText(clubName), normalizeText(teamName), normalizeText(label) || 'Update']
    .filter(Boolean)
    .join(' | ')
}

export async function hydrateNotificationScopeNames(client, intents = []) {
  const rows = Array.isArray(intents) ? intents : []
  const clubIds = [...new Set(rows.map((row) => normalizeText(row?.club_id ?? row?.clubId)).filter(Boolean))]
  const teamIds = [...new Set(rows.map((row) => normalizeText(row?.team_id ?? row?.teamId)).filter(Boolean))]
  const [clubResult, teamResult] = await Promise.all([
    clubIds.length > 0
      ? client.from('clubs').select('id, name').in('id', clubIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length > 0
      ? client.from('teams').select('id, club_id, name, notification_display_name').in('id', teamIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (clubResult.error) throw clubResult.error
  if (teamResult.error) throw teamResult.error

  const clubs = new Map((clubResult.data || []).map((club) => [normalizeText(club.id), normalizeText(club.name)]))
  const teams = new Map((teamResult.data || []).map((team) => [normalizeText(team.id), {
    clubId: normalizeText(team.club_id),
    name: resolveTeamNotificationDisplayName(team, team.name),
  }]))

  return rows.map((row) => {
    const clubId = normalizeText(row?.club_id ?? row?.clubId)
    const teamId = normalizeText(row?.team_id ?? row?.teamId)
    const team = teams.get(teamId)
    const authorisedClubId = team?.clubId || clubId
    return {
      ...row,
      club_name: clubs.get(authorisedClubId) || normalizeText(row?.club_name ?? row?.clubName),
      team_name: team?.name || normalizeText(row?.team_name ?? row?.teamName),
    }
  })
}

export async function addScopeToNotificationPayload(client, payload = {}) {
  const [scope] = await hydrateNotificationScopeNames(client, [{
    club_id: payload.clubId,
    team_id: payload.teamId,
  }])
  const clubName = normalizeText(scope?.club_name)
  const teamName = normalizeText(scope?.team_name)

  return {
    ...payload,
    data: {
      ...(payload.data || {}),
      clubName,
      teamName,
    },
    title: buildScopedNotificationTitle(payload.title, { clubName, teamName }),
  }
}
