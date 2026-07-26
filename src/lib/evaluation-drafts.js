import {
  canAccessDraftScope,
  createDraftScope,
  createOpaqueDraftId,
  getDraftExpiry,
  isDraftExpired,
  isDraftUserActive,
} from './draft-security.js'

export const PRIVATE_EVALUATION_DRAFTS_KEY = 'footballplayer:protected-private-evaluation-drafts:v2'
export const LEGACY_PRIVATE_EVALUATION_DRAFTS_KEY = 'footballplayer:private-evaluation-drafts:v1'
export const PRIVATE_EVALUATION_DRAFT_LIFECYCLE = Object.freeze({
  initialising: 'initialising',
  loadingExistingDraft: 'loading_existing_draft',
  hydrated: 'hydrated',
  dirty: 'dirty',
  saving: 'saving',
  saved: 'saved',
  saveFailed: 'save_failed',
  offline: 'offline',
  retrying: 'retrying',
  submitting: 'submitting',
  submitted: 'submitted',
  discarding: 'discarding',
  discarded: 'discarded',
})

export function isPrivateEvaluationDraftOffline(navigatorObject) {
  const resolvedNavigator = navigatorObject ??
    (typeof navigator !== 'undefined' ? navigator : null)

  return resolvedNavigator?.onLine === false
}

export function canRecoverPrivateEvaluationDraft({
  hasPendingRevision = false,
  lifecycle = PRIVATE_EVALUATION_DRAFT_LIFECYCLE.hydrated,
  online = true,
  recoveryInFlight = false,
} = {}) {
  return Boolean(
    online &&
    hasPendingRevision &&
    !recoveryInFlight &&
    [
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.offline,
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.saveFailed,
    ].includes(lifecycle),
  )
}

export function getPrivateEvaluationDraftRecoveryDelay({
  attempt = 1,
  baseDelayMs = 30_000,
  maxDelayMs = 120_000,
} = {}) {
  const normalizedAttempt = Math.max(1, Number(attempt) || 1)
  const normalizedBaseDelay = Math.max(1_000, Number(baseDelayMs) || 30_000)
  const normalizedMaxDelay = Math.max(
    normalizedBaseDelay,
    Number(maxDelayMs) || 120_000,
  )

  return Math.min(
    normalizedMaxDelay,
    normalizedBaseDelay * (2 ** (normalizedAttempt - 1)),
  )
}
const DRAFT_STATUSES = {
  active: 'active',
  discarded: 'discarded',
  submitted: 'submitted',
}
const SERVER_DRAFT_STATUS = 'draft'

async function getSupabaseClient(supabaseClient) {
  if (supabaseClient) {
    return supabaseClient
  }

  const { supabase } = await import('./supabase-client.js')
  return supabase
}

async function blockServerDraftDemoMutation(user) {
  const { blockDemoMutation } = await import('./domain/demo-guards.js')
  await blockDemoMutation(user)
}

function getStorage(storage) {
  if (storage) {
    return storage
  }

  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage || null
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeDraftContext(context = {}) {
  return {
    clubId: normalizeText(context.clubId),
    createdByUserId: normalizeText(context.createdByUserId),
    editingEvaluationId: normalizeText(context.editingEvaluationId),
    formId: normalizeText(context.formId),
    formVersion: Math.max(0, Number(context.formVersion) || 0),
    formType: normalizeText(context.formType) || 'development_record',
    playerId: normalizeText(context.playerId),
    playerName: normalizeText(context.playerName),
    section: normalizeText(context.section),
    session: normalizeText(context.session),
    teamId: normalizeText(context.teamId),
    teamName: normalizeText(context.teamName),
  }
}

function parseDrafts(value) {
  if (!value) {
    return []
  }

  try {
    const parsedValue = JSON.parse(value)
    return Array.isArray(parsedValue) ? parsedValue : []
  } catch (error) {
    console.error(error)
    return []
  }
}

function readDrafts(storage, now = Date.now()) {
  const resolvedStorage = getStorage(storage)

  if (!resolvedStorage) {
    return []
  }

  if (resolvedStorage.getItem(LEGACY_PRIVATE_EVALUATION_DRAFTS_KEY) !== null) {
    resolvedStorage.removeItem(LEGACY_PRIVATE_EVALUATION_DRAFTS_KEY)
  }

  const drafts = parseDrafts(resolvedStorage.getItem(PRIVATE_EVALUATION_DRAFTS_KEY))
  const activeDrafts = drafts.filter((draft) => !isDraftExpired(draft, now))

  if (activeDrafts.length !== drafts.length) {
    writeDrafts(activeDrafts, resolvedStorage)
  }

  return activeDrafts
}

function writeDrafts(drafts, storage) {
  const resolvedStorage = getStorage(storage)

  if (!resolvedStorage) {
    return
  }

  resolvedStorage.setItem(PRIVATE_EVALUATION_DRAFTS_KEY, JSON.stringify(drafts))
}

function isOwnedActiveDraft(draft, user) {
  return Boolean(
    draft?.id &&
      draft.status === DRAFT_STATUSES.active &&
      canAccessDraftScope({ scope: draft.scope, user }),
  )
}

function hasEnteredValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(hasEnteredValue)
  }

  return normalizeText(value) !== ''
}

