export function getTabForNotificationRoute(appRole, route) {
  const normalizedRole = String(appRole || '').trim()
  const normalizedRoute = String(route || '').trim().toLowerCase()

  if (normalizedRole === 'parent') {
    if (['message', 'messages', 'parent-message', 'parent-messages'].includes(normalizedRoute)) {
      return 'messages'
    }

    if (['poll', 'polls', 'parent-poll', 'parent-polls'].includes(normalizedRoute)) {
      return 'polls'
    }

    if (normalizedRoute === 'parent-portal' || normalizedRoute === 'matchday') {
      return 'matchday'
    }

    return ''
  }

  if (normalizedRole === 'coach' && normalizedRoute === 'matchday') {
    return 'matchday'
  }

  return ''
}
