import { getCoachFriendlyError } from './coachFriendlyErrors.js'

export const COACH_ACCOUNT_OFFLINE_SCHEMA = 1

export function assertCoachAccountPreparationFinished(result, contexts, statuses) {
  if (result?.cancelled) throw new Error('Download paused before every team was saved. Keep Coach open and connected, then retry.')
  const targets = [...new Map((contexts || []).filter(context => context.id && context.clubId).map(context => [context.id, context])).values()]
  const results = new Map((result?.results || []).map(status => [status.contextId, status]))
  if (!targets.length || results.size !== targets.length || result.results.length !== targets.length) {
    throw new Error('Download incomplete. Check the team statuses and retry while connected.')
  }
  let onlineOnlyCount = 0
  let complete = true
  for (const context of targets) {
    const status = statuses ? statuses[context.id] : results.get(context.id)
    const links = Array.isArray(status?.onlineOnly) ? status.onlineOnly.length : 0
    if (!results.has(context.id) || !status?.savedAt || !Number.isFinite(Date.parse(status.savedAt))
      || status.error || status.filesFailed || !['ready', 'partial'].includes(status.state)
      || (status.state === 'partial' && !links)) {
      throw new Error('Download incomplete. Check the team statuses and retry while connected.')
    }
    onlineOnlyCount += links
    complete = complete && status.state === 'ready' && !links
  }
  return { complete, onlineOnlyCount }
}

const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000
const COMPLETE_REFRESH_MS = 5 * 60 * 1000