function isMissingServerDraftTableError(error) {
  const message = normalizeLowerText(error?.message)
  return error?.code === '42P01' ||
    message.includes('evaluation_drafts') && (
      message.includes('does not exist') ||
      message.includes('schema cache') ||
      message.includes('could not find the table')
    )
}

export function getEvaluationDraftContextKey(context = {}) {
  const normalizedContext = normalizeDraftContext(context)

  return [
    'v2',
    normalizedContext.formType,
    normalizedContext.teamId || normalizeLowerText(normalizedContext.teamName) || 'all',
    normalizedContext.playerId || normalizeLowerText(normalizedContext.playerName) || 'unassigned-player',
    normalizedContext.formId || 'unselected-form',
    normalizedContext.formVersion || 'version',
    normalizedContext.editingEvaluationId || 'new',
  ]
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]+/g, '_'))
    .join(':')
}

export function getLegacyEvaluationDraftContextKey(context = {}) {
  const normalizedContext = normalizeDraftContext(context)

  return [
    normalizedContext.formType,
    normalizedContext.teamId || normalizeLowerText(normalizedContext.teamName) || 'all',
    normalizeLowerText(normalizedContext.playerName) || normalizedContext.playerId || 'unassigned-player',
    normalizedContext.section || 'section',
    normalizedContext.session || 'session',
    normalizedContext.editingEvaluationId || 'new',
  ]
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]+/g, '_'))
    .join(':')
}

export function getEvaluationDraftContextKeys(context = {}) {
  return [...new Set([
    getEvaluationDraftContextKey(context),
    getLegacyEvaluationDraftContextKey(context),
  ])]
}

function sortDraftFingerprintValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortDraftFingerprintValue)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['draftContext', 'draftMeta'].includes(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortDraftFingerprintValue(item)]),
    )
  }

  return value
}

export function getPrivateEvaluationDraftPayloadFingerprint(payload = {}) {
  return JSON.stringify(sortDraftFingerprintValue(payload))
}

export function getPrivateEvaluationDraftCanonicalSaveIdentity({
  context = {},
  contextIdentity = '',
  epoch = 0,
  fingerprint = '',
  payload = {},
  revision = 0,
} = {}) {
  const resolvedContextIdentity = normalizeText(contextIdentity) ||
    getPrivateEvaluationDraftRequestIdentity({ context, payload })
  const resolvedFingerprint = normalizeText(fingerprint) ||
    getPrivateEvaluationDraftPayloadFingerprint(payload)

  if (!resolvedContextIdentity || !resolvedFingerprint) {
    return ''
  }

  return JSON.stringify([
    resolvedContextIdentity,
    Math.max(0, Number(epoch) || 0),
    Math.max(0, Number(revision) || 0),
    resolvedFingerprint,
  ])
}

export function canStagePrivateEvaluationDraftSave({
  activeIdentity = '',
  confirmedIdentity = '',
  contextChanging = false,
  currentIdentity = '',
  discarded = false,
  hydratedIdentity = '',
  hydrationReady = false,
  pendingIdentity = '',
  requiredContextReady = false,
  submitted = false,
  userEdited = false,
} = {}) {
  const normalizedCurrentIdentity = normalizeText(currentIdentity)

  return Boolean(
    normalizedCurrentIdentity &&
    hydrationReady &&
    requiredContextReady &&
    userEdited &&
    !contextChanging &&
    !submitted &&
    !discarded &&
    normalizedCurrentIdentity !== normalizeText(hydratedIdentity) &&
    normalizedCurrentIdentity !== normalizeText(confirmedIdentity) &&
    normalizedCurrentIdentity !== normalizeText(activeIdentity) &&
    normalizedCurrentIdentity !== normalizeText(pendingIdentity),
  )
}

