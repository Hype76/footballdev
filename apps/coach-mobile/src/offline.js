import AsyncStorage from '@react-native-async-storage/async-storage'
import { requireOptionalNativeModule } from 'expo'
import { createCoachFileStorage } from '../../mobile-core/src/coachFileStorage'
import { createCoachVersionedOfflineStore } from '../../mobile-core/src/coachVersionedOfflineStore'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import {
  createCoachOfflineDocument,
  getCoachOfflineProfile,
  getCoachOfflineResources,
  setCoachOfflineProfile,
  setCoachOfflineResources,
  recoverCoachOfflineCacheSpace,
} from '../../mobile-core/src/coachOfflineCore'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { APPROVED_MOBILE_PRODUCTION, APPROVED_MOBILE_TEST } from '../../mobile-core/src/environmentBoundary'
import { createEncryptedOfflineStore } from '../../mobile-core/src/offlineStorageCore'
import { mergeFormationPendingSaves } from './coachFormationSaveQueueCore'
import { getCoachCacheByteLength, COACH_PHASE_31F_MAX_CACHE_BYTES } from '../../mobile-core/src/coachPhase31FCore'
import { developmentDraftKey, editLocalDevelopmentDraft } from '../../mobile-core/src/developmentOfflineCore'
import { formationDraftKey, updateFormationLocalDraft } from '../../mobile-core/src/coachFormationDraftCore'
import { getScopedTeamBranding } from '../../../src/lib/team-branding-display.js'
import { createCoachRecoveryNotice } from './coachRecoveryNotice'
import { withCoachOfflineStorageLock } from './coachOfflineStorageBudget'
import { validateCoachAccountOfflineStatus } from './coachAccountOfflinePreparation'
import { activateCoachOfflineAccount, captureCoachOfflineAccount, invalidateCoachOfflineAccount } from './coachOfflineAccountSession'

const config = getMobileRuntimeConfig('coach')
const projectRef = config.isUsable ? new URL(config.supabaseUrl).hostname.split('.')[0] : ''
export const coachRecoveryNotice = createCoachRecoveryNotice(AsyncStorage, `fp.coach.recovery.${config.isProduction ? 'live' : 'test'}.${projectRef}`)

async function reportRecoveryFailure(operation) {
  try { return await operation() } catch (error) { coachRecoveryNotice.report(error); throw error }
}

const cryptoProvider = {
  async open({ aad, ciphertext, key, nonce }) {
    return bytesToUtf8(xchacha20poly1305(key, nonce, utf8ToBytes(aad)).decrypt(ciphertext))
  },
  async randomBytes(length) {
    return Crypto.getRandomBytesAsync(length)
  },
  async seal({ aad, key, nonce, plaintext }) {
    return xchacha20poly1305(key, nonce, utf8ToBytes(aad)).encrypt(utf8ToBytes(plaintext))
  },
}

function unavailableStore() {
  return {
    activate() {},
    captureScopeGuard() { throw new Error('offline_storage_boundary_rejected') },
    async update() { throw new Error('offline_storage_boundary_rejected') },
    async clear() {},
    async inspect() { return { hasDocument: false, status: 'blocked' } },
    async read() { return { document: null, status: 'blocked' } },
    async write() { throw new Error('offline_storage_boundary_rejected') },
  }
}

const coachStorage = createCoachFileStorage({ fileSystem: requireOptionalNativeModule('ExponentFileSystem'), legacyStorage: AsyncStorage })
let mediaHooks = { measureBytes: async () => 0, clearAccount: async () => {}, verifyInventory: async () => false }
export function registerCoachOfflineMediaHooks(hooks) { mediaHooks = hooks }
export function measureCoachOfflineDocumentBytes() { return coachStorage.measureBytes() }

function createLegacyStore(environment, ref) {
  return createEncryptedOfflineStore({
    appRole: 'coach', cryptoProvider, environment, projectRef: ref,
    keyStore: SecureStore,
    keyStoreOptions: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false },
    storage: AsyncStorage, preserveOnFailure: true,
  })
}

function createStore(environment, ref) {
  const legacyStore = createLegacyStore(environment, ref)
  return createCoachVersionedOfflineStore({
    legacyStore, markerStorage: AsyncStorage,
    markerPrefix: `fp.mobile.offline.v1.coach.${environment}.${ref}.coach2.migration`,
    fingerprint: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
    createScopedStore: key => createEncryptedOfflineStore({
      appRole: 'coach', cryptoProvider, environment, projectRef: ref,
      keyStore: SecureStore,
      keyStoreOptions: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false },
      namespaceSuffix: `coach2.${key}`, preserveOnFailure: true,
      operationTimeoutMs: 60_000, storage: coachStorage,
    }),
  })
}

const expectedRef = config.isProduction ? APPROVED_MOBILE_PRODUCTION.supabaseRef : APPROVED_MOBILE_TEST.supabaseRef
const underlyingStore = config.isUsable && projectRef === expectedRef
  ? createStore(config.isProduction ? 'live' : 'test', projectRef)
  : unavailableStore()
