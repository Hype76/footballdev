import { base64ToBytes, bytesToBase64 } from './offlineStorageCore.js'

export const COACH_MEDIA_MAX_FILE_BYTES = 20 * 1024 * 1024
const normalize = value => String(value ?? '').trim()
const fail = code => Object.assign(new Error(code), { code })

// storage only sees opaque names and encrypted envelopes. Callers must establish
// current context and resource authority before preparing or opening a file.
export function createCoachEncryptedMediaStore({ storage, keyStore, crypto, fingerprint, availableBytes }) {
  let active = '', epoch = 0, tail = Promise.resolve()
  const verifiedFiles = new Map()
  const enqueue = operation => {
    const next = tail.catch(() => {}).then(operation)
    tail = next.catch(() => {})
    return next
  }
  const guardFor = (account, guard) => {
    const captured = epoch
    return () => {
      if (!account || account !== active || captured !== epoch) throw fail('offline_media_scope_invalidated')
      guard?.()
    }
  }
  const hash = async value => {
    const result = await fingerprint(value)
    if (!/^[a-f0-9]{64}$/i.test(result)) throw fail('offline_media_fingerprint_invalid')
    return result.toLowerCase()
  }
  const accountHash = account => hash(`coach-media-v1:${account}`)
  const storageKey = digest => `coach-media-${digest}`
  async function keyFor(accountId, create, check) {
    const name = `fp.coach.media.v1.${await accountHash(accountId)}`; check()
    let encoded = await keyStore.getItem(name); check()
    if (!encoded && create) {
      if (await storage.hasPrefix(storageKey(await accountHash(accountId)))) throw fail('offline_media_key_missing')
      check()
      const key = await crypto.randomBytes(32); check()
      if (!(key instanceof Uint8Array) || key.length !== 32) throw fail('offline_media_key_invalid')
      encoded = bytesToBase64(key)
      await keyStore.setItem(name, encoded); check()
    }
    if (!encoded) throw fail('offline_media_key_missing')
    const key = base64ToBytes(encoded)
    if (key.length !== 32) throw fail('offline_media_key_invalid')
    return key
  }
  function identity(account, context, resource) {
    const clubId = normalize(context?.clubId), teamId = normalize(context?.teamId), contextId = normalize(context?.id)
    const id = normalize(resource?.id), revision = normalize(resource?.updatedAt), expiresAt = normalize(resource?.expiresAt)
    const kind = normalize(resource?.kind || 'file'), mimeType = normalize(resource?.mimeType).toLowerCase()
    if (!clubId || !teamId || !contextId || !id || !revision || !mimeType || !['file', 'badge', 'kit'].includes(kind)) throw fail('offline_media_identity_invalid')
    if (resource?.clubId !== clubId || resource?.teamId !== teamId) throw fail('offline_media_scope_mismatch')
    if (['file', 'kit'].includes(kind) && (resource?.type !== 'file' || !normalize(resource?.storageBucket) || !normalize(resource?.storagePath))) throw fail('offline_media_file_invalid')
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) throw fail('offline_media_expired')
    return JSON.stringify({ account, clubId, teamId, contextId, id, revision, expiresAt, kind, mimeType,
      storageBucket: kind === 'badge' ? '' : resource.storageBucket, storagePath: kind === 'badge' ? '' : resource.storagePath })
  }
  async function seal(key, aad, plain, check) {
    const nonce = await crypto.randomBytes(24); check()
    if (!(nonce instanceof Uint8Array) || nonce.length !== 24) throw fail('offline_media_nonce_invalid')
    const ciphertext = await crypto.seal({ key, nonce, aad, plaintext: plain }); check()
    return JSON.stringify({ v: 1, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ciphertext) })
  }
  async function unseal(key, aad, envelope, check) {
    let value
    try { value = JSON.parse(envelope) } catch { throw fail('offline_media_corrupt') }
    if (value?.v !== 1) throw fail('offline_media_corrupt')
    const nonce = base64ToBytes(value.nonce), ciphertext = base64ToBytes(value.ciphertext)
    if (nonce.length !== 24) throw fail('offline_media_corrupt')
    try { const data = await crypto.open({ key, nonce, aad, ciphertext }); check(); return data } catch {
      check(); throw fail('offline_media_corrupt')
    }
  }
  async function location(account, context, resource, check) {
    const aad = identity(account, context, resource), accountId = await accountHash(account); check()
    const id = await hash(aad); check()
    return { aad, prefix: storageKey(accountId), name: `${storageKey(accountId)}.${id}` }
  }
  return {
    activate(account) { const value = normalize(account); if (!value) throw fail('offline_media_scope_invalidated'); if (active !== value) { active = value; epoch++; verifiedFiles.clear() } },
    invalidate() { active = ''; epoch++; verifiedFiles.clear() },
    prepare({ account, context, resource, guard, bytes }) {
      const check = guardFor(account, guard)
      return enqueue(async () => {
        check()
        if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > COACH_MEDIA_MAX_FILE_BYTES) throw fail('offline_media_size_invalid')
        if (resource.kind !== 'badge' && Number(resource.fileSizeBytes) !== bytes.length) throw fail('offline_media_size_mismatch')
        const target = await location(account, context, resource, check), key = await keyFor(account, true, check)
        const existing = await storage.getItem(target.name); check()
        if (existing) {
          const existingBytes = await unseal(key, target.aad, existing, check)
          if (existingBytes.length !== bytes.length || existingBytes.some((value, index) => value !== bytes[index])) throw fail('offline_media_revision_mismatch')
          return { bytes: bytes.length, storedBytes: existing.length, alreadySaved: true }
        }
        const envelope = await seal(key, target.aad, bytes, check)
        const requiredBytes = envelope.length
        const available = await availableBytes(); check()
        if (!Number.isFinite(available) || requiredBytes > available) throw fail('offline_media_budget_exceeded')
        check()
        await storage.setItem(target.name, envelope); check()
        const saved = await storage.getItem(target.name); check()
        if (saved !== envelope) throw fail('offline_media_write_verification_failed')
        const verified = await unseal(key, target.aad, saved, check)
        if (verified.length !== bytes.length || verified.some((value, index) => value !== bytes[index])) throw fail('offline_media_write_verification_failed')
        const stat = await storage.getStat?.(target.name); check()
        if (Number.isFinite(stat?.size) && Number.isFinite(stat?.modifiedAt)) verifiedFiles.set(target.name, stat)
        return { bytes: bytes.length, storedBytes: requiredBytes }
      })
    },
    open({ account, context, resource, guard }) {
      const check = guardFor(account, guard)
      return enqueue(async () => {
        check(); const target = await location(account, context, resource, check)
        const envelope = await storage.getItem(target.name); check()
        if (!envelope) throw fail('offline_media_missing')
        const key = await keyFor(account, false, check)
        const bytes = await unseal(key, target.aad, envelope, check)
        if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > COACH_MEDIA_MAX_FILE_BYTES) throw fail('offline_media_corrupt')
        if (resource.kind !== 'badge' && Number(resource.fileSizeBytes) !== bytes.length) throw fail('offline_media_corrupt')
        return bytes
      })
    },
    has({ account, context, resource, guard }) {
      const check = guardFor(account, guard)
      return enqueue(async () => { check(); const target = await location(account, context, resource, check)
        const stat = await storage.getStat?.(target.name); check()
        if (stat?.exists === false) { verifiedFiles.delete(target.name); return false }
        const previous = verifiedFiles.get(target.name)
        if (Number.isFinite(stat?.size) && Number.isFinite(stat?.modifiedAt) && previous?.size === stat.size
          && previous?.modifiedAt === stat.modifiedAt) return true
        const value = await storage.getItem(target.name); check()
        if (!value) return false
        const key = await keyFor(account, false, check)
        const bytes = await unseal(key, target.aad, value, check)
        if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > COACH_MEDIA_MAX_FILE_BYTES
          || (resource.kind !== 'badge' && Number(resource.fileSizeBytes) !== bytes.length)) throw fail('offline_media_corrupt')
        if (Number.isFinite(stat?.size) && Number.isFinite(stat?.modifiedAt)) verifiedFiles.set(target.name, stat)
        return true })
    },
    clear(account) {
      const value = normalize(account)
      if (!value) throw fail('offline_media_scope_invalidated')
      if (active === value) { active = ''; epoch++; verifiedFiles.clear() }
      return enqueue(async () => {
        const digest = await accountHash(value), prefix = storageKey(digest)
        await storage.removePrefix(prefix)
        await keyStore.removeItem(`fp.coach.media.v1.${digest}`)
      })
    },
  }
}
