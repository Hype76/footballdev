export const MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION = 1
export const MOBILE_OFFLINE_KEY_BYTES = 32
export const MOBILE_OFFLINE_NONCE_BYTES = 24

const GENERATIONS = ['a', 'b']
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const queues = new Map()
const runningTransactions = new Map()
const scopes = new WeakMap()
const STORAGE_STEP_LABELS = {
  queued: 'Waiting for an earlier save', preparing: 'Preparing saved work',
  pointer_read: 'Reading saved work', generation_read: 'Reading saved work', key_read: 'Preparing a secure save',
  crypto_random: 'Preparing a secure save', crypto_encrypt: 'Preparing a secure save', crypto_decrypt: 'Opening saved work',
  key_write: 'Preparing a secure save', generation_write: 'Writing saved work', pointer_write: 'Writing saved work',
  pointer_remove: 'Clearing saved work', generation_remove: 'Clearing saved work', key_remove: 'Clearing saved work',
}

function normalize(value) {
  return String(value ?? '').trim()
}

function offlineError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

export function bytesToBase64(bytes) {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0
    const packed = (first << 16) | (second << 8) | third
    output += BASE64_ALPHABET[(packed >> 18) & 63]
    output += BASE64_ALPHABET[(packed >> 12) & 63]
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(packed >> 6) & 63] : '='
    output += index + 2 < bytes.length ? BASE64_ALPHABET[packed & 63] : '='
  }
  return output
}

