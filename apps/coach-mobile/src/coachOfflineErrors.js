export function getCoachOfflineSaveWarning(error) {
  const reason = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  let detail = 'Try saving again. If it still fails, contact support. Reference: SAVE.'
  if (/scope|boundary|profile|context/.test(reason)) {
    detail = 'Refresh your workspace and try again. Reference: ACCESS.'
  } else if (/payload_too_large|quota|disk.*full|database.*full|not enough.*storage/.test(reason)) {
    detail = 'Offline storage is full. Connect to the internet and sync any saved work. Reference: SPACE.'
  } else if (/crypto|key_store|key_readback|securestore|secure.store|textencoder|textdecoder/.test(reason)) {
    detail = 'Secure storage is unavailable on this phone. Unlock the phone and try again. Reference: SECURE.'
  } else if (/storage|readback|sqlite|database/.test(reason)) {
    detail = 'The phone could not verify its saved copy. Try saving again. Reference: DEVICE.'
  }
  return `Sessions are up to date, but this phone could not save an offline copy. Keep an internet connection while using Sessions. ${detail}`
}