// A checkpoint holds only locally verified records and file metadata. Signed URLs
// are never saved, and each unfinished file is authorised when it is downloaded.
export async function prepareCoachAccountOffline({ user, contexts, selectedContextId, loadContext, createSaver, saveStatus, saveMatch, saveMatches, readBackResources, readPreviousStatus, verifyCheckpoint, prepareMedia, hasMedia, report = () => {}, yieldControl = async () => {}, reuseSaved = false, isCurrent = () => true, now = () => new Date().toISOString() }) {
  const targets = [...new Map(contexts.filter(context => context.id && context.clubId).map(context => [context.id, context])).values()]
    .sort((left, right) => Number(Boolean(right.teamId)) - Number(Boolean(left.teamId)) || Number(right.id === selectedContextId) - Number(left.id === selectedContextId))
  const results = []
  const previous = new Map(await Promise.all(targets.map(async context => [context.id,
    readPreviousStatus ? await readPreviousStatus(user.id, context) : null,
  ])))
  const incomplete = targets.some(context => !isFinished(previous.get(context.id)))
  const age = time => Date.parse(now()) - Date.parse(time)
  const publishProgress = (id, status) => {
    const { checkpoint: _checkpoint, resources: _resources, matchIds: _matchIds, ...progress } = status
    if (isCurrent()) report(id, progress)
  }

  for (const context of targets) {
    await yieldControl(isCurrent)
    if (!isCurrent()) return { cancelled: true, results }
    const prior = previous.get(context.id)
    const reuse = isFinished(prior) && age(prior.savedAt) >= 0 && (reuseSaved || age(prior.savedAt) < (incomplete ? RESUME_MAX_AGE_MS : COMPLETE_REFRESH_MS))
    const resume = Array.isArray(prior?.checkpoint?.plan) && prior.checkpoint.saved && Array.isArray(prior.matchIds)
      && age(prior.startedAt) >= 0 && age(prior.startedAt) < RESUME_MAX_AGE_MS
    if ((reuse || resume) && verifyCheckpoint) {
      try { await verifyCheckpoint(user, context, isCurrent) }
      catch (error) {
        if (!isCurrent()) return { cancelled: true, results }
        const denied = error?.code === '42501' || Number(error?.status) === 403
        const status = {
          ...prior, state: 'partial', ...(denied ? { checkpoint: undefined, savedAt: '' } : {}),
          error: getCoachFriendlyError(error, 'This team could not be checked. Retry while connected.'),
        }
        if (denied) await saveStatus(user.id, context, status, isCurrent).catch(() => {})
        publishProgress(context.id, status)
        results.push({ contextId: context.id, ...status })
        continue
      }
    }
    if (!isCurrent()) return { cancelled: true, results }
    if (reuse) {
      publishProgress(context.id, prior)
      results.push({ contextId: context.id, ...prior })
      continue
    }
    const status = {
      schemaVersion: COACH_ACCOUNT_OFFLINE_SCHEMA, scope: context.teamId ? 'team' : 'club',
      state: 'saving', phase: resume ? 'files' : 'records', startedAt: resume ? prior.startedAt : now(), savedAt: '',
      previousFilesSaved: prior?.savedAt || prior?.state === 'saving' ? prior.filesSaved : prior?.previousFilesSaved,
      resources: resume ? { ...prior.resources } : {}, matchIds: resume ? [...prior.matchIds] : [],
      filesSaved: resume ? prior.filesSaved : 0, fileBytesSaved: resume ? prior.fileBytesSaved : 0,
      filesFailed: 0, onlineOnly: resume ? prior.onlineOnly : [], error: '',
      ...(resume ? { filesTotal: prior.filesTotal, checkpoint: prior.checkpoint } : {}),
    }
    const save = createSaver(user, context, { isCurrent })
    let pendingResources = {}, progressItems = 0, progressAt = Date.now(), restartRecords = false
    const matches = new Map(), media = new Map()
    const notify = () => publishProgress(context.id, status)
    const persist = async () => {
      if (!isCurrent()) return
      await saveStatus(user.id, context, status, isCurrent)
      progressItems = 0
      progressAt = Date.now()
    }
    const saveProgress = async () => {
      notify()
      if (++progressItems >= 8 || Date.now() - progressAt >= 5000) await persist()
    }
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error('offline_preparation_cancelled')
    }
    const flushResources = async () => {
      const entries = Object.entries(pendingResources)
      if (!entries.length) return
      assertCurrent()
      const saved = await save(pendingResources)
      assertCurrent()
      for (const [key] of entries) {
        const fingerprint = saved?.resourceMetadata?.[key]?.fingerprint
        if (!fingerprint) throw new Error('offline_preparation_resource_not_saved')
        status.resources[key] = fingerprint
      }
      pendingResources = {}
      await saveProgress()
    }
    const flushMatches = async () => {
      if (!matches.size) return
      assertCurrent()
      const details = [...matches.values()]
      if (saveMatches) await saveMatches(user, context, details)
      else for (const detail of details) await saveMatch(user, context, detail)
      assertCurrent()
      status.matchIds = details.map(detail => detail.id)
      matches.clear()
    }

    notify()
    try {
      await persist()
      if (!resume) {
        const result = await loadContext(user, context, {
          isCurrent,
          beforePage: () => yieldControl(isCurrent),
          onStage: resourceKey => { status.resourceKey = resourceKey; notify() },
          onIncomplete: error => { status.filesFailed += 1; status.error = getCoachFriendlyError(error, 'A file could not be saved. Connect and try downloading again.') },
          onDependencyIncomplete: () => { status.error = 'Some teams in this club still need downloading.' },
          onMatch: async detail => { assertCurrent(); matches.set(detail.id, detail); await yieldControl(isCurrent) },
          onResource: async entry => {
            assertCurrent()
            if (entry?.complete !== true || !entry.cacheKey) throw new Error('offline_preparation_incomplete_resource')
            pendingResources[entry.cacheKey] = entry.value
            if (Object.keys(pendingResources).length >= 16 || entry.cacheKey === 'home') await flushResources()
            await yieldControl(isCurrent)
          },
          onMedia: async resource => {
            assertCurrent()
            media.set(mediaKey(resource), resource)
          },
        })
        assertCurrent()
        if (result?.complete !== true) throw new Error('offline_preparation_incomplete_context')
        await flushResources()
        await flushMatches()
        status.onlineOnly = Array.isArray(result.onlineOnly) ? result.onlineOnly : []
        if (!status.error) status.checkpoint = { plan: [...media.values()], saved: {} }
      }
      const plan = status.checkpoint?.plan || [...media.values()]
      const savedMedia = { ...status.checkpoint?.saved }
      status.phase = 'files'
      status.resourceKey = ''
      status.filesTotal = plan.length
      notify()
      if (plan.length) await persist()

      if (plan.length) await yieldControl(isCurrent)
      for (const resource of plan) {
        assertCurrent()
        const key = mediaKey(resource)
        status.currentFile = resource.title || ''
        notify()
        try {
          const retained = savedMedia[key]
          if (retained && hasMedia && await hasMedia(user, context, retained.resource, isCurrent).catch(() => false)) {
            assertCurrent()
            continue
          }
          if (retained) {
            status.filesSaved -= 1
            status.fileBytesSaved -= retained.bytes
            delete savedMedia[key]
          }
          const saved = await prepareMedia(user, context, resource, isCurrent)
          assertCurrent()
          const bytes = Number(saved?.bytes || 0)
          savedMedia[key] = { resource: saved?.resource || resource, bytes }
          status.filesSaved += 1
          status.fileBytesSaved += bytes
        } catch (error) {
          assertCurrent()
          status.filesFailed += 1
          restartRecords ||= [403, 404].includes(Number(error?.status)) || ['offline_media_revision_mismatch', 'coach_offline_kit_revision_changed'].includes(error?.code)
          status.error = getCoachFriendlyError(error, 'A file could not be saved. Connect and try downloading again.')
        }
        if (status.checkpoint) status.checkpoint = { plan, saved: { ...savedMedia } }
        await saveProgress()
        await yieldControl(isCurrent)
      }

      status.currentFile = ''
      status.phase = 'verifying'
      notify()
      const saved = await save({ offlineMediaInventory: plan.map(resource => savedMedia[mediaKey(resource)]?.resource).filter(Boolean) })
      assertCurrent()
      const fingerprint = saved?.resourceMetadata?.offlineMediaInventory?.fingerprint
      if (!fingerprint) throw new Error('offline_preparation_resource_not_saved')
      status.resources.offlineMediaInventory = fingerprint
      if (readBackResources) {
        const cache = await readBackResources(user.id, context)
        assertCurrent()
        if (Object.entries(status.resources).some(([key, expected]) => cache?.resourceMetadata?.[key]?.fingerprint !== expected)) throw new Error('There is not enough offline storage to retain all information. Your saved changes remain on this phone.')
      }
      status.state = status.filesFailed || status.onlineOnly.length || status.error ? 'partial' : 'ready'
      status.savedAt = now()
      if (isFinished(status) || restartRecords) delete status.checkpoint
    } catch (error) {
      if (!isCurrent()) return { cancelled: true, results }
      try { await flushResources(); await flushMatches() } catch { /* Keep already committed batches. */ }
      status.state = 'partial'
      if (restartRecords) delete status.checkpoint
      status.error = getCoachFriendlyError(error, 'Some information could not be saved. Connect and try downloading again.')
    }
    notify()
    try { await persist() }
    catch (error) {
      if (!isCurrent()) return { cancelled: true, results }
      status.state = 'partial'
      status.error = getCoachFriendlyError(error, 'Download progress could not be saved on this phone.')
      notify()
    }
    if (!isCurrent()) return { cancelled: true, results }
    results.push({ contextId: context.id, ...status })
  }
  return { complete: results.length === targets.length && results.every(result => result.state === 'ready'),
    retryNeeded: results.some(result => result.filesFailed || result.error), results }
}

