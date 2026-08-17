const normalize = (value) => String(value ?? '').trim()

export const COACH_QUICK_ACTIONS = Object.freeze([
  Object.freeze({ id: 'add-player', intent: 'create-player', label: 'Add Player', minimumRank: 50, requiresTeam: true, route: 'players' }),
  Object.freeze({ id: 'add-session', intent: 'create-session', label: 'Add Session', minimumRank: 20, requiresTeam: true, route: 'sessions' }),
  Object.freeze({ id: 'add-assessment', label: 'Add Assessment', minimumRank: 20, requiresTeam: true, route: 'development' }),
  Object.freeze({ id: 'add-event', intent: 'create-event', label: 'Add Event', minimumRank: 20, route: 'calendar' }),
  Object.freeze({ id: 'add-match', intent: 'create-match', label: 'Add Match', minimumRank: 20, requiresTeam: true, route: 'matchday' }),
  Object.freeze({ id: 'game-day', label: 'Game Day', minimumRank: 20, requiresTeam: true, route: 'matchday' }),
  Object.freeze({ id: 'create-poll', label: 'Create Poll', minimumRank: 50, route: 'polls' }),
  Object.freeze({ id: 'formation-board', label: 'Formation Board', minimumRank: 20, requiresTeam: true, route: 'formation' }),
])

export function getCoachQuickActions(context) {
  if (!context) return []
  const roleRank = Number(context.roleRank || 0)
  return COACH_QUICK_ACTIONS.filter((action) => (
    roleRank >= Number(action.minimumRank || 0)
    && (!action.requiresTeam || Boolean(context.teamId))
  ))
}

export function getCoachQuickActionStorageKey(userId) {
  return `fp.coach.quick-add.position.v1.${normalize(userId) || 'anonymous'}`
}

export function clampCoachQuickActionPosition(position, viewport, bottomInset = 0) {
  const buttonSize = 60
  const margin = 12
  const width = Math.max(buttonSize + (margin * 2), Number(viewport?.width || 0))
  const height = Math.max(buttonSize + (margin * 2), Number(viewport?.height || 0))
  const maxX = Math.max(margin, width - buttonSize - margin)
  const maxY = Math.max(margin, height - buttonSize - Math.max(84, Number(bottomInset || 0) + 68))
  return {
    x: Math.max(margin, Math.min(maxX, Number(position?.x ?? maxX))),
    y: Math.max(margin, Math.min(maxY, Number(position?.y ?? maxY))),
  }
}

export function parseCoachQuickActionPosition(value) {
  try {
    const parsed = JSON.parse(String(value || ''))
    if (parsed?.version !== 1 || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null
    return { x: parsed.x, y: parsed.y }
  } catch {
    return null
  }
}

export function serializeCoachQuickActionPosition(position) {
  return JSON.stringify({ version: 1, x: Number(position?.x || 0), y: Number(position?.y || 0) })
}
