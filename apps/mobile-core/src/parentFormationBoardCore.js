const normalize = (value) => String(value ?? '').trim()

export function getParentFormationPlayerLabel(player = {}) {
  const label = normalize(player.displayName ?? player.playerName ?? player.name)
  return label && label.toLowerCase() !== 'player' ? label : ''
}

export function getParentFormationPitchPercent(value, fallback = 50) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  const percent = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric
  return Math.max(0, Math.min(100, percent))
}

export function getNamedParentFormationPlayers(players = []) {
  return (Array.isArray(players) ? players : [])
    .map((player) => ({ ...player, parentDisplayName: getParentFormationPlayerLabel(player) }))
    .filter((player) => player.parentDisplayName)
}

