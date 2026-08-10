export const COACH_PHASE_31F_CACHE_SCHEMA_VERSION = 3
export const COACH_PHASE_31F_MAX_CACHE_BYTES = 1_500_000

const normalize = (value) => String(value ?? '').trim()
const normalizeLower = (value) => normalize(value).toLowerCase()

export const COACH_OFFLINE_READ_POLICIES = Object.freeze({
  home: Object.freeze({ cache: true, maxItems: 40, sensitivity: 'operational', staleLabel: 'Offline Coach overview' }),
  calendar: Object.freeze({ cache: true, maxItems: 180, sensitivity: 'operational', staleLabel: 'Offline Calendar' }),
  calendarPlayers: Object.freeze({ cache: true, maxItems: 300, sensitivity: 'child-data', staleLabel: 'Offline Calendar Players' }),
  players: Object.freeze({ cache: true, maxItems: 300, sensitivity: 'child-data', staleLabel: 'Offline Player list' }),
  playerDetail: Object.freeze({ cache: true, maxItems: 80, sensitivity: 'child-data', staleLabel: 'Offline Player detail' }),
  sessions: Object.freeze({ cache: true, maxItems: 180, sensitivity: 'operational', staleLabel: 'Offline Sessions' }),
  sessionPlayers: Object.freeze({ cache: true, maxItems: 300, sensitivity: 'child-data', staleLabel: 'Offline Session Players' }),
  matchDayList: Object.freeze({ cache: true, maxItems: 100, sensitivity: 'operational', staleLabel: 'Offline Match list' }),
  matchDayDetail: Object.freeze({ cache: true, maxItems: 250, sensitivity: 'live-match', staleLabel: 'Stale Match state' }),
  matchDayPlayers: Object.freeze({ cache: true, maxItems: 300, sensitivity: 'child-data', staleLabel: 'Offline Match squad' }),
  development: Object.freeze({ cache: true, maxItems: 80, sensitivity: 'private-development', staleLabel: 'Offline Development history' }),
  resources: Object.freeze({ cache: true, maxItems: 150, sensitivity: 'authorised-resource-metadata', staleLabel: 'Offline Resource list' }),
  chat: Object.freeze({ cache: true, maxItems: 100, sensitivity: 'private-communication', staleLabel: 'Offline Chat history' }),
  messages: Object.freeze({ cache: true, maxItems: 120, sensitivity: 'private-communication', staleLabel: 'Offline communication history' }),
  polls: Object.freeze({ cache: true, maxItems: 100, sensitivity: 'operational', staleLabel: 'Offline Poll summary' }),
  invites: Object.freeze({ cache: true, maxItems: 180, sensitivity: 'child-data', staleLabel: 'Offline availability summary' }),
  context: Object.freeze({ cache: true, maxItems: 30, sensitivity: 'authority-metadata', staleLabel: 'Last authorised context' }),
  branding: Object.freeze({ cache: true, maxItems: 20, sensitivity: 'public-branding', staleLabel: 'Saved branding' }),
})

const ONLINE_ONLY_MUTATIONS = [
  'calendar.create', 'calendar.edit', 'calendar.cancel',
  'players.create', 'players.identity_edit', 'players.team_assign', 'players.archive',
  'sessions.create', 'sessions.edit', 'sessions.complete',
  'matchday.start', 'matchday.pause', 'matchday.resume', 'matchday.period_transition',
  'matchday.goal', 'matchday.card', 'matchday.substitution', 'matchday.scorer_assign',
  'matchday.scorer_revoke', 'matchday.event_correct', 'matchday.event_void',
  'matchday.extra_time', 'matchday.shootout', 'matchday.complete',
  'development.draft_save', 'development.finalise', 'development.parent_share', 'development.correct',
  'resources.create', 'resources.upload', 'resources.share', 'resources.unshare',
  'chat.send', 'messages.read_receipt',
  'polls.create', 'polls.edit', 'polls.open', 'polls.close',
  'invites.create', 'invites.resend', 'invites.cancel', 'invites.close',
]

export const COACH_OFFLINE_MUTATION_POLICIES = Object.freeze(Object.fromEntries([
  ...ONLINE_ONLY_MUTATIONS.map((operation) => [operation, Object.freeze({
    authorityRefresh: 'server-before-write',
    conflictModel: 'server-authoritative',
    failure: 'show failure and retain no queued command',
    idempotency: operation.startsWith('matchday.') || operation.startsWith('invites.') ? 'server-command-id' : 'canonical-server-contract',
    offlineAllowed: false,
    replay: 'disabled',
  })]),
  ['preferences.theme', Object.freeze({ authorityRefresh: 'not-required', conflictModel: 'device-local-last-write', failure: 'retain previous preference', idempotency: 'deterministic-storage-key', offlineAllowed: true, replay: 'not-a-journal-command' })],
  ['preferences.biometric', Object.freeze({ authorityRefresh: 'device-authentication', conflictModel: 'device-local-last-write', failure: 'retain previous preference', idempotency: 'deterministic-storage-key', offlineAllowed: true, replay: 'not-a-journal-command' })],
]))

export function getCoachOfflineReadPolicy(resourceKey) {
  const key = normalize(resourceKey).replace(/^phase31e:/, '')
  return COACH_OFFLINE_READ_POLICIES[key] || Object.freeze({ cache: false, maxItems: 0, sensitivity: 'unclassified', staleLabel: 'Offline data unavailable' })
}

export function getCoachOfflineMutationPolicy(operation) {
  return COACH_OFFLINE_MUTATION_POLICIES[normalizeLower(operation)] || Object.freeze({
    authorityRefresh: 'server-before-write',
    conflictModel: 'unknown',
    failure: 'reject while offline',
    idempotency: 'unproven',
    offlineAllowed: false,
    replay: 'disabled',
  })
}

