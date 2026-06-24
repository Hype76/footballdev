export const parentMatchDayLoadErrorTitle = 'Shared match day items could not load'
export const parentMatchDayActionErrorTitle = 'Match Day action failed'
export const parentMatchDayLoadErrorMessage = 'Could not load shared match day items. Please refresh or try again.'

export function getParentMatchDayErrorMessage(error, fallback = parentMatchDayLoadErrorMessage) {
  const rawMessage = String(error?.message ?? error ?? '').trim()

  if (!rawMessage) {
    return fallback
  }

  if (/typeerror|load failed|failed to fetch|networkerror|network request failed|aborterror/i.test(rawMessage)) {
    return fallback
  }

  return rawMessage
}
