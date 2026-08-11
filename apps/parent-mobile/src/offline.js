import AsyncStorage from '@react-native-async-storage/async-storage'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { getParentPolls, markParentMessageRead, submitParentPollVote } from '../../mobile-core/src/data'
import { APPROVED_MOBILE_PRODUCTION, APPROVED_MOBILE_TEST } from '../../mobile-core/src/environmentBoundary'
import { createEncryptedOfflineStore } from '../../mobile-core/src/offlineStorageCore'
import {
  createParentOfflineDocument,
  createParentSyncCoordinator,
  enqueueParentOfflineCommand,
  getParentOfflineResources,
  getParentSyncSummary,
  setParentOfflineProfile,
  setParentOfflineResources,
  setParentOfflineSelection,
} from '../../mobile-core/src/parentOfflineCore'
import { getParentPortalLinks, withSelectedParentLink } from '../../mobile-core/src/parentLinks'

const config = getMobileRuntimeConfig('parent')
const projectRef = config.isUsable ? new URL(config.supabaseUrl).hostname.split('.')[0] : ''

function unavailableStore() {
  return {
    async clear() {},
    async inspect() {
      return { hasDocument: false, status: 'blocked' }
    },
    async read() {
      return { document: null, status: 'blocked' }
    },
    async write() {
      throw new Error('offline_storage_boundary_rejected')
    },
  }
}

const cryptoProvider = {
  async open({ aad, ciphertext, key, nonce }) {
    const plaintext = xchacha20poly1305(key, nonce, utf8ToBytes(aad)).decrypt(ciphertext)
    return bytesToUtf8(plaintext)
  },
  async randomBytes(length) {
    return Crypto.getRandomBytesAsync(length)
  },
  async seal({ aad, key, nonce, plaintext }) {
    return xchacha20poly1305(key, nonce, utf8ToBytes(aad)).encrypt(utf8ToBytes(plaintext))
  },
}