const store = { ...underlyingStore }
function createCoachStartupProfileStore(environment, ref, record = 'profile') {
  return createEncryptedOfflineStore({
    appRole: 'coach', cryptoProvider, environment, projectRef: ref,
    keyStore: SecureStore,
    keyStoreOptions: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false },
    namespaceSuffix: `coach2.startup-${record}`, storage: AsyncStorage,
  })
}
const startupProfileStore = config.isUsable && projectRef === expectedRef
  ? createCoachStartupProfileStore(config.isProduction ? 'live' : 'test', projectRef)
  : unavailableStore()
const startupHomeStore = config.isUsable && projectRef === expectedRef
  ? createCoachStartupProfileStore(config.isProduction ? 'live' : 'test', projectRef, 'home')
  : unavailableStore()
const startupHomeAuthority = context => JSON.stringify([
  outboxAuthority(context), context.roleRank, context.planKey, context.planStatus,
  context.clubStatus, context.teamStatus, context.archivedAt, context.hasActivePlanAccess,
])
const startupHomeFields = [
  'nextMatch', 'nextSession', 'nextCalendar', 'activePolls', 'unreadChat', 'pendingAvailability',
  'developmentRecords', 'homeSources', 'homeSavedSources', 'sourceStates', 'errors', 'partial',
]
let startupProfileWriteGeneration = 0
const revokedStartupProfiles = new Set()
const startupRevocationKey = userScope => `fp.coach.startup-revoked.${config.isProduction ? 'live' : 'test'}.${projectRef}.${userScope}`
let startupRevocationQueue = Promise.resolve()

function queueStartupRevocationChange(change) {
  const result = startupRevocationQueue.then(change)
  startupRevocationQueue = result.catch(() => {})
  return result
}

async function readStartupRevocation(userScope) {
  const key = startupRevocationKey(userScope)
  const saved = await Promise.allSettled([AsyncStorage.getItem(key), SecureStore.getItemAsync(key)])
  if (saved.some(result => result.status === 'fulfilled' && result.value)) return true
  const unavailable = saved.find(result => result.status === 'rejected')
  if (unavailable) throw unavailable.reason
  return false
}
const deniedCoachWorkspaces = new Set()
const checkedCoachWorkspaces = new Set()
const coachWorkspaceDenialKey = (userId, clubId) => `fp.coach.workspace-denied.${config.isProduction ? 'live' : 'test'}.${projectRef}.${userId}.${clubId}`

export function peekCoachWorkspaceDenied(userId, clubId) {
  return deniedCoachWorkspaces.has(coachWorkspaceDenialKey(userId, clubId))
}

export async function isCoachWorkspaceDenied(userId, clubId) {
  const key = coachWorkspaceDenialKey(userId, clubId)
  if (deniedCoachWorkspaces.has(key)) return true
  if (checkedCoachWorkspaces.has(key)) return false
  const results = await Promise.allSettled([AsyncStorage.getItem(key), SecureStore.getItemAsync(key)])
  if (deniedCoachWorkspaces.has(key) || results.some(result => result.status === 'fulfilled' && result.value)) {
    deniedCoachWorkspaces.add(key)
    return true
  }
  if (results.some(result => result.status === 'rejected')) throw new Error('Saved workspace access could not be checked.')
  checkedCoachWorkspaces.add(key)
  return false
}

export async function markCoachWorkspaceDenied(userId, clubId) {
  const key = coachWorkspaceDenialKey(userId, clubId)
  deniedCoachWorkspaces.add(key)
  checkedCoachWorkspaces.delete(key)
  await queueStartupRevocationChange(async () => {
    deniedCoachWorkspaces.add(key)
    checkedCoachWorkspaces.delete(key)
    const results = await Promise.allSettled([AsyncStorage.setItem(key, '1'), SecureStore.setItemAsync(key, '1')])
    if (results.every(result => result.status === 'rejected')) throw new Error('Workspace access removal could not be saved.')
  })
}

export async function allowVerifiedCoachWorkspace(userId, clubId, isCurrent) {
  const key = coachWorkspaceDenialKey(userId, clubId)
  await queueStartupRevocationChange(async () => {
    if (!isCurrent() || !await isCoachWorkspaceDenied(userId, clubId) || !isCurrent()) return
    await Promise.all([AsyncStorage.removeItem(key), SecureStore.deleteItemAsync(key)])
    if (!isCurrent()) return
    deniedCoachWorkspaces.delete(key)
    checkedCoachWorkspaces.add(key)
  })
}