export function base64ToBytes(value) {
  const input = normalize(value)
  if (!input || input.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(input)) {
    throw offlineError('offline_storage_corrupt')
  }

  const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0
  if (input.slice(0, input.length - padding).includes('=')) throw offlineError('offline_storage_corrupt')
  const output = new Uint8Array(input.length / 4 * 3 - padding)
  let offset = 0
  for (let index = 0; index < input.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(input[index])
    const b = BASE64_ALPHABET.indexOf(input[index + 1])
    const c = input[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(input[index + 2])
    const d = input[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(input[index + 3])
    if (a < 0 || b < 0 || c < 0 || d < 0 || (index < input.length - 4 && input.slice(index, index + 4).includes('='))) throw offlineError('offline_storage_corrupt')
    const packed = (a << 18) | (b << 12) | (c << 6) | d
    output[offset++] = (packed >> 16) & 255
    if (offset < output.length) output[offset++] = (packed >> 8) & 255
    if (offset < output.length) output[offset++] = packed & 255
  }
  return output
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function enqueue(namespace, operation, timeoutMs, { kind, mustComplete = false }) {
  let timeoutError, timer, rejectCancellation
  const cancellation = new Promise((_, reject) => { rejectCancellation = reject })
  // A queued timeout may happen before a native wait subscribes to cancellation.
  cancellation.catch(() => {})
  const transaction = {
    stage: 'queued', mutating: false, guard: null,
    check() {
      if (timeoutError && !mustComplete) throw timeoutError
      this.guard?.()
    },
    async wait(stage, callback, mutating = false) {
      this.check()
      this.stage = stage
      this.mutating = mutating
      const pending = Promise.resolve().then(() => { this.check(); return callback() })
      try {
        // Only abandon read-only native waits. A dispatched mutation retains the
        // queue until it settles, even after its caller's deadline has expired.
        const result = await (mutating || mustComplete ? pending : Promise.race([pending, cancellation]))
        this.check()
        return result
      } finally { this.mutating = false }
    },
  }
  const previous = queues.get(namespace) || Promise.resolve()
  const current = previous.catch(() => {}).then(async () => {
    transaction.check()
    runningTransactions.set(namespace, transaction)
    try { return await operation(transaction) }
    finally { if (runningTransactions.get(namespace) === transaction) runningTransactions.delete(namespace) }
  })
  queues.set(namespace, current.catch(() => {}))
  return Promise.race([current, new Promise((_, reject) => {
    timer = setTimeout(() => {
      timeoutError = offlineError('offline_storage_timeout')
      timeoutError.storageOperation = kind
      timeoutError.storageStage = transaction.stage
      if (transaction.stage === 'queued') timeoutError.storageBlockedStage = runningTransactions.get(namespace)?.stage || 'queued'
      timeoutError.message = `Phone storage is taking too long. Keep your entries open and retry saving. Do not clear app data. Step: ${STORAGE_STEP_LABELS[transaction.stage] || 'Saving work on this phone'}.`
      if (!transaction.mutating && !mustComplete) rejectCancellation(timeoutError)
      reject(timeoutError)
    }, timeoutMs)
  })]).finally(() => clearTimeout(timer))
}

function parsePointer(rawValue) {
  if (!rawValue) return { active: '', previous: '', valid: true }
  const pointer = parseJson(rawValue)
  const valid = pointer?.schemaVersion === MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION
    && GENERATIONS.includes(pointer.active)
    && (!pointer.previous || GENERATIONS.includes(pointer.previous))
    && pointer.active !== pointer.previous
  return valid
    ? { active: pointer.active, previous: pointer.previous || '', valid: true }
    : { active: '', previous: '', valid: false }
}

export function deriveOfflineStorageNamespace({ appRole, environment, projectRef }) {
  const app = normalize(appRole).toLowerCase()
  const environmentName = normalize(environment).toLowerCase()
  const ref = normalize(projectRef).toLowerCase()
  if (!['coach', 'parent'].includes(app)) throw offlineError('offline_storage_app_mismatch')
  if (!['test', 'live'].includes(environmentName)) throw offlineError('offline_storage_environment_mismatch')
  if (!/^[a-z0-9]+$/.test(ref)) throw offlineError('offline_storage_project_mismatch')
  return `fp.mobile.offline.v${MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION}.${app}.${environmentName}.${ref}`
}

export function createEncryptedOfflineStore({
  appRole,
  cryptoProvider,
  environment,
  keyStore,
  keyStoreOptions = {},
  projectRef,
  storage,
  operationTimeoutMs = 8000,
}) {
  const namespace = deriveOfflineStorageNamespace({ appRole, environment, projectRef })
  const aad = `${namespace}.authenticated-envelope`
  const keyName = `${namespace}.key`
  const pointerName = `${namespace}.active`
  const verifiedGenerations = new Map()
  let snapshot = null
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value))
  const timeoutMs = Number.isFinite(operationTimeoutMs) && operationTimeoutMs > 0 ? operationTimeoutMs : 8000
  const transact = (kind, operation, mustComplete = false) => enqueue(namespace, operation, timeoutMs, { kind, mustComplete })

  function remember(result, userScope, epoch) {
    checkScope(userScope, epoch)
    snapshot = result.document ? { document: copy(result.document), userScope: normalize(userScope), epoch } : null
    return result
  }

  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) throw offlineError('offline_storage_unavailable')
  if (!keyStore?.getItemAsync || !keyStore?.setItemAsync || !keyStore?.deleteItemAsync) throw offlineError('offline_key_store_unavailable')
  if (!cryptoProvider?.randomBytes || !cryptoProvider?.seal || !cryptoProvider?.open) throw offlineError('offline_crypto_unavailable')

  function generationName(generation) {
    return `${namespace}.g.${generation}`
  }

  async function clearCiphertext(transaction) {
    snapshot = null
    verifiedGenerations.clear()
    await transaction.wait('pointer_remove', () => storage.removeItem(pointerName), true)
    for (const generation of GENERATIONS) await transaction.wait('generation_remove', () => storage.removeItem(generationName(generation)), true)
  }

  async function readKey(transaction) {
    const encoded = await transaction.wait('key_read', () => keyStore.getItemAsync(keyName, keyStoreOptions))
    if (!encoded) return null
    try {
      const key = base64ToBytes(encoded)
      return key.length === MOBILE_OFFLINE_KEY_BYTES ? key : null
    } catch {
      return null
    }
  }

  async function getOrCreateKey(transaction) {
    const existing = await readKey(transaction)
    if (existing) return existing
    const key = await transaction.wait('crypto_random', () => cryptoProvider.randomBytes(MOBILE_OFFLINE_KEY_BYTES))
    if (!(key instanceof Uint8Array) || key.length !== MOBILE_OFFLINE_KEY_BYTES) {
      throw offlineError('offline_crypto_unavailable')
    }
    await transaction.wait('key_write', () => keyStore.setItemAsync(keyName, bytesToBase64(key), keyStoreOptions), true)
    const verified = await readKey(transaction)
    if (!verified) throw offlineError('offline_key_readback_failed')
    return verified
  }

  function validateDocument(document, userScope) {
    return document
      && typeof document === 'object'
      && !Array.isArray(document)
      && document.schemaVersion === MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION
      && document.appRole === normalize(appRole).toLowerCase()
      && document.environment === normalize(environment).toLowerCase()
      && document.projectRef === normalize(projectRef).toLowerCase()
      && normalize(document.userScope) === normalize(userScope)
  }

  async function readGeneration(generation, key, userScope, transaction) {
    const raw = await transaction.wait('generation_read', () => storage.getItem(generationName(generation)))
    const cached = verifiedGenerations.get(generation)
    // Still read and compare the actual ciphertext and key. Tampering, missing
    // storage and key rotation must never be hidden by the decoded cache.
    if (cached?.raw === raw && cached.key === bytesToBase64(key) && validateDocument(cached.document, userScope)) {
      return { document: copy(cached.document), status: 'ready', valid: true }
    }
    verifiedGenerations.delete(generation)
    const envelope = parseJson(raw)
    if (
      envelope?.schemaVersion !== MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION
      || envelope?.generation !== generation
      || normalize(envelope?.algorithm) !== 'xchacha20-poly1305'
    ) {
      return { document: null, status: 'corrupt', valid: false }
    }

    try {
      const nonce = base64ToBytes(envelope.nonce)
      const ciphertext = base64ToBytes(envelope.ciphertext)
      if (nonce.length !== MOBILE_OFFLINE_NONCE_BYTES || ciphertext.length < 17) throw offlineError('offline_storage_corrupt')
      const plaintext = await transaction.wait('crypto_decrypt', () => cryptoProvider.open({ aad, ciphertext, key, nonce }))
      const document = JSON.parse(plaintext)
      if (!validateDocument(document, userScope)) {
        return { document: null, status: 'scope_mismatch', valid: false }
      }
      verifiedGenerations.set(generation, { raw, key: bytesToBase64(key), document: copy(document) })
      return { document, status: 'ready', valid: true }
    } catch (error) {
      if (['offline_storage_timeout', 'offline_scope_invalidated'].includes(error.code)) throw error
      return { document: null, status: 'corrupt', valid: false }
    }
  }

  async function readInternal(userScope, transaction) {
    const scope = normalize(userScope)
    if (!scope) return { document: null, status: 'missing' }
    const pointer = parsePointer(await transaction.wait('pointer_read', () => storage.getItem(pointerName)))
    if (!pointer.valid) {
      await clearCiphertext(transaction)
      return { document: null, status: 'corrupt' }
    }
    if (!pointer.active) return { document: null, status: 'missing' }
    const key = await readKey(transaction)
    if (!key) {
      await clearCiphertext(transaction)
      return { document: null, status: 'corrupt' }
    }

    const active = await readGeneration(pointer.active, key, scope, transaction)
    if (active.valid) return active
    if (active.status === 'scope_mismatch') {
      await clearCiphertext(transaction)
      return active
    }

    if (pointer.previous) {
      const previous = await readGeneration(pointer.previous, key, scope, transaction)
      if (previous.valid) {
        await transaction.wait('pointer_write', () => storage.setItem(pointerName, JSON.stringify({
          active: pointer.previous,
          previous: '',
          schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
        })), true)
        await transaction.wait('generation_remove', () => storage.removeItem(generationName(pointer.active)), true)
        return previous
      }
    }

    await clearCiphertext(transaction)
    return { document: null, status: 'corrupt' }
  }

  function scopeState() {
    if (!scopes.has(storage)) scopes.set(storage, new Map())
    const states = scopes.get(storage)
    if (!states.has(namespace)) states.set(namespace, { epoch: 0, userScope: '', blocked: false })
    return states.get(namespace)
  }

  function checkScope(userScope, epoch) {
    const state = scopeState()
    if (state.blocked || state.epoch !== epoch || (state.userScope && state.userScope !== normalize(userScope))) {
      throw offlineError('offline_scope_invalidated')
    }
  }

  async function writeInternal(userScope, value, epoch, transaction) {
    checkScope(userScope, epoch)
    const scope = normalize(userScope)
    const document = {
      ...value,
      appRole: normalize(appRole).toLowerCase(),
      environment: normalize(environment).toLowerCase(),
      projectRef: normalize(projectRef).toLowerCase(),
      schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
      userScope: scope,
    }
    if (!validateDocument(document, scope)) throw offlineError('offline_document_invalid')

    const pointer = parsePointer(await transaction.wait('pointer_read', () => storage.getItem(pointerName)))
    if (!pointer.valid) throw offlineError('offline_storage_corrupt')
    const target = pointer.active === 'a' ? 'b' : 'a'
    const key = await getOrCreateKey(transaction)
    const nonce = await transaction.wait('crypto_random', () => cryptoProvider.randomBytes(MOBILE_OFFLINE_NONCE_BYTES))
    const ciphertext = await transaction.wait('crypto_encrypt', () => cryptoProvider.seal({
      aad,
      key,
      nonce,
      plaintext: JSON.stringify(document),
    }))
    const envelope = JSON.stringify({
      algorithm: 'xchacha20-poly1305',
      ciphertext: bytesToBase64(ciphertext),
      generation: target,
      nonce: bytesToBase64(nonce),
      schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
    })

    await transaction.wait('generation_write', () => storage.setItem(generationName(target), envelope), true)
    const verified = await readGeneration(target, key, scope, transaction)
    if (!verified.valid || JSON.stringify(verified.document) !== JSON.stringify(document)) {
      await transaction.wait('generation_remove', () => storage.removeItem(generationName(target)), true)
      throw offlineError('offline_storage_readback_failed')
    }

    checkScope(userScope, epoch)
    await transaction.wait('pointer_write', () => storage.setItem(pointerName, JSON.stringify({
      active: target,
      previous: pointer.active || '',
      schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
    })), true)
    const activated = await readInternal(scope, transaction)
    if (!activated.document) throw offlineError('offline_storage_readback_failed')
    checkScope(userScope, epoch)
    await transaction.wait('pointer_write', () => storage.setItem(pointerName, JSON.stringify({
      active: target,
      previous: '',
      schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
    })), true)
    if (pointer.active) {
      await transaction.wait('generation_remove', () => storage.removeItem(generationName(pointer.active)), true)
      verifiedGenerations.delete(pointer.active)
    }
    remember(activated, scope, epoch)
    return activated.document
  }

  return {
    // Capture before a live request so its delayed response cannot recreate
    // storage after sign-out, account replacement or an explicit local clear.
    captureScopeGuard(userScope) {
      const epoch = scopeState().epoch
      checkScope(userScope, epoch)
      return () => checkScope(userScope, epoch)
    },
    activate(userScope) {
      const state = scopeState()
      const scope = normalize(userScope)
      if (!scope) throw offlineError('offline_profile_scope_mismatch')
      if (state.blocked || state.userScope !== scope) {
        snapshot = null
        verifiedGenerations.clear()
        state.epoch += 1
        state.userScope = scope
        state.blocked = false
      }
    },
    async update(userScope, updater) {
      const epoch = scopeState().epoch
      return transact('update', async transaction => {
        transaction.guard = () => checkScope(userScope, epoch)
        transaction.check()
        const current = (await readInternal(userScope, transaction)).document
        const next = await transaction.wait('preparing', () => updater(current))
        checkScope(userScope, epoch)
        if (!next || next === current) return current
        return writeInternal(userScope, next, epoch, transaction)
      })
    },
    async clear() {
      const state = scopeState()
      state.epoch += 1
      state.blocked = true
      snapshot = null
      verifiedGenerations.clear()

      return transact('clear', async transaction => {
        await clearCiphertext(transaction)
        await transaction.wait('key_remove', () => keyStore.deleteItemAsync(keyName, keyStoreOptions), true)
      }, true)
    },

    async inspect(userScope) {
      const epoch = scopeState().epoch
      return transact('inspect', async transaction => {
        const state = scopeState()
        transaction.guard = () => checkScope(userScope, epoch)
        const result = state.blocked || (state.userScope && state.userScope !== normalize(userScope))
          ? { document: null, status: 'scope_mismatch' } : await readInternal(userScope, transaction)
        return {
          appRole: normalize(appRole).toLowerCase(),
          environment: normalize(environment).toLowerCase(),
          hasDocument: Boolean(result.document),
          schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
          status: result.status,
        }
      })
    },

    async read(userScope) {
      const epoch = scopeState().epoch
      return transact('read', async transaction => {
        const state = scopeState()
        if (state.blocked || (state.userScope && state.userScope !== normalize(userScope))) {
          return { document: null, status: 'scope_mismatch' }
        }
        transaction.guard = () => checkScope(userScope, epoch)
        return remember(await readInternal(userScope, transaction), userScope, epoch)
      })
    },

    // Display the last committed snapshot without waiting for a background
    // write. Commands and reconciliation continue to use read/update above.
    async readSnapshot(userScope) {
      const state = scopeState()
      if (state.blocked || (state.userScope && state.userScope !== normalize(userScope))) return { document: null, status: 'scope_mismatch' }
      if (snapshot?.epoch === state.epoch && snapshot.userScope === normalize(userScope)) return { document: copy(snapshot.document), status: 'ready' }
      return this.read(userScope)
    },

    async write(userScope, value) {
      const epoch = scopeState().epoch
      return transact('write', transaction => {
        transaction.guard = () => checkScope(userScope, epoch)
        return writeInternal(userScope, value, epoch, transaction)
      })
    },
  }
}
