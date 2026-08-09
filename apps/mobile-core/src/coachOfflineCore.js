import {
  boundCoachOfflineResource,
  COACH_PHASE_31F_CACHE_SCHEMA_VERSION,
  COACH_PHASE_31F_MAX_CACHE_BYTES,
  getCoachCacheByteLength,
  getCoachCacheFingerprint,
  getCoachOfflineReadPolicy,
} from './coachPhase31FCore.js'

function normalize(value) {
  return String(value ?? '').trim()
}

function normalizeContext(value) {
  if (value && typeof value === 'object') {
    return {
      clubId: normalize(value.clubId),
      contextId: normalize(value.id || value.contextId),
      teamId: normalize(value.teamId),
    }
  }
  return { clubId: '', contextId: normalize(value), teamId: '' }
}

export function createCoachOfflineDocument({ userScope }) {
  const scope = normalize(userScope)
  if (!scope) throw new Error('offline_profile_scope_mismatch')
  return {
    cacheSchemaVersion: COACH_PHASE_31F_CACHE_SCHEMA_VERSION,
    contexts: {},
    updatedAt: '',
    userScope: scope,
  }
}

export function getCoachOfflineResources(document, contextId) {
  const expected = normalizeContext(contextId)
  const key = expected.contextId
  if (!document || !key || normalize(document.userScope) === '') return null
  const entry = document.contexts?.[key]
  if (!entry || normalize(entry.contextId) !== key) return null
  if (expected.clubId && normalize(entry.clubId) !== expected.clubId) return null
  if (expected.teamId !== '' && normalize(entry.teamId) !== expected.teamId) return null
  return {
    cacheSchemaVersion: Number(document.cacheSchemaVersion || 1),
    clubId: normalize(entry.clubId),
    contextId: key,
    resourceMetadata: entry.resourceMetadata || {},
    resources: entry.resources || {},
    savedAt: normalize(entry.savedAt),
    stale: true,
    teamId: normalize(entry.teamId),
  }
}

export function setCoachOfflineResources(document, contextId, resources, now = new Date().toISOString()) {
  const expected = normalizeContext(contextId)
  const key = expected.contextId
  if (!document?.userScope || !key) throw new Error('offline_context_scope_mismatch')
  const previous = document.contexts?.[key] || {}
  const nextResources = { ...(previous.resources || {}) }
  const nextMetadata = { ...(previous.resourceMetadata || {}) }
  let changed = false
  for (const [resourceKey, value] of Object.entries(resources || {})) {
    const policy = getCoachOfflineReadPolicy(resourceKey)
    if (!policy.cache) continue
    const bounded = boundCoachOfflineResource(resourceKey, value)
    const fingerprint = getCoachCacheFingerprint(bounded)
    if (nextMetadata[resourceKey]?.fingerprint === fingerprint) continue
    changed = true
    nextResources[resourceKey] = bounded
    nextMetadata[resourceKey] = { fingerprint, savedAt: now, sensitivity: policy.sensitivity }
  }
  if (!changed) return document
  const next = {
    ...document,
    cacheSchemaVersion: COACH_PHASE_31F_CACHE_SCHEMA_VERSION,
    contexts: {
      ...(document.contexts || {}),
      [key]: {
        clubId: expected.clubId || normalize(previous.clubId),
        contextId: key,
        resourceMetadata: nextMetadata,
        resources: nextResources,
        savedAt: now,
        teamId: expected.teamId || normalize(previous.teamId),
      },
    },
    updatedAt: now,
  }
  if (getCoachCacheByteLength(next) > COACH_PHASE_31F_MAX_CACHE_BYTES) throw new Error('offline_cache_payload_too_large')
  return next
}
