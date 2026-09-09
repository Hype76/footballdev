import AsyncStorage from '@react-native-async-storage/async-storage'
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
} from '../../mobile-core/src/coachOfflineCore'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { APPROVED_MOBILE_PRODUCTION, APPROVED_MOBILE_TEST } from '../../mobile-core/src/environmentBoundary'
import { createEncryptedOfflineStore } from '../../mobile-core/src/offlineStorageCore'
import { getCoachCacheByteLength, COACH_PHASE_31F_MAX_CACHE_BYTES } from '../../mobile-core/src/coachPhase31FCore'
import { developmentDraftKey, editLocalDevelopmentDraft } from '../../mobile-core/src/developmentOfflineCore'

const config = getMobileRuntimeConfig('coach')
const projectRef = config.isUsable ? new URL(config.supabaseUrl).hostname.split('.')[0] : ''

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
    async update() { throw new Error('offline_storage_boundary_rejected') },
    async clear() {},
    async inspect() { return { hasDocument: false, status: 'blocked' } },
    async read() { return { document: null, status: 'blocked' } },
    async write() { throw new Error('offline_storage_boundary_rejected') },
  }
}

function createStore(environment, ref) {
  return createEncryptedOfflineStore({
    appRole: 'coach',
    cryptoProvider,
    environment,
    keyStore: SecureStore,
    keyStoreOptions: {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    },
    projectRef: ref,
    storage: AsyncStorage,
  })
}

const expectedRef = config.isProduction ? APPROVED_MOBILE_PRODUCTION.supabaseRef : APPROVED_MOBILE_TEST.supabaseRef
const store = config.isUsable && projectRef === expectedRef
  ? createStore(config.isProduction ? 'live' : 'test', projectRef)
  : unavailableStore()
const incompatibleTestStore = config.isProduction
  ? createStore('test', APPROVED_MOBILE_TEST.supabaseRef)
  : null

function normalize(value) {
  return String(value ?? '').trim()
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
    await store.clear()
  },
  async read(userScope) {
    store.activate(userScope)
    return getCoachOfflineProfile((await store.read(userScope)).document, userScope)
  },
  async write(profile) {
    const sanitized = sanitizeCoachProfile(profile)
    if (!sanitized.id) throw new Error('offline_profile_scope_mismatch')
    const next = await store.update(sanitized.id, (current) => setCoachOfflineProfile(
      current || createCoachOfflineDocument({ userScope: sanitized.id }), sanitized,
    ))
    return getCoachOfflineProfile(next, sanitized.id)
  },
}

export async function quarantineIncompatibleCoachOfflineState() {
  if (!incompatibleTestStore) return { quarantined: false }
  await incompatibleTestStore.clear()
  return { previousEnvironment: 'test', quarantined: true }
}

export async function clearCoachOfflineState() {
  await store.clear()
}

export async function inspectCoachOfflineState(userId) {
  return store.inspect(userId)
}

export async function readCoachOfflineResources(userId, contextId) {
  const result = await store.read(userId)
  return getCoachOfflineResources(result.document, contextId)
}

export async function saveCoachOfflineResources(userId, contextId, resources) {
  const next = await store.update(userId, (current) => {
    if (!current?.profile) throw new Error('offline_profile_scope_mismatch')
    const key = typeof contextId === 'object' ? contextId.id || contextId.contextId : contextId
    const authority = current.profile.value.coachContexts.find((context) => context.id === key)
    if (!authority || (typeof contextId === 'object' && ['authorityId', 'authoritySource', 'clubId', 'role', 'teamId'].some((field) =>
      normalize(contextId[field]) && normalize(contextId[field]) !== normalize(authority[field]),
    ))) {
      throw new Error('offline_context_scope_mismatch')
    }
    return setCoachOfflineResources(current, contextId, resources)
  })
  return getCoachOfflineResources(next, contextId)
}

function assertOutboxContext(document, userId, context) {
  const authority = document?.profile?.value?.coachContexts?.find(item => item.id === context.id)
  if (document?.userScope !== userId || !authority || ['authorityId', 'authoritySource', 'clubId', 'role', 'teamId'].some(field => normalize(context[field]) !== normalize(authority[field]))) {
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

export async function getPendingCoachMatchDays(userId) {
  const { document } = await store.read(userId)
  if (!document) return []
  return Object.entries(document.matchDayOutboxes || {}).flatMap(([contextId, journals]) => Object.entries(journals)
    .filter(([, journal]) => journal.pending?.length).map(([matchId]) => ({ contextId, matchId })))
}

export async function updateCoachMatchDayOutbox(userId, context, matchId, change) {
  let journal
  await store.update(userId, document => {
    assertOutboxContext(document, userId, context)
    const outboxes = document.matchDayOutboxes || {}
    const previous = outboxes[context.id]?.[matchId] || null
    if (previous && previous.authority !== outboxAuthority(context)) throw new Error('Your access to this saved fixture changed. The saved actions need review.')
    journal = { ...change(previous), authority: outboxAuthority(context) }
    if (journal?.baseMatch?.id !== matchId || journal.baseMatch.clubId !== context.clubId || journal.baseMatch.teamId !== context.teamId) throw new Error('The saved fixture does not match this workspace.')
    const entries = Object.entries(outboxes[context.id] || {})
    const recentIds = new Set(entries.filter(([, value]) => !value.pending?.length)
      .sort((a, b) => Date.parse(b[1].verifiedAt) - Date.parse(a[1].verifiedAt)).slice(0, 7).map(([id]) => id))
    const contextJournals = entries.filter(([id, value]) => id === matchId || value.pending?.length || recentIds.has(id))
    const next = { ...document, matchDayOutboxes: { ...outboxes, [context.id]: { ...Object.fromEntries(contextJournals), [matchId]: journal } } }
    if (getCoachCacheByteLength(next) > COACH_PHASE_31F_MAX_CACHE_BYTES) throw new Error('There is not enough offline storage. This action was not saved. Reconnect and sync first.')
    return next
  })
  return journal
}

export async function readCoachDevelopmentDrafts(userId, context) {
  const { document } = await store.read(userId)
  assertOutboxContext(document, userId, context)
  const entry = document.developmentDrafts?.[context.id]
  if (entry && entry.authority !== outboxAuthority(context)) throw new Error('Your access to these saved Development drafts changed.')
  return entry?.items || {}
}

export async function updateCoachDevelopmentDraft(userId, context, key, change) {
  let result
  await store.update(userId, document => {
    assertOutboxContext(document, userId, context)
    const previous = document.developmentDrafts?.[context.id]
    if (previous && previous.authority !== outboxAuthority(context)) throw new Error('Your access to these saved Development drafts changed.')
    const items = { ...previous?.items }
    result = change(items[key] || null)
    if (result) items[key] = result
    else delete items[key]
    const next = { ...document, developmentDrafts: { ...document.developmentDrafts,
      [context.id]: { authority: outboxAuthority(context), items } } }
    if (getCoachCacheByteLength(next) > COACH_PHASE_31F_MAX_CACHE_BYTES) throw new Error('This change could not be saved on this phone. Reconnect and sync to free space.')
    return next
  })
  return result
}

export function saveLocalCoachDevelopmentDraft(userId, context, input) {
  return updateCoachDevelopmentDraft(userId, context, developmentDraftKey(input.playerId, input.formId),
    previous => editLocalDevelopmentDraft(previous, { ...input, id: previous?.id || Crypto.randomUUID() }))
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
