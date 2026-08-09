function normalize(value) {
  return String(value ?? '').trim()
}

export function createCoachOfflineDocument({ userScope }) {
  const scope = normalize(userScope)
  if (!scope) throw new Error('offline_profile_scope_mismatch')
  return {
    contexts: {},
    updatedAt: '',
    userScope: scope,
  }
}

export function getCoachOfflineResources(document, contextId) {
  const key = normalize(contextId)
  if (!document || !key || normalize(document.userScope) === '') return null
  const entry = document.contexts?.[key]
  if (!entry || normalize(entry.contextId) !== key) return null
  return {
    contextId: key,
    resources: entry.resources || {},
    savedAt: normalize(entry.savedAt),
    stale: true,
  }
}

export function setCoachOfflineResources(document, contextId, resources, now = new Date().toISOString()) {
  const key = normalize(contextId)
  if (!document?.userScope || !key) throw new Error('offline_context_scope_mismatch')
  return {
    ...document,
    contexts: {
      ...(document.contexts || {}),
      [key]: {
        contextId: key,
        resources: resources && typeof resources === 'object' && !Array.isArray(resources) ? resources : {},
        savedAt: now,
      },
    },
    updatedAt: now,
  }
}
