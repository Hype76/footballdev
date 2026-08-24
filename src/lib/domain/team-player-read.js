const AUTHORIZATION_ERROR_CODE = '42501'

export function isTeamPlayerAuthorizationError(error) {
  return String(error?.code ?? '').trim() === AUTHORIZATION_ERROR_CODE ||
    /permission denied for function get_team_players/i.test(String(error?.message ?? ''))
}

export function normalizeTeamPlayerMembershipRows(rows, fallbackTeamId = '') {
  return (rows ?? [])
    .map((membership) => {
      const player = membership?.player
      const team = membership?.team

      if (!player?.id) {
        return null
      }

      return {
        ...player,
        team_id: team?.id || membership?.team_id || fallbackTeamId || player.team_id || '',
        team: team?.name || player.team || '',
      }
    })
    .filter(Boolean)
}

export function getTeamPlayerSessionFailure(error) {
  const failure = new Error('Your sign-in has expired. Sign in again, then reopen Availability.')
  failure.code = 'TEAM_PLAYER_SESSION_REQUIRED'
  failure.cause = error
  return failure
}