for (const method of ['clear', 'inspect', 'read', 'readSnapshot', 'update', 'write']) {
  if (typeof underlyingStore[method] !== 'function') continue
  store[method] = (...args) => reportRecoveryFailure(async () => {
    const result = await underlyingStore[method](...args)
    coachRecoveryNotice.report(result)
    return result
  })
}
const updateRecords = store.update
store.update = (userId, change) => withCoachOfflineStorageLock(async () => {
  return updateRecords(userId, async document => {
    const next = await change(document)
    if (next && next !== document) {
      const documentBytes = await coachStorage.measureBytes()
      const mediaBytes = await mediaHooks.measureBytes()
      // The new encrypted generation is staged before the old one is removed.
      // Base64 envelope overhead and a small header reserve count as disk use.
      const stagedBytes = Math.ceil(getCoachCacheByteLength(next) * 4 / 3) + 8192
      if (documentBytes + mediaBytes + stagedBytes > COACH_PHASE_31F_MAX_CACHE_BYTES) throw new Error('There is not enough offline storage to finish downloading. Your saved changes remain on this phone.')
    }
    return next
  })
})
const incompatibleTestStore = config.isProduction
  ? createLegacyStore('test', APPROVED_MOBILE_TEST.supabaseRef)
  : null

function normalize(value) {
  return String(value ?? '').trim()
}

function sanitizeCoachBranding(context) {
  const display = getScopedTeamBranding(context)
  if (!display) return null
  // Keep display-only fields from the scoped RPC, never management or plan authority.
  return {
    teamId: display.teamId,
    clubId: display.clubId,
    source: display.source,
    logoAllowed: display.logoAllowed,
    coloursAllowed: display.coloursAllowed,
    baseLogoAllowed: display.baseLogoAllowed === true,
    baseColoursAllowed: display.baseColoursAllowed === true,
    expiresAt: display.expiresAt || null,
    logoUrl: display.logoUrl,
    accent: display.accent,
    buttonStyle: display.buttonStyle,
  }
}

function sanitizeCoachContext(context) {
  return {
    archivedAt: normalize(context?.archivedAt),
    authorityId: normalize(context?.authorityId),
    authoritySource: normalize(context?.authoritySource),
    clubAccent: normalize(context?.clubAccent),
    clubButtonStyle: normalize(context?.clubButtonStyle),
    clubId: normalize(context?.clubId),
    clubLogoUrl: normalize(context?.clubLogoUrl),
    clubName: normalize(context?.clubName),
    clubStatus: normalize(context?.clubStatus || 'active'),
    hasActivePlanAccess: context?.hasActivePlanAccess === true,
    id: normalize(context?.id),
    planKey: normalize(context?.planKey),
    planStatus: normalize(context?.planStatus || 'active'),
    role: normalize(context?.role),
    roleLabel: normalize(context?.roleLabel),
    roleRank: Number(context?.roleRank || 0),
    teamAccent: normalize(context?.teamAccent),
    teamButtonStyle: normalize(context?.teamButtonStyle),
    teamId: normalize(context?.teamId),
    teamBrandingDisplay: sanitizeCoachBranding(context),
    teamName: normalize(context?.teamName),
    teamStatus: normalize(context?.teamStatus || 'active'),
    workspaceScope: normalize(context?.workspaceScope),
  }
}

function sanitizeCoachProfile(profile) {
  const coachContexts = (Array.isArray(profile?.coachContexts) ? profile.coachContexts : [])
    .map(sanitizeCoachContext)
    .filter((context) => context.id && context.clubId)
  return {
    accountStatus: normalize(profile?.accountStatus || 'active'),
    activeCoachContextId: normalize(profile?.activeCoachContextId),
    activeTeamId: normalize(profile?.activeTeamId),
    activeTeamName: normalize(profile?.activeTeamName),
    clubId: normalize(profile?.clubId),
    clubLogoUrl: normalize(profile?.clubLogoUrl),
    clubName: normalize(profile?.clubName),
    coachContexts,
    displayName: normalize(profile?.displayName),
    email: normalize(profile?.email).toLowerCase(),
    hasActivePlanAccess: profile?.hasActivePlanAccess === true,
    id: normalize(profile?.id),
    name: normalize(profile?.name),
    planKey: normalize(profile?.planKey),
    planStatus: normalize(profile?.planStatus || 'active'),
    role: normalize(profile?.role),
    roleLabel: normalize(profile?.roleLabel),
    roleRank: Number(profile?.roleRank || 0),
    teamOptions: coachContexts.filter((context) => context.teamId).map((context) => ({
      assignmentRole: context.role,
      assignmentRoleLabel: context.roleLabel,
      assignmentRoleRank: context.roleRank,
      id: context.teamId,
      name: context.teamName,
    })),
    workspaceScope: normalize(profile?.workspaceScope),
  }
}

