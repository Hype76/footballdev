const DEFAULT_MAX_AGE_MS = 30000

export function createMobileResourceCache({ now = Date.now, maxEntries = 80 } = {}) {
  const entries = new Map()
  let generation = 0
  return {
    clear() { generation += 1; entries.clear() },
    peek(key, maxAgeMs = DEFAULT_MAX_AGE_MS) {
      const entry = entries.get(key)
      return entry?.hasValue && now() - entry.savedAt < maxAgeMs ? entry.value : undefined
    },
    read(key, loader, { force = false, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
      const existing = entries.get(key)
      if (existing?.pending && (!force || existing.pendingForced)) return existing.pending
      if (!force && existing?.hasValue && now() - existing.savedAt < maxAgeMs) return Promise.resolve(existing.value)
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
  return JSON.stringify([
    user?.id, user?.role, user?.roleRank, user?.clubId,
    user?.activeCoachContextId, user?.activeTeamId, user?.selectedParentLinkId,
    user?.hasActivePlanAccess, user?.accountStatus, user?.planStatus, user?.selectedPlayerId, resource,
  ])
}

export function readMobileResource(user, resource, loader, options = {}) {
  if (!user?.id) return Promise.resolve().then(loader)
  return mobileResourceCache.read(mobileResourceKey(user, resource), loader, options)
}

export function peekMobileResource(user, resource) {
  return mobileResourceCache.peek(mobileResourceKey(user, resource))
}
