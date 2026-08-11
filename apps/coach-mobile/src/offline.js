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
    return getCoachOfflineProfile((await store.read(userScope)).document, userScope)
  },
  async write(profile) {
    const sanitized = sanitizeCoachProfile(profile)
    if (!sanitized.id) throw new Error('offline_profile_scope_mismatch')
    const current = (await store.read(sanitized.id)).document || createCoachOfflineDocument({ userScope: sanitized.id })
    const next = setCoachOfflineProfile(current, sanitized)
    await store.write(sanitized.id, next)
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
  const current = (await store.read(userId)).document || createCoachOfflineDocument({ userScope: userId })
  const cached = getCoachOfflineResources(current, contextId)
  const next = setCoachOfflineResources(current, contextId, {
    ...(cached?.resources || {}),
    ...(resources || {}),
  })
  if (JSON.stringify(next.contexts) === JSON.stringify(current.contexts)) return cached
  await store.write(userId, next)
  return getCoachOfflineResources(next, contextId)
}
