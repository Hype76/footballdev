export function developmentInputIsSaved(input, draft) {
  const stable = values => JSON.stringify(Object.entries(values || {}).sort(([a], [b]) => a.localeCompare(b)))
  return stable(input.values) === stable(draft?.values) && (input.notes || '') === (draft?.notes || '')
}

export function developmentSaveStatus({ ready, saving, draft, unsaved, error, syncError }) {
  if (!ready) return 'Opening saved work...'
  if (saving) return 'Saving on this phone...'
  if (unsaved || error) return 'Some changes have not been saved. Keep this screen open and retry Save private draft.'
  if (draft?.finalisation) return 'Saved on this phone.'
  if (draft?.status === 'synced') return 'Synced. Private draft saved to your account.'
  if (syncError || draft?.error) return 'Saved on this phone. Sync needs a retry.'
  return draft ? 'Saved on this phone. Waiting to sync.' : 'Changes save on this phone as you work.'
}

export function developmentSyncFailure(error, stage) {
  if (error.code === 'offline_cache_payload_too_large') {
    return stage === 'acknowledging'
      ? 'The server confirmed this attempt, but the phone could not record the confirmation within the app\'s saved-data limit. Your saved draft is kept; retry Sync now with the same attempt.'
      : 'Your draft is still saved on this phone. Sync could not start within the app\'s saved-data limit. Retry Sync now when connected. Do not clear app data.'
  }
  return `Your saved draft is kept on this phone. Sync needs a retry. ${error.message || 'Check your connection and retry Sync now.'}`
}
