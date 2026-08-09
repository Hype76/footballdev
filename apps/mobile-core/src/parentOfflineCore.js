export const PARENT_OFFLINE_DOCUMENT_SCHEMA_VERSION = 1
export const PARENT_OFFLINE_COMMAND_SCHEMA_VERSION = 1
export const PARENT_OFFLINE_MAX_AUTOMATIC_ATTEMPTS = 5

const COMMAND_TYPES = new Set(['message_read', 'poll_vote'])
const TERMINAL_COMMAND_STATES = new Set(['succeeded', 'conflict', 'permanently_rejected', 'cancelled'])

function normalize(value) {
  return String(value ?? '').trim()
}

function isoNow(now) {
  return new Date(now()).toISOString()
}

export function createParentOfflineDocument({ now = Date.now, profile, selectedLinkId = '', userScope }) {
  const scope = normalize(userScope)
  if (!scope || normalize(profile?.id) !== scope) throw new Error('offline_profile_scope_mismatch')
  const timestamp = isoNow(now)
  return {
    documentSchemaVersion: PARENT_OFFLINE_DOCUMENT_SCHEMA_VERSION,
    journal: [],
    nextSequence: 1,
    profile: {
      entityType: 'parent_profile',
      retrievedAt: timestamp,
      staleAfter: new Date(now() + (24 * 60 * 60 * 1000)).toISOString(),
      value: profile,
    },
    resources: {},
    selectedLinkId: normalize(selectedLinkId),
    updatedAt: timestamp,
    userScope: scope,
  }
}

export function setParentOfflineProfile(document, profile, { now = Date.now } = {}) {
  if (normalize(profile?.id) !== normalize(document?.userScope)) throw new Error('offline_profile_scope_mismatch')
  const links = Array.isArray(profile.parentPortalLinks) ? profile.parentPortalLinks : []
  const retainedSelection = links.some((link) => normalize(link?.id) === normalize(document.selectedLinkId))
    ? normalize(document.selectedLinkId)
    : normalize(profile.selectedParentLinkId || links[0]?.id)
  const activeLinkIds = new Set(links.map((link) => normalize(link?.id)).filter(Boolean))
  return {
    ...document,
    journal: (document.journal || []).map((command) => (
      activeLinkIds.has(command.childScope) || TERMINAL_COMMAND_STATES.has(command.status)
        ? command
        : {
            ...command,
            lastErrorCategory: 'authority_removed',
            nextAttemptAt: '',
            status: 'permanently_rejected',
          }
    )),
    profile: {
      entityType: 'parent_profile',
      retrievedAt: isoNow(now),
      staleAfter: new Date(now() + (24 * 60 * 60 * 1000)).toISOString(),
      value: { ...profile, selectedParentLinkId: retainedSelection },
    },
    resources: Object.fromEntries(Object.entries(document.resources || {}).filter(([linkId]) => activeLinkIds.has(linkId))),
    selectedLinkId: retainedSelection,
    updatedAt: isoNow(now),
  }
}

export function setParentOfflineSelection(document, linkId, { now = Date.now } = {}) {
  const normalizedLinkId = normalize(linkId)
  const links = Array.isArray(document?.profile?.value?.parentPortalLinks)
    ? document.profile.value.parentPortalLinks
    : []
  if (!links.some((link) => normalize(link?.id) === normalizedLinkId)) throw new Error('offline_child_scope_invalid')
  return {
    ...document,
    profile: {
      ...document.profile,
      value: { ...document.profile.value, selectedParentLinkId: normalizedLinkId },
    },
    selectedLinkId: normalizedLinkId,
    updatedAt: isoNow(now),
  }
}

export function setParentOfflineResources(document, linkId, resources, { now = Date.now } = {}) {
  const normalizedLinkId = normalize(linkId)
  const links = Array.isArray(document?.profile?.value?.parentPortalLinks)
    ? document.profile.value.parentPortalLinks
    : []
  if (!links.some((link) => normalize(link?.id) === normalizedLinkId)) throw new Error('offline_child_scope_invalid')
  const retrievedAt = isoNow(now)
  const entityTypes = ['calendar', 'chatHistory', 'chatRooms', 'development', 'invitations', 'matches', 'messages', 'polls', 'resources']
  const values = Object.fromEntries(entityTypes.map((entityType) => [entityType, {
    entityType,
    retrievedAt,
    staleAfter: new Date(now() + (6 * 60 * 60 * 1000)).toISOString(),
    value: Array.isArray(resources?.[entityType]) ? resources[entityType] : [],
  }]))
  return {
    ...document,
    resources: {
      ...(document.resources || {}),
      [normalizedLinkId]: values,
    },
    updatedAt: retrievedAt,
  }
}

export function getParentOfflineResources(document, linkId, { now = Date.now } = {}) {
  const scoped = document?.resources?.[normalize(linkId)]
  if (!scoped) return null
  const entityTypes = ['calendar', 'chatHistory', 'chatRooms', 'development', 'invitations', 'matches', 'messages', 'polls', 'resources']
  const entries = entityTypes.map((name) => scoped[name])
  if (entries.some((entry) => !entry || !Array.isArray(entry.value))) return null
  const retrievedAt = entries.map((entry) => entry.retrievedAt).filter(Boolean).sort().at(-1) || ''
  const stale = entries.some((entry) => entry.staleAfter && new Date(entry.staleAfter).getTime() <= now())
  return {
    retrievedAt,
    resources: Object.fromEntries(entityTypes.map((name) => [name, scoped[name].value])),
    stale,
  }
}

