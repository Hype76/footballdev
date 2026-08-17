const DEFAULT_TIMEOUT_MS = 12000

function normalize(value) {
  return String(value ?? '').trim()
}

export function joinApiPath(apiBaseUrl, path) {
  const base = normalize(apiBaseUrl).replace(/\/+$/, '')
  const nextPath = normalize(path).replace(/^\/+/, '')

  return nextPath ? `${base}/${nextPath}` : base
}

export function withMobileAsyncTimeout(operation, options = {}) {
  const requestedTimeout = Number(options.timeoutMs)
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? requestedTimeout
    : DEFAULT_TIMEOUT_MS
  const timeoutMessage = normalize(options.timeoutMessage) || 'The request timed out. Check your connection and try again.'
  let timeoutId

  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timeoutId))
}

export async function fetchJsonWithTimeout(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    const result = await response.json().catch(() => ({}))

    return {
      ok: response.ok,
      response,
      result,
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('The request timed out. Check your connection and try again.')
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
