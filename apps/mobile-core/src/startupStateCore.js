export const MOBILE_STARTUP_STATES = Object.freeze({
  BOOTING: 'BOOTING',
  RECOVERABLE_ERROR: 'RECOVERABLE_ERROR',
  READY_SIGNED_IN: 'READY_SIGNED_IN',
  READY_SIGNED_OUT: 'READY_SIGNED_OUT',
  RESOLVING_STAFF_CONTEXT: 'RESOLVING_STAFF_CONTEXT',
  RESTORING_SESSION: 'RESTORING_SESSION',
})

export const DEFAULT_MOBILE_STARTUP_TIMEOUT_MS = 12000

function startupError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

export function getSafeStartupDiagnosticCode(error, fallback = 'PARENT_STARTUP_FAILED') {
  const code = String(error?.code || error?.message || fallback).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  return /^[A-Z0-9_]{3,64}$/.test(code) ? code : fallback
}

export function withStartupTimeout(operation, timeoutMs = DEFAULT_MOBILE_STARTUP_TIMEOUT_MS) {
  let timer
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(startupError('PARENT_STARTUP_TIMEOUT')), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function runMobileStartup({
  clearInvalidSession,
  config,
  getBiometricEnabled,
  getSession,
  loadProfile,
  onLock,
  onSession,
  onTransition,
  prepare,
  resolvingProfileState = MOBILE_STARTUP_STATES.RESTORING_SESSION,
  timeoutMs = DEFAULT_MOBILE_STARTUP_TIMEOUT_MS,
}) {
  onTransition?.(MOBILE_STARTUP_STATES.BOOTING)

  if (!config?.isUsable) {
    return {
      diagnosticCode: 'PARENT_CONFIG_INVALID',
      state: MOBILE_STARTUP_STATES.RECOVERABLE_ERROR,
    }
  }

  onTransition?.(MOBILE_STARTUP_STATES.RESTORING_SESSION)

  try {
    await withStartupTimeout(() => prepare?.(), timeoutMs)
    const result = await withStartupTimeout(() => getSession(), timeoutMs)
    if (result?.error) throw result.error
    const session = result?.data?.session || null

    if (!session?.user) {
      await onSession?.(null)
      return { diagnosticCode: '', session: null, state: MOBILE_STARTUP_STATES.READY_SIGNED_OUT }
    }

    const biometricEnabled = await withStartupTimeout(() => getBiometricEnabled(), timeoutMs)
    onLock?.(Boolean(biometricEnabled))
    await onSession?.(session)
    onTransition?.(resolvingProfileState)
    await withStartupTimeout(() => loadProfile(session), timeoutMs)
    return { diagnosticCode: '', session, state: MOBILE_STARTUP_STATES.READY_SIGNED_IN }
  } catch (error) {
    const diagnosticCode = getSafeStartupDiagnosticCode(error)
    if (/REFRESH|SESSION.*INVALID|INVALID.*SESSION|JWT.*EXPIRED/.test(diagnosticCode)) {
      try {
        await withStartupTimeout(() => clearInvalidSession?.(), timeoutMs)
        await onSession?.(null)
        return { diagnosticCode: '', session: null, state: MOBILE_STARTUP_STATES.READY_SIGNED_OUT }
      } catch (clearError) {
        return {
          diagnosticCode: getSafeStartupDiagnosticCode(clearError, 'PARENT_SESSION_RESET_FAILED'),
          state: MOBILE_STARTUP_STATES.RECOVERABLE_ERROR,
        }
      }
    }
    return { diagnosticCode, state: MOBILE_STARTUP_STATES.RECOVERABLE_ERROR }
  }
}
