import { createEvaluation, updateEvaluation } from './supabase.js'

const OFFLINE_DRAFTS_KEY = 'player-feedback:offline-evaluation-drafts'

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch (error) {
    console.error('Offline draft storage could not be read', error)
    return fallback
  }
}

function writeDrafts(drafts) {
  localStorage.setItem(OFFLINE_DRAFTS_KEY, JSON.stringify(drafts))
  window.dispatchEvent(new CustomEvent('offline-drafts-changed'))
}

export function getDrafts() {
  const drafts = safeJsonParse(localStorage.getItem(OFFLINE_DRAFTS_KEY), [])
  return Array.isArray(drafts) ? drafts : []
}

export function getQueuedDrafts() {
  return getDrafts().filter((draft) => !draft.synced && draft.readyToSync === true)
}

export function saveDraft(draft) {
  if (!draft?.id || !draft?.data) {
    return null
  }

  const drafts = getDrafts()
  const nextDraft = {
    ...draft,
    createdAt: draft.createdAt || new Date().toISOString(),
    synced: false,
  }
  const existingIndex = drafts.findIndex((item) => item.id === draft.id)

  if (existingIndex >= 0) {
    drafts[existingIndex] = {
      ...drafts[existingIndex],
      ...nextDraft,
      readyToSync: nextDraft.readyToSync === true || drafts[existingIndex].readyToSync === true,
    }
  } else {
    drafts.push(nextDraft)
  }

  writeDrafts(drafts)
  return nextDraft
}

export function removeDraft(id) {
  writeDrafts(getDrafts().filter((draft) => draft.id !== id))
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

export async function syncDrafts() {
  if (!navigator.onLine) {
    return {
      synced: 0,
      failed: getDrafts().filter((draft) => !draft.synced).length,
    }
  }

  const pendingDrafts = getQueuedDrafts()
  let synced = 0
  let failed = 0

  for (const draft of pendingDrafts) {
    try {
      await syncDraft(draft)
      removeDraft(draft.id)
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
