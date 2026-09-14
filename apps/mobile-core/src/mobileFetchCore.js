// Bound the actual request, including session renewal. Timing out only the
// caller leaves the request running and can keep the auth session lock held.
const MATCH_DAY_WRITE_RPCS = new Set(['apply_coach_match_day_command', 'start_match_day', 'set_match_day_timer_state', 'set_match_day_extended_state'])

export function getMobileRequestTimeout(url, options = {}, timeoutMs = 8000) {
  const path = String(url).split('?')[0]
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
        throw new Error('The request timed out. Check your connection and retry. Saved match actions remain on this device.')
      }
      throw error
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', cancel)
    }
  }
}