export const coachOfflineProfileStore = {
  async clear() {
    await clearCoachOfflineState()
  },
  async revoke(userScope) {
    startupProfileWriteGeneration += 1
    revokedStartupProfiles.add(userScope)
    // Both startup readers respect this marker. Leave encrypted match drafts intact.
    const key = startupRevocationKey(userScope)
    await queueStartupRevocationChange(async () => {
      try {
        await AsyncStorage.setItem(key, '1')
        if (await AsyncStorage.getItem(key) === '1') return
      } catch { /* Try the independent secure store below. */ }
      await SecureStore.setItemAsync(key, '1')
      if (await SecureStore.getItemAsync(key) !== '1') throw new Error('offline_revocation_readback_failed')
    })
  },
  async read(userScope) {
    activateCoachOfflineAccount(userScope)
    store.activate(userScope)
    startupProfileStore.activate(userScope)
    startupHomeStore.activate(userScope)
    const guard = captureCoachOfflineAccount(userScope)
    if (revokedStartupProfiles.has(userScope) || await readStartupRevocation(userScope)) return null
    guard()
    const snapshot = await startupProfileStore.read(userScope).catch(() => null)
    guard()
    if (revokedStartupProfiles.has(userScope)) return null
    const profile = getCoachOfflineProfile(snapshot?.document, userScope)
    if (profile) return profile
    const saved = await reportRecoveryFailure(() => store.read(userScope))
    guard()
    return revokedStartupProfiles.has(userScope) ? null : getCoachOfflineProfile(saved.document, userScope)
  },
  async write(profile) {
    const sanitized = sanitizeCoachProfile(profile)
    if (!sanitized.id) throw new Error('offline_profile_scope_mismatch')
    const accountGuard = captureCoachOfflineAccount(sanitized.id)
    accountGuard()
    startupProfileStore.activate(sanitized.id)
    // Keep startup independent of the encrypted match, media and team data.
    // A failed mirror write must not leave an older startup profile eligible.
    const mirrorGeneration = ++startupProfileWriteGeneration
    const mirror = startupProfileStore.write(sanitized.id, setCoachOfflineProfile(createCoachOfflineDocument({ userScope: sanitized.id }), sanitized))
      .catch(async error => {
        accountGuard()
        if (mirrorGeneration === startupProfileWriteGeneration) await startupProfileStore.clear()
        throw error
      })
    void mirror.catch(() => {})
    const matchesProfile = document => JSON.stringify(getCoachOfflineProfile(document, sanitized.id)) === JSON.stringify(sanitized)
    const unchanged = store.peekSnapshot?.(sanitized.id, matchesProfile)
    const next = unchanged ? null : await reportRecoveryFailure(() => store.update(sanitized.id, current => {
      if (matchesProfile(current)) return current
      const updated = setCoachOfflineProfile(current || createCoachOfflineDocument({ userScope: sanitized.id }), sanitized)
      return { ...updated, accountPreparation: Object.fromEntries(Object.entries(updated.accountPreparation || {}).filter(([id, entry]) =>
        sanitized.coachContexts.some(context => context.id === id && entry.authority === outboxAuthority(context)))) }
    }))
    accountGuard()
    await mirror
    await queueStartupRevocationChange(async () => {
      if (mirrorGeneration !== startupProfileWriteGeneration) return
      const revoked = await readStartupRevocation(sanitized.id)
      if (mirrorGeneration !== startupProfileWriteGeneration) return
      if (revoked) {
        const key = startupRevocationKey(sanitized.id)
        await Promise.all([AsyncStorage.removeItem(key), SecureStore.deleteItemAsync(key)])
      }
      if (mirrorGeneration === startupProfileWriteGeneration) revokedStartupProfiles.delete(sanitized.id)
    })
    return unchanged ? sanitized : getCoachOfflineProfile(next, sanitized.id)
  },
}

export async function quarantineIncompatibleCoachOfflineState() {
  if (!incompatibleTestStore) return { quarantined: false }
  await Promise.all([incompatibleTestStore.clear(), createCoachStartupProfileStore('test', APPROVED_MOBILE_TEST.supabaseRef).clear(),
    createCoachStartupProfileStore('test', APPROVED_MOBILE_TEST.supabaseRef, 'home').clear()])
  return { previousEnvironment: 'test', quarantined: true }
}

export async function clearCoachOfflineState() {
  const previousUserId = invalidateCoachOfflineAccount()
  const results = await Promise.allSettled([reportRecoveryFailure(() => store.clear()), startupProfileStore.clear(), startupHomeStore.clear(), mediaHooks.clearAccount(previousUserId)])
  const failed = results.find(result => result.status === 'rejected')
  if (failed) throw failed.reason
}

export async function saveCoachAccountPreparation(userId, context, status, isCurrent = () => true) {
  const guard = store.captureScopeGuard(userId)
  await store.update(userId, document => {
    guard()
    if (!isCurrent()) return document
    assertOutboxContext(document, userId, context)
    return { ...document, accountPreparation: { ...(document.accountPreparation || {}),
      [context.id]: { authority: outboxAuthority(context), status: JSON.parse(JSON.stringify(status)) } } }
  })
}

