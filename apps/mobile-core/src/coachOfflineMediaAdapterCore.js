import { COACH_MEDIA_MAX_FILE_BYTES, createCoachEncryptedMediaStore } from './coachEncryptedMediaStore.js'
import { bytesToBase64 } from './offlineStorageCore.js'

const fail = code => Object.assign(new Error(code), { code })
export function requireCoachMediaFileSize(info) {
  if (!info?.exists) return 0
  if (info.isDirectory !== false || !Number.isSafeInteger(info.size) || info.size < 0) throw fail('offline_media_size_unavailable')
  return info.size
}
const extensions = Object.freeze({
  'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv', 'text/plain': 'txt', 'image/png': 'png', 'image/jpeg': 'jpg',
  'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'application/vnd.footballplayer.formation-board+json': 'json',
})

export function createCoachOfflineMediaAdapter({ storage, keyStore, crypto, fingerprint, remainingBudget,
  fetchAuthorized, fetchImpl, tempFiles, sharing, appState, allowedOrigin }) {
  let account = '', generation = 0, sharingActive = false
  const store = createCoachEncryptedMediaStore({ storage, keyStore, crypto, fingerprint,
    availableBytes: async () => remainingBudget(await storage.measureBytes()) })
  const capture = guard => {
    if (!account || typeof guard !== 'function') throw fail('offline_media_scope_invalidated')
    const value = account, epoch = generation
    return { account: value, guard: () => { if (account !== value || generation !== epoch) throw fail('offline_media_scope_invalidated'); guard() } }
  }
  const cleanup = async () => { if (!sharingActive) await tempFiles.clear() }
  const scopedAccount = ({ environment, userId, projectRef } = {}) => {
    let originRef = ''
    try { originRef = new URL(allowedOrigin).hostname.split('.')[0] } catch { /* Fail closed below. */ }
    if (!['live', 'test'].includes(environment) || !/^[a-z0-9-]{1,128}$/i.test(String(userId || ''))
      || !/^[a-z0-9]+$/i.test(String(projectRef || '')) || projectRef !== originRef) throw fail('offline_media_scope_invalidated')
    return `${environment}:${projectRef}:${userId}`
  }
  const clearScope = async target => {
    if (!account) await tempFiles.clear()
    else if (account === target) { account = ''; generation++; store.invalidate(); await tempFiles.clear() }
    await store.clear(target)
  }
  const subscription = appState?.addEventListener('change', state => {
    if (state === 'background' || state === 'active') void cleanup().catch(() => {})
  })
  return {
    activate(scope) {
      const next = scopedAccount(scope)
      if (account !== next) { account = next; generation++; store.activate(next) }
    },
    async save({ context, resource, guard }) {
      const scope = capture(guard); scope.guard()
      if (resource?.type === 'external_link') throw fail('offline_media_external_online_only')
      const mime = String(resource?.mimeType || '').toLowerCase(), size = Number(resource?.fileSizeBytes)
      if (!extensions[mime] || !Number.isSafeInteger(size) || size < 1 || size > COACH_MEDIA_MAX_FILE_BYTES) throw fail('offline_media_size_or_type_unsupported')
      const authorized = await fetchAuthorized({ context, resource }); scope.guard()
      const confirmed = authorized?.resource
      const fields = ['id', 'clubId', 'teamId', 'updatedAt', 'expiresAt', 'mimeType', 'fileSizeBytes']
      if (resource.kind !== 'badge') fields.push('storageBucket', 'storagePath')
      if (resource.kind === 'kit') fields.push('sourceId')
      if (!confirmed || fields.some(field => String(confirmed[field] ?? '') !== String(resource[field] ?? ''))) throw fail('offline_media_revision_mismatch')
      if (await store.has({ ...scope, context, resource })) return { bytes: size, alreadySaved: true }
      scope.guard()
      let url
      try { url = new URL(authorized?.signedUrl) } catch { throw fail('offline_media_url_invalid') }
      if (url.protocol !== 'https:' || url.origin !== new URL(allowedOrigin).origin || url.username || url.password
        || !url.pathname.startsWith('/storage/v1/object/sign/')) throw fail('offline_media_url_invalid')
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30_000)
      try {
        const response = await fetchImpl(url.href, { signal: controller.signal }); scope.guard()
        const length = Number(response.headers?.get('content-length'))
        if (!response.ok || !Number.isSafeInteger(length) || length !== size || length > COACH_MEDIA_MAX_FILE_BYTES) throw fail('offline_media_download_size_unverified')
        const bytes = new Uint8Array(await response.arrayBuffer()); scope.guard()
        if (bytes.length !== size) throw fail('offline_media_download_size_unverified')
        return await store.prepare({ ...scope, context, resource, bytes })
      } finally { clearTimeout(timeout) }
    },
    has({ context, resource, guard }) { const scope = capture(guard); return store.has({ ...scope, context, resource }) },
    async verifyInventory({ context, resources, guard }) {
      if (!Array.isArray(resources)) throw fail('offline_media_identity_invalid')
      const scope = capture(guard)
      for (const resource of resources) {
        scope.guard()
        if (!await store.has({ ...scope, context, resource })) return false
      }
      scope.guard()
      return true
    },
    async getDisplayUri({ context, resource, guard }) {
      const scope = capture(guard), mime = String(resource?.mimeType || '').toLowerCase()
      if (!['badge', 'kit'].includes(resource?.kind) || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) throw fail('offline_media_size_or_type_unsupported')
      const bytes = await store.open({ ...scope, context, resource }); scope.guard()
      return `data:${mime};base64,${bytesToBase64(bytes)}`
    },
    async open({ context, resource, guard }) {
      const scope = capture(guard), mime = String(resource?.mimeType || '').toLowerCase(), extension = extensions[mime]
      if (!extension) throw fail('offline_media_size_or_type_unsupported')
      if (sharingActive) throw fail('offline_media_open_busy')
      if (!await sharing.isAvailableAsync()) throw fail('offline_media_viewer_unavailable')
      const bytes = await store.open({ ...scope, context, resource }); scope.guard()
      await cleanup(); scope.guard()
      sharingActive = true
      try {
        const uri = await tempFiles.write(`resource.${extension}`, bytesToBase64(bytes)); scope.guard()
        await sharing.shareAsync(uri, { mimeType: mime, dialogTitle: 'Open saved Resource' })
      } finally {
        sharingActive = false
        await tempFiles.clear()
      }
    },
    clearTransient: cleanup,
    measureBytes: () => storage.measureBytes(),
    async clearAccount() {
      const previous = account
      if (!previous) return
      await clearScope(previous)
    },
    clearAccountScope(scope) { return clearScope(scopedAccount(scope)) },
    dispose() { subscription?.remove(); void cleanup().catch(() => {}) },
  }
}
