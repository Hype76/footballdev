export function developmentDraftKey(playerId, formId) {
  return JSON.stringify([playerId, formId])
}

export function developmentFormFingerprint(form) {
  return JSON.stringify([form.id, form.version, (form.fields || []).map(field => [field.id, field.type, field.roleRank, field.parentVisible, field.staffPrivate, field.options])])
}

export function editLocalDevelopmentDraft(previous, { id, playerId, formId, formFingerprint, values, notes }, now = new Date().toISOString()) {
  return {
    ...previous, id: previous?.id || id, playerId, formId,
    values, notes, formFingerprint: formFingerprint || '', revision: (previous?.revision || 0) + 1,
    serverVersion: previous?.serverVersion || 0, savedAt: now,
    status: 'pending', error: '',
  }
}

export function prepareDevelopmentAttempt(draft) {
  if (draft.attempt) return draft
  return { ...draft, attempt: { revision: draft.revision, values: draft.values, notes: draft.notes, formFingerprint: draft.formFingerprint || '',
    baseVersion: draft.serverVersion, version: draft.serverVersion + 1 } }
}

export function acknowledgeDevelopmentAttempt(draft, attempt, result) {
  if (draft.attempt?.revision !== attempt.revision) return draft
  return { ...draft, attempt: null, serverVersion: result.clientSaveVersion,
    status: draft.revision === attempt.revision ? 'synced' : 'pending', error: '', syncedAt: result.lastSavedAt }
}

export function sameDevelopmentSave(row, { playerId, formId, values, notes, version }) {
  const data = row?.draft_data || {}
  const canonical = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)))
  return row?.status === 'draft' && row.player_id === playerId
    && data.selectedFeedbackFormId === formId && Number(row.client_save_version) === version
    && canonical(data.responseValues) === canonical(values) && (data.notes || '') === (notes || '')
}
