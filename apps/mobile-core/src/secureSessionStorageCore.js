export const MOBILE_SESSION_STORAGE_SCHEMA_VERSION = 1
export const MOBILE_SESSION_CHUNK_BYTES = 1500
export const MOBILE_SESSION_MAX_BYTES = 64 * 1024
export const APPROVED_MOBILE_TEST_SUPABASE_REF = 'ndohkecigwlwayghsopw'

const LIVE_SUPABASE_REF = 'hvapkizujvsahvgspser'
const RETIRED_SUPABASE_REF = 'llpufwzvgxyczxcjwupu'
const APP_ROLES = new Set(['coach', 'parent'])
const NAMESPACE_ENVIRONMENTS = new Set(['test', 'live'])
const GENERATIONS = ['a', 'b']
const MAX_CHUNKS = Math.ceil(MOBILE_SESSION_MAX_BYTES / MOBILE_SESSION_CHUNK_BYTES)
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const namespaceQueues = new Map()

function normalize(value) {
  return String(value ?? '').trim()
}

function storageError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function emitDiagnostic(callback, category) {
  try {
    callback?.(category)
  } catch {
    // Diagnostics must never alter authentication storage behaviour.
  }
}

function utf8CodePointBytes(codePoint) {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

export function getUtf8ByteLength(value) {
  let bytes = 0
  for (const character of String(value)) bytes += utf8CodePointBytes(character.codePointAt(0))
  return bytes
}

export function splitUtf8Chunks(value, maximumBytes = MOBILE_SESSION_CHUNK_BYTES) {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) throw storageError('invalid_chunk_size')

  const chunks = []
  let current = ''
  let currentBytes = 0

  for (const character of String(value)) {
    const characterBytes = utf8CodePointBytes(character.codePointAt(0))
    if (characterBytes > maximumBytes) throw storageError('invalid_chunk_size')

    if (current && currentBytes + characterBytes > maximumBytes) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }

    current += character
    currentBytes += characterBytes
  }

  if (current || chunks.length === 0) chunks.push(current)
  return chunks
}

function decodeBase64Url(value) {
  const input = normalize(value).replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/g, '')
  let bits = 0
  let buffer = 0
  let output = ''

  for (const character of input) {
    const index = BASE64_ALPHABET.indexOf(character)
    if (index < 0) throw storageError('invalid_session_token')
    buffer = (buffer << 6) | index
    bits += 6

    if (bits >= 8) {
      bits -= 8
      output += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }

  return output
}

function getSessionProjectRef(accessToken) {
  try {
    const segments = normalize(accessToken).split('.')
    if (segments.length !== 3) return ''
    const claims = JSON.parse(decodeBase64Url(segments[1]))
    const explicitRef = normalize(claims?.ref)
    if (explicitRef) return explicitRef
    const issuerMatch = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/auth\/v1\/?$/i.exec(normalize(claims?.iss))
    return normalize(issuerMatch?.[1])
  } catch {
    return ''
  }
}

export function inspectSupabaseSessionValue(value, expectedProjectRef = APPROVED_MOBILE_TEST_SUPABASE_REF) {
  try {
    const session = JSON.parse(String(value))
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      return { category: 'secure_session_corrupt', valid: false }
    }

    if (!normalize(session.access_token) || !normalize(session.refresh_token)) {
      return { category: 'secure_session_corrupt', valid: false }
    }

    if (!Number.isFinite(Number(session.expires_at)) || !session.user || typeof session.user !== 'object') {
      return { category: 'secure_session_corrupt', valid: false }
    }

    const projectRef = getSessionProjectRef(session.access_token)
    if (projectRef === LIVE_SUPABASE_REF) {
      return { category: 'secure_session_environment_mismatch', valid: false }
    }
    if (projectRef === RETIRED_SUPABASE_REF) {
      return { category: 'secure_session_environment_mismatch', valid: false }
    }
    if (projectRef !== expectedProjectRef) {
      return { category: 'secure_session_environment_mismatch', valid: false }
    }

    return { category: 'approved_test_session', valid: true }
  } catch {
    return { category: 'secure_session_corrupt', valid: false }
  }
}

function normalizeLogicalKey(value) {
  const key = normalize(value)
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw storageError('invalid_auth_storage_key')
  return key
}