function isFinished(status) {
  return Boolean(status?.savedAt && !status.error && !status.filesFailed
    && (status.state === 'ready' || status.state === 'partial' && status.onlineOnly?.length))
}

function mediaKey(resource) {
  return (resource.kind || 'file') + ':' + resource.id
}

export function coachAccountOfflineLabel(status) {
  if (!status) return 'Not downloaded yet'
  const savedFiles = `${status.filesSaved || 0} file${status.filesSaved === 1 ? '' : 's'} saved`
  if (status.state === 'ready') return status.scope === 'club' ? 'Club overview saved with its teams' : `Ready offline, ${savedFiles}`
  if (status.state === 'saving') {
    if (Number.isFinite(status.previousFilesSaved)) return `Checking files, ${status.previousFilesSaved} file${status.previousFilesSaved === 1 ? '' : 's'} saved at last download`
    return `Not ready offline yet, ${savedFiles}`
  }
  if (status.filesFailed) return `${status.filesFailed} file${status.filesFailed === 1 ? '' : 's'} still need downloading`
  if (status.error) return 'Download incomplete'
  if (status.onlineOnly?.length) return `Saved, ${status.onlineOnly.length} link${status.onlineOnly.length === 1 ? '' : 's'} need internet`
  return 'Download incomplete'
}

export function validateCoachAccountOfflineStatus(status, cache, { acceptUpdatedResources = false } = {}) {
  if (!status || status.schemaVersion !== COACH_ACCOUNT_OFFLINE_SCHEMA) return null
  const allowReplacement = acceptUpdatedResources && isFinished(status)
  const retained = Object.entries(status.resources || {}).every(([key, fingerprint]) => {
    const savedFingerprint = cache?.resourceMetadata?.[key]?.fingerprint
    const savedValue = cache?.resources?.[key]
    return savedValue !== undefined && savedValue !== null && (savedFingerprint === fingerprint
      || (allowReplacement && key !== 'offlineMediaInventory' && Boolean(savedFingerprint)))
  })
  return { ...status, state: status.state === 'ready' && !retained ? 'partial' : status.state,
    checkpoint: retained ? status.checkpoint : undefined,
    error: retained ? status.error : 'Some saved information needs downloading again.' }
}
