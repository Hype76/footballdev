import { createEvaluation, updateEvaluation } from './supabase.js'
import {
  canAccessDraftScope,
  createDraftScope,
  getDraftExpiry,
  isDraftExpired,
  isDraftUserActive,
} from './draft-security.js'

export const OFFLINE_DRAFTS_KEY = 'footballplayer:protected-offline-evaluation-drafts:v2'
export const LEGACY_OFFLINE_DRAFTS_KEY = 'player-feedback:offline-evaluation-drafts'

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch (error) {
    console.error('Offline draft storage could not be read', error)
    return fallback
  }
}

function getStorage(storage) {
  if (storage) {
    return storage
  }

  return typeof window === 'undefined' ? null : window.localStorage
}

function dispatchDraftChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('offline-drafts-changed'))
  }
}

function writeDrafts(drafts, storage) {
  const resolvedStorage = getStorage(storage)

  if (!resolvedStorage) {
    return
  }

  resolvedStorage.setItem(OFFLINE_DRAFTS_KEY, JSON.stringify(drafts))
  dispatchDraftChange()
}

function readAllDrafts({ now = Date.now(), storage } = {}) {
  const resolvedStorage = getStorage(storage)

  if (!resolvedStorage) {
    return []
  }

  if (resolvedStorage.getItem(LEGACY_OFFLINE_DRAFTS_KEY) !== null) {
    resolvedStorage.removeItem(LEGACY_OFFLINE_DRAFTS_KEY)
  }

  const storedDrafts = safeJsonParse(resolvedStorage.getItem(OFFLINE_DRAFTS_KEY), [])
  const drafts = Array.isArray(storedDrafts) ? storedDrafts : []
  const activeDrafts = drafts.filter((draft) => !isDraftExpired(draft, now))

  if (activeDrafts.length !== drafts.length) {
    writeDrafts(activeDrafts, resolvedStorage)
  }

  return activeDrafts
}

export function getDrafts({ now = Date.now(), storage, user } = {}) {
  if (!isDraftUserActive(user)) {
    return []
  }

  return readAllDrafts({ now, storage })
    .filter((draft) => canAccessDraftScope({ scope: draft.scope, user }))
}

export function getQueuedDrafts(options = {}) {
  return getDrafts(options).filter((draft) => !draft.synced && draft.readyToSync === true)
}

export function saveDraft(draft, { now = Date.now(), storage, user } = {}) {
  if (!draft?.id || !draft?.data || !isDraftUserActive(user)) {
    return null
  }

  const drafts = readAllDrafts({ now, storage })
  const ownedDrafts = drafts.filter((item) => canAccessDraftScope({ scope: item.scope, user }))
  const nextDraft = {
    ...draft,
    createdAt: draft.createdAt || new Date(now).toISOString(),
    expiresAt: getDraftExpiry(now),
    scope: createDraftScope({
      context: {
        clubId: draft.clubId,
        playerId: draft.playerId || draft.data?.playerId,
        playerName: draft.playerName || draft.data?.playerName,
        teamId: draft.teamId || draft.data?.teamId,
        teamName: draft.teamName || draft.data?.team,
      },
      user,
    }),
    synced: false,
  }
  const existingIndex = ownedDrafts.findIndex((item) => item.id === draft.id)

  if (existingIndex >= 0) {
    ownedDrafts[existingIndex] = {
      ...ownedDrafts[existingIndex],
      ...nextDraft,
      readyToSync: nextDraft.readyToSync === true || ownedDrafts[existingIndex].readyToSync === true,
    }
  } else {
    ownedDrafts.push(nextDraft)
  }

  const inaccessibleDrafts = drafts.filter((item) => !canAccessDraftScope({ scope: item.scope, user }))
  writeDrafts([...inaccessibleDrafts, ...ownedDrafts].slice(-50), storage)
  return nextDraft
}

export function removeDraft(id, { storage, user } = {}) {
  if (!isDraftUserActive(user)) {
    return
  }

  writeDrafts(
    readAllDrafts({ storage }).filter((draft) => (
      draft.id !== id || !canAccessDraftScope({ scope: draft.scope, user })
    )),
    storage,
  )
}

export function clearOfflineDraftsForUser(user, { storage } = {}) {
  const accountId = String(user?.id ?? '').trim()
  const resolvedStorage = getStorage(storage)

  if (!resolvedStorage || !accountId) {
    return
  }

  writeDrafts(
    readAllDrafts({ storage: resolvedStorage })
      .filter((draft) => String(draft?.scope?.accountId ?? '').trim() !== accountId),
    resolvedStorage,
  )
}

function isDuplicateKeyError(error) {
  return error?.code === '23505' || String(error?.message ?? '').toLowerCase().includes('duplicate key')
}

async function syncDraft(draft) {
  const operation = draft.operation || 'create'

  if (operation === 'update') {
    await updateEvaluation(draft.evaluationId, draft.data, draft.clubId)
    return
  }

  try {
    await createEvaluation({
      ...draft.data,
      id: draft.data.id || draft.id,
    })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return
    }

    throw error
  }
}

export async function syncDrafts({ storage, user } = {}) {
  const drafts = getDrafts({ storage, user })

  if (!navigator.onLine) {
    return {
      synced: 0,
      failed: drafts.filter((draft) => !draft.synced).length,
    }
  }

  const pendingDrafts = getQueuedDrafts({ storage, user })
  let synced = 0
  let failed = 0

  for (const draft of pendingDrafts) {
    try {
      await syncDraft(draft)
      removeDraft(draft.id, { storage, user })
      synced += 1
    } catch (error) {
      console.error('Offline draft sync failed', error)
      failed += 1
    }
  }

  return {
    synced,
    failed,
  }
}
