export function getTabForNotificationRoute(appRole, route) {
  const normalizedRole = String(appRole || '').trim()
  const normalizedRoute = String(route || '').trim()

  if (normalizedRole === 'parent') {
    if (normalizedRoute === 'messages') {
      return 'messages'
    }

    if (normalizedRoute === 'polls') {
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