export function enqueueParentOfflineCommand(document, input, { commandId, now = Date.now } = {}) {
  const type = normalize(input?.type)
  const actorScope = normalize(input?.actorScope)
  const childScope = normalize(input?.childScope)
  const entityId = normalize(input?.entityId)
  const id = normalize(commandId)
  if (!COMMAND_TYPES.has(type) || actorScope !== normalize(document?.userScope) || !childScope || !entityId || !id) {
    throw new Error('offline_command_invalid')
  }

  const pendingDuplicate = (document.journal || []).find((command) => (
    !TERMINAL_COMMAND_STATES.has(command.status)
    && command.type === type
    && command.childScope === childScope
    && command.entityId === entityId
    && JSON.stringify(command.payload) === JSON.stringify(input.payload || {})
  ))
  if (pendingDuplicate) return { command: pendingDuplicate, document }

  const command = {
    actorScope,
    attemptCount: 0,
    childScope,
    commandId: id,
    commandSchemaVersion: PARENT_OFFLINE_COMMAND_SCHEMA_VERSION,
    createdAt: isoNow(now),
    entityId,
    expectedServerVersion: normalize(input.expectedServerVersion),
    idempotencyKey: id,
    lastErrorCategory: '',
    localSequence: Number(document.nextSequence || 1),
    nextAttemptAt: '',
    payload: input.payload || {},
    status: 'pending',
    type,
  }
  return {
    command,
    document: {
      ...document,
      journal: [...(document.journal || []), command],
      nextSequence: command.localSequence + 1,
      updatedAt: isoNow(now),
    },
  }
}

export function classifyParentCommandError(error) {
  const code = normalize(error?.code).toLowerCase()
  const message = normalize(error?.message || error).toLowerCase()
  const status = Number(error?.status || error?.statusCode || 0)
  if (
    message.includes('network request failed')
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('timed out')
    || status >= 500
  ) return 'retryable_failure'
  if (
    code === '55000'
    || code === '22023'
    || message.includes('vote_locked')
    || message.includes('vote_limit')
    || message.includes('option_invalid')
  ) return 'conflict'
  if (
    status === 401
    || status === 403
    || code === '42501'
    || message.includes('unavailable')
    || message.includes('not permitted')
    || message.includes('not authorised')
    || message.includes('not authorized')
  ) return 'permanently_rejected'
  return 'retryable_failure'
}

function replaceCommand(document, commandId, replacement, now) {
  return {
    ...document,
    journal: (document.journal || []).map((command) => command.commandId === commandId ? replacement : command),
    updatedAt: isoNow(now),
  }
}

export function getParentSyncSummary(document) {
  const commands = document?.journal || []
  const waiting = commands.filter((command) => ['pending', 'syncing', 'retryable_failure'].includes(command.status)).length
  const needsAttention = commands.filter((command) => ['conflict', 'permanently_rejected'].includes(command.status)).length
  return {
    needsAttention,
    state: needsAttention > 0 ? 'attention' : waiting > 0 ? 'waiting' : 'synced',
    waiting,
  }
}

export function createParentSyncCoordinator({ execute, now = Date.now, random = Math.random, readDocument, writeDocument }) {
  let active = null

  async function run({ explicitRetry = false, userScope }) {
    let document = await readDocument(userScope)
    if (!document) return { ...getParentSyncSummary(null), results: [] }

    document = {
      ...document,
      journal: (document.journal || []).map((command) => command.status === 'syncing'
        ? { ...command, status: 'pending' }
        : command),
    }
    await writeDocument(userScope, document)
    const results = []

    for (const original of [...document.journal].sort((left, right) => left.localSequence - right.localSequence)) {
      const current = document.journal.find((command) => command.commandId === original.commandId)
      if (!current || TERMINAL_COMMAND_STATES.has(current.status)) continue
      if (!explicitRetry && current.status === 'retryable_failure' && current.attemptCount >= PARENT_OFFLINE_MAX_AUTOMATIC_ATTEMPTS) continue
      if (!explicitRetry && current.nextAttemptAt && new Date(current.nextAttemptAt).getTime() > now()) continue

      const syncing = {
        ...current,
        attemptCount: current.attemptCount + 1,
        lastErrorCategory: '',
        status: 'syncing',
      }
      document = replaceCommand(document, current.commandId, syncing, now)
      await writeDocument(userScope, document)

      try {
        await execute(syncing)
        const succeeded = { ...syncing, completedAt: isoNow(now), nextAttemptAt: '', status: 'succeeded' }
        document = replaceCommand(document, current.commandId, succeeded, now)
        results.push({ commandId: current.commandId, status: 'succeeded', type: current.type })
      } catch (error) {
        const category = classifyParentCommandError(error)
        const retryDelay = Math.min(15 * 60 * 1000, (2 ** Math.min(syncing.attemptCount, 8)) * 1000)
        const jitter = Math.floor(retryDelay * 0.25 * random())
        const failed = {
          ...syncing,
          lastErrorCategory: category,
          nextAttemptAt: category === 'retryable_failure'
            ? new Date(now() + retryDelay + jitter).toISOString()
            : '',
          status: category,
        }
        document = replaceCommand(document, current.commandId, failed, now)
        results.push({ commandId: current.commandId, status: category, type: current.type })
        if (category === 'retryable_failure' && syncing.attemptCount >= PARENT_OFFLINE_MAX_AUTOMATIC_ATTEMPTS) break
      }
      await writeDocument(userScope, document)
    }

    await writeDocument(userScope, document)
    return { ...getParentSyncSummary(document), document, results }
  }

  return {
    sync(options) {
      if (!active) active = run(options).finally(() => { active = null })
      return active
    },
  }
}
