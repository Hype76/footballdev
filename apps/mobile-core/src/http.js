const DEFAULT_TIMEOUT_MS = 12000

function normalize(value) {
  return String(value ?? '').trim()
}

export function joinApiPath(apiBaseUrl, path) {
  const base = normalize(apiBaseUrl).replace(/\/+$/, '')
  const nextPath = normalize(path).replace(/^\/+/, '')

  return nextPath ? `${base}/${nextPath}` : base
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