export async function readCoachAccountPreparation(userId, contexts, { verifyMedia = true, acceptUpdatedResources = true, beforeVerifyMedia } = {}) {
  const { document } = await (store.readSnapshot ? store.readSnapshot(userId) : store.read(userId))
  const guard = store.captureScopeGuard(userId)
  const results = []
  for (const context of contexts) {
    guard()
    const entry = document?.accountPreparation?.[context.id]
    if (!matchesOfflineContext(document, userId, context) || entry?.authority !== outboxAuthority(context)) { results.push([context.id, null]); continue }
    const cache = getCoachOfflineResources(document, context)
    let status = validateCoachAccountOfflineStatus(entry.status, cache, { acceptUpdatedResources })
    if (status?.savedAt && (status.matchIds || []).some(id => {
      const journal = document.matchDayOutboxes?.[context.id]?.[id]
      return journal?.authority !== outboxAuthority(context) || journal?.baseMatch?.id !== id
        || journal.baseMatch.clubId !== context.clubId || journal.baseMatch.teamId !== context.teamId
    })) status = { ...status, checkpoint: undefined, state: 'partial', error: 'Some saved fixtures need downloading again.' }
    const inventory = cache?.resources?.offlineMediaInventory || []
    if (verifyMedia && status?.savedAt && !status.filesFailed && ['ready', 'partial'].includes(status.state) && inventory.length) {
      if (beforeVerifyMedia) await beforeVerifyMedia()
      guard()
      let verified = false
      try { verified = status.filesSaved === inventory.length && await mediaHooks.verifyInventory(userId, context, inventory, document.profile.value) } catch { /* Missing or unverifiable copies are incomplete. */ }
      guard()
      if (!verified) status = { ...status, state: 'partial', error: 'Some saved files need downloading again.' }
    }
    results.push([context.id, status])
  }
  return Object.fromEntries(results)
}

export async function inspectCoachOfflineState(userId) {
  const result = await reportRecoveryFailure(() => store.inspect(userId))
  coachRecoveryNotice.report(result)
  return result
}

// The startup view contains only Home rows and counts. The full account
// cache and its durable journals remain the source of saved team detail.
export async function readCoachStartupHome(userId, context) {
  const guard = captureCoachOfflineAccount(userId)
  guard()
  if (revokedStartupProfiles.has(userId) || await readStartupRevocation(userId) || await isCoachWorkspaceDenied(userId, context.clubId)) return null
  guard()
  const { document } = await startupHomeStore.read(userId)
  guard()
  const saved = document?.startupHome
  return !revokedStartupProfiles.has(userId) && !peekCoachWorkspaceDenied(userId, context.clubId) && saved?.contextId === context.id
    && saved.authority === startupHomeAuthority(context) ? saved.home : null
}

export async function saveCoachStartupHome(userId, context, home) {
  const guard = captureCoachOfflineAccount(userId)
  guard()
  await startupHomeStore.update(userId, document => {
    guard()
    if (revokedStartupProfiles.has(userId)) return document
    const current = document?.startupHome
    const authority = startupHomeAuthority(context)
    if (!home) {
      if (current?.contextId !== context.id || current.authority !== authority) return document
      const next = { ...document }
      delete next.startupHome
      return next
    }
    const visible = Object.fromEntries(startupHomeFields.filter(key => Object.hasOwn(home, key)).map(key => [key, home[key]]))
    const previous = Object.fromEntries(startupHomeFields.filter(key => Object.hasOwn(current?.home || {}, key)).map(key => [key, current.home[key]]))
    if (current?.contextId === context.id && current.authority === authority && JSON.stringify(previous) === JSON.stringify(visible)) return document
    return {
      ...(document || createCoachOfflineDocument({ userScope: userId })),
      startupHome: { contextId: context.id, authority, home: { ...visible, savedAt: home.savedAt } },
    }
  })
}

export async function readCoachOfflineResources(userId, contextId, resourceKeys) {
  const select = document => {
    const cache = getCoachOfflineResources(document, contextId)
    if (!cache || !resourceKeys) return cache
    return {
      ...cache,
      resources: Object.fromEntries(resourceKeys.filter(key => Object.hasOwn(cache.resources, key)).map(key => [key, cache.resources[key]])),
      resourceMetadata: Object.fromEntries(resourceKeys.filter(key => Object.hasOwn(cache.resourceMetadata, key)).map(key => [key, cache.resourceMetadata[key]])),
    }
  }
  if (store.readSnapshot) return (await store.readSnapshot(userId, select)).document
  return select((await store.read(userId)).document)
}

export async function readCoachOverviewResources(userId, context) {
  const readOverview = document => {
    if (!matchesOfflineContext(document, userId, context)) return null
    const cache = getCoachOfflineResources(document, context)
    if (!cache) return null
    return {
      resources: { home: Boolean(cache.resources.home), 'phase31e:invites': Boolean(cache.resources['phase31e:invites']) },
      resourceMetadata: cache.resourceMetadata,
    }
  }
  const saved = store.peekSnapshot?.(userId, readOverview)
  if (saved !== undefined) return saved
  if (store.readSnapshot) return (await store.readSnapshot(userId, readOverview)).document
  return readOverview((await store.read(userId)).document)
}

export function peekCoachOfflineResource(userId, context, key) {
  return store.peekSnapshot?.(userId, document => matchesOfflineContext(document, userId, context)
    ? getCoachOfflineResources(document, context)?.resources?.[key] : undefined)
}

