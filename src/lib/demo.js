export const DEMO_EMAIL = 'demo@playerfeedback.online'
export const DEMO_PASSWORD = 'Demo12345!'
export const DEMO_ROLE_STORAGE_KEY = 'player-feedback-demo-role'
export const DEMO_RESET_PENDING_STORAGE_KEY = 'football-player-demo-reset-pending'

export const DEMO_ROLE_OPTIONS = [
  { role: 'admin', label: 'Club Admin', rank: 90 },
  { role: 'head_manager', label: 'Team Admin', rank: 70 },
  { role: 'manager', label: 'Manager', rank: 50 },
  { role: 'coach', label: 'Coach', rank: 30 },
  { role: 'assistant_coach', label: 'Assistant Coach', rank: 20 },
]

export function isDemoEmail(email) {
  return String(email ?? '').trim().toLowerCase() === DEMO_EMAIL
}

export function isDemoUser(user) {
  return isDemoEmail(user?.email)
}

export function isDemoResetPending() {
  return typeof window !== 'undefined' && window.sessionStorage.getItem(DEMO_RESET_PENDING_STORAGE_KEY) === 'true'
}

export function setDemoResetPending(isPending) {
  if (typeof window === 'undefined') {
    return
  }

  if (isPending) {
    window.sessionStorage.setItem(DEMO_RESET_PENDING_STORAGE_KEY, 'true')
    return
  }

  window.sessionStorage.removeItem(DEMO_RESET_PENDING_STORAGE_KEY)
}

export function getDemoRole(roleKey) {
  return DEMO_ROLE_OPTIONS.find((role) => role.role === roleKey) || null
}
