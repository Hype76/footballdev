const ICONS = Object.freeze({
  'action.add-assessment': 'assignment',
  'action.add-match': 'sports-soccer',
  'action.add-player': 'person-add-alt',
  'action.add-session': 'event',
  'action.back': 'arrow-back',
  'action.create-poll': 'poll',
  'action.formation': 'grid-view',
  'action.game-day': 'sports',
  'action.new-board': 'note-add',
  'action.open': 'chevron-right',
  'action.plus': 'add',
  'action.retry': 'refresh',
  'action.save': 'check-circle-outline',
  'action.search': 'search',
  'coach.attention': 'monitor-heart',
  'coach.availability': 'group-add',
  'coach.chat': 'chat-bubble-outline',
  'coach.development': 'bar-chart',
  'coach.match': 'sports-soccer',
  'coach.polls': 'poll',
  'coach.quick-access': 'bolt',
  'coach.session': 'sports',
  'formation.finish': 'check-circle-outline',
  'formation.formation': 'grid-view',
  'formation.lineup': 'checkroom',
  'formation.squad': 'groups',
  'match.correct-score': 'verified',
  'match.create': 'add-circle-outline',
  'match.filter-all': 'filter-alt',
  'match.filter-current': 'sensors',
  'match.filter-previous': 'history',
  'match.filter-upcoming': 'calendar-month',
  'match.full-time': 'check-circle-outline',
  'match.goal': 'sports-soccer',
  'match.half-time': 'hourglass-bottom',
  'match.hydration': 'water-drop',
  'match.pause': 'pause',
  'match.period': 'sports',
  'match.red-card': 'crop-portrait',
  'match.score': 'scoreboard',
  'match.substitution': 'swap-horiz',
  'match.timer': 'timer',
  'match.yellow-card': 'style',
  'more.chat': 'chat-bubble-outline',
  'more.club': 'shield',
  'more.development': 'bar-chart',
  'more.formation': 'grid-view',
  'more.invites': 'group-add',
  'more.payment': 'credit-card',
  'more.polls': 'poll',
  'more.resources': 'folder-open',
  'more.sessions': 'sports',
  'more.settings': 'settings',
  'more.team': 'groups',
  'notification.status-checking': 'notifications-none',
  'notification.status-off': 'notifications-off',
  'notification.status-on': 'notifications',
  'panel.formation': 'grid-view',
  'panel.live': 'sensors',
  'panel.overview': 'info-outline',
  'panel.report': 'description',
  'panel.shootout': 'gps-fixed',
  'panel.squad': 'groups',
  'panel.timeline': 'schedule',
  'panel.volunteers': 'volunteer-activism',
  'parent.calendar': 'calendar-month',
  'parent.directions': 'near-me',
  'parent.match': 'sports-soccer',
  'parent.polls': 'assignment-turned-in',
  'parent.updates': 'campaign',
  'route.calendar': 'calendar-month',
  'route.chat': 'chat-bubble-outline',
  'route.home': 'home',
  'route.matchday': 'sports-soccer',
  'route.more': 'more-horiz',
  'route.notifications': 'notifications-none',
  'route.players': 'groups',
  'settings.account': 'person-outline',
  'settings.appearance': 'palette',
  'settings.badge': 'radio-button-unchecked',
  'settings.notifications': 'notifications-none',
  'settings.security': 'lock-outline',
  'settings.sync': 'sync',
})

const FALLBACK_ICON = 'radio-button-unchecked'

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function getMobileIconName(key, fallback = FALLBACK_ICON) {
  return ICONS[normalize(key)] || normalize(fallback) || FALLBACK_ICON
}

export function getCoachRouteIconKey(routeKey) {
  const key = normalize(routeKey)
  if (['home', 'notifications', 'calendar', 'players', 'matchday', 'more'].includes(key)) return `route.${key}`
  return `more.${key}`
}

export function getParentTabIconKey(routeKey) {
  const key = normalize(routeKey)
  if (key === 'chat') return 'route.chat'
  if (key === 'matchday') return 'route.matchday'
  return `route.${key}`
}

export function getCoachQuickActionIconKey(actionId) {
  const key = normalize(actionId)
  return ({
    'add-assessment': 'action.add-assessment',
    'add-match': 'action.add-match',
    'add-player': 'action.add-player',
    'add-session': 'action.add-session',
    'create-poll': 'action.create-poll',
    'formation-board': 'action.formation',
    'game-day': 'action.game-day',
  })[key] || 'action.plus'
}

export function getMatchDayPanelIconKey(panelKey) {
  return `panel.${normalize(panelKey)}`
}

export function getMatchDayFilterIconKey(filterKey) {
  return `match.filter-${normalize(filterKey)}`
}

export function listMobileIconNames() {
  return Object.freeze([...new Set(Object.values(ICONS))])
}