function createStore({ environment, ref }) {
  return createEncryptedOfflineStore({
    appRole: 'parent',
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
  ? createStore({ environment: config.isProduction ? 'live' : 'test', ref: projectRef })
  : unavailableStore()
const incompatibleTestStore = config.isProduction
  ? createStore({ environment: 'test', ref: APPROVED_MOBILE_TEST.supabaseRef })
  : null

export async function quarantineIncompatibleParentOfflineState() {
  if (!incompatibleTestStore) return { quarantined: false }
  await incompatibleTestStore.clear()
  return { previousEnvironment: 'test', quarantined: true }
}

function normalize(value) {
  return String(value ?? '').trim()
}

function sanitizeParentProfile(profile) {
  const links = getParentPortalLinks(profile).map((link) => ({
    clubId: normalize(link.clubId),
    clubName: normalize(link.clubName),
    id: normalize(link.id),
    linkType: normalize(link.linkType),
    playerId: normalize(link.playerId),
    playerName: normalize(link.playerName),
    playerSection: normalize(link.playerSection),
    teamId: normalize(link.teamId),
    teamName: normalize(link.teamName),
  }))
  const selectedParentLinkId = links.some((link) => link.id === normalize(profile?.selectedParentLinkId))
    ? normalize(profile.selectedParentLinkId)
    : links[0]?.id || ''
  return {
    accountStatus: normalize(profile?.accountStatus || 'active'),
    activeTeamId: normalize(profile?.activeTeamId),
    activeTeamName: normalize(profile?.activeTeamName),
    clubId: normalize(profile?.clubId),
    clubName: normalize(profile?.clubName),
    displayName: normalize(profile?.displayName),
    email: normalize(profile?.email).toLowerCase(),
    hasActivePlanAccess: profile?.hasActivePlanAccess === true,
    hasParentAccess: links.length > 0,
    id: normalize(profile?.id),
    name: normalize(profile?.name),
    parentPortalLinks: links,
    planStatus: normalize(profile?.planStatus || 'active'),
    role: 'parent_portal',
    roleLabel: 'Parent',
    roleRank: 0,
    selectedParentLinkId,
    selectedPlayerId: links.find((link) => link.id === selectedParentLinkId)?.playerId || '',
    selectedPlayerName: links.find((link) => link.id === selectedParentLinkId)?.playerName || '',
  }
}

async function readDocument(userScope) {
  return (await store.read(userScope)).document
}

async function writeDocument(userScope, document) {
  return store.write(userScope, document)
}

async function ensureDocument(profile) {
  const sanitized = sanitizeParentProfile(profile)
  const userScope = sanitized.id
  if (!userScope) throw new Error('offline_profile_scope_mismatch')
  const existing = await readDocument(userScope)
  const document = existing
    ? setParentOfflineProfile(existing, sanitized)
    : createParentOfflineDocument({
        profile: sanitized,
        selectedLinkId: sanitized.selectedParentLinkId,
        userScope,
      })
  return writeDocument(userScope, document)
}

export const parentOfflineProfileStore = {
  async clear() {
    await store.clear()
  },
  async read(userScope) {
    const document = await readDocument(userScope)
    return document?.profile?.value || null
  },
  async write(profile) {
    return (await ensureDocument(profile)).profile.value
  },
}

export async function inspectParentOfflineStorage(userScope) {
  return store.inspect(userScope)
}

export async function readParentOfflineView(userScope, linkId) {
  const document = await readDocument(userScope)
  const cache = getParentOfflineResources(document, linkId)
  const activeCommands = (document?.journal || []).filter((command) => (
    command.childScope === normalize(linkId)
    && ['pending', 'syncing', 'retryable_failure'].includes(command.status)
  ))

  if (cache) {
    cache.resources = {
      ...cache.resources,
      messages: cache.resources.messages.map((message) => {
        const command = activeCommands.find((entry) => entry.type === 'message_read' && entry.entityId === message.id)
        return command ? { ...message, readAt: message.readAt || command.createdAt } : message
      }),
      polls: cache.resources.polls.map((poll) => {
        const command = activeCommands.filter((entry) => entry.type === 'poll_vote' && entry.entityId === poll.id).at(-1)
        if (!command) return poll
        const optionId = normalize(command.payload?.optionId)
        const selected = command.payload?.selected !== false
        const currentOptionIds = new Set(poll.currentOptionIds || [])
        if (selected) currentOptionIds.add(optionId)
        else currentOptionIds.delete(optionId)
        return {
          ...poll,
          currentOptionId: poll.allowMultiple ? [...currentOptionIds][0] || '' : optionId,
          currentOptionIds: poll.allowMultiple
            ? [...currentOptionIds].filter(Boolean)
            : [optionId],
        }
      }),
    }
  }
  return {
    cache,
    document,
    sync: getParentSyncSummary(document),
  }
}

export async function saveParentOfflineResources(user, linkId, resources) {
  let document = await ensureDocument(user)
  document = setParentOfflineSelection(document, linkId)
  document = setParentOfflineResources(document, linkId, resources)
  return writeDocument(user.id, document)
}

export async function saveParentOfflineSelection(user, linkId) {
  let document = await ensureDocument(user)
  document = setParentOfflineSelection(document, linkId)
  return writeDocument(user.id, document)
}

export async function queueParentMessageRead(user, linkId, message) {
  let document = await ensureDocument(user)
  const queued = enqueueParentOfflineCommand(document, {
    actorScope: user.id,
    childScope: linkId,
    entityId: message.id,
    expectedServerVersion: message.createdAt,
    payload: {},
    type: 'message_read',
  }, { commandId: Crypto.randomUUID() })
  await writeDocument(user.id, queued.document)
  return queued.command
}

export async function queueParentPollVote(user, linkId, poll, optionId) {
  let document = await ensureDocument(user)
  const normalizedOptionId = normalize(optionId)
  const currentlySelected = (poll.currentOptionIds || []).map(normalize).includes(normalizedOptionId)
  const queued = enqueueParentOfflineCommand(document, {
    actorScope: user.id,
    childScope: linkId,
    entityId: poll.id,
    expectedServerVersion: [poll.createdAt, poll.closesAt, poll.currentOptionIds?.join(',')].filter(Boolean).join(':'),
    payload: { optionId: normalizedOptionId, selected: poll.allowMultiple ? !currentlySelected : true },
    type: 'poll_vote',
  }, { commandId: Crypto.randomUUID() })
  await writeDocument(user.id, queued.document)
  return queued.command
}

async function executeParentCommand(user, command) {
  const link = getParentPortalLinks(user).find((candidate) => candidate.id === command.childScope)
  if (!link) {
    const error = new Error('parent_link_unavailable')
    error.code = '42501'
    throw error
  }
  const scopedUser = withSelectedParentLink(user, link)
  if (command.type === 'message_read') return markParentMessageRead(scopedUser, command.entityId)
  if (command.type === 'poll_vote') {
    const polls = await getParentPolls(scopedUser)
    const poll = polls.find((candidate) => candidate.id === command.entityId)
    if (!poll) throw new Error('parent_poll_unavailable')
    const selected = (poll.currentOptionIds || []).includes(command.payload.optionId)
    if (selected === (command.payload.selected !== false)) return { reconciled: true }
    return submitParentPollVote(scopedUser, command.entityId, command.payload.optionId)
  }
  throw new Error('offline_command_invalid')
}

let activeSync = null

export function syncParentOfflineCommands(user, { explicitRetry = false } = {}) {
  if (activeSync) return activeSync
  const coordinator = createParentSyncCoordinator({
    execute: (command) => executeParentCommand(user, command),
    readDocument,
    writeDocument,
  })
  activeSync = coordinator.sync({ explicitRetry, userScope: user.id }).finally(() => {
    activeSync = null
  })
  return activeSync
}
