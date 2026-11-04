export function getCoachOfflineRecoveryMessage(value) {
  const reason = `${value?.code || ''} ${value?.message || ''} ${value?.status || ''}`.toLowerCase()
  return /recovery_required|offline_storage_file_unavailable|\bcorrupt\b/.test(reason)
    ? 'Saved offline work needs recovery. Keep app data and contact support. Reference: RECOVERY.'
    : ''
}

export function getCoachOfflineSaveWarning(error) {
  const reason = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  let detail = 'Try saving again. If it still fails, contact support. Reference: SAVE.'
  if (/recovery_required/.test(reason)) {
    detail = 'Saved offline work needs recovery. Keep app data and contact support. Reference: RECOVERY.'
  } else if (/scope|boundary|profile|context/.test(reason)) {
    detail = 'Refresh your workspace and try again. Reference: ACCESS.'
  } else if (/payload_too_large/.test(reason)) {
    detail = 'This offline copy exceeds the app cache limit. Keep using Sessions online and contact support if retrying does not help. Reference: CACHE.'
  } else if (/quota|disk.*full|database.*full|not enough.*storage/.test(reason)) {
    detail = 'The phone could not allocate offline storage. Check available device storage, then retry. Do not clear app data while work is waiting to sync. Reference: SPACE.'
  } else if (/crypto|key_store|key_readback|securestore|secure.store|textencoder|textdecoder/.test(reason)) {
    detail = 'Secure storage is unavailable on this phone. Unlock the phone and try again. Reference: SECURE.'
  } else if (/storage|readback|sqlite|database/.test(reason)) {
    detail = 'The phone could not verify its saved copy. Try saving again. Reference: DEVICE.'
  }
  return `Sessions are up to date, but this phone could not save an offline copy. Keep an internet connection while using Sessions. ${detail}`
}

export function getCoachMatchDayOfflineNotice(error) {
  const reason = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  if (/offline_profile_scope_mismatch|offline_context_scope_mismatch/.test(reason)) {
    return 'The saved Match Day workspace is still preparing. Return to Home and reopen this fixture. Reference: PROFILE.'
  }
  if (/scope|authority|access|context/.test(reason)) {
    return 'Saved Match Day actions belong to a different workspace. Select the original team before syncing. Reference: ACCESS.'
  }
  if (/quota|disk.*full|not enough.*storage|payload_too_large/.test(reason)) {
    return 'This phone could not save more Match Day work. Keep app data, free some device storage and retry. Reference: SPACE.'
  }
  if (/recovery_required|corrupt/.test(reason)) {
    return 'Saved Match Day work needs recovery. Keep app data and contact support. Reference: RECOVERY.'
  }
  return 'This phone could not verify its saved Match Day copy. Retry before recording another action. Reference: DEVICE.'
}
