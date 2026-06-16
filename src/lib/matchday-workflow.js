export const FIXTURE_SETUP_STORAGE_KEY = 'football-open-fixture-setup'
export const FIXTURE_SETUP_EVENT = 'football-open-fixture-setup'

function getWindow(windowRef) {
  if (windowRef) {
    return windowRef
  }

  if (typeof window === 'undefined') {
    return null
  }

  return window
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeBoolean(value) {
  return value === true
}

export function normalizeFixtureSetupIntent(intent = {}) {
  return {
    arrivalTime: normalizeText(intent.arrivalTime),
    homeAway: ['home', 'away', 'neutral'].includes(normalizeText(intent.homeAway)) ? normalizeText(intent.homeAway) : 'home',
    kickoffTime: normalizeText(intent.kickoffTime),
    matchDate: normalizeText(intent.matchDate),
    notes: normalizeText(intent.notes),
    opponent: normalizeText(intent.opponent),
    parentAudience: normalizeText(intent.parentAudience) || 'none',
    parentVisible: normalizeBoolean(intent.parentVisible),
    teamId: normalizeText(intent.teamId),
    venueAddress: normalizeText(intent.venueAddress),
    venueName: normalizeText(intent.venueName),
  }
}

export function storeFixtureSetupIntent(intent = {}, { windowRef } = {}) {
  const resolvedWindow = getWindow(windowRef)

  if (!resolvedWindow?.sessionStorage) {
    return normalizeFixtureSetupIntent(intent)
  }

  const normalizedIntent = normalizeFixtureSetupIntent(intent)
  resolvedWindow.sessionStorage.setItem(FIXTURE_SETUP_STORAGE_KEY, JSON.stringify(normalizedIntent))
  return normalizedIntent
}

export function consumeFixtureSetupIntent({ windowRef } = {}) {
  const resolvedWindow = getWindow(windowRef)

  if (!resolvedWindow?.sessionStorage) {
    return null
  }

  const storedValue = resolvedWindow.sessionStorage.getItem(FIXTURE_SETUP_STORAGE_KEY)

  if (!storedValue) {
    return null
  }

  resolvedWindow.sessionStorage.removeItem(FIXTURE_SETUP_STORAGE_KEY)

  try {
    const parsedValue = JSON.parse(storedValue)
    return parsedValue && typeof parsedValue === 'object'
      ? normalizeFixtureSetupIntent(parsedValue)
      : normalizeFixtureSetupIntent({})
  } catch {
    return normalizeFixtureSetupIntent({})
  }
}

export function openMatchDayFixtureSetup(intent = {}, { navigate, windowRef } = {}) {
  const resolvedWindow = getWindow(windowRef)
  const normalizedIntent = storeFixtureSetupIntent(intent, { windowRef: resolvedWindow })

  if (typeof navigate === 'function') {
    navigate('/match-day')
    return normalizedIntent
  }

  if (resolvedWindow?.dispatchEvent) {
    resolvedWindow.dispatchEvent(new Event(FIXTURE_SETUP_EVENT))
  }

  return normalizedIntent
}
