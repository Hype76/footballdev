export function getCoachOfflineSaveWarning(error) {
  const reason = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  let detail = 'Try saving again. If it still fails, contact support. Reference: SAVE.'
  if (/scope|boundary|profile|context/.test(reason)) {
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
