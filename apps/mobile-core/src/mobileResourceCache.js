const DEFAULT_MAX_AGE_MS = 30000
const COACH_DISPLAY_RESOURCES = new Set([
  'coach:calendar', 'coach:players', 'coach:match-list', 'coach:home-availability-summary',
  'coach:home-chat-summary', 'coach:home-poll-summary', 'coach:development-open-summary',
])
const isCoachHomePrimary = resource => resource === 'coach:home-primary' || resource.startsWith('coach:home-primary:')
const isCoachDisplayResource = resource => COACH_DISPLAY_RESOURCES.has(resource) || isCoachHomePrimary(resource)

export function createMobileResourceCache({ now = Date.now, maxEntries = 80 } = {}) {
  const entries = new Map()
  let generation = 0
  return {
    clear() { generation += 1; entries.clear() },
    invalidate(key) { entries.delete(key) },
    peek(key, maxAgeMs = DEFAULT_MAX_AGE_MS, { allowStale = false } = {}) {
      const entry = entries.get(key)
      return entry?.hasValue && (allowStale || now() - entry.savedAt < maxAgeMs) ? entry.value : undefined
    },
    read(key, loader, { force = false, maxAgeMs = DEFAULT_MAX_AGE_MS, onSource, pendingScope, joinPending = false, isolatePending = false } = {}) {
      const existing = entries.get(key)
      if (!isolatePending && existing?.pending && existing.pendingScope === pendingScope && (!force || existing.pendingForced || joinPending)) {
        onSource?.('network')
        return existing.pending
      }
      if (!force && existing?.hasValue && now() - existing.savedAt < maxAgeMs) {
        onSource?.('cache')
        return Promise.resolve(existing.value)
      }
      onSource?.('network')
      const owner = generation
      const entry = { ...existing }
      const pending = Promise.resolve().then(loader).then((value) => {
        if (generation === owner && entries.get(key) === entry) {
          entry.value = value
          entry.hasValue = true
          entry.savedAt = now()
        }
        return value
      }).finally(() => {
        if (entry.pending === pending) delete entry.pending
      })
      entry.pending = pending
      entry.pendingForced = force
      entry.pendingScope = pendingScope
      entries.set(key, entry)
      if (entries.size > maxEntries) {
        for (const [oldKey, oldEntry] of entries) {
          if (oldKey !== key && !oldEntry.pending) { entries.delete(oldKey); break }
        }
      }
      return pending
    },
  }
}

export const mobileResourceCache = createMobileResourceCache()

export function mobileResourceKey(user, resource) {
  // Cache identity includes authority and the selected workspace/child. It is
  // never an authorisation decision; mutations still use server authority.
  const context = user?.coachContexts?.find(item => item.id === user?.activeCoachContextId)
  const link = user?.parentPortalLinks?.find(item => item.id === user?.selectedParentLinkId)
  return JSON.stringify([
    user?.id, user?.role, user?.roleRank, user?.clubId,
    user?.activeCoachContextId, user?.activeTeamId, user?.selectedParentLinkId,
    user?.hasActivePlanAccess, user?.accountStatus, user?.planStatus, user?.selectedPlayerId, resource,
    user?.activeCoachAuthorityId ?? context?.authorityId,
    user?.activeCoachAuthoritySource ?? context?.authoritySource,
    link?.clubId, link?.teamId, link?.playerId, link?.linkType, link?.planStatus, link?.planKey,
    ...(isCoachDisplayResource(resource) ? [user?.planKey, context?.clubStatus, context?.teamStatus, context?.archivedAt]
      : typeof user?.getCoachAuthorityGeneration === 'function' ? [user.getCoachAuthorityGeneration()] : []),
  ])
}

export function readMobileResource(user, resource, loader, options = {}) {
  if (!user?.id) {
    options.onSource?.('network')
    return Promise.resolve().then(loader)
  }
  const authorityGeneration = user.getCoachAuthorityGeneration?.()
  const key = mobileResourceKey(user, resource)
  const guardedLoader = resource.startsWith('coach:') && typeof user.waitForCoachAuthority === 'function'
    ? async () => {
        await user.waitForCoachAuthority()
        try {
          const value = await loader()
          if (authorityGeneration !== user.getCoachAuthorityGeneration?.()) throw new Error('The Coach workspace changed while loading. Retry in the current workspace.')
          return value
        } catch (error) {
          if (authorityGeneration === user.getCoachAuthorityGeneration?.()
            && (error?.code === '42501' || Number(error?.status || error?.statusCode) === 403)) mobileResourceCache.invalidate(key)
          throw error
        }
      } : loader
  return mobileResourceCache.read(key, guardedLoader, {
    maxAgeMs: resourceMaxAge(resource),
    pendingScope: authorityGeneration,
    joinPending: isCoachHomePrimary(resource),
    ...options,
  })
}

export function peekMobileResource(user, resource, options = {}) {
  return mobileResourceCache.peek(mobileResourceKey(user, resource), resourceMaxAge(resource), options)
}

export function invalidateMobileResource(user, resource) {
  mobileResourceCache.invalidate(mobileResourceKey(user, resource))
}

function resourceMaxAge(resource) {
  if (resource.startsWith('coach:team-administration:')) return Infinity
  return /players|resources|development|player-detail/.test(resource) ? 120_000 : DEFAULT_MAX_AGE_MS
}
