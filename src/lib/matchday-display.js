function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeScore(value) {
  const score = Number(value ?? 0)
  return Number.isFinite(score) ? score : 0
}

export function getMatchDayDisplayParts(match = {}) {
  const teamName = normalizeText(match.teamName ?? match.team_name) || 'Our team'
  const opponent = normalizeText(match.opponent) || 'Opponent'
  const homeAway = normalizeText(match.homeAway ?? match.home_away).toLowerCase()
  const homeScore = normalizeScore(match.homeScore ?? match.home_score)
  const awayScore = normalizeScore(match.awayScore ?? match.away_score)

  if (homeAway === 'away') {
    return {
      firstTeam: opponent,
      secondTeam: teamName,
      firstScore: homeScore,
      secondScore: awayScore,
      firstSide: 'home',
      secondSide: 'away',
    }
  }

  return {
    firstTeam: teamName,
    secondTeam: opponent,
    firstScore: homeScore,
    secondScore: awayScore,
    firstSide: homeAway === 'neutral' ? 'team' : 'home',
    secondSide: homeAway === 'neutral' ? 'opponent' : 'away',
  }
}

export function getMatchDayDisplayName(match = {}) {
  const { firstTeam, secondTeam } = getMatchDayDisplayParts(match)
  return `${firstTeam} v ${secondTeam}`
}

export function getMatchDayDisplayScore(match = {}) {
  const { firstScore, secondScore } = getMatchDayDisplayParts(match)
  return `${firstScore} - ${secondScore}`
}
