export const MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION = 1
export const MOBILE_OFFLINE_KEY_BYTES = 32
export const MOBILE_OFFLINE_NONCE_BYTES = 24

const GENERATIONS = ['a', 'b']
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const queues = new Map()

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

  const output = []
  for (let index = 0; index < input.length; index += 4) {
    const chars = input.slice(index, index + 4)
    const values = [...chars].map((character) => character === '=' ? 0 : BASE64_ALPHABET.indexOf(character))
    if (values.some((entry) => entry < 0)) throw offlineError('offline_storage_corrupt')
    const packed = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3]
    output.push((packed >> 16) & 255)
    if (chars[2] !== '=') output.push((packed >> 8) & 255)
    if (chars[3] !== '=') output.push(packed & 255)
  }
  return Uint8Array.from(output)
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function enqueue(namespace, operation) {
  const previous = queues.get(namespace) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  queues.set(namespace, current.catch(() => {}))
  return current
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
}) {
  const namespace = deriveOfflineStorageNamespace({ appRole, environment, projectRef })
  const aad = `${namespace}.authenticated-envelope`
  const keyName = `${namespace}.key`
  const pointerName = `${namespace}.active`

  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) throw offlineError('offline_storage_unavailable')
  if (!keyStore?.getItemAsync || !keyStore?.setItemAsync || !keyStore?.deleteItemAsync) throw offlineError('offline_key_store_unavailable')
  if (!cryptoProvider?.randomBytes || !cryptoProvider?.seal || !cryptoProvider?.open) throw offlineError('offline_crypto_unavailable')

  function generationName(generation) {
    return `${namespace}.g.${generation}`
  }

  async function clearCiphertext() {
    await storage.removeItem(pointerName)
    await Promise.all(GENERATIONS.map((generation) => storage.removeItem(generationName(generation))))
  }

  async function readKey() {
    const encoded = await keyStore.getItemAsync(keyName, keyStoreOptions)
    if (!encoded) return null
    try {
      const key = base64ToBytes(encoded)
      return key.length === MOBILE_OFFLINE_KEY_BYTES ? key : null
    } catch {
      return null
    }
  }

  async function getOrCreateKey() {
    const existing = await readKey()
    if (existing) return existing
    const key = await cryptoProvider.randomBytes(MOBILE_OFFLINE_KEY_BYTES)
    if (!(key instanceof Uint8Array) || key.length !== MOBILE_OFFLINE_KEY_BYTES) {
      throw offlineError('offline_crypto_unavailable')
    }
    await keyStore.setItemAsync(keyName, bytesToBase64(key), keyStoreOptions)
    const verified = await readKey()
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

  async function readGeneration(generation, key, userScope) {
    const envelope = parseJson(await storage.getItem(generationName(generation)))
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
      const plaintext = await cryptoProvider.open({ aad, ciphertext, key, nonce })
      const document = JSON.parse(plaintext)
      if (!validateDocument(document, userScope)) {
        return { document: null, status: 'scope_mismatch', valid: false }
      }
      return { document, status: 'ready', valid: true }
    } catch {
      return { document: null, status: 'corrupt', valid: false }
    }
  }

  async function readInternal(userScope) {
    const scope = normalize(userScope)
    if (!scope) return { document: null, status: 'missing' }
    const pointer = parsePointer(await storage.getItem(pointerName))
    if (!pointer.valid) {
      await clearCiphertext()
      return { document: null, status: 'corrupt' }
    }
    if (!pointer.active) return { document: null, status: 'missing' }
    const key = await readKey()
    if (!key) {
      await clearCiphertext()
      return { document: null, status: 'corrupt' }
    }

    const active = await readGeneration(pointer.active, key, scope)
    if (active.valid) return active
    if (active.status === 'scope_mismatch') {
      await clearCiphertext()
      return active
    }

    if (pointer.previous) {
      const previous = await readGeneration(pointer.previous, key, scope)
      if (previous.valid) {
        await storage.setItem(pointerName, JSON.stringify({
          active: pointer.previous,
          previous: '',
          schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
        }))
        await storage.removeItem(generationName(pointer.active))
        return previous
      }
    }

    await clearCiphertext()
    return { document: null, status: 'corrupt' }
  }

  return {
    async clear() {
      return enqueue(namespace, async () => {
        await clearCiphertext()
        await keyStore.deleteItemAsync(keyName, keyStoreOptions)
      })
    },

    async inspect(userScope) {
      return enqueue(namespace, async () => {
        const result = await readInternal(userScope)
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
      return enqueue(namespace, () => readInternal(userScope))
    },

    async write(userScope, value) {
      return enqueue(namespace, async () => {
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

        const pointer = parsePointer(await storage.getItem(pointerName))
        if (!pointer.valid) throw offlineError('offline_storage_corrupt')
        const target = pointer.active === 'a' ? 'b' : 'a'
        const key = await getOrCreateKey()
        const nonce = await cryptoProvider.randomBytes(MOBILE_OFFLINE_NONCE_BYTES)
        const ciphertext = await cryptoProvider.seal({
          aad,
          key,
          nonce,
          plaintext: JSON.stringify(document),
        })
        const envelope = JSON.stringify({
          algorithm: 'xchacha20-poly1305',
          ciphertext: bytesToBase64(ciphertext),
          generation: target,
          nonce: bytesToBase64(nonce),
          schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
        })

        await storage.setItem(generationName(target), envelope)
        const verified = await readGeneration(target, key, scope)
        if (!verified.valid || JSON.stringify(verified.document) !== JSON.stringify(document)) {
          await storage.removeItem(generationName(target))
          throw offlineError('offline_storage_readback_failed')
        }

        await storage.setItem(pointerName, JSON.stringify({
          active: target,
          previous: pointer.active || '',
          schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
        }))
        const activated = await readInternal(scope)
        if (!activated.document) throw offlineError('offline_storage_readback_failed')
        await storage.setItem(pointerName, JSON.stringify({
          active: target,
          previous: '',
          schemaVersion: MOBILE_OFFLINE_STORAGE_SCHEMA_VERSION,
        }))
        if (pointer.active) await storage.removeItem(generationName(pointer.active))
        return activated.document
      })
    },
  }
}
