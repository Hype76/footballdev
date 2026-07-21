export const PROTECTED_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase()
}

export function isDraftUserActive(user) {
  if (!normalizeText(user?.id) || !normalizeText(user?.clubId)) {
    return false
  }

  if (user?.status && normalizeLowerText(user.status) !== 'active') {
    return false
  }

  return !user?.suspendedAt && !user?.suspended_at && user?.isDisabled !== true
}

export function createDraftScope({ context = {}, user } = {}) {
  return {
    accountId: normalizeText(user?.id),
    clubId: normalizeText(context.clubId || user?.clubId),
    teamId: normalizeText(context.teamId || user?.activeTeamId),
    teamName: normalizeLowerText(context.teamName || user?.activeTeamName),
    playerId: normalizeText(context.playerId),
    playerName: normalizeLowerText(context.playerName),
  }
}

function scopeMatchesValue(storedId, storedName, requestedId, requestedName) {
  if (requestedId) {
    return storedId === requestedId
  }

  if (requestedName) {
    return storedName === requestedName
  }

  return true
}

export function canAccessDraftScope({ requestedContext = {}, scope = {}, user } = {}) {
  if (!isDraftUserActive(user)) {
    return false
  }

  const currentScope = createDraftScope({ context: requestedContext, user })

  if (
    normalizeText(scope.accountId) !== currentScope.accountId ||
    normalizeText(scope.clubId) !== currentScope.clubId
  ) {
    return false
  }

  const storedTeamId = normalizeText(scope.teamId)
  const storedTeamName = normalizeLowerText(scope.teamName)

  if (
    !scopeMatchesValue(
      storedTeamId,
      storedTeamName,
      currentScope.teamId,
      currentScope.teamName,
    )
  ) {
    return false
  }

  return scopeMatchesValue(
    normalizeText(scope.playerId),
    normalizeLowerText(scope.playerName),
    currentScope.playerId,
    currentScope.playerName,
  )
}

export function getDraftExpiry(now = Date.now()) {
  return new Date(Number(now) + PROTECTED_DRAFT_TTL_MS).toISOString()
}

export function isDraftExpired(draft, now = Date.now()) {
  const expiryTime = Date.parse(String(draft?.expiresAt ?? ''))
  return !Number.isFinite(expiryTime) || expiryTime <= Number(now)
}

export function createOpaqueDraftId(prefix = 'draft') {
  const randomId = globalThis.crypto?.randomUUID?.()

  if (randomId) {
    return `${prefix}:${randomId}`
  }

  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
}
