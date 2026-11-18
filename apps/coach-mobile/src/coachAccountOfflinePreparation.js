import { getCoachFriendlyError } from './coachFriendlyErrors.js'

export const COACH_ACCOUNT_OFFLINE_SCHEMA = 1

// Preparation never changes the server's selected workspace. Each loader must
// prove authority for its explicit target before returning viewable data.
export async function prepareCoachAccountOffline({ user, contexts, selectedContextId, loadContext, createSaver, saveStatus, saveMatch, saveMatches, readBackResources, prepareMedia, isCurrent = () => true, now = () => new Date().toISOString() }) {
  const targets = [...contexts].filter(context => context.id && context.clubId)
    .sort((left, right) => Number(Boolean(right.teamId)) - Number(Boolean(left.teamId)) || Number(right.id === selectedContextId) - Number(left.id === selectedContextId))
  const results = []
  for (const context of targets) {
    if (!isCurrent()) return { cancelled: true, results }
    const save = createSaver(user, context, { isCurrent })
    const status = { schemaVersion: COACH_ACCOUNT_OFFLINE_SCHEMA, scope: context.teamId ? 'team' : 'club', state: 'saving', startedAt: now(), savedAt: '', resources: {}, matchIds: [], filesSaved: 0, fileBytesSaved: 0, filesFailed: 0, onlineOnly: [], error: '' }
    const inventory = []
    let pendingResources = {}
    const matches = new Map()
    const flushResources = async () => {
      const entries = Object.entries(pendingResources)
      if (!entries.length) return
      if (!isCurrent()) throw new Error('offline_preparation_cancelled')
      const saved = await save(pendingResources)
      if (!isCurrent()) throw new Error('offline_preparation_cancelled')
      for (const [key] of entries) {
        const fingerprint = saved?.resourceMetadata?.[key]?.fingerprint
        if (!fingerprint) throw new Error('offline_preparation_resource_not_saved')
        status.resources[key] = fingerprint
      }
      pendingResources = {}
      await saveStatus(user.id, context, status, isCurrent)
    }
    const flushMatches = async () => {
      if (!matches.size) return
      if (!isCurrent()) throw new Error('offline_preparation_cancelled')
      const details = [...matches.values()]
      if (saveMatches) await saveMatches(user, context, details)
      else for (const detail of details) await saveMatch(user, context, detail)
      if (!isCurrent()) throw new Error('offline_preparation_cancelled')
      status.matchIds = details.map(detail => detail.id)
      matches.clear()
    }
    await saveStatus(user.id, context, status, isCurrent)
    try {
      const result = await loadContext(user, context, {
        isCurrent,
        onIncomplete: error => { status.filesFailed += 1; status.error = getCoachFriendlyError(error, 'A file could not be saved. Connect and try downloading again.') },
        onDependencyIncomplete: () => { status.error = 'Some teams in this club still need downloading.' },
        onMatch: async detail => {
          if (!isCurrent()) throw new Error('offline_preparation_cancelled')
          matches.set(detail.id, detail)
        },
        onResource: async entry => {
          if (!isCurrent()) throw new Error('offline_preparation_cancelled')
          if (entry?.complete !== true || !entry.cacheKey) throw new Error('offline_preparation_incomplete_resource')
          pendingResources[entry.cacheKey] = entry.value
          // Bound background disk work rather than rewriting the entire
          // encrypted account for every individual Player or Session detail.
          if (Object.keys(pendingResources).length >= 16 || entry.cacheKey === 'home') await flushResources()
        },
        onMedia: async resource => {
          if (!isCurrent()) throw new Error('offline_preparation_cancelled')
          inventory.push(resource)
          try { const saved = await prepareMedia(user, context, resource, isCurrent); status.filesSaved += 1; status.fileBytesSaved += Number(saved?.bytes || 0) }
          catch (error) { status.filesFailed += 1; status.error = getCoachFriendlyError(error, 'A file could not be saved. Connect and try downloading again.') }
          if (isCurrent()) await saveStatus(user.id, context, status, isCurrent)
        },
      })
      if (!isCurrent()) return { cancelled: true, results }
      if (result?.complete !== true) throw new Error('offline_preparation_incomplete_context')
      await flushResources()
      await flushMatches()
      const saved = await save({ offlineMediaInventory: inventory })
      const fingerprint = saved?.resourceMetadata?.offlineMediaInventory?.fingerprint
      if (!fingerprint) throw new Error('offline_preparation_resource_not_saved')
      status.resources.offlineMediaInventory = fingerprint
      if (readBackResources) {
        const cache = await readBackResources(user.id, context)
        if (!isCurrent()) return { cancelled: true, results }
        if (Object.entries(status.resources).some(([key, expected]) => cache?.resourceMetadata?.[key]?.fingerprint !== expected)) throw new Error('There is not enough offline storage to retain all information. Your saved changes remain on this phone.')
      }
      status.onlineOnly = Array.isArray(result.onlineOnly) ? result.onlineOnly : []
      status.state = status.filesFailed || status.onlineOnly.length || status.error ? 'partial' : 'ready'
      status.savedAt = now()
    } catch (error) {
      if (!isCurrent()) return { cancelled: true, results }
      try { await flushResources(); await flushMatches() } catch { /* Prior committed batches remain intact. */ }
      status.state = 'partial'
      status.error = getCoachFriendlyError(error, 'Some information could not be saved. Connect and try downloading again.')
    }
    await saveStatus(user.id, context, status, isCurrent)
    results.push({ contextId: context.id, ...status })
  }
  return { complete: results.length === targets.length && results.every(result => result.state === 'ready'),
    retryNeeded: results.some(result => result.filesFailed || result.error), results }
}

export function coachAccountOfflineLabel(status) {
  if (!status) return 'Not downloaded yet'
  if (status.state === 'ready') return status.scope === 'club' ? 'Club overview saved with its teams' : `Ready offline, ${status.filesSaved || 0} files saved`
  if (status.state === 'saving') return `Saving while connected, ${status.filesSaved || 0} files saved`
  if (status.filesFailed) return `${status.filesFailed} file${status.filesFailed === 1 ? '' : 's'} still need downloading`
  if (status.error) return 'Download incomplete'
  if (status.onlineOnly?.length) return `Saved, ${status.onlineOnly.length} link${status.onlineOnly.length === 1 ? '' : 's'} need internet`
  return 'Download incomplete'
}

export function validateCoachAccountOfflineStatus(status, cache) {
  if (!status || status.schemaVersion !== COACH_ACCOUNT_OFFLINE_SCHEMA) return null
  const retained = Object.entries(status.resources || {}).every(([key, fingerprint]) =>
    cache?.resourceMetadata?.[key]?.fingerprint === fingerprint && cache?.resources?.[key] !== undefined)
  return { ...status, state: status.state === 'ready' && !retained ? 'partial' : status.state,
    error: retained ? status.error : 'Some saved information needs downloading again.' }
}
