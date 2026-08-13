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

  if (normalizedRole === 'coach') {
    const routeAliases = {
      assessment: 'development',
      assessments: 'development',
      calendar: 'calendar',
      chat: 'chat',
      development: 'development',
      fixture: 'matchday',
      fixtures: 'matchday',
      matchday: 'matchday',
      message: 'messages',
      messages: 'messages',
      player: 'players',
      players: 'players',
      poll: 'polls',
      polls: 'polls',
      resource: 'resources',
      resources: 'resources',
      session: 'sessions',
      sessions: 'sessions',
    }

    return routeAliases[normalizedRoute] || ''
  }

  return ''
}