export async function readCoachHomeOfflineView(userId, context) {
  const select = document => getCoachHomeOfflineView(document, userId, context)
  if (store.readSnapshot) return (await store.readSnapshot(userId, select)).document
  return select((await store.read(userId)).document)
}

export function peekCoachHomeOfflineView(userId, context) {
  return store.peekSnapshot?.(userId, document => {
    if (!matchesOfflineContext(document, userId, context)) return undefined
    const cache = getCoachOfflineResources(document, context)
    const entry = document.developmentDrafts?.[context.id]
    if (entry && entry.authority !== outboxAuthority(context)) return undefined
    return { home: cache?.resources?.home, savedAt: cache?.savedAt, developmentDrafts: entry?.items || {} }
  })
}

function getCoachHomeOfflineView(document, userId, context) {
  assertOutboxContext(document, userId, context)
  const entry = document.developmentDrafts?.[context.id]
  if (entry && entry.authority !== outboxAuthority(context)) throw new Error('Your access to these saved Development drafts changed.')
  const cache = getCoachOfflineResources(document, context)
  return {
    cache: cache ? { savedAt: cache.savedAt, resources: { home: cache.resources.home } } : null,
    developmentDrafts: entry?.items || {},
  }
}

export function createCoachOfflineResourceSaver(profile, context, options = {}) {
  // The caller captures this while starting a live read, before awaiting it.
  // Only a server-loaded profile can repair a missing profile cache.
  const liveProfile = profile?.isOfflineProfile ? null : sanitizeCoachProfile(profile)
  const userId = normalize(profile?.id)
  const saveOptions = { ...options }
  const capturedContext = typeof context === 'object' ? { ...context } : context
  let guard
  let scopeError
  try { guard = store.captureScopeGuard(userId) } catch (error) { scopeError = error }
  return async (resources) => {
    if (scopeError) throw scopeError
    guard()
    return saveCoachOfflineResourcesWithProfile(userId, capturedContext, resources, liveProfile, saveOptions)
  }
}

export async function saveCoachOfflineResources(userId, contextId, resources) {
  return saveCoachOfflineResourcesWithProfile(userId, contextId, resources)
}

export async function saveCoachFormationLocalDraft(userId, context, key, entry) {
  return store.update(userId, (document) => {
    assertOutboxContext(document, userId, context)
    const previous = getCoachOfflineResources(document, context)?.resources?.formation
    const clearPending = !entry && key === formationDraftKey(previous?.board?.id, previous?.matchDayId)
    if (!entry && !Object.hasOwn(previous?.localDrafts || {}, key) && !(clearPending && previous?.pendingSave)) return document
    const formation = updateFormationLocalDraft(previous, key, entry)
    if (clearPending) formation.pendingSave = null
    return setCoachOfflineResources(document, context, {
      formation,
    })
  })
}

async function saveCoachOfflineResourcesWithProfile(userId, contextId, resources, liveProfile = null, { requireExistingDocument = false, expectedResourceMetadata, isCurrent = () => true } = {}) {
  const next = await store.update(userId, (current) => {
    if (!isCurrent()) return current
    if (requireExistingDocument && (!current || normalize(current.userScope) !== normalize(userId))) throw new Error('offline_profile_scope_mismatch')
    if (!current?.profile) {
      if (!liveProfile || normalize(liveProfile.id) !== normalize(userId)) throw new Error('offline_profile_scope_mismatch')
      const previous = current || createCoachOfflineDocument({ userScope: userId })
      const contextKey = typeof contextId === 'object' ? contextId.id || contextId.contextId : contextId
      const priorContext = previous.contexts?.[contextKey]
      if (priorContext && typeof contextId === 'object' && ['authorityId', 'authoritySource', 'clubId', 'role', 'teamId'].some(field =>
        normalize(contextId[field]) && normalize(priorContext[field]) !== normalize(contextId[field]),
      )) throw new Error('offline_profile_recovery_would_reset_context')
      const repaired = setCoachOfflineProfile(previous, liveProfile)
      if (Object.keys(previous.contexts || {}).some(key => !Object.hasOwn(repaired.contexts || {}, key))) {
        throw new Error('offline_profile_recovery_would_remove_context')
      }
      current = repaired
    }
    const key = typeof contextId === 'object' ? contextId.id || contextId.contextId : contextId
    const authority = current.profile.value.coachContexts.find((context) => context.id === key)
    if (!authority || (typeof contextId === 'object' && ['authorityId', 'authoritySource', 'clubId', 'role', 'teamId'].some((field) =>
      normalize(contextId[field]) && normalize(contextId[field]) !== normalize(authority[field]),
    ))) {
      throw new Error('offline_context_scope_mismatch')
    }
    if (expectedResourceMetadata) {
      const metadata = getCoachOfflineResources(current, contextId)?.resourceMetadata || {}
      resources = Object.fromEntries(Object.entries(resources).filter(([resourceKey]) => {
        const expected = expectedResourceMetadata[resourceKey]
        const actual = metadata[resourceKey]
        return expected?.fingerprint === actual?.fingerprint && expected?.checkedAt === actual?.checkedAt && expected?.savedAt === actual?.savedAt
      }))
      if (!Object.keys(resources).length) return current
    }
    // Refreshing the read cache must never replace unsent formation drafts.
    const previousFormation = getCoachOfflineResources(current, contextId)?.resources?.formation
    const nextResources = resources.formation ? {
      ...resources,
      formation: {
        ...resources.formation,
        clearDraftKey: undefined,
        pendingSaveChanges: undefined,
        localDrafts: resources.formation.clearDraftKey
          ? updateFormationLocalDraft(previousFormation, resources.formation.clearDraftKey, null).localDrafts
          : previousFormation?.localDrafts || {},
        pendingSave: resources.formation.pendingSave === undefined ? previousFormation?.pendingSave : resources.formation.pendingSave,
        pendingSaves: resources.formation.pendingSaveChanges
          ? mergeFormationPendingSaves(previousFormation?.pendingSaves, resources.formation.pendingSaveChanges)
          : resources.formation.pendingSaves === undefined ? (previousFormation?.pendingSaves || {}) : resources.formation.pendingSaves,
      },
    } : resources
    return setCoachOfflineResources(current, contextId, nextResources)
  })
  return getCoachOfflineResources(next, contextId)
}

