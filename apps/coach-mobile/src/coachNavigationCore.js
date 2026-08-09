const PRIMARY_ROUTES = Object.freeze([
  Object.freeze({ key: 'home', label: 'Home' }),
  Object.freeze({ key: 'calendar', label: 'Calendar' }),
  Object.freeze({ key: 'players', label: 'Players' }),
  Object.freeze({ key: 'matchday', label: 'Match Day' }),
  Object.freeze({ key: 'more', label: 'More' }),
])

const MORE_ROUTES = Object.freeze([
  Object.freeze({ key: 'sessions', label: 'Sessions', minimumRank: 20, requiresTeam: true }),
  Object.freeze({ key: 'development', label: 'Development', minimumRank: 20, requiresTeam: true }),
  Object.freeze({ key: 'resources', label: 'Resources', minimumRank: 20 }),
  Object.freeze({ key: 'chat', label: 'Chat', minimumRank: 20 }),
  Object.freeze({ key: 'messages', label: 'Messages', minimumRank: 20 }),
  Object.freeze({ key: 'polls', label: 'Polls', minimumRank: 20 }),
  Object.freeze({ key: 'team', label: 'Team', minimumRank: 50, requiresTeam: true }),
  Object.freeze({ key: 'club', label: 'Club', clubAdminOnly: true }),
  Object.freeze({ key: 'payment', label: 'Plan access', payerOnly: true }),
  Object.freeze({ key: 'settings', label: 'Settings', minimumRank: 20 }),
])

const ROUTE_ALIASES = Object.freeze({
  assess: 'development',
  assessment: 'development',
  assessments: 'development',
  calendar: 'calendar',
  chat: 'chat',
  club: 'club',
  development: 'development',
  fixtures: 'matchday',
  home: 'home',
  match: 'matchday',
  matchday: 'matchday',
  messages: 'messages',
  players: 'players',
  polls: 'polls',
  resources: 'resources',
  sessions: 'sessions',
  settings: 'settings',
  team: 'team',
})

function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('_', '').replaceAll('-', '')
}

function routeIsAllowed(route, context) {
  if (!context) return false
  const roleRank = Number(context.roleRank || 0)
  if (route.minimumRank && roleRank < route.minimumRank) return false
  if (route.requiresTeam && !context.teamId) return false
  if (route.clubAdminOnly && context.role !== 'admin') return false
  const payerAuthority = context.paymentAccess?.payerAuthority
    || (context.role === 'admin' && context.workspaceScope === 'club'
      ? 'club'
      : context.role === 'head_manager' && roleRank >= 70 && context.workspaceScope === 'team'
        ? 'team'
        : 'none')
  if (route.payerOnly && !['club', 'team'].includes(payerAuthority)) return false
  return true
}

export function getCoachNavigationModel(context) {
  if (!context) return Object.freeze({ more: [], primary: [] })
  const primary = PRIMARY_ROUTES.filter((route) => {
    if (['players', 'matchday'].includes(route.key)) return Boolean(context.teamId)
    return true
  })
  const more = MORE_ROUTES.filter((route) => routeIsAllowed(route, context))
  return Object.freeze({ more: Object.freeze(more), primary: Object.freeze(primary) })
}

export function resolveCoachRoute(route, context) {
  const normalizedRoute = ROUTE_ALIASES[normalize(route)] || ''
  if (!normalizedRoute) return ''
  const navigation = getCoachNavigationModel(context)
  if (navigation.primary.some((item) => item.key === normalizedRoute)) return normalizedRoute
  if (navigation.more.some((item) => item.key === normalizedRoute)) return normalizedRoute
  return ''
}

export function getCoachRouteContainer(route) {
  return MORE_ROUTES.some((item) => item.key === route) ? 'more' : route
}

export function getCoachBackTarget({ activeRoute, moreRoute = '' } = {}) {
  if (moreRoute) return Object.freeze({ activeRoute: 'more', moreRoute: '' })
  if (activeRoute && activeRoute !== 'home') return Object.freeze({ activeRoute: 'home', moreRoute: '' })
  return null
}

export function getCoachPrimaryRoutes() {
  return PRIMARY_ROUTES
}

export function getCoachMoreRoutes() {
  return MORE_ROUTES
}
