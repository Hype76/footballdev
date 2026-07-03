export const SELECTED_ACCESS_MODE_STORAGE_KEY = 'selected-access-mode'
export const SELECTED_ACCESS_MODE_EXPLICIT_KEY = 'selected-access-mode-explicit'
export const LOGIN_ACCESS_INTENT_STORAGE_KEY = 'login-access-intent'

const loginAccessIntents = new Set(['team', 'parent', 'platform_admin'])

export function normalizeLoginAccessIntent(intent = '') {
  const normalizedIntent = String(intent ?? '').trim()
  return loginAccessIntents.has(normalizedIntent) ? normalizedIntent : ''
}

export function rememberLoginAccessIntent(intent) {
  if (typeof window === 'undefined') {
    return ''
  }

  const normalizedIntent = normalizeLoginAccessIntent(intent)

  if (!normalizedIntent) {
    clearLoginAccessIntent()
    return ''
  }

  window.sessionStorage.setItem(LOGIN_ACCESS_INTENT_STORAGE_KEY, normalizedIntent)
  window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, normalizedIntent)
  window.sessionStorage.setItem(SELECTED_ACCESS_MODE_EXPLICIT_KEY, 'true')
  return normalizedIntent
}

export function readLoginAccessIntent() {
  if (typeof window === 'undefined') {
    return ''
  }

  return normalizeLoginAccessIntent(window.sessionStorage.getItem(LOGIN_ACCESS_INTENT_STORAGE_KEY))
}

export function clearLoginAccessIntent() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(LOGIN_ACCESS_INTENT_STORAGE_KEY)
}
