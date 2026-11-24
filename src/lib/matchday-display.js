function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeScore(value) {
  const score = Number(value ?? 0)
  return Number.isFinite(score) ? score : 0
}

export function getMatchDayDisplayParts(match = {}) {
  const teamName = normalizeText(match.clubName ?? match.club_name)
    || normalizeText(match.teamName ?? match.team_name)
    || 'Our team'
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
  const title = normalizeText(match.title)
  const knownNames = [match.clubName, match.club_name, match.teamName, match.team_name, match.teams?.name]
    .map(name => normalizeText(name).toLowerCase()).filter(Boolean)
  const titleSides = title.split(/\s+v(?:s\.?)?\s+/i)
  const generatedFixtureTitle = titleSides.length === 2 && titleSides.some(side => knownNames.includes(side.toLowerCase()))
  if (title && !/^match(?:\s+v(?:s\.?)?\b|$)/i.test(title) && !(generatedFixtureTitle && normalizeText(match.opponent))) return title
  const { firstTeam, secondTeam } = getMatchDayDisplayParts(match)
  return `${firstTeam} v ${secondTeam}`
}

export function getMatchDayDisplayScore(match = {}) {
  const { firstScore, secondScore } = getMatchDayDisplayParts(match)
  const shootoutScore = getMatchDayShootoutScore(match)
  return `${firstScore} - ${secondScore}${shootoutScore ? ` (${shootoutScore} pens)` : ''}`
}

export function getMatchDayShootoutScore(match = {}) {
  const home = normalizeScore(match.homeShootoutScore ?? match.home_shootout_score)
  const away = normalizeScore(match.awayShootoutScore ?? match.away_shootout_score)
  const phase = normalizeText(match.currentMatchPhase ?? match.current_match_phase)
  const winner = normalizeText(match.shootoutWinner ?? match.shootout_winner)
  const kicks = match.shootoutEvents ?? match.shootout_events ?? match.match_day_shootout_kicks ?? []
  const hasActiveKick = Array.isArray(kicks) && kicks.some(kick => !kick.voidedAt && !kick.voided_at && (kick.eventStatus ?? kick.event_status) !== 'voided')
  return phase === 'penalties' || match.status === 'penalties' || winner || home > 0 || away > 0 || hasActiveKick
    ? `${home} - ${away}` : ''
}
