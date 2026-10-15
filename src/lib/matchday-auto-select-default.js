const STORAGE_PREFIX = 'fp.matchday.auto-select-available.v1'

function preferenceKey(user, teamId) {
  const userId = String(user?.id || '').trim()
  const clubId = String(user?.clubId || '').trim()
  const selectedTeamId = String(teamId ?? user?.activeTeamId ?? '').trim() || 'club-wide'
  return userId ? `${STORAGE_PREFIX}:${userId}:${clubId}:${selectedTeamId}` : ''
}

export function readMatchDayAutoSelectDefault(user, teamId, storage) {
  const key = preferenceKey(user, teamId)
  if (!key) return false
  try {
    return (storage ?? globalThis.localStorage)?.getItem(key) === 'true'
  } catch {
    return false
  }
}

export function rememberMatchDayAutoSelectDefault(user, teamId, selected, storage) {
  const key = preferenceKey(user, teamId)
  if (!key || typeof selected !== 'boolean') return
  try {
    (storage ?? globalThis.localStorage)?.setItem(key, String(selected))
  } catch {
    // Browser storage must not prevent a fixture from saving.
  }
}

export async function loadMatchDayAutoSelectDefault(user, teamId, loadPreference, storage) {
  try {
    const preference = await loadPreference({ user, teamId })
    const selected = preference?.autoSelectAvailablePlayers === true
    return selected
  } catch {
    return readMatchDayAutoSelectDefault(user, teamId, storage)
  }
}