export function canAutosavePrivateEvaluationDraft({
  baselineFingerprint = '',
  dependenciesResolved = false,
  explicit = false,
  fingerprint = '',
  hasContent = false,
  hydrationReady = false,
  lifecycle = PRIVATE_EVALUATION_DRAFT_LIFECYCLE.initialising,
  requiredContextReady = true,
  userEdited = false,
} = {}) {
  if (
    !dependenciesResolved ||
    !hydrationReady ||
    !hasContent ||
    !requiredContextReady ||
    [
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.initialising,
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.loadingExistingDraft,
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.submitting,
      PRIVATE_EVALUATION_DRAFT_LIFECYCLE.discarding,
    ].includes(lifecycle)
  ) {
    return false
  }

  return explicit || (userEdited && fingerprint !== baselineFingerprint)
}

export function getPrivateEvaluationDraftRequestIdentity({ context = {}, payload = {} } = {}) {
  const normalizedContext = normalizeDraftContext({
    ...context,
    formId: context.formId || payload.selectedFeedbackFormId,
  })

  return [
    normalizedContext.clubId || 'club',
    normalizedContext.createdByUserId || 'actor',
    normalizedContext.teamId || normalizeLowerText(normalizedContext.teamName) || 'team',
    normalizedContext.playerId || normalizeLowerText(normalizedContext.playerName) || 'player',
    normalizedContext.formId || 'unselected-form',
    normalizedContext.formVersion || 'version',
    normalizedContext.editingEvaluationId || 'new',
  ]
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]+/g, '_'))
    .join(':')
}

export function createPrivateEvaluationDraftRequestCoordinator({ initialRevision = 0 } = {}) {
  let contextIdentity = ''
  let epoch = 0
  let revision = Math.max(0, Number(initialRevision) || 0)

  const snapshot = () => ({ contextIdentity, epoch, revision })
  const nextGenuineEdit = (nextContextIdentity = contextIdentity, minimumRevision = 0) => {
    const normalizedIdentity = normalizeText(nextContextIdentity) || contextIdentity

    if (normalizedIdentity !== contextIdentity) {
      contextIdentity = normalizedIdentity
      epoch += 1
    }

    revision = Math.max(revision, Number(minimumRevision) || 0) + 1
    return snapshot()
  }

  return {
    beginContext(nextContextIdentity, hydratedRevision = 0) {
      const normalizedIdentity = normalizeText(nextContextIdentity)
      const contextChanged = normalizedIdentity !== contextIdentity

      if (contextChanged) {
        contextIdentity = normalizedIdentity
        epoch += 1
        revision = Math.max(0, Number(hydratedRevision) || 0)
      } else {
        revision = Math.max(revision, Number(hydratedRevision) || 0)
      }

      return {
        ...snapshot(),
        contextChanged,
      }
    },
    hydrateRevision(hydratedRevision = 0) {
      revision = Math.max(revision, Number(hydratedRevision) || 0)
      return snapshot()
    },
    invalidate() {
      epoch += 1
      return snapshot()
    },
    isCurrent(request = {}) {
      return normalizeText(request.contextIdentity) === contextIdentity &&
        Number(request.epoch) === epoch &&
        Number(request.revision) === revision
    },
    nextGenuineEdit,
    nextRequest: nextGenuineEdit,
    snapshot,
  }
}

function getPrivateEvaluationDraftSingleFlightIdentity(save = {}) {
  const request = save?.request || {}

  return normalizeText(request.identity) ||
    getPrivateEvaluationDraftCanonicalSaveIdentity(request)
}

export function isSamePrivateEvaluationDraftSave(leftSave, rightSave) {
  return Boolean(
    leftSave?.request &&
    rightSave?.request &&
    getPrivateEvaluationDraftSingleFlightIdentity(leftSave) ===
      getPrivateEvaluationDraftSingleFlightIdentity(rightSave)
  )
}

