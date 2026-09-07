import AsyncStorage from '@react-native-async-storage/async-storage'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { markParentMessageRead, submitParentPollVote } from '../../mobile-core/src/data'
import { APPROVED_MOBILE_PRODUCTION, APPROVED_MOBILE_TEST } from '../../mobile-core/src/environmentBoundary'
import { createEncryptedOfflineStore } from '../../mobile-core/src/offlineStorageCore'
import {
  createParentOfflineDocument,
  createParentSyncCoordinator,
  enqueueParentOfflineCommand,
  getParentOfflineResources,
  getParentSyncAttentionItems,
  getParentSyncSummary,
  reconcileParentSyncAttention,
  sanitizeParentOfflineProfile,
  setParentOfflineProfile,
  setParentOfflineResources,
  setParentOfflineSelection,
} from '../../mobile-core/src/parentOfflineCore'
import { getParentPortalLinks, withSelectedParentLink } from '../../mobile-core/src/parentLinks'
import { applyParentNotificationAction } from '../../mobile-core/src/parentNotificationInboxCore'

const config = getMobileRuntimeConfig('parent')
const projectRef = config.isUsable ? new URL(config.supabaseUrl).hostname.split('.')[0] : ''

function unavailableStore() {
  return {
    activate() {},
    async update() { throw new Error('offline_storage_boundary_rejected') },
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

async function readDocument(userScope) {
  return (await store.read(userScope)).document
}

async function updateDocument(userScope, updater) {
  return store.update(userScope, updater)
}

async function ensureDocument(profile) {
  const sanitized = sanitizeParentOfflineProfile(profile)
  if (!sanitized.id) throw new Error('offline_profile_scope_mismatch')
  return updateDocument(sanitized.id, (existing) => existing
    ? setParentOfflineProfile(existing, sanitized)
    : createParentOfflineDocument({ profile: sanitized, selectedLinkId: sanitized.selectedParentLinkId, userScope: sanitized.id }))
}

function updateParentDocument(user, updater) {
  return updateDocument(user.id, (document) => {
    if (!document) throw new Error('offline_profile_scope_mismatch')
    return updater(document)
  })
}

export const parentOfflineProfileStore = {
  async clear() {
    await store.clear()
  },
  async read(userScope) {
    store.activate(userScope)
    const document = await readDocument(userScope)
    if (!document?.profile?.value) return null
    return (await ensureDocument(document.profile.value)).profile.value
  },
  async write(profile) {
    await ensureDocument(profile)
    return profile
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
        const commands = activeCommands.filter((entry) => entry.type === 'poll_vote' && entry.entityId === poll.id)
        if (commands.length === 0) return poll
        const savedOptionIds = Array.isArray(poll.currentOptionIds)
          ? poll.currentOptionIds.map(normalize).filter(Boolean)
          : normalize(poll.currentOptionId) ? [normalize(poll.currentOptionId)] : []
        const nextOptionIds = commands.reduce((optionIds, command) => {
          const optionId = normalize(command.payload?.optionId)
          if (!optionId) return optionIds
          if (!poll.allowMultiple) return [optionId]
          if (optionIds.includes(optionId)) {
            return poll.allowVoteChanges === true ? optionIds.filter((id) => id !== optionId) : optionIds
          }
          return [...optionIds, optionId]
        }, savedOptionIds)
        return {
          ...poll,
          currentOptionId: nextOptionIds[0] || null,
          currentOptionIds: [...new Set(nextOptionIds)],
        }
      }),
    }
  }
  return {
    cache,
    document,
    sync: {
      ...getParentSyncSummary(document, linkId),
      attentionItems: getParentSyncAttentionItems(document, linkId),
    },
  }
}

export async function saveParentOfflineResources(user, linkId, resources) {
  return updateParentDocument(user, (document) => setParentOfflineResources(document, linkId, resources))
}

export async function markParentOfflineNotificationRead(user, linkId, notificationIds, action = 'read', appliedAt = '') {
  return updateParentDocument(user, (document) => {
    const cache = getParentOfflineResources(document, linkId)
    const ids = [...new Set((Array.isArray(notificationIds) ? notificationIds : [notificationIds]).map(normalize).filter(Boolean))]
    if (!cache || ids.length === 0) return document
    return setParentOfflineResources(document, linkId, {
      notifications: applyParentNotificationAction(cache.resources.notifications || [], ids, action, appliedAt),
    })
  })
}

export async function saveParentOfflineSelection(user, linkId) {
  return updateParentDocument(user, (document) => setParentOfflineSelection(document, linkId))
}

export async function reconcileParentOfflineAttention(user, linkId, resources) {
  const reconciled = await updateDocument(user.id, (document) => document && reconcileParentSyncAttention(document, {
    childScope: linkId, messages: resources?.messages, polls: resources?.polls,
  }))
  return { ...getParentSyncSummary(reconciled, linkId), attentionItems: getParentSyncAttentionItems(reconciled, linkId) }
}

async function queueParentCommand(user, command) {
  let queued
  await updateParentDocument(user, (document) => {
    queued = enqueueParentOfflineCommand(document, command, { commandId: Crypto.randomUUID() })
    return queued.document
  })
  return queued.command
}

export async function queueParentMessageRead(user, linkId, message) {
  return queueParentCommand(user, {
    actorScope: user.id, childScope: linkId, entityId: message.id,
    expectedServerVersion: message.createdAt, payload: {}, type: 'message_read',
  })
}

export async function queueParentPollVote(user, linkId, poll, optionId) {
  return queueParentCommand(user, {
    actorScope: user.id, childScope: linkId, entityId: poll.id,
    expectedServerVersion: [poll.createdAt, poll.closesAt, poll.currentOptionIds?.join(',')].filter(Boolean).join(':'),
    payload: { optionId: normalize(optionId) }, type: 'poll_vote',
  })
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
  if (command.type === 'poll_vote') return submitParentPollVote(scopedUser, command.entityId, command.payload.optionId)
  throw new Error('offline_command_invalid')
}

const activeSyncs = new Map()

export function syncParentOfflineCommands(user, { explicitRetry = false } = {}) {
  if (activeSyncs.has(user.id)) return activeSyncs.get(user.id)
  const coordinator = createParentSyncCoordinator({
    execute: (command) => executeParentCommand(user, command),
    readDocument,
    updateDocument,
  })
  const activeSync = coordinator.sync({ explicitRetry, userScope: user.id })
    .then((result) => {
      const scopedSummary = getParentSyncSummary(result.document, user.selectedParentLinkId)
      return {
        ...result,
        ...scopedSummary,
        attentionItems: getParentSyncAttentionItems(result.document, user.selectedParentLinkId),
      }
    })
    .finally(() => {
      activeSyncs.delete(user.id)
    })
  activeSyncs.set(user.id, activeSync)
  return activeSync
}
