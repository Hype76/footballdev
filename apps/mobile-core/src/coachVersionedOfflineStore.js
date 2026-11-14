// Each account gets a new encrypted namespace. The legacy store remains intact
// until an explicit sign-out, and an interrupted migration never overwrites it.
export function createCoachVersionedOfflineStore({ legacyStore, markerStorage, markerPrefix, createScopedStore, fingerprint, checkpointKey = '__coachLegacyCheckpoint' }) {
  if (!['__coachLegacyCheckpoint', '__parentLegacyCheckpoint'].includes(checkpointKey)) throw new Error('offline_checkpoint_invalid')
  const stores = new Map(), markerWrites = new Set(), activeKey = `${markerPrefix}.active`
  async function writeMarker(key, value) {
    const write = Promise.resolve(markerStorage.setItem(key, value))
    markerWrites.add(write)
    try { await write } finally { markerWrites.delete(write) }
  }
  let active = '', epoch = 0, pending = null, qualifiedTarget = null
  let cleanup = Promise.resolve(), activationChain = Promise.resolve(), activationReady = Promise.resolve()
  const scopeKey = value => {
    const scope = String(value || '').trim()
    if (!/^[A-Za-z0-9-]{1,128}$/.test(scope)) throw new Error('offline_profile_scope_mismatch')
    return scope.replaceAll('-', '_')
  }
  const storeFor = scope => {
    const key = scopeKey(scope)
    if (!stores.has(key)) stores.set(key, createScopedStore(key))
    return stores.get(key)
  }
  const markerKey = scope => `${markerPrefix}.${scopeKey(scope)}`
  const guardFor = scope => {
    const captured = epoch
    if (!scope || active !== scope) throw new Error('offline_scope_invalidated')
    return () => { if (captured !== epoch || active !== scope) throw new Error('offline_scope_invalidated') }
  }
  async function legacyCheckpoint(scope, guard) {
    const result = await legacyStore.read(scope); guard()
    if (result.status === 'missing' || result.status === 'scope_mismatch') return { checkpoint: result.status, document: null }
    if (result.status !== 'ready' || !result.document) throw new Error('offline_legacy_recovery_required')
    const digest = await fingerprint(JSON.stringify(result.document)); guard()
    if (!/^[a-f0-9]{64}$/i.test(digest || '')) throw new Error('offline_legacy_checkpoint_invalid')
    return { checkpoint: `sha256:${digest.toLowerCase()}`, document: result.document }
  }
  async function ensure(scope) {
    const guard = guardFor(scope)
    if (pending?.scope === scope && pending.epoch === epoch) return pending.promise
    const currentEpoch = epoch
    const promise = (async () => {
      await activationReady; guard()
      const target = storeFor(scope)
      const saved = await target.read(scope); guard()
      let marker = await markerStorage.getItem(markerKey(scope)); guard()
      const legacy = await legacyCheckpoint(scope, guard)
      const preparing = `preparing:${legacy.checkpoint}`, committed = `committed:${legacy.checkpoint}`
      if (saved.status === 'ready' && saved.document) {
        if (![preparing, committed].includes(marker) || saved.document[checkpointKey] !== legacy.checkpoint) throw new Error('offline_legacy_recovery_required')
        if (marker === preparing) { await writeMarker(markerKey(scope), committed); guard() }
        return { target, checkpoint: legacy.checkpoint, guard }
      }
      if (saved.status !== 'missing') throw new Error('offline_migration_recovery_required')
      if (marker) {
        if (marker !== preparing) throw new Error('offline_migration_recovery_required')
        const artifacts = await target.inspectArtifacts(scope); guard()
        if (artifacts.hasPointer || artifacts.hasGeneration) throw new Error('offline_migration_recovery_required')
      }
      if (legacy.document) {
        if (!marker) { await writeMarker(markerKey(scope), preparing); guard(); marker = preparing }
        await target.write(scope, { ...legacy.document, [checkpointKey]: legacy.checkpoint }); guard()
        await writeMarker(markerKey(scope), committed); guard()
      }
      return { target, checkpoint: legacy.checkpoint, guard }
    })()
    pending = { scope, epoch: currentEpoch, promise }
    try {
      const result = await promise
      guard()
      qualifiedTarget = result.target
      return result
    } catch (error) { if (pending?.promise === promise) pending = null; throw error }
  }
  return {
    activate(scope) {
      scopeKey(scope)
      if (active === scope) return
      active = scope; epoch++; pending = null; qualifiedTarget = null
      const guard = guardFor(scope)
      activationReady = Promise.all([cleanup, activationChain]).then(async () => {
        guard()
        const savedScope = await markerStorage.getItem(activeKey); guard()
        if (savedScope !== scope) { await markerStorage.setItem(activeKey, scope); guard() }
        legacyStore.activate(scope); storeFor(scope).activate(scope)
      })
      activationChain = activationReady.catch(() => {})
    },
    captureScopeGuard(scope) { return guardFor(scope) },
    peekSnapshot(scope, select) {
      return active === scope ? qualifiedTarget?.peekSnapshot?.(scope, select) : undefined
    },
    async read(scope) { if (!active) return { document: null, status: 'missing' }; const { target, guard } = await ensure(scope); const result = await target.read(scope); guard(); return result },
    async readSnapshot(scope) { if (!active) return { document: null, status: 'missing' }; const { target, guard } = await ensure(scope); const result = await target.readSnapshot(scope); guard(); return result },
    async inspect(scope) { if (!active) return { hasDocument: false, status: 'missing' }; const { target, guard } = await ensure(scope); const result = await target.inspect(scope); guard(); return result },
    async update(scope, updater) {
      const { target, checkpoint, guard } = await ensure(scope)
      let changed = false
      const result = await target.update(scope, async current => {
        guard(); const next = await updater(current); guard()
        if (!next || next === current) return next
        await writeMarker(markerKey(scope), `preparing:${checkpoint}`); guard()
        changed = true
        return { ...next, [checkpointKey]: checkpoint }
      })
      guard()
      if (changed) { await writeMarker(markerKey(scope), `committed:${checkpoint}`); guard() }
      return result
    },
    async write(scope, value) {
      const { target, checkpoint, guard } = await ensure(scope)
      await writeMarker(markerKey(scope), `preparing:${checkpoint}`); guard()
      const result = await target.write(scope, { ...value, [checkpointKey]: checkpoint }); guard()
      await writeMarker(markerKey(scope), `committed:${checkpoint}`); guard()
      return result
    },
    clear() {
      const previousScope = active, previousActivation = activationChain
      active = ''; epoch++; pending = null; qualifiedTarget = null
      // Reject captured work immediately; qualification happens before deletion.
      if (previousScope) storeFor(previousScope).invalidate()
      cleanup = cleanup.catch(() => {}).then(async () => {
        await previousActivation
        await Promise.allSettled([...markerWrites])
        const scope = previousScope || await markerStorage.getItem(activeKey)
        if (!scope) {
          const keys = await markerStorage.getAllKeys()
          if (keys.some(key => key.startsWith(`${markerPrefix}.`) && key !== activeKey)) throw new Error('offline_signout_recovery_required')
          await legacyStore.clear()
          return
        }
        scopeKey(scope)
        const target = storeFor(scope)
        target.activate(scope); legacyStore.activate(scope)
        const saved = await target.read(scope)
        const marker = await markerStorage.getItem(markerKey(scope))
        const legacy = await legacyCheckpoint(scope, () => {})
        const preparing = `preparing:${legacy.checkpoint}`, committed = `committed:${legacy.checkpoint}`
        if (saved.status === 'ready' && saved.document) {
          if (![preparing, committed].includes(marker) || saved.document[checkpointKey] !== legacy.checkpoint) throw new Error('offline_legacy_recovery_required')
        } else if (saved.status === 'missing') {
          if (marker) {
            if (marker !== preparing) throw new Error('offline_migration_recovery_required')
            const artifacts = await target.inspectArtifacts(scope)
            if (artifacts.hasPointer || artifacts.hasGeneration) throw new Error('offline_migration_recovery_required')
          }
        } else throw new Error('offline_migration_recovery_required')
        await target.clear()
        if (legacy.document) await legacyStore.clear()
        await markerStorage.removeItem(markerKey(scope))
        if (await markerStorage.getItem(activeKey) === scope) await markerStorage.removeItem(activeKey)
      })
      return cleanup
    },
  }
}