export function createPrivateEvaluationDraftSingleFlight() {
  let active = null
  let confirmedIdentity = ''
  let generation = 0
  let pending = null
  const idleWaiters = new Set()

  const settleIdleWaiters = () => {
    if (active || pending) {
      return
    }

    idleWaiters.forEach((resolve) => resolve())
    idleWaiters.clear()
  }

  const createEntry = (save, execute) => {
    let rejectPromise
    let resolvePromise
    const promise = new Promise((resolve, reject) => {
      rejectPromise = reject
      resolvePromise = resolve
    })

    return {
      execute,
      generation,
      promise,
      reject: rejectPromise,
      resolve: resolvePromise,
      save,
    }
  }

  const start = (entry) => {
    if (entry.generation !== generation) {
      entry.resolve({ cancelled: true, serverSaved: false })
      settleIdleWaiters()
      return
    }

    active = entry
    Promise.resolve()
      .then(() => entry.execute(entry.save))
      .then(entry.resolve, entry.reject)
      .finally(() => {
        if (active === entry) {
          active = null
        }

        const next = pending
        pending = null

        if (next) {
          start(next)
        } else {
          settleIdleWaiters()
        }
      })
  }

  return {
    enqueue(save, execute) {
      if (!save?.request || typeof execute !== 'function') {
        return Promise.resolve({ skipped: true })
      }

      if (
        confirmedIdentity &&
        getPrivateEvaluationDraftSingleFlightIdentity(save) === confirmedIdentity
      ) {
        return Promise.resolve({
          confirmed: true,
          serverSaved: true,
          skipped: true,
        })
      }

      if (isSamePrivateEvaluationDraftSave(active?.save, save)) {
        return active.promise
      }

      if (isSamePrivateEvaluationDraftSave(pending?.save, save)) {
        return pending.promise
      }

      const entry = createEntry(save, execute)

      if (active) {
        if (pending) {
          pending.resolve({
            coalesced: true,
            serverSaved: false,
            superseded: true,
          })
        }

        pending = entry
      } else {
        start(entry)
      }

      return entry.promise
    },
    confirm(saveOrIdentity) {
      const nextConfirmedIdentity = typeof saveOrIdentity === 'string'
        ? normalizeText(saveOrIdentity)
        : getPrivateEvaluationDraftSingleFlightIdentity(saveOrIdentity)

      if (!nextConfirmedIdentity) {
        return
      }

      confirmedIdentity = nextConfirmedIdentity

      if (
        pending &&
        getPrivateEvaluationDraftSingleFlightIdentity(pending.save) === confirmedIdentity
      ) {
        pending.resolve({
          confirmed: true,
          serverSaved: true,
          skipped: true,
        })
        pending = null
      }
    },
    invalidate({ preserveConfirmed = false } = {}) {
      generation += 1

      if (!preserveConfirmed) {
        confirmedIdentity = ''
      }

      if (pending) {
        pending.resolve({
          cancelled: true,
          serverSaved: false,
          superseded: true,
        })
        pending = null
      }

      settleIdleWaiters()
    },
    snapshot() {
      return {
        active: active?.save || null,
        confirmedIdentity,
        pending: pending?.save || null,
      }
    },
    waitForIdle() {
      if (!active && !pending) {
        return Promise.resolve()
      }

      return new Promise((resolve) => {
        idleWaiters.add(resolve)
      })
    },
  }
}

export function getPrivateEvaluationDraftSaveResponseDisposition({
  activeFingerprint = '',
  request = {},
  requestIsCurrent = false,
  serverDraft = null,
} = {}) {
  const requestFingerprint = normalizeText(request.fingerprint)

  if (
    !requestIsCurrent ||
    !requestFingerprint ||
    requestFingerprint !== normalizeText(activeFingerprint)
  ) {
    return {
      outcome: 'ignored',
      ownsVisibleStatus: false,
      retryable: false,
    }
  }

  if (!serverDraft?.id) {
    return {
      outcome: 'failed',
      ownsVisibleStatus: true,
      retryable: true,
    }
  }

  const serverFingerprint = getPrivateEvaluationDraftPayloadFingerprint(serverDraft.payload)
  const requestRevision = Math.max(0, Number(request.revision) || 0)
  const serverRevision = Math.max(0, Number(serverDraft.clientSaveVersion) || 0)
  const responseMatchesActiveRevision =
    serverFingerprint === requestFingerprint &&
    serverRevision >= requestRevision

  if (!responseMatchesActiveRevision) {
    return {
      outcome: 'failed',
      ownsVisibleStatus: true,
      retryable: true,
    }
  }

  return {
    outcome: serverDraft.staleWrite ? 'reconciled' : 'saved',
    ownsVisibleStatus: true,
    retryable: false,
  }
}

