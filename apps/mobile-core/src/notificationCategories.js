export const DEFAULT_NOTIFICATION_CATEGORIES = Object.freeze({
  gameDay: 'scores_cards', invites: true, chats: true, resources: true,
})

export const GAME_DAY_CHOICES = Object.freeze([
  { key: 'off', label: 'Off', iconKey: 'notification.status-off', copy: 'No Game Day push alerts.' },
  { key: 'scores_cards', label: 'Score and cards only', iconKey: 'match.score', copy: 'Goals, score corrections, yellow and red cards, game started, first half ended, second half started and game finished.' },
  { key: 'full', label: 'Full Game Day notifications', iconKey: 'panel.live', copy: 'Every match update, including substitutions, kick-off, breaks and full-time.' },
])

export function normalizeNotificationCategories(value = {}) {
  return {
    gameDay: ['off', 'scores_cards', 'full'].includes(value?.gameDay) ? value.gameDay : 'scores_cards',
    invites: value?.invites !== false,
    chats: value?.chats !== false,
    resources: value?.resources !== false,
  }
}

export function notificationCategory(data = {}) {
  const type = String(data.type || data.intentType || '').toLowerCase()
  const route = String(data.route || '').toLowerCase()
  if (route === 'invites' || /availability|assignment|scorer_|calendar|training|session|squad/.test(type) || ['calendar', 'sessions'].includes(route)) return 'invites'
  if (['chat', 'messages', 'polls'].includes(route) || /chat|message|poll|communication/.test(type)) return 'chats'
  if (route === 'resources' || /resource/.test(type)) return 'resources'
  if (['matchday', 'fans'].includes(route) || /matchday|match_day/.test(type)) return 'gameDay'
  return null
}

export function allowsMobileNotification(preferences, data = {}) {
  const settings = normalizeNotificationCategories(preferences)
  const category = notificationCategory(data)
  if (!category) return true
  if (category !== 'gameDay') return settings[category]
  if (settings.gameDay === 'off') return false
  if (settings.gameDay === 'full') return true
  // Existing match senders use live for kick-off; copy builders call it match_started.
  return ['goal', 'score_correction', 'yellow_card', 'red_card', 'live', 'match_started', 'half_time', 'second_half', 'full_time'].includes(String(data.type || '').toLowerCase())
}
