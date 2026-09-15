// Bound the actual request, including session renewal. Timing out only the
// caller leaves the request running and can keep the auth session lock held.
const MATCH_DAY_WRITE_RPCS = new Set(['apply_coach_match_day_command', 'start_match_day', 'set_match_day_timer_state', 'set_match_day_extended_state'])
export const MOBILE_PASSWORD_REQUEST_TIMEOUT_MS = 20000

export function getMobileConnectionErrorMessage(error) {
  const message = String(error?.message || error || '').toLowerCase()
  const code = String(error?.code || '').toUpperCase()
  if (code.endsWith('_TIMEOUT') || /timed out|taking too long|service is taking too long/.test(message)) {
    return 'The service is taking too long to respond. Please try again.'
  }
  if (/network request failed|failed to fetch|networkerror|offline|unable to reach football player/.test(message)) {
    return 'Unable to reach Football Player. Please try again.'
  }
  return ''
}

export function getMobileRequestTimeout(url, options = {}, timeoutMs = 8000) {
  const path = String(url).split('?')[0]
  if (String(options.method || 'GET').toUpperCase() === 'POST'
    && path.endsWith('/auth/v1/token')
    && new URLSearchParams(String(url).split('?')[1] || '').get('grant_type') === 'password') {
    return Math.max(timeoutMs, MOBILE_PASSWORD_REQUEST_TIMEOUT_MS)
  }
  return String(options.method || 'GET').toUpperCase() === 'POST'
    && path.includes('/rest/v1/rpc/') && MATCH_DAY_WRITE_RPCS.has(path.split('/').at(-1))
    ? Math.max(timeoutMs, 30000) : timeoutMs
}

export function createBoundedMobileFetch(fetcher, timeoutMs = 8000) {
  return async (url, options = {}) => {
    const controller = new AbortController()
    const externalSignal = options.signal
    const cancel = () => controller.abort()
    if (externalSignal?.aborted) cancel()
    externalSignal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, getMobileRequestTimeout(url, options, timeoutMs))
    try {
      return await fetcher(url, { ...options, signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted && !externalSignal?.aborted) {
        const failure = new Error('The request timed out. Please try again. Saved match actions remain on this device.')
        failure.code = 'MOBILE_REQUEST_TIMEOUT'
        throw failure
      }
      throw error
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', cancel)
    }
  }
}
