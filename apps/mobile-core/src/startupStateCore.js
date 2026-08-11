export const MOBILE_STARTUP_STATES = Object.freeze({
  BOOTING: 'BOOTING',
  RECOVERABLE_ERROR: 'RECOVERABLE_ERROR',
  READY_SIGNED_IN: 'READY_SIGNED_IN',
  READY_SIGNED_OUT: 'READY_SIGNED_OUT',
  RESOLVING_STAFF_CONTEXT: 'RESOLVING_STAFF_CONTEXT',
  RESTORING_SESSION: 'RESTORING_SESSION',
})

export const DEFAULT_MOBILE_STARTUP_TIMEOUT_MS = 12000

export function getMobileStartupDiagnosticPrefix(appRole = 'parent') {
  return String(appRole || '').trim().toLowerCase() === 'coach' ? 'COACH' : 'PARENT'
}

function startupError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

export function getSafeStartupDiagnosticCode(error, fallback = 'PARENT_STARTUP_FAILED') {
  const code = String(error?.code || error?.message || fallback).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  return /^[A-Z0-9_]{3,64}$/.test(code) ? code : fallback
}

export function withStartupTimeout(
  operation,
  timeoutMs = DEFAULT_MOBILE_STARTUP_TIMEOUT_MS,
  timeoutCode = 'PARENT_STARTUP_TIMEOUT',
) {
  let timer
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(startupError(timeoutCode)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function runMobileStartup({
  appRole = 'parent',
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
  const diagnosticPrefix = getMobileStartupDiagnosticPrefix(appRole)
  const startupTimeoutCode = `${diagnosticPrefix}_STARTUP_TIMEOUT`
  onTransition?.(MOBILE_STARTUP_STATES.BOOTING)

  if (!config?.isUsable) {
    return {
      diagnosticCode: `${diagnosticPrefix}_CONFIG_INVALID`,
      state: MOBILE_STARTUP_STATES.RECOVERABLE_ERROR,
    }
  }

  onTransition?.(MOBILE_STARTUP_STATES.RESTORING_SESSION)

  try {
    await withStartupTimeout(() => prepare?.(), timeoutMs, startupTimeoutCode)
    const result = await withStartupTimeout(() => getSession(), timeoutMs, startupTimeoutCode)
    if (result?.error) throw result.error
    const session = result?.data?.session || null

    if (!session?.user) {
      await onSession?.(null)
      return { diagnosticCode: '', session: null, state: MOBILE_STARTUP_STATES.READY_SIGNED_OUT }
    }

    const biometricEnabled = await withStartupTimeout(() => getBiometricEnabled(), timeoutMs, startupTimeoutCode)
    onLock?.(Boolean(biometricEnabled))
    await onSession?.(session)
    onTransition?.(resolvingProfileState)
    await withStartupTimeout(() => loadProfile(session), timeoutMs, startupTimeoutCode)
    return { diagnosticCode: '', session, state: MOBILE_STARTUP_STATES.READY_SIGNED_IN }
  } catch (error) {
    const diagnosticCode = getSafeStartupDiagnosticCode(error, `${diagnosticPrefix}_STARTUP_FAILED`)
    if (/REFRESH|SESSION.*INVALID|INVALID.*SESSION|JWT.*EXPIRED/.test(diagnosticCode)) {
      try {
        await withStartupTimeout(() => clearInvalidSession?.(), timeoutMs, startupTimeoutCode)
        await onSession?.(null)
        return { diagnosticCode: '', session: null, state: MOBILE_STARTUP_STATES.READY_SIGNED_OUT }
      } catch (clearError) {
        return {
          diagnosticCode: getSafeStartupDiagnosticCode(clearError, `${diagnosticPrefix}_SESSION_RESET_FAILED`),
          state: MOBILE_STARTUP_STATES.RECOVERABLE_ERROR,
        }
      }
    }
    return { diagnosticCode, state: MOBILE_STARTUP_STATES.RECOVERABLE_ERROR }
  }
}