export function assertCoachMutationOnline(operation, online) {
  const policy = getCoachOfflineMutationPolicy(operation)
  if (!policy.offlineAllowed && !online) {
    const error = new Error('online_connection_required')
    error.code = 'COACH_ONLINE_CONNECTION_REQUIRED'
    throw error
  }
  return policy
}

function clampArray(value, maximum) {
  return value.slice(0, Math.max(0, maximum))
}

function boundNestedValue(value, maximum, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value
  if (Array.isArray(value)) return clampArray(value, maximum).map((entry) => boundNestedValue(entry, maximum, depth + 1))
  if (typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const nestedMaximum = /messages|events|timeline|history|responses/i.test(key) ? Math.min(maximum, 100) : maximum
    return [key, boundNestedValue(entry, nestedMaximum, depth + 1)]
  }))
}

export function boundCoachOfflineResource(resourceKey, value) {
  const policy = getCoachOfflineReadPolicy(resourceKey)
  if (!policy.cache) return null
  return boundNestedValue(value, policy.maxItems)
}

export function getCoachCacheFingerprint(value) {
  const input = JSON.stringify(value ?? null)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}:${input.length}`
}

export function getCoachCacheByteLength(value) {
  const input = JSON.stringify(value ?? null)
  return encodeURIComponent(input).replace(/%[0-9A-F]{2}|./gi, 'x').length
}

export function evaluateCoachCachedScope({ context, entry, environment = 'test', userId }) {
  if (!entry || !context || !normalize(userId)) return Object.freeze({ allowed: false, code: 'cache_scope_missing' })
  if (normalizeLower(environment) !== 'test') return Object.freeze({ allowed: false, code: 'cache_environment_rejected' })
  if (normalize(entry.userId) !== normalize(userId)) return Object.freeze({ allowed: false, code: 'cache_user_mismatch' })
  if (normalize(entry.contextId) !== normalize(context.id)) return Object.freeze({ allowed: false, code: 'cache_context_mismatch' })
  if (normalize(entry.clubId) !== normalize(context.clubId)) return Object.freeze({ allowed: false, code: 'cache_club_mismatch' })
  if (normalize(entry.teamId) !== normalize(context.teamId)) return Object.freeze({ allowed: false, code: 'cache_team_mismatch' })
  if (normalize(context.archivedAt) || normalizeLower(context.clubStatus) !== 'active' || normalizeLower(context.teamStatus) !== 'active') {
    return Object.freeze({ allowed: false, code: 'cache_authority_inactive' })
  }
  return Object.freeze({ allowed: true, code: 'cache_scope_ready' })
}

export const COACH_SECURITY_HOSTILE_CASES = Object.freeze([
  'no_session', 'expired_session', 'revoked_session', 'malformed_session', 'forged_role', 'forged_context',
  'cross_team', 'cross_club', 'archived_context', 'removed_staff', 'parent_only', 'player_only',
  'platform_admin_without_membership', 'wrong_environment', 'corrupt_storage', 'payment_required',
])

export function evaluateCoachSecurityBoundary({ context, environment = 'test', profile, productionAccess = false }) {
  if (normalizeLower(environment) !== 'test' || productionAccess) return Object.freeze({ allowed: false, code: 'wrong_environment' })
  if (!profile?.id) return Object.freeze({ allowed: false, code: 'no_session' })
  if (normalizeLower(profile.accountStatus || 'active') !== 'active') return Object.freeze({ allowed: false, code: 'revoked_session' })
  if (!context?.id || !context?.clubId) return Object.freeze({ allowed: false, code: 'forged_context' })
  const roles = new Set(['assistant_coach', 'coach', 'manager', 'head_manager', 'admin'])
  if (!roles.has(normalizeLower(context.role))) return Object.freeze({ allowed: false, code: 'forged_role' })
  if (normalize(context.archivedAt) || normalizeLower(context.clubStatus) !== 'active' || normalizeLower(context.teamStatus) !== 'active') {
    return Object.freeze({ allowed: false, code: 'archived_context' })
  }
  return Object.freeze({ allowed: true, canMutate: context.paymentAccess?.canMutate !== false, code: context.paymentAccess?.canMutate === false ? 'payment_required' : 'coach_authority_ready' })
}

export const COACH_ACCESSIBILITY_REQUIREMENTS = Object.freeze({
  colour: 'semantic tokens and text labels, never colour alone',
  focus: 'destructive confirmations announce purpose and result',
  forms: 'inputs have labels, multiline fields remain visible, actions follow fields',
  screenReader: 'tabs, context switcher, Match Day controls, status, and offline state are labelled',
  textScale: 'wrapping text with no fixed-height operational copy',
  touchTarget: 48,
})

export function createCoachRuntimeGuard({ now = Date.now } = {}) {
  const active = new Set()
  const requests = new Map()
  const writes = new Map()
  return Object.freeze({
    beginListener(key) {
      const normalized = normalize(key)
      if (!normalized || active.has(normalized)) return false
      active.add(normalized)
      return true
    },
    endListener(key) { return active.delete(normalize(key)) },
    getActiveListenerCount() { return active.size },
    shouldRequest(key, minimumIntervalMs = 500) {
      const normalized = normalize(key)
      const current = now()
      const previous = requests.get(normalized) || 0
      if (current - previous < minimumIntervalMs) return false
      requests.set(normalized, current)
      return true
    },
    shouldWriteCache(key, fingerprint) {
      const normalized = normalize(key)
      const value = normalize(fingerprint)
      if (!normalized || !value || writes.get(normalized) === value) return false
      writes.set(normalized, value)
      return true
    },
  })
}

export function normalizeCoachCollection(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : []
}
