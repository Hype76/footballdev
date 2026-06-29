const PRIVATE_EVALUATION_DRAFTS_KEY = 'footballplayer:private-evaluation-drafts:v1'
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
    formType: normalizeText(context.formType) || 'development_record',
    playerId: normalizeText(context.playerId),
    playerName: normalizeText(context.playerName),
    section: normalizeText(context.section),
    session: normalizeText(context.session),
    teamId: normalizeText(context.teamId),
    teamName: normalizeText(context.teamName),
  }
}

function createDraftId(context) {
  return [
    'evaluation-draft',
    context.createdByUserId || 'unknown-user',
    context.clubId || 'platform',
    context.teamId || normalizeLowerText(context.teamName) || 'all',
    normalizeLowerText(context.playerName) || context.playerId || 'unassigned-player',
    context.editingEvaluationId || 'new',
  ]
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]+/g, '_'))
    .join(':')
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

function readDrafts(storage) {
  const resolvedStorage = getStorage(storage)

  if (!resolvedStorage) {
    return []
  }

  return parseDrafts(resolvedStorage.getItem(PRIVATE_EVALUATION_DRAFTS_KEY))
}

function writeDrafts(drafts, storage) {
  const resolvedStorage = getStorage(storage)

  if (!resolvedStorage) {
    return
  }

  resolvedStorage.setItem(PRIVATE_EVALUATION_DRAFTS_KEY, JSON.stringify(drafts))
}

function isOwnedActiveDraft(draft, user) {
  const ownerId = normalizeText(user?.id)
  const clubId = normalizeText(user?.clubId)

  return Boolean(
    draft?.id &&
      draft.status === DRAFT_STATUSES.active &&
      normalizeText(draft.createdByUserId) === ownerId &&
      (!clubId || normalizeText(draft.clubId) === clubId),
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
    payload: row.draft_data && typeof row.draft_data === 'object' ? row.draft_data : {},
    status: normalizeText(row.status) || SERVER_DRAFT_STATUS,
    lastSavedAt: row.last_saved_at ?? row.lastSavedAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

export function buildPrivateEvaluationDraftContext({ editingEvaluationId = '', formData = {}, user } = {}) {
  return normalizeDraftContext({
    clubId: user?.clubId,
    createdByUserId: user?.id,
    editingEvaluationId,
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
  const normalizedContext = normalizeDraftContext(context)
  const requestedPlayerName = normalizeLowerText(normalizedContext.playerName)
  const requestedTeamId = normalizeText(normalizedContext.teamId)
  const requestedTeamName = normalizeLowerText(normalizedContext.teamName)

  return readDrafts(storage)
    .filter((draft) => isOwnedActiveDraft(draft, user))
    .filter((draft) => {
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
  if (!user?.id || !hasPrivateEvaluationDraftContent(payload)) {
    return null
  }

  const normalizedContext = normalizeDraftContext({
    ...context,
    clubId: context.clubId || user.clubId,
    createdByUserId: user.id,
  })
  const drafts = readDrafts(storage)
  const draftId = normalizeText(existingDraftId) || createDraftId(normalizedContext)
  const now = new Date().toISOString()
  const existingDraft = drafts.find((draft) => draft.id === draftId)
  const nextDraft = {
    ...(existingDraft || {}),
    id: draftId,
    clubId: normalizedContext.clubId,
    context: normalizedContext,
    createdAt: existingDraft?.createdAt || now,
    createdByUserId: user.id,
    formType: normalizedContext.formType,
    payload,
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

  return {
    club_id: normalizedContext.clubId,
    team_id: normalizedContext.teamId || null,
    player_id: normalizedContext.playerId || null,
    created_by_user_id: user?.id,
    report_type: normalizedContext.formType,
    context_key: getEvaluationDraftContextKey(normalizedContext),
    draft_data: {
      ...payload,
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
  const { data, error } = await supabase
    .from('evaluation_drafts')
    .select('*')
    .eq('club_id', normalizedContext.clubId)
    .eq('created_by_user_id', user.id)
    .eq('report_type', normalizedContext.formType)
    .eq('context_key', getEvaluationDraftContextKey(normalizedContext))
    .eq('status', SERVER_DRAFT_STATUS)
    .order('last_saved_at', { ascending: false })
    .limit(1)
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

export async function saveServerEvaluationDraft({ context = {}, existingDraftId = '', payload = {}, supabaseClient, user } = {}) {
  if (!user?.id || !user?.clubId || !hasPrivateEvaluationDraftContent(payload)) {
    return null
  }

  await blockServerDraftDemoMutation(user)

  const supabase = await getSupabaseClient(supabaseClient)
  const rowPayload = createServerDraftRow({ context, payload, user })
  const normalizedDraftId = normalizeText(existingDraftId)
  const existingDraft = normalizedDraftId
    ? { id: normalizedDraftId }
    : await findServerEvaluationDraft({ context, supabaseClient: supabase, user })

  if (existingDraft?.id) {
    const { data, error } = await supabase
      .from('evaluation_drafts')
      .update(rowPayload)
      .eq('id', existingDraft.id)
      .eq('created_by_user_id', user.id)
      .eq('status', SERVER_DRAFT_STATUS)
      .select('*')
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
    })
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

  const { error } = await closeQuery

  if (error) {
    if (isMissingServerDraftTableError(error)) {
      return false
    }

    console.error(error)
    throw error
  }

  return true
}

export function clearPrivateEvaluationDraft({ draftId = '', status = DRAFT_STATUSES.discarded, storage, user } = {}) {
  const normalizedDraftId = normalizeText(draftId)

  if (!user?.id || !normalizedDraftId) {
    return
  }

  const nextDrafts = readDrafts(storage).map((draft) => {
    if (draft.id !== normalizedDraftId || normalizeText(draft.createdByUserId) !== normalizeText(user.id)) {
      return draft
    }

    return {
      ...draft,
      status: status === DRAFT_STATUSES.submitted ? DRAFT_STATUSES.submitted : DRAFT_STATUSES.discarded,
      updatedAt: new Date().toISOString(),
    }
  })

  writeDrafts(nextDrafts, storage)
}

export const PRIVATE_EVALUATION_DRAFT_STATUSES = DRAFT_STATUSES
