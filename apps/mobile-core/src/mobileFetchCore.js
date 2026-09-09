// Bound the actual request, including session renewal. Timing out only the
// caller leaves the request running and can keep the auth session lock held.
export function createBoundedMobileFetch(fetcher, timeoutMs = 8000) {
  return async (url, options = {}) => {
    const controller = new AbortController()
    const externalSignal = options.signal
    const cancel = () => controller.abort()
    if (externalSignal?.aborted) cancel()
    externalSignal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, timeoutMs)
    try {
      return await fetcher(url, { ...options, signal: controller.signal })
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', cancel)
    }
  }
}