export function deriveMobileSessionNamespace({ appRole, environment, logicalKey }) {
  const app = normalize(appRole).toLowerCase()
  const environmentName = normalize(environment).toLowerCase()
  if (!APP_ROLES.has(app)) throw storageError('secure_session_app_mismatch')
  if (!NAMESPACE_ENVIRONMENTS.has(environmentName)) throw storageError('secure_session_environment_mismatch')
  return `fp.mobile.auth.v${MOBILE_SESSION_STORAGE_SCHEMA_VERSION}.${app}.${environmentName}.${normalizeLogicalKey(logicalKey)}`
}

function parseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function enqueue(namespace, operation) {
  const previous = namespaceQueues.get(namespace) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  namespaceQueues.set(namespace, current.catch(() => {}))
  return current
}

export function createSecureSessionStorage({
  appRole,
  environment,
  legacyStorage,
  onDiagnostic,
  secureStore,
  secureStoreOptions = {},
  sessionStorageKey,
  supabaseProjectRef,
}) {
  const app = normalize(appRole).toLowerCase()
  const environmentName = normalize(environment).toLowerCase()
  const projectRef = normalize(supabaseProjectRef)
  const mainKey = normalizeLogicalKey(sessionStorageKey)

  if (!APP_ROLES.has(app)) throw storageError('secure_session_app_mismatch')
  if (environmentName !== 'test') throw storageError('secure_session_environment_mismatch')
  if (projectRef !== APPROVED_MOBILE_TEST_SUPABASE_REF) throw storageError('secure_session_environment_mismatch')
  if (!secureStore?.getItemAsync || !secureStore?.setItemAsync || !secureStore?.deleteItemAsync) {
    throw storageError('secure_storage_unavailable')
  }
  if (!legacyStorage?.getItem || !legacyStorage?.removeItem) throw storageError('legacy_storage_unavailable')

  const knownKeys = new Set([mainKey, `${mainKey}-code-verifier`, `${mainKey}-user`])
  const namespace = deriveMobileSessionNamespace({ appRole: app, environment: environmentName, logicalKey: mainKey })

  function keyParts(logicalKey) {
    const keyNamespace = deriveMobileSessionNamespace({
      appRole: app,
      environment: environmentName,
      logicalKey,
    })
    return {
      marker: `${keyNamespace}.migration`,
      namespace: keyNamespace,
      pointer: `${keyNamespace}.active`,
    }
  }

  function generationManifestKey(keyNamespace, generation) {
    return `${keyNamespace}.g.${generation}.manifest`
  }

  function generationChunkKey(keyNamespace, generation, index) {
    return `${keyNamespace}.g.${generation}.c.${String(index).padStart(2, '0')}`
  }

  async function secureGet(key) {
    return secureStore.getItemAsync(key, secureStoreOptions)
  }

  async function secureSet(key, value) {
    return secureStore.setItemAsync(key, value, secureStoreOptions)
  }

  async function secureDelete(key) {
    return secureStore.deleteItemAsync(key, secureStoreOptions)
  }

  async function deleteGeneration(keyNamespace, generation) {
    await secureDelete(generationManifestKey(keyNamespace, generation))
    for (let index = 0; index < MAX_CHUNKS; index += 1) {
      await secureDelete(generationChunkKey(keyNamespace, generation, index))
    }
  }

  function parsePointer(rawValue) {
    if (!rawValue) return { active: '', previous: '', valid: true }
    const pointer = parseJson(rawValue)
    if (
      pointer?.schemaVersion !== MOBILE_SESSION_STORAGE_SCHEMA_VERSION ||
      !GENERATIONS.includes(pointer.active) ||
      (pointer.previous && !GENERATIONS.includes(pointer.previous)) ||
      pointer.previous === pointer.active
    ) {
      return { active: '', previous: '', valid: false }
    }
    return { active: pointer.active, previous: pointer.previous || '', valid: true }
  }

  async function readGeneration(keyNamespace, generation, validateSession) {
    const manifest = parseJson(await secureGet(generationManifestKey(keyNamespace, generation)))
    if (
      manifest?.schemaVersion !== MOBILE_SESSION_STORAGE_SCHEMA_VERSION ||
      manifest?.generation !== generation ||
      !Number.isInteger(manifest?.chunkCount) ||
      manifest.chunkCount < 1 ||
      manifest.chunkCount > MAX_CHUNKS ||
      !Number.isInteger(manifest?.byteLength) ||
      manifest.byteLength < 1 ||
      manifest.byteLength > MOBILE_SESSION_MAX_BYTES ||
      !Array.isArray(manifest?.chunkByteLengths) ||
      manifest.chunkByteLengths.length !== manifest.chunkCount
    ) {
      return { category: 'secure_session_corrupt', valid: false, value: null }
    }

    const chunks = []
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const chunk = await secureGet(generationChunkKey(keyNamespace, generation, index))
      if (typeof chunk !== 'string' || getUtf8ByteLength(chunk) !== manifest.chunkByteLengths[index]) {
        return { category: 'secure_session_corrupt', valid: false, value: null }
      }
      chunks.push(chunk)
    }

    const value = chunks.join('')
    if (getUtf8ByteLength(value) !== manifest.byteLength) {
      return { category: 'secure_session_corrupt', valid: false, value: null }
    }

    if (validateSession) {
      const inspection = inspectSupabaseSessionValue(value, projectRef)
      if (!inspection.valid) return { ...inspection, value: null }
    }

    return { category: 'secure_session_valid', valid: true, value }
  }

  async function readSecureValue(logicalKey) {
    const parts = keyParts(logicalKey)
    const pointer = parsePointer(await secureGet(parts.pointer))
    if (!pointer.valid) return { category: 'secure_session_corrupt', valid: false, value: null }
    if (!pointer.active) return { category: 'secure_session_missing', valid: false, value: null }

    const active = await readGeneration(parts.namespace, pointer.active, logicalKey === mainKey)
    if (active.valid) return active

    if (pointer.previous) {
      const previous = await readGeneration(parts.namespace, pointer.previous, logicalKey === mainKey)
      if (previous.valid) {
        await secureSet(parts.pointer, JSON.stringify({
          active: pointer.previous,
          previous: '',
          schemaVersion: MOBILE_SESSION_STORAGE_SCHEMA_VERSION,
        }))
        await deleteGeneration(parts.namespace, pointer.active)
        emitDiagnostic(onDiagnostic, 'stale_generation_pruned')
        return previous
      }
    }

    return active
  }

  async function pruneKey(logicalKey) {
    const parts = keyParts(logicalKey)
    const pointer = parsePointer(await secureGet(parts.pointer))
    if (!pointer.valid) return 0
    const retained = new Set([pointer.active, pointer.previous].filter(Boolean))
    let pruned = 0
    for (const generation of GENERATIONS) {
      if (!retained.has(generation)) {
        await deleteGeneration(parts.namespace, generation)
        pruned += 1
      }
    }
    if (pruned) emitDiagnostic(onDiagnostic, 'stale_generation_pruned')
    return pruned
  }

  async function clearKey(logicalKey, { clearLegacy = true } = {}) {
    const parts = keyParts(logicalKey)
    await secureDelete(parts.pointer)
    await secureDelete(parts.marker)
    for (const generation of GENERATIONS) await deleteGeneration(parts.namespace, generation)
    if (clearLegacy) await legacyStorage.removeItem(logicalKey)
  }

  async function writeSecureValue(logicalKey, value) {
    if (logicalKey !== mainKey) throw storageError('unsupported_auth_storage_key')
    if (typeof value !== 'string' || !value) throw storageError('secure_session_corrupt')

    const byteLength = getUtf8ByteLength(value)
    if (byteLength > MOBILE_SESSION_MAX_BYTES) throw storageError('secure_session_oversized')

    const inspection = inspectSupabaseSessionValue(value, projectRef)
    if (!inspection.valid) throw storageError(inspection.category)

    const parts = keyParts(logicalKey)
    const pointer = parsePointer(await secureGet(parts.pointer))
    if (!pointer.valid) throw storageError('secure_session_corrupt')

    const target = pointer.active === 'a' ? 'b' : 'a'
    const chunks = splitUtf8Chunks(value)
    await deleteGeneration(parts.namespace, target)

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        await secureSet(generationChunkKey(parts.namespace, target, index), chunks[index])
      }

      await secureSet(generationManifestKey(parts.namespace, target), JSON.stringify({
        byteLength,
        chunkByteLengths: chunks.map(getUtf8ByteLength),
        chunkCount: chunks.length,
        generation: target,
        schemaVersion: MOBILE_SESSION_STORAGE_SCHEMA_VERSION,
      }))

      const written = await readGeneration(parts.namespace, target, true)
      if (!written.valid || written.value !== value) throw storageError('secure_readback_failed')

      await secureSet(parts.pointer, JSON.stringify({
        active: target,
        previous: pointer.active || '',
        schemaVersion: MOBILE_SESSION_STORAGE_SCHEMA_VERSION,
      }))

      const activated = await readSecureValue(logicalKey)
      if (!activated.valid || activated.value !== value) {
        if (pointer.active) {
          await secureSet(parts.pointer, JSON.stringify({
            active: pointer.active,
            previous: '',
            schemaVersion: MOBILE_SESSION_STORAGE_SCHEMA_VERSION,
          }))
        } else {
          await secureDelete(parts.pointer)
        }
        throw storageError('secure_readback_failed')
      }

      await secureSet(parts.pointer, JSON.stringify({
        active: target,
        previous: '',
        schemaVersion: MOBILE_SESSION_STORAGE_SCHEMA_VERSION,
      }))
      await pruneKey(logicalKey)
      return true
    } catch (error) {
      const currentPointer = parsePointer(await secureGet(parts.pointer))
      if (!currentPointer.valid || currentPointer.active !== target) await deleteGeneration(parts.namespace, target)
      emitDiagnostic(onDiagnostic, error?.code === 'secure_readback_failed' ? 'secure_readback_failed' : 'secure_write_failed')
      throw error
    }
  }

  async function finishLegacyCleanup(logicalKey) {
    const parts = keyParts(logicalKey)
    await legacyStorage.removeItem(logicalKey)
    await secureSet(parts.marker, JSON.stringify({
      schemaVersion: MOBILE_SESSION_STORAGE_SCHEMA_VERSION,
      status: 'complete',
    }))
  }

  async function migrateLegacySessionInternal() {
    const secureValue = await readSecureValue(mainKey)
    if (secureValue.valid) {
      await finishLegacyCleanup(mainKey)
      return { category: 'secure_session_valid', migrated: false, value: secureValue.value }
    }

    const legacyValue = await legacyStorage.getItem(mainKey)
    if (!legacyValue) {
      if (secureValue.category !== 'secure_session_missing') {
        emitDiagnostic(onDiagnostic, secureValue.category)
        await clearKey(mainKey)
      }
      return { category: 'secure_session_missing', migrated: false, value: null }
    }

    const legacyInspection = inspectSupabaseSessionValue(legacyValue, projectRef)
    if (!legacyInspection.valid) {
      emitDiagnostic(onDiagnostic, 'legacy_session_rejected')
      if (secureValue.category !== 'secure_session_missing') await clearKey(mainKey, { clearLegacy: false })
      return { category: 'legacy_session_rejected', migrated: false, value: null }
    }

    if (secureValue.category !== 'secure_session_missing') await clearKey(mainKey, { clearLegacy: false })
    await writeSecureValue(mainKey, legacyValue)
    const readback = await readSecureValue(mainKey)
    if (!readback.valid || readback.value !== legacyValue) throw storageError('secure_readback_failed')
    await finishLegacyCleanup(mainKey)
    emitDiagnostic(onDiagnostic, 'legacy_session_migrated')
    return { category: 'legacy_session_migrated', migrated: true, value: readback.value }
  }

  return {
    async clearSessionStorage() {
      return enqueue(namespace, async () => {
        for (const logicalKey of knownKeys) await clearKey(logicalKey)
      })
    },

    async getItem(logicalKey) {
      if (logicalKey !== mainKey) return null
      return enqueue(namespace, async () => (await migrateLegacySessionInternal()).value)
    },

    async inspectSafeStorageState() {
      return enqueue(namespace, async () => {
        const parts = keyParts(mainKey)
        const pointer = parsePointer(await secureGet(parts.pointer))
        const secureValue = pointer.valid ? await readSecureValue(mainKey) : { category: 'secure_session_corrupt', valid: false }
        return {
          appRole: app,
          category: secureValue.category,
          environment: environmentName,
          hasActiveGeneration: Boolean(pointer.active),
          hasPreviousGeneration: Boolean(pointer.previous),
          schemaVersion: MOBILE_SESSION_STORAGE_SCHEMA_VERSION,
        }
      })
    },

    async migrateLegacySession() {
      return enqueue(namespace, migrateLegacySessionInternal)
    },

    async pruneStaleGenerations() {
      return enqueue(namespace, () => pruneKey(mainKey))
    },

    async removeItem(logicalKey) {
      if (!knownKeys.has(logicalKey)) return
      return enqueue(namespace, () => clearKey(logicalKey))
    },

    async setItem(logicalKey, value) {
      return enqueue(namespace, async () => {
        await writeSecureValue(logicalKey, value)
        await finishLegacyCleanup(logicalKey)
      })
    },
  }
}
