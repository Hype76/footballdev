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
      authorityId: normalize(value.authorityId),
      authoritySource: normalize(value.authoritySource),
      clubId: normalize(value.clubId),
      contextId: normalize(value.id || value.contextId),
      role: normalize(value.role),
      teamId: normalize(value.teamId),
    }
  }
  return { authorityId: '', authoritySource: '', clubId: '', contextId: normalize(value), role: '', teamId: '' }
}

export function createCoachOfflineDocument({ userScope }) {
  const scope = normalize(userScope)
  if (!scope) throw new Error('offline_profile_scope_mismatch')
  return {
    cacheSchemaVersion: COACH_PHASE_31F_CACHE_SCHEMA_VERSION,
    contexts: {},
    profile: null,
    updatedAt: '',
    userScope: scope,
  }
}

export function getCoachOfflineProfile(document, userScope) {
  const expectedScope = normalize(userScope)
  const profile = document?.profile?.value
  if (!expectedScope || normalize(document?.userScope) !== expectedScope) return null
  if (!profile || normalize(profile.id) !== expectedScope) return null
  return profile
}

export function setCoachOfflineProfile(document, profile, now = new Date().toISOString()) {
  const userScope = normalize(document?.userScope)
  if (!userScope || normalize(profile?.id) !== userScope) throw new Error('offline_profile_scope_mismatch')
  const next = {
    ...document,
    cacheSchemaVersion: COACH_PHASE_31F_CACHE_SCHEMA_VERSION,
    profile: {
      retrievedAt: now,
      value: profile,
    },
    updatedAt: now,
  }
  if (getCoachCacheByteLength(next) > COACH_PHASE_31F_MAX_CACHE_BYTES) throw new Error('offline_cache_payload_too_large')
  return next
}

export function getCoachOfflineResources(document, contextId) {
  const expected = normalizeContext(contextId)
  const key = expected.contextId
  if (!document || !key || normalize(document.userScope) === '') return null
  const entry = document.contexts?.[key]
  if (!entry || normalize(entry.contextId) !== key) return null
  if (expected.authorityId && normalize(entry.authorityId) !== expected.authorityId) return null
  if (expected.authoritySource && normalize(entry.authoritySource) !== expected.authoritySource) return null
  if (expected.clubId && normalize(entry.clubId) !== expected.clubId) return null
  if (expected.role && normalize(entry.role) !== expected.role) return null
  if (expected.teamId !== '' && normalize(entry.teamId) !== expected.teamId) return null
  return {
    authorityId: normalize(entry.authorityId),
    authoritySource: normalize(entry.authoritySource),
    cacheSchemaVersion: Number(document.cacheSchemaVersion || 1),
    clubId: normalize(entry.clubId),
    contextId: key,
    resourceMetadata: entry.resourceMetadata || {},
    resources: entry.resources || {},
    savedAt: normalize(entry.savedAt),
    stale: true,
    role: normalize(entry.role),
    teamId: normalize(entry.teamId),
  }
}

export function setCoachOfflineResources(document, contextId, resources, now = new Date().toISOString()) {
  const expected = normalizeContext(contextId)
  const key = expected.contextId
  if (!document?.userScope || !key) throw new Error('offline_context_scope_mismatch')
  const previous = document.contexts?.[key] || {}
  const scopeChanged = Boolean(
    (expected.authorityId && normalize(previous.authorityId) !== expected.authorityId)
    || (expected.authoritySource && normalize(previous.authoritySource) !== expected.authoritySource)
    || (expected.clubId && normalize(previous.clubId) !== expected.clubId)
    || (expected.role && normalize(previous.role) !== expected.role)
    || (expected.teamId && normalize(previous.teamId) !== expected.teamId)
  )
  const nextResources = scopeChanged ? {} : { ...(previous.resources || {}) }
  const nextMetadata = scopeChanged ? {} : { ...(previous.resourceMetadata || {}) }
  let changed = scopeChanged
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
        authorityId: expected.authorityId || normalize(previous.authorityId),
        authoritySource: expected.authoritySource || normalize(previous.authoritySource),
        clubId: expected.clubId || normalize(previous.clubId),
        contextId: key,
        resourceMetadata: nextMetadata,
        resources: nextResources,
        savedAt: now,
        role: expected.role || normalize(previous.role),
        teamId: expected.teamId || normalize(previous.teamId),
      },
    },
    updatedAt: now,
  }
  if (getCoachCacheByteLength(next) > COACH_PHASE_31F_MAX_CACHE_BYTES) throw new Error('offline_cache_payload_too_large')
  return next
}
