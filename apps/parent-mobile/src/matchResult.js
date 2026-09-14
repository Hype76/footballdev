export function getParentMatchResult(match = {}) {
  if (match.status !== 'full_time') return null
  const home = Number(match.homeScore), away = Number(match.awayScore)
  if (match.homeScore == null || match.awayScore == null || !Number.isFinite(home) || !Number.isFinite(away)) return null
  const winner = match.shootoutWinner
  if (home === away && !['home', 'away'].includes(winner)) return 'draw'
  const winningSide = home === away ? winner : home > away ? 'home' : 'away'
  return winningSide === (match.homeAway === 'away' ? 'away' : 'home') ? 'won' : 'loss'
}