function matchesOfflineContext(document, userId, context) {
  const authority = document?.profile?.value?.coachContexts?.find(item => item.id === context?.id)
  return document?.userScope === userId && Boolean(authority)
    && ['authorityId', 'authoritySource', 'clubId', 'role', 'teamId'].every(field => normalize(context[field]) === normalize(authority[field]))
}

function assertOutboxContext(document, userId, context) {
  if (!matchesOfflineContext(document, userId, context)) {
    throw new Error('Your saved Match Day actions belong to a different workspace. Select the original workspace to sync them.')
  }
}

function outboxAuthority(context) {
  return JSON.stringify(['id', 'authorityId', 'authoritySource', 'clubId', 'role', 'teamId'].map(field => normalize(context[field])))
}

export async function readCoachMatchDayOutbox(userId, context, matchId) {
  const { document } = await store.read(userId)
  assertOutboxContext(document, userId, context)
  const journal = document.matchDayOutboxes?.[context.id]?.[matchId] || null
  if (journal && journal.authority !== outboxAuthority(context)) throw new Error('Your access to this saved fixture changed. The saved actions need review.')
  return journal
}

export async function countPendingCoachMatchDayActions(userId) {
  const { document } = await store.read(userId)
  if (!document) return 0
  return Object.values(document.matchDayOutboxes || {}).flatMap(context => Object.values(context)).reduce((count, journal) => count + (journal.pending?.length || 0), 0)
}

export async function getPendingCoachMatchDays(userId, { committedSnapshot = false } = {}) {
  const select = document => Object.entries(document?.matchDayOutboxes || {}).flatMap(([contextId, journals]) =>
    Object.entries(journals).filter(([, journal]) => journal.pending?.length).map(([matchId]) => ({ contextId, matchId })))
  if (committedSnapshot && store.readSnapshot) return (await store.readSnapshot(userId, select)).document || []
  return select((await store.read(userId)).document)
}

export async function updateCoachMatchDayOutbox(userId, context, matchId, change) {
  let journal
  await store.update(userId, document => {
    assertOutboxContext(document, userId, context)
    const outboxes = document.matchDayOutboxes || {}
    const previous = outboxes[context.id]?.[matchId] || null
    if (previous && previous.authority !== outboxAuthority(context)) throw new Error('Your access to this saved fixture changed. The saved actions need review.')
    const changed = change(previous)
    if (changed === previous) { journal = previous; return document }
    journal = { ...changed, authority: outboxAuthority(context) }
    if (journal?.baseMatch?.id !== matchId || journal.baseMatch.clubId !== context.clubId || journal.baseMatch.teamId !== context.teamId) throw new Error('The saved fixture does not match this workspace.')
    const next = { ...document, matchDayOutboxes: { ...outboxes, [context.id]: { ...(outboxes[context.id] || {}), [matchId]: journal } } }
    if (getCoachCacheByteLength(next) > COACH_PHASE_31F_MAX_CACHE_BYTES) throw new Error('There is not enough offline storage. This action was not saved. Reconnect and sync first.')
    return next
  })
  return journal
}

export async function saveCoachPreparedMatchDays(userId, context, matches, isCurrent = () => true) {
  const guard = store.captureScopeGuard(userId)
  await store.update(userId, document => {
    guard()
    if (!isCurrent()) return document
    assertOutboxContext(document, userId, context)
    const authority = outboxAuthority(context)
    const entries = { ...(document.matchDayOutboxes?.[context.id] || {}) }
    const verifiedAt = new Date().toISOString()
    for (const detail of matches) {
      if (!detail?.id || detail.clubId !== context.clubId || detail.teamId !== context.teamId) throw new Error('The saved fixture does not match this workspace.')
      const previous = entries[detail.id]
      if (previous && previous.authority !== authority) throw new Error('Your access to this saved fixture changed. The saved actions need review.')
      if (!previous?.pending?.length) entries[detail.id] = { authority, baseMatch: detail, pending: [], verifiedAt, error: '' }
    }
    return { ...document, matchDayOutboxes: { ...(document.matchDayOutboxes || {}), [context.id]: entries } }
  })
}

