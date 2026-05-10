import { REQUEST_TIMEOUT_MS } from '../supabase-client.js'

const VIEW_CACHE_PREFIX = 'view-cache:'
const MEMORY_CACHE_TTL_MS = 30 * 1000

const memoryCache = new Map()
const inFlightMemoryRequests = new Map()

function readMemoryCache(key) {
  if (!key) {
    return null
  }

  const cachedEntry = memoryCache.get(key)

  if (!cachedEntry) {
    return null
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    memoryCache.delete(key)
    return null
  }

  return cachedEntry.value
}

function writeMemoryCache(key, value, ttlMs = MEMORY_CACHE_TTL_MS) {
  if (!key) {
    return value
  }

  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
  return value
}

export function invalidateMemoryCacheByPrefix(prefix) {
  if (!prefix) {
    return
  }

  Array.from(memoryCache.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key)
    }
  })

  Array.from(inFlightMemoryRequests.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      inFlightMemoryRequests.delete(key)
    }
  })
}

export async function getCachedResource(cacheKey, task, ttlMs = MEMORY_CACHE_TTL_MS) {
  const cachedValue = readMemoryCache(cacheKey)

  if (cachedValue !== null) {
    return cachedValue
  }

  const pendingRequest = inFlightMemoryRequests.get(cacheKey)

  if (pendingRequest) {
    return pendingRequest
  }

  const nextRequest = Promise.resolve()
    .then(task)
    .then((value) => writeMemoryCache(cacheKey, value, ttlMs))
    .finally(() => {
      inFlightMemoryRequests.delete(cacheKey)
    })

  inFlightMemoryRequests.set(cacheKey, nextRequest)
  return nextRequest
}

export async function withRequestTimeout(task, message = 'Request timed out.', timeoutMs = REQUEST_TIMEOUT_MS) {
  let timeoutId

  try {
    const operation = typeof task === 'function' ? task() : task

    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(message))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId)
    }
  }
}

export function readViewCache(cacheKey) {
  if (!cacheKey) {
    return null
  }

  try {
    const storedValue = sessionStorage.getItem(`${VIEW_CACHE_PREFIX}${cacheKey}`)

    if (!storedValue) {
      return null
    }

    const parsedValue = JSON.parse(storedValue)
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null
  } catch (error) {
    console.error(error)
    return null
  }
}

export function readViewCacheValue(cacheKey, propertyName, fallbackValue) {
  const cachedValue = readViewCache(cacheKey)

  if (!cachedValue || !(propertyName in cachedValue)) {
    return fallbackValue
  }

  return cachedValue[propertyName]
}

export function writeViewCache(cacheKey, value) {
  if (!cacheKey) {
    return
  }

  try {
    sessionStorage.setItem(`${VIEW_CACHE_PREFIX}${cacheKey}`, JSON.stringify(value))
  } catch (error) {
    console.error(error)
  }
}

export function clearViewCaches() {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(VIEW_CACHE_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key))
  } catch (error) {
    console.error(error)
  }
}