export function choosePrivateEvaluationDraftServerAcknowledgement({
  currentAcknowledgement = null,
  request = {},
  serverDraft = null,
} = {}) {
  const contextIdentity = normalizeText(request.contextIdentity)
  const epoch = Math.max(0, Number(request.epoch) || 0)

  if (!contextIdentity || !serverDraft?.id) {
    return currentAcknowledgement
  }

  const nextAcknowledgement = {
    contextIdentity,
    draftId: serverDraft.id,
    epoch,
    fingerprint: getPrivateEvaluationDraftPayloadFingerprint(serverDraft.payload),
    identity: normalizeText(request.identity) ||
      getPrivateEvaluationDraftCanonicalSaveIdentity(request),
    revision: Math.max(0, Number(serverDraft.clientSaveVersion) || 0),
  }

  if (
    currentAcknowledgement?.contextIdentity === contextIdentity &&
    Number(currentAcknowledgement.epoch) === epoch &&
    Number(currentAcknowledgement.revision) > nextAcknowledgement.revision
  ) {
    return currentAcknowledgement
  }

  return nextAcknowledgement
}

function normalizeServerDraftRow(row) {
  if (!row?.id) {
    return null
  }

  return {
    id: row.id,
    clubId: normalizeText(row.club_id ?? row.clubId),
    teamId: normalizeText(row.team_id ?? row.teamId),
    playerId: normalizeText(row.player_id ?? row.playerId),
    createdByUserId: normalizeText(row.created_by_user_id ?? row.createdByUserId),
    formType: normalizeText(row.report_type ?? row.reportType) || 'development_record',
    contextKey: normalizeText(row.context_key ?? row.contextKey),
    clientSaveVersion: Math.max(
      0,
      Number(
        row.client_save_version ??
        row.clientSaveVersion ??
        row.draft_data?.draftMeta?.clientSaveVersion ??
        0,
      ) || 0,
    ),
    payload: row.draft_data && typeof row.draft_data === 'object' ? row.draft_data : {},
    status: normalizeText(row.status) || SERVER_DRAFT_STATUS,
    lastSavedAt: row.last_saved_at ?? row.lastSavedAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

export function buildPrivateEvaluationDraftContext({
  editingEvaluationId = '',
  formData = {},
  formId = '',
  formVersion = 0,
  user,
} = {}) {
  return normalizeDraftContext({
    clubId: user?.clubId,
    createdByUserId: user?.id,
    editingEvaluationId,
    formId,
    formVersion,
    formType: 'development_record',
    playerId: formData.playerId,
    playerName: formData.playerName,
    section: formData.section,
    session: formData.session,
    teamId: formData.teamId || user?.activeTeamId,
    teamName: formData.team || user?.activeTeamName,
  })
}

export function hasPrivateEvaluationDraftContent(payload = {}) {
  return hasEnteredValue(payload.formData?.playerName) ||
    hasEnteredValue(payload.responseValues) ||
    hasEnteredValue(payload.formData?.parentContacts) ||
    hasEnteredValue(payload.emailTemplateKey) ||
    hasEnteredValue(payload.inviteDate) ||
    hasEnteredValue(payload.selectedExportLabels) ||
    hasEnteredValue(payload.scheduledEmailDateTime) ||
    payload.isPdfAttachmentApproved === true ||
    payload.includeAttendanceSummary === false ||
    payload.emailSendMode === 'scheduled' ||
    payload.archiveAfterNoPlace === true
}

export function createPrivateEvaluationDraftPayload({
  archiveAfterNoPlace = false,
  emailSendMode = 'now',
  emailTemplateKey = '',
  formData = {},
  includeAttendanceSummary = true,
  inviteDate = '',
  isPdfAttachmentApproved = false,
  lastUsedSession = '',
  offlineDraftId = '',
  previewMode = 'scored',
  responseValues = {},
  saveVersion = 0,
  scheduledEmailDateTime = '',
  selectedFeedbackFormId = '',
  selectedExportLabels = null,
  selectedParentContactIndexes = [0],
  savedAt = '',
} = {}) {
  return {
    formData,
    responseValues,
    selectedFeedbackFormId: normalizeText(selectedFeedbackFormId),
    lastUsedSession,
    previewMode,
    emailTemplateKey,
    selectedParentContactIndexes,
    inviteDate,
    offlineDraftId,
    isPdfAttachmentApproved,
    includeAttendanceSummary,
    emailSendMode,
    scheduledEmailDateTime,
    selectedExportLabels,
    archiveAfterNoPlace,
    draftMeta: {
      clientSaveVersion: Number(saveVersion) || 0,
      clientSavedAt: savedAt || new Date().toISOString(),
    },
  }
}

export function getPrivateEvaluationDraftSavedAt(draft = {}) {
  return normalizeText(
    draft.lastSavedAt ||
      draft.updatedAt ||
      draft.createdAt ||
      draft.payload?.draftMeta?.clientSavedAt ||
      draft.draftMeta?.clientSavedAt,
  )
}

export function getPrivateEvaluationDraftSaveVersion(draft = {}) {
  const version = Number(draft.payload?.draftMeta?.clientSaveVersion ?? draft.draftMeta?.clientSaveVersion ?? 0)
  return Number.isFinite(version) ? version : 0
}

export function chooseLatestPrivateEvaluationDraft(candidates = []) {
  return candidates
    .filter((draft) => draft?.payload && hasPrivateEvaluationDraftContent(draft.payload))
    .sort((left, right) => {
      const versionDiff = getPrivateEvaluationDraftSaveVersion(right) - getPrivateEvaluationDraftSaveVersion(left)

      if (versionDiff !== 0) {
        return versionDiff
      }

      return getPrivateEvaluationDraftSavedAt(right).localeCompare(getPrivateEvaluationDraftSavedAt(left))
    })[0] || null
}

export function findPrivateEvaluationDraft({ context = {}, storage, user } = {}) {
  if (!isDraftUserActive(user)) {
    return null
  }

  const normalizedContext = normalizeDraftContext(context)
  const requestedPlayerName = normalizeLowerText(normalizedContext.playerName)
  const requestedTeamId = normalizeText(normalizedContext.teamId)
  const requestedTeamName = normalizeLowerText(normalizedContext.teamName)

  return readDrafts(storage)
    .filter((draft) => isOwnedActiveDraft(draft, user))
    .filter((draft) => canAccessDraftScope({
      requestedContext: normalizedContext,
      scope: draft.scope,
      user,
    }))
    .filter((draft) => {
      if (
        normalizedContext.formId &&
        normalizeText(draft.context?.formId) &&
        normalizeText(draft.context.formId) !== normalizedContext.formId
      ) {
        return false
      }

      if (normalizedContext.formType && normalizeText(draft.formType) !== normalizedContext.formType) {
        return false
      }

      if (requestedPlayerName && normalizeLowerText(draft.context?.playerName) !== requestedPlayerName) {
        return false
      }

      if (requestedTeamId && normalizeText(draft.context?.teamId) && normalizeText(draft.context.teamId) !== requestedTeamId) {
        return false
      }

      if (!requestedTeamId && requestedTeamName && normalizeLowerText(draft.context?.teamName) && normalizeLowerText(draft.context.teamName) !== requestedTeamName) {
        return false
      }

      return true
    })
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null
}

export function savePrivateEvaluationDraft({ context = {}, existingDraftId = '', payload = {}, storage, user } = {}) {
  if (!isDraftUserActive(user) || !hasPrivateEvaluationDraftContent(payload)) {
    return null
  }

  const normalizedContext = normalizeDraftContext({
    ...context,
    clubId: context.clubId || user.clubId,
    createdByUserId: user.id,
  })
  const drafts = readDrafts(storage)
  const draftId = normalizeText(existingDraftId) || createOpaqueDraftId('private-evaluation-draft')
  const now = new Date().toISOString()
  const existingDraft = drafts.find((draft) => draft.id === draftId)
  const nextDraft = {
    ...(existingDraft || {}),
    id: draftId,
    clubId: normalizedContext.clubId,
    context: normalizedContext,
    createdAt: existingDraft?.createdAt || now,
    createdByUserId: user.id,
    expiresAt: getDraftExpiry(),
    formType: normalizedContext.formType,
    payload,
    scope: createDraftScope({ context: normalizedContext, user }),
    status: DRAFT_STATUSES.active,
    updatedAt: now,
  }
  const nextDrafts = [nextDraft, ...drafts.filter((draft) => draft.id !== draftId)].slice(0, 25)

  writeDrafts(nextDrafts, storage)
  return nextDraft
}

function createServerDraftRow({ context = {}, payload = {}, user } = {}) {
  const normalizedContext = normalizeDraftContext({
    ...context,
    clubId: context.clubId || user?.clubId,
    createdByUserId: user?.id,
  })
  const now = new Date().toISOString()
  const clientSaveVersion = Math.max(1, getPrivateEvaluationDraftSaveVersion(payload))
  const versionedPayload = {
    ...payload,
    draftMeta: {
      ...(payload.draftMeta && typeof payload.draftMeta === 'object' ? payload.draftMeta : {}),
      clientSaveVersion,
    },
  }

  return {
    club_id: normalizedContext.clubId,
    team_id: normalizedContext.teamId || null,
    player_id: normalizedContext.playerId || null,
    created_by_user_id: user?.id,
    report_type: normalizedContext.formType,
    context_key: getEvaluationDraftContextKey(normalizedContext),
    client_save_version: clientSaveVersion,
    draft_data: {
      ...versionedPayload,
      draftContext: normalizedContext,
    },
    status: SERVER_DRAFT_STATUS,
    last_saved_at: now,
    updated_at: now,
  }
}

export async function findServerEvaluationDraft({ context = {}, supabaseClient, user } = {}) {
  if (!user?.id || !user?.clubId) {
    return null
  }

  const normalizedContext = normalizeDraftContext({
    ...context,
    clubId: context.clubId || user.clubId,
    createdByUserId: user.id,
  })
  const supabase = await getSupabaseClient(supabaseClient)
  const findDraft = async ({ latestCanonicalPlayer = false } = {}) => {
    let query = supabase
      .from('evaluation_drafts')
      .select('*')
      .eq('club_id', normalizedContext.clubId)
      .eq('created_by_user_id', user.id)
      .eq('report_type', normalizedContext.formType)

    if (latestCanonicalPlayer) {
      query = query.eq('player_id', normalizedContext.playerId)

      if (normalizedContext.teamId) {
        query = query.eq('team_id', normalizedContext.teamId)
      }
    } else {
      query = query.in('context_key', getEvaluationDraftContextKeys(normalizedContext))
    }

    return query
      .eq('status', SERVER_DRAFT_STATUS)
      .order('last_saved_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  }

  let { data, error } = await findDraft()

  if (
    !error &&
    !data?.id &&
    !normalizedContext.formId &&
    normalizedContext.playerId
  ) {
    const fallbackResult = await findDraft({ latestCanonicalPlayer: true })
    data = fallbackResult.data
    error = fallbackResult.error
  }

  if (error) {
    if (isMissingServerDraftTableError(error)) {
      return null
    }

    console.error(error)
    throw error
  }

  return normalizeServerDraftRow(data)
}

async function findServerEvaluationDraftById({ draftId = '', supabaseClient, user } = {}) {
  const normalizedDraftId = normalizeText(draftId)

  if (!user?.id || !normalizedDraftId) {
    return null
  }

  const supabase = await getSupabaseClient(supabaseClient)
  const { data, error } = await supabase
    .from('evaluation_drafts')
    .select('*')
    .eq('id', normalizedDraftId)
    .eq('club_id', user.clubId)
    .eq('created_by_user_id', user.id)
    .eq('status', SERVER_DRAFT_STATUS)
    .maybeSingle()

  if (error) {
    if (isMissingServerDraftTableError(error)) {
      return null
    }

    console.error(error)
    throw error
  }

  return normalizeServerDraftRow(data)
}

export async function saveServerEvaluationDraft({
  context = {},
  existingDraftContextKey = '',
  existingDraftId = '',
  payload = {},
  supabaseClient,
  user,
} = {}) {
  if (!user?.id || !user?.clubId || !hasPrivateEvaluationDraftContent(payload)) {
    return null
  }

  await blockServerDraftDemoMutation(user)

  const supabase = await getSupabaseClient(supabaseClient)
  const rowPayload = createServerDraftRow({ context, payload, user })
  const requestRevision = rowPayload.client_save_version
  const normalizedDraftId = normalizeText(existingDraftId)
  const existingDraft = normalizedDraftId
    ? { contextKey: normalizeText(existingDraftContextKey), id: normalizedDraftId }
    : await findServerEvaluationDraft({ context, supabaseClient: supabase, user })

  if (existingDraft?.id) {
    const updatePayload = {
      ...rowPayload,
      context_key: existingDraft.contextKey || rowPayload.context_key,
    }
    const { count, data, error } = await supabase
      .from('evaluation_drafts')
      .update(updatePayload, { count: 'exact' })
      .eq('id', existingDraft.id)
      .eq('created_by_user_id', user.id)
      .eq('status', SERVER_DRAFT_STATUS)
      .lt('client_save_version', requestRevision)
      .select('*')
      .maybeSingle()

    if (error) {
      if (isMissingServerDraftTableError(error)) {
        return null
      }

      console.error(error)
      throw error
    }

    if (data?.id) {
      return normalizeServerDraftRow(data)
    }

    const currentDraft = await findServerEvaluationDraftById({
      draftId: existingDraft.id,
      supabaseClient: supabase,
      user,
    })

    if (currentDraft?.id && currentDraft.clientSaveVersion >= requestRevision) {
      return {
        ...currentDraft,
        staleWrite: true,
      }
    }

    const persistenceError = new Error('The Development draft write did not persist.')
    persistenceError.code = count === 0 ? 'DRAFT_WRITE_ZERO_ROWS' : 'DRAFT_WRITE_NOT_PERSISTED'
    throw persistenceError
  }

  const { data, error } = await supabase
    .from('evaluation_drafts')
    .insert({
      ...rowPayload,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    if (isMissingServerDraftTableError(error)) {
      return null
    }

    if (error.code === '23505') {
      const duplicateDraft = await findServerEvaluationDraft({ context, supabaseClient: supabase, user })

      if (duplicateDraft?.id) {
        return saveServerEvaluationDraft({
          context,
          existingDraftContextKey: duplicateDraft.contextKey,
          existingDraftId: duplicateDraft.id,
          payload,
          supabaseClient: supabase,
          user,
        })
      }
    }

    console.error(error)
    throw error
  }

  return normalizeServerDraftRow(data)
}

export async function closeServerEvaluationDraft({ draftId = '', status = DRAFT_STATUSES.discarded, supabaseClient, user } = {}) {
  const normalizedDraftId = normalizeText(draftId)

  if (!user?.id || !normalizedDraftId) {
    return false
  }

  await blockServerDraftDemoMutation(user)

  const closingStatus = status === DRAFT_STATUSES.submitted ? 'submitted' : 'discarded'
  const closedAtColumn = closingStatus === 'submitted' ? 'submitted_at' : 'discarded_at'
  const supabase = await getSupabaseClient(supabaseClient)
  const now = new Date().toISOString()
  const { data: activeDraft, error: lookupError } = await supabase
    .from('evaluation_drafts')
    .select('id, club_id, team_id, player_id, created_by_user_id, status')
    .eq('id', normalizedDraftId)
    .eq('created_by_user_id', user.id)
    .eq('status', SERVER_DRAFT_STATUS)
    .maybeSingle()

  if (lookupError) {
    if (isMissingServerDraftTableError(lookupError)) {
      return false
    }

    console.error(lookupError)
    throw lookupError
  }

  if (!activeDraft?.id) {
    return false
  }

  let closeQuery = supabase
    .from('evaluation_drafts')
    .update({
      status: closingStatus,
      [closedAtColumn]: now,
      updated_at: now,
    }, { count: 'exact' })
    .eq('id', normalizedDraftId)
    .eq('created_by_user_id', user.id)
    .eq('status', SERVER_DRAFT_STATUS)
    .eq('club_id', activeDraft.club_id)

  closeQuery = activeDraft.team_id
    ? closeQuery.eq('team_id', activeDraft.team_id)
    : closeQuery.is('team_id', null)
  closeQuery = activeDraft.player_id
    ? closeQuery.eq('player_id', activeDraft.player_id)
    : closeQuery.is('player_id', null)

  const { count, error } = await closeQuery

  if (error) {
    if (isMissingServerDraftTableError(error)) {
      return false
    }

    console.error(error)
    throw error
  }

  return count === 1
}

export function clearPrivateEvaluationDraft({ draftId = '', storage, user } = {}) {
  const normalizedDraftId = normalizeText(draftId)

  if (!isDraftUserActive(user) || !normalizedDraftId) {
    return
  }

  const nextDrafts = readDrafts(storage).filter((draft) => (
    draft.id !== normalizedDraftId || !canAccessDraftScope({ scope: draft.scope, user })
  ))

  writeDrafts(nextDrafts, storage)
}

export function clearPrivateEvaluationDraftsForUser(user, { storage } = {}) {
  const accountId = normalizeText(user?.id)
  const resolvedStorage = getStorage(storage)

  if (!resolvedStorage || !accountId) {
    return
  }

  writeDrafts(
    readDrafts(resolvedStorage)
      .filter((draft) => normalizeText(draft?.scope?.accountId) !== accountId),
    resolvedStorage,
  )
}

export const PRIVATE_EVALUATION_DRAFT_STATUSES = DRAFT_STATUSES