export async function readCoachDevelopmentDrafts(userId, context, { committedSnapshot = false } = {}) {
  const select = document => {
    assertOutboxContext(document, userId, context)
    const entry = document.developmentDrafts?.[context.id]
    if (entry && entry.authority !== outboxAuthority(context)) throw new Error('Your access to these saved Development drafts changed.')
    return entry?.items || {}
  }
  if (committedSnapshot && store.readSnapshot) return (await store.readSnapshot(userId, select)).document || {}
  return select((await store.read(userId)).document)
}

export async function updateCoachDevelopmentDraft(userId, context, key, change) {
  let result
  await store.update(userId, document => {
    assertOutboxContext(document, userId, context)
    const previous = document.developmentDrafts?.[context.id]
    if (previous && previous.authority !== outboxAuthority(context)) throw new Error('Your access to these saved Development drafts changed.')
    const items = { ...previous?.items }
    const previousDraft = items[key]
    result = change(items[key] || null)
    if (result === previousDraft || (!result && !previousDraft)) return document
    if (result) items[key] = result
    else delete items[key]
    let next = { ...document, developmentDrafts: { ...document.developmentDrafts,
      [context.id]: { authority: outboxAuthority(context), items } } }
    if (!result && previousDraft?.discardRequested) {
      const cached = getCoachOfflineResources(next, context)?.resources?.['phase31e:development']
      if (cached) next = setCoachOfflineResources(next, context, { 'phase31e:development': {
        ...cached, drafts: (cached.drafts || []).filter(draft => draft.id !== previousDraft.id),
      } })
    }
    try {
      return recoverCoachOfflineCacheSpace(next, { retainContextId: context.id,
        retainResourceKeys: ['phase31e:development', 'development', 'players'] })
    } catch (error) {
      if (error.message !== 'offline_cache_payload_too_large') throw error
      const capacityError = new Error('This edit could not fit within the app\'s saved-data limit. Keep this screen open and retry after syncing existing work. Do not clear app data.')
      capacityError.code = 'offline_cache_payload_too_large'
      throw capacityError
    }
  })
  return result
}

export function createCoachDevelopmentDraftSaver(userId, context) {
  const capturedContext = { ...context }
  const guard = store.captureScopeGuard(userId)
  return input => {
    guard()
    return saveLocalCoachDevelopmentDraft(userId, capturedContext, input, guard)
  }
}

export function saveLocalCoachDevelopmentDraft(userId, context, input, guard = () => {}) {
  return updateCoachDevelopmentDraft(userId, context, developmentDraftKey(input.playerId, input.formId),
    previous => {
      guard()
      if (previous?.finalisation) throw new Error('This record is already queued to finish. Your saved values have been kept.')
      if (previous?.discardRequested) throw new Error('This assessment is queued to cancel. Wait until cancellation has synced before starting another.')
      return editLocalDevelopmentDraft(previous, { ...input, id: previous?.id || Crypto.randomUUID() })
    })
}

export async function countPendingCoachDevelopmentDrafts(userId) {
  const { document } = await store.read(userId)
  return Object.values(document?.developmentDrafts || {}).flatMap(entry => Object.values(entry.items || {}))
    .filter(draft => draft.status !== 'synced').length
}

export async function readCoachOfflineReadiness(userId, context) {
  const { document } = await store.read(userId)
  assertOutboxContext(document, userId, context)
  const saved = getCoachOfflineResources(document, context)
  return {
    resources: saved?.resources || {},
    journals: Object.values(document.matchDayOutboxes?.[context.id] || {}).filter(journal => journal.authority === outboxAuthority(context)),
    pending: Object.values(document.matchDayOutboxes || {}).flatMap(entries => Object.values(entries)).reduce((total, journal) => total + (journal.pending?.length || 0), 0)
      + Object.values(document.developmentDrafts || {}).flatMap(entry => Object.values(entry.items || {})).filter(draft => draft.status !== 'synced').length,
  }
}

export async function readCoachAttendanceCommands(user, context) {
  const guard = store.captureScopeGuard(user.id)
  const { document } = await store.read(user.id)
  guard()
  assertOutboxContext(document, user.id, context)
  return document.attendanceCommands || []
}

export async function updateCoachAttendanceCommands(user, context, change) {
  const guard = store.captureScopeGuard(user.id)
  const document = await store.update(user.id, previous => {
    guard()
    assertOutboxContext(previous, user.id, context)
    const next = { ...previous, attendanceCommands: change(previous.attendanceCommands || []) }
    if (getCoachCacheByteLength(next) > COACH_PHASE_31F_MAX_CACHE_BYTES) throw new Error('This answer could not be saved on the phone. Sync existing work first.')
    return next
  })
  guard()
  return document.attendanceCommands
}
