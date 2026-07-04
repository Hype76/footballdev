import {
  PLAYER_CONTACT_TYPES,
  formatParentContactEmails,
  formatParentContactNames,
  getClubSettings,
  normalizeParentContacts,
  normalizePlayerContactType,
} from '../../lib/supabase.js'
import { formatUkDate, formatUkDateTime, formatUkDateWords } from '../../lib/date-format.js'
import {
  EMAIL_TEMPLATE_AUDIENCES,
  DIRECT_EMAIL_TEMPLATE_SECTION,
  renderParentEmailTemplate,
} from '../../lib/email-templates.js'
import { buildAssessmentPdfHtml } from '../../lib/assessment-pdf-html.js'
import { buildProgressionEmailSections, getProgressionNumericFieldMap } from '../../lib/player-progression.js'

export const PROFILE_EVALUATION_PAGE_SIZE = 5
export const PLAYER_PROFILE_SOURCES = Object.freeze({
  history: 'history',
  squad: 'squad',
  trial: 'trial',
})

export function isNumericScore(value) {
  if (value === null || value === undefined || value === '') {
    return false
  }

  return !Number.isNaN(Number(value))
}

export function calculateMergedAverage(formResponses) {
  const numericValues = Object.values(formResponses ?? {})
    .filter(isNumericScore)
    .map(Number)

  if (numericValues.length === 0) {
    return null
  }

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
}

export function getDraftParentContacts(player) {
  const contacts = Array.isArray(player?.parentContacts) ? player.parentContacts : []
  const draftContacts = contacts.map((contact) => ({
    name: String(contact?.name ?? contact?.parentName ?? ''),
    email: String(contact?.email ?? contact?.parentEmail ?? ''),
    type: PLAYER_CONTACT_TYPES.parent,
  }))

  if (draftContacts.length > 0) {
    return draftContacts
  }

  const fallbackName = String(player?.parentName ?? '')
  const fallbackEmail = String(player?.parentEmail ?? '')

  return fallbackName || fallbackEmail
    ? [{ name: fallbackName, email: fallbackEmail, type: PLAYER_CONTACT_TYPES.parent }]
    : [{ name: '', email: '', type: PLAYER_CONTACT_TYPES.parent }]
}

export function getContactEmailAddresses(contact) {
  const emails = String(contact?.email ?? contact?.parentEmail ?? contact?.parent_email ?? '')
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean)
  const invalidEmails = emails.filter((email) => !isValidContactEmail(email))

  if (invalidEmails.length > 0) {
    throw new Error(`Check this contact email before sending: ${invalidEmails[0]}`)
  }

  return emails
}

export function getContactRecipientName(contact, fallbackName) {
  return String(contact?.name ?? '').trim() || String(fallbackName ?? '').trim() || 'Parent/Guardian'
}

export function isValidContactEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
}

export function getEmailReadyContactsForAudience(contacts, contactType) {
  const availableContacts = (Array.isArray(contacts) ? contacts : [])
    .filter((contact) => getContactEmailAddresses(contact).length > 0)
  const exactContacts = availableContacts.filter((contact) => contact.type === contactType)

  if (exactContacts.length > 0) {
    return exactContacts
  }

  return availableContacts
}

export function buildCommentsFromMergedResponses(formResponses) {
  const findResponse = (labels) => {
    const matchingEntry = Object.entries(formResponses ?? {}).find(([label]) =>
      labels.some((item) => label.toLowerCase().includes(item)),
    )

    return matchingEntry ? String(matchingEntry[1] ?? '').trim() : ''
  }

  return {
    strengths: findResponse(['strength']),
    improvements: findResponse(['improvement', 'weakness']),
    overall: findResponse(['overall', 'comment']),
  }
}

export function formatActivityDate(value) {
  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? 'No date entered' : formatUkDateTime(parsedDate.toISOString(), 'No date entered')
}

export function getActivityLabel(log) {
  const labels = {
    scored_pdf_downloaded: 'Report with scores downloaded',
    pdf_without_scores_downloaded: 'Report without scores downloaded',
    email_template_pdf_downloaded: 'Email template report downloaded',
    parent_email_sent: 'Parent email sent',
    next_assessment_reminder_set: 'Next assessment reminder set',
    staff_note_added: 'Staff note added',
    voice_note_added: 'Voice note added',
    invite_back_selected: 'Invite back selected',
    no_place_offered_selected: 'No place offered selected',
    offer_place_selected: 'Offer place selected',
  }

  return labels[log?.action] || String(log?.action ?? 'Activity').replaceAll('_', ' ')
}

export function buildEvaluationSummary(evaluation, mode = 'scored') {
  if (mode === 'email') {
    return (
      evaluation.comments?.overall ||
      evaluation.comments?.strengths ||
      evaluation.comments?.improvements ||
      'No written summary provided.'
    )
  }

  const responseEntries = Object.entries(evaluation.formResponses ?? {})

  if (responseEntries.length > 0) {
    return responseEntries
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')
  }

  return (
    evaluation.comments?.overall ||
    evaluation.comments?.strengths ||
    evaluation.comments?.improvements ||
    'No written summary provided.'
  )
}

export function formatTrendDate(evaluation) {
  if (evaluation.date) {
    return formatUkDateWords(evaluation.date, evaluation.date)
  }

  return evaluation.createdAt ? formatUkDateWords(evaluation.createdAt, 'No date entered') : 'No date entered'
}

function getHistoricalCutoffKey(currentDate = new Date()) {
  const parsedDate = currentDate instanceof Date ? currentDate : new Date(currentDate)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString().slice(0, 10)
}

function getEvaluationHistoryDateKey(evaluation) {
  const value = evaluation?.date || evaluation?.createdAt
  const parsedDate = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString().slice(0, 10)
}

function isHistoricalEvaluation(evaluation, cutoffKey) {
  if (!cutoffKey) {
    return true
  }

  const dateKey = getEvaluationHistoryDateKey(evaluation)
  return !dateKey || dateKey <= cutoffKey
}

export function buildRatingTrend(evaluations, { currentDate } = {}) {
  const cutoffKey = getHistoricalCutoffKey(currentDate)

  return [...evaluations]
    .filter((evaluation) => evaluation.averageScore !== null)
    .filter((evaluation) => isHistoricalEvaluation(evaluation, cutoffKey))
    .sort((left, right) => {
      const leftTime = new Date(left.date || left.createdAt).getTime()
      const rightTime = new Date(right.date || right.createdAt).getTime()
      return leftTime - rightTime
    })
}

export function buildFieldMovement(evaluations, fields = [], { currentDate } = {}) {
  const cutoffKey = getHistoricalCutoffKey(currentDate)
  const chronologicalEvaluations = [...evaluations]
    .filter((evaluation) => isHistoricalEvaluation(evaluation, cutoffKey))
    .sort((left, right) => {
      const leftTime = new Date(left.date || left.createdAt).getTime()
      const rightTime = new Date(right.date || right.createdAt).getTime()
      return leftTime - rightTime
    })
  const fieldValues = new Map()
  const numericFieldMap = getProgressionNumericFieldMap(fields)

  chronologicalEvaluations.forEach((evaluation) => {
    Object.entries(evaluation.formResponses ?? {}).forEach(([label, value]) => {
      if (!numericFieldMap.has(String(label ?? '').trim().toLowerCase())) {
        return
      }

      const numericValue = Number(value)

      if (!Number.isFinite(numericValue)) {
        return
      }

      if (!fieldValues.has(label)) {
        fieldValues.set(label, [])
      }

      fieldValues.get(label).push({
        dateLabel: formatTrendDate(evaluation),
        evaluationId: evaluation.id || '',
        value: numericValue,
      })
    })
  })

  return Array.from(fieldValues.entries())
    .map(([label, values]) => {
      const firstEntry = values[0]
      const latestEntry = values[values.length - 1]
      const previousEntry = values.length > 1 ? values[values.length - 2] : null
      const firstValue = firstEntry?.value
      const latestValue = latestEntry?.value

      return {
        label,
        firstValue,
        firstDateLabel: firstEntry?.dateLabel || 'No date entered',
        previousValue: previousEntry?.value ?? null,
        previousDateLabel: previousEntry?.dateLabel || '',
        latestValue,
        latestDateLabel: latestEntry?.dateLabel || 'No date entered',
        currentValue: latestValue,
        currentDateLabel: latestEntry?.dateLabel || 'No date entered',
        change: latestValue - firstValue,
        recordedCount: values.length,
      }
    })
    .filter((item) => item.firstValue !== undefined && item.latestValue !== undefined)
}

export function normalizePlayerProfileSource(source) {
  const normalizedSource = String(source ?? '').trim().toLowerCase()

  if (Object.values(PLAYER_PROFILE_SOURCES).includes(normalizedSource)) {
    return normalizedSource
  }

  return ''
}

export function isSavedPlayerProfileSource(source) {
  const normalizedSource = normalizePlayerProfileSource(source)
  return normalizedSource === PLAYER_PROFILE_SOURCES.squad || normalizedSource === PLAYER_PROFILE_SOURCES.trial
}

export function getExpectedPlayerProfileSection(source) {
  const normalizedSource = normalizePlayerProfileSource(source)

  if (normalizedSource === PLAYER_PROFILE_SOURCES.squad) {
    return 'Squad'
  }

  if (normalizedSource === PLAYER_PROFILE_SOURCES.trial) {
    return 'Trial'
  }

  return ''
}

function normalizeScopeValue(value) {
  return String(value ?? '').trim()
}

function normalizeScopeLabel(value) {
  return normalizeScopeValue(value).toLowerCase()
}

export function getPlayerProfileTeamScope({ routeTeamId = '', user } = {}) {
  return normalizeScopeValue(routeTeamId) || normalizeScopeValue(user?.activeTeamId)
}

export function requiresSavedPlayerTeamScope({
  players,
  profileSource,
  routePlayerId = '',
  routeTeamId = '',
  user,
} = {}) {
  if (!isSavedPlayerProfileSource(profileSource) || !normalizeScopeValue(routePlayerId)) {
    return false
  }

  if (getPlayerProfileTeamScope({ routeTeamId, user })) {
    return false
  }

  return (Array.isArray(players) ? players : []).some((player) => normalizeScopeValue(player?.teamId))
}

export function isPlayerInRequestedProfileScope(player, {
  profileSource,
  routePlayerId = '',
  routeTeamId = '',
  user,
} = {}) {
  if (!player) {
    return false
  }

  const expectedSection = getExpectedPlayerProfileSection(profileSource)
  const normalizedRoutePlayerId = normalizeScopeValue(routePlayerId)
  const normalizedRouteTeamId = getPlayerProfileTeamScope({ routeTeamId, user })
  const normalizedUserClubId = normalizeScopeValue(user?.clubId)
  const playerId = normalizeScopeValue(player.id)
  const playerClubId = normalizeScopeValue(player.clubId)
  const playerTeamId = normalizeScopeValue(player.teamId)

  if (normalizedRoutePlayerId && playerId !== normalizedRoutePlayerId) {
    return false
  }

  if (normalizedUserClubId && playerClubId && playerClubId !== normalizedUserClubId) {
    return false
  }

  if (expectedSection && normalizeScopeLabel(player.section) !== expectedSection.toLowerCase()) {
    return false
  }

  if (normalizedRouteTeamId) {
    return Boolean(playerTeamId) && playerTeamId === normalizedRouteTeamId
  }

  return true
}

export function getScopedProfilePlayers(players, scope = {}) {
  const availablePlayers = Array.isArray(players) ? players : []
  const normalizedRoutePlayerId = normalizeScopeValue(scope.routePlayerId)

  if (requiresSavedPlayerTeamScope({ ...scope, players: availablePlayers })) {
    return []
  }

  if (normalizedRoutePlayerId) {
    return availablePlayers.filter((player) => isPlayerInRequestedProfileScope(player, scope))
  }

  return getProfilePlayers(availablePlayers, { playerId: scope.routePlayerId })
    .filter((player) => isPlayerInRequestedProfileScope(player, scope))
}

export function getProfilePlayers(players, { playerId = '' } = {}) {
  const availablePlayers = Array.isArray(players) ? players : []
  const normalizedPlayerId = String(playerId ?? '').trim()

  if (normalizedPlayerId) {
    const matchedPlayer = availablePlayers.find((player) => String(player?.id ?? '').trim() === normalizedPlayerId)
    return matchedPlayer ? [matchedPlayer] : []
  }

  if (availablePlayers.length <= 1) {
    return availablePlayers
  }

  const squadPlayer = availablePlayers.find((player) => String(player.section ?? '').toLowerCase() === 'squad')
  return [squadPlayer ?? availablePlayers[0]]
}

export function isAmbiguousProfilePlayerSelection({ players, routePlayerId }) {
  const availablePlayers = Array.isArray(players) ? players : []
  return !String(routePlayerId ?? '').trim() && availablePlayers.length > 1
}

export function canUseProfilePlayerActions({ players, profilePlayers, routePlayerId }) {
  const resolvedPlayers = Array.isArray(profilePlayers) ? profilePlayers : []

  if (resolvedPlayers.length !== 1) {
    return false
  }

  return !isAmbiguousProfilePlayerSelection({ players, routePlayerId })
}

export function getPlayerDetailsEmptyState({
  profileSource,
  routePlayerId,
  isScopeMismatch = false,
  isTeamScopeMissing = false,
} = {}) {
  if (isTeamScopeMissing) {
    return {
      action: 'Refresh the player list and open this saved player again from the selected team.',
      body: 'This saved player link is missing team scope, so the profile will not guess which team record to manage.',
      eyebrow: 'Team scope missing',
      title: 'Saved player team scope is incomplete.',
    }
  }

  if (isScopeMismatch) {
    return {
      action: 'Refresh the player list and open this player from the selected team again.',
      body: 'This player record could not be matched to the selected team.',
      eyebrow: 'Scoped player mismatch',
      title: 'Selected team player could not be matched.',
    }
  }

  if (isSavedPlayerProfileSource(profileSource) && !String(routePlayerId ?? '').trim()) {
    return {
      action: 'Refresh the player list and open this saved player again before changing saved details.',
      body: 'This Squad or Trial link is missing the saved player id, so the profile will not guess by name.',
      eyebrow: 'Saved player link',
      title: 'Saved player link is incomplete.',
    }
  }

  if (isSavedPlayerProfileSource(profileSource)) {
    return {
      action: 'Refresh the player list and open this player again before changing saved details.',
      body: 'This Squad or Trial link points to a saved player record that is no longer available.',
      eyebrow: 'Saved player unavailable',
      title: 'Saved player record could not be found.',
    }
  }

  return {
    action: 'Add the player to Trial or Squad so this profile has one saved football record to manage.',
    body: 'This profile was opened from development history. Team, parent contacts, positions, and section rules need a saved player record.',
    eyebrow: 'Profile setup',
    title: 'Saved player details are not attached yet.',
  }
}

export function getPlayerProfileResolutionDiagnostics({
  isLoading = false,
  players,
  profilePlayers,
  profileSource,
  routePlayerId,
  routePlayerName,
  routeTeamId = '',
  user,
  shouldLoadSavedPlayerById = false,
} = {}) {
  const normalizedSource = normalizePlayerProfileSource(profileSource)
  const normalizedPlayerId = String(routePlayerId ?? '').trim()
  const normalizedTeamId = getPlayerProfileTeamScope({ routeTeamId, user })
  const isSavedSource = isSavedPlayerProfileSource(normalizedSource)
  const resolvedPlayers = Array.isArray(profilePlayers) ? profilePlayers : []
  const lookupRows = Array.isArray(players) ? players : []
  const isTeamScopeMissing = requiresSavedPlayerTeamScope({
    players: lookupRows,
    profileSource: normalizedSource,
    routePlayerId: normalizedPlayerId,
    routeTeamId,
    user,
  })
  const lookupMode = shouldLoadSavedPlayerById ? 'saved-player-id' : isSavedSource ? 'saved-player-missing-id' : 'player-name'
  let missingStateBranch = 'development-history-missing-details'

  if (resolvedPlayers.length > 0) {
    missingStateBranch = 'resolved-saved-player'
  } else if (shouldLoadSavedPlayerById && isLoading) {
    missingStateBranch = 'saved-player-id-loading'
  } else if (isTeamScopeMissing) {
    missingStateBranch = 'saved-player-team-scope-missing'
  } else if (shouldLoadSavedPlayerById && lookupRows.length > 0) {
    missingStateBranch = 'saved-player-scope-mismatch'
  } else if (shouldLoadSavedPlayerById) {
    missingStateBranch = 'saved-player-id-not-found'
  } else if (isSavedSource) {
    missingStateBranch = 'saved-player-id-missing'
  }

  return {
    lookupMode,
    lookupResultCount: lookupRows.length,
    missingStateBranch,
    playerId: normalizedPlayerId,
    routePlayerName: String(routePlayerName ?? '').trim(),
    source: normalizedSource,
    teamId: normalizedTeamId,
  }
}

export function getProfileContactDetails({ primaryPlayer, evaluations }) {
  const profileParentName = primaryPlayer?.parentName || evaluations.find((evaluation) => evaluation.parentName)?.parentName || ''
  const profileParentEmail = primaryPlayer?.parentEmail || evaluations.find((evaluation) => evaluation.parentEmail)?.parentEmail || ''
  const profileContactType = normalizePlayerContactType(
    primaryPlayer?.contactType || evaluations.find((evaluation) => evaluation.contactType)?.contactType,
  )
  const profileParentContacts = normalizeParentContacts(primaryPlayer?.parentContacts, {
    parentName: profileParentName,
    parentEmail: profileParentEmail,
    contactType: profileContactType,
  })

  return {
    profileContactType,
    profileParentContacts,
    profileParentEmail,
    profileParentName,
  }
}

export function getReassignPlayerOptions(allPlayers, routePlayerName) {
  return allPlayers
    .filter((player) => {
      const playerName = String(player.playerName ?? '').trim()
      return player.id && playerName && playerName.toLowerCase() !== routePlayerName.toLowerCase()
    })
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
}

export function getMergeFieldLabels(mergeSelectedEvaluations) {
  return Array.from(
    new Set(
      mergeSelectedEvaluations.flatMap((evaluation) => Object.keys(evaluation.formResponses ?? {})),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

export function buildMergeDetailFields(routePlayerName) {
  return [
    {
      key: 'player',
      label: 'Player, team, and section',
      preview: (evaluation) =>
        `${evaluation?.playerName || routePlayerName} | ${evaluation?.team || 'No team entered'} | ${evaluation?.section || 'Trial'}`,
    },
    {
      key: 'parents',
      label: 'Contact details',
      preview: (evaluation) =>
        formatParentContactNames(evaluation?.parentContacts, evaluation?.parentName) ||
        formatParentContactEmails(evaluation?.parentContacts, evaluation?.parentEmail) ||
        'No contact details entered',
    },
    {
      key: 'session',
      label: 'Session',
      preview: (evaluation) => evaluation?.session || 'No session entered',
    },
    {
      key: 'date',
      label: 'Date',
      preview: (evaluation) => evaluation?.date || 'No date entered',
    },
    {
      key: 'coach',
      label: 'Coach shown on report',
      preview: (evaluation) => evaluation?.coach || 'No coach entered',
    },
    {
      key: 'comments',
      label: 'Comments',
      preview: (evaluation) => {
        const comments = evaluation?.comments ?? {}
        return [comments.strengths, comments.improvements, comments.overall]
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
          .join(' | ') || 'No comments entered'
      },
    },
    {
      key: 'status',
      label: 'Status',
      preview: (evaluation) => evaluation?.status || 'Submitted',
    },
  ]
}

export function buildMergePreviewResponses({
  mergeCoreSource,
  mergeFieldLabels,
  mergeFieldSources,
  mergeSelectedEvaluations,
}) {
  return Object.fromEntries(
    mergeFieldLabels.map((label) => {
      const sourceId =
        mergeFieldSources[label] ||
        mergeSelectedEvaluations.find((evaluation) =>
          Object.prototype.hasOwnProperty.call(evaluation.formResponses ?? {}, label),
        )?.id ||
        mergeCoreSource?.id ||
        mergeSelectedEvaluations[0]?.id
      const sourceEvaluation =
        mergeSelectedEvaluations.find((evaluation) => evaluation.id === sourceId) ?? mergeSelectedEvaluations[0]

      return [label, sourceEvaluation?.formResponses?.[label] ?? '']
    }),
  )
}

export function buildMergedEvaluationPayload({
  getMergeDetailSource,
  mergeCoreSource,
  mergePreviewAverage,
  mergePreviewResponses,
  mergeSelectedEvaluations,
  primaryPlayer,
  routePlayerName,
  user,
}) {
  const mergedResponses = mergePreviewResponses
  const mergedScores = Object.fromEntries(
    Object.entries(mergedResponses)
      .filter(([, value]) => isNumericScore(value))
      .map(([label, value]) => [label, Number(value)]),
  )
  const playerSource = getMergeDetailSource('player')
  const parentSource = getMergeDetailSource('parents')
  const sessionSource = getMergeDetailSource('session')
  const dateSource = getMergeDetailSource('date')
  const coachSource = getMergeDetailSource('coach')
  const commentsSource = getMergeDetailSource('comments')
  const statusSource = getMergeDetailSource('status')
  const parentContacts = normalizeParentContacts(parentSource?.parentContacts, {
    parentName: parentSource?.parentName,
    parentEmail: parentSource?.parentEmail,
  })
  const mergedComments = commentsSource?.comments ?? buildCommentsFromMergedResponses(mergedResponses)

  return {
    playerId: playerSource?.playerId || primaryPlayer?.id || mergeCoreSource.playerId,
    playerName: playerSource?.playerName || routePlayerName,
    teamId: playerSource?.teamId || primaryPlayer?.teamId || mergeCoreSource.teamId,
    team: playerSource?.team || primaryPlayer?.team || mergeCoreSource.team,
    section: playerSource?.section || primaryPlayer?.section || mergeCoreSource.section,
    clubId: user.clubId,
    coachId: user.id,
    coach: String(coachSource?.coach || user.username || user.name || user.email || '').trim(),
    createdByName: String(user.username || user.name || user.email || '').trim(),
    createdByEmail: String(user.email || '').trim().toLowerCase(),
    updatedBy: user.id,
    updatedByName: String(user.username || user.name || user.email || '').trim(),
    updatedByEmail: String(user.email || '').trim().toLowerCase(),
    parentName: parentContacts[0]?.name ?? mergeCoreSource.parentName ?? '',
    parentEmail: parentContacts[0]?.email ?? mergeCoreSource.parentEmail ?? '',
    parentContacts,
    session: sessionSource?.session || `Merged assessment from ${mergeSelectedEvaluations.length} reports`,
    date: dateSource?.date || formatUkDate(new Date().toISOString().slice(0, 10)),
    scores: mergedScores,
    averageScore: mergePreviewAverage,
    comments: mergedComments,
    formResponses: mergedResponses,
    decision: mergeCoreSource.decision,
    status: statusSource?.status || mergeCoreSource.status || 'Submitted',
    rejectionReason: statusSource?.rejectionReason || '',
    reviewedBy: statusSource?.reviewedBy || null,
    reviewedAt: statusSource?.reviewedAt || null,
    createdAt: new Date().toISOString(),
  }
}

export async function getLatestClubLogoUrl(user) {
  if (!user?.clubId) {
    return user?.clubLogoUrl || ''
  }

  try {
    const clubSettings = await getClubSettings(user.clubId)
    return clubSettings.logoUrl || user.clubLogoUrl || ''
  } catch (error) {
    console.error(error)
    return user.clubLogoUrl || ''
  }
}

export function getEditableParentContacts(player) {
  const contacts = normalizeParentContacts(player?.parentContacts, {
    parentName: player?.parentName,
    parentEmail: player?.parentEmail,
  })

  const parentContacts = contacts.map((contact) => ({
    ...contact,
    type: 'parent',
  }))

  return parentContacts.length > 0 ? parentContacts : [{ name: '', email: '', type: 'parent' }]
}

export function createPlayerDraft(player) {
  return {
    ...player,
    contactType: 'parent',
    parentContacts: getEditableParentContacts(player),
  }
}

export function startEditingPlayerDraft(currentDrafts, player) {
  return {
    ...currentDrafts,
    [player.id]: createPlayerDraft(currentDrafts[player.id] ?? player),
  }
}

export function buildPlayerProfileCachePayload({ evaluations, players, allPlayers }) {
  return {
    evaluations,
    players,
    ...(allPlayers ? { allPlayers } : {}),
  }
}

export function removeEvaluationIdFromSelection(currentIds, evaluationId) {
  return currentIds.filter((id) => id !== evaluationId)
}

export function getRemainingMergeCoreSourceId(currentSourceId, evaluationId) {
  return currentSourceId === evaluationId ? '' : currentSourceId
}

export function updatePlayerDraftValue(currentDrafts, playerId, fieldName, value) {
  return {
    ...currentDrafts,
    [playerId]: {
      ...currentDrafts[playerId],
      [fieldName]: fieldName === 'playerName' ? String(value ?? '') : value,
    },
  }
}

export function updateParentContactDraft(currentDrafts, playerId, index, fieldName, value) {
  const draft = currentDrafts[playerId] ?? {}
  const contacts = Array.isArray(draft.parentContacts) && draft.parentContacts.length > 0
    ? draft.parentContacts
    : [{ name: draft.parentName || '', email: draft.parentEmail || '', type: PLAYER_CONTACT_TYPES.parent }]
  const nextContacts = contacts.length > 0 ? contacts : [{ name: '', email: '', type: PLAYER_CONTACT_TYPES.parent }]
  const updatedContacts = nextContacts.map((contact, contactIndex) =>
    contactIndex === index
      ? {
          ...contact,
          type: PLAYER_CONTACT_TYPES.parent,
          [fieldName]: value,
        }
      : { ...contact, type: PLAYER_CONTACT_TYPES.parent },
  )

  return {
    ...currentDrafts,
    [playerId]: {
      ...draft,
      parentName: updatedContacts[0]?.name ?? '',
      parentEmail: updatedContacts[0]?.email ?? '',
      parentContacts: updatedContacts,
    },
  }
}

export function addParentContactDraft(currentDrafts, playerId) {
  const draft = currentDrafts[playerId] ?? {}
  const contacts = Array.isArray(draft.parentContacts) && draft.parentContacts.length > 0
    ? draft.parentContacts
    : [{ name: draft.parentName || '', email: draft.parentEmail || '', type: PLAYER_CONTACT_TYPES.parent }]

  return {
    ...currentDrafts,
    [playerId]: {
      ...draft,
      parentContacts: [
        ...contacts.map((contact) => ({ ...contact, type: PLAYER_CONTACT_TYPES.parent })),
        { name: '', email: '', type: PLAYER_CONTACT_TYPES.parent },
      ],
    },
  }
}

export function removeParentContactDraft(currentDrafts, playerId, index) {
  const draft = currentDrafts[playerId] ?? {}
  const contacts = Array.isArray(draft.parentContacts) && draft.parentContacts.length > 0
    ? draft.parentContacts
    : [{ name: draft.parentName || '', email: draft.parentEmail || '', type: PLAYER_CONTACT_TYPES.parent }]
  const nextContacts = contacts.filter((_, contactIndex) => contactIndex !== index)
  const fallbackContacts = nextContacts.length > 0 ? nextContacts : [{ name: '', email: '', type: PLAYER_CONTACT_TYPES.parent }]

  return {
    ...currentDrafts,
    [playerId]: {
      ...draft,
      parentName: fallbackContacts[0]?.name ?? '',
      parentEmail: fallbackContacts[0]?.email ?? '',
      parentContacts: fallbackContacts.map((contact) => ({ ...contact, type: PLAYER_CONTACT_TYPES.parent })),
    },
  }
}

export function addPlayerPositionDraft(currentDrafts, playerId, nextPosition) {
  return {
    ...currentDrafts,
    [playerId]: {
      ...currentDrafts[playerId],
      positions: [...new Set([...(currentDrafts[playerId]?.positions ?? []), nextPosition])],
      positionDraft: '',
    },
  }
}

export function removePlayerPositionDraft(currentDrafts, playerId, positionToRemove) {
  return {
    ...currentDrafts,
    [playerId]: {
      ...currentDrafts[playerId],
      positions: (currentDrafts[playerId]?.positions ?? []).filter((position) => position !== positionToRemove),
    },
  }
}

export function buildPlayerProfileParentEmailPayload({
  evaluation,
  getContactTemplateAudiences,
  getEmailTemplateKey,
  getEvaluationContactType,
  getSelectedEmailTemplate,
  getSelectedEvaluationParentContacts,
  getSelectedExportResponseItems,
  getSelectedInviteDate,
  progressionData,
  profileParentName,
  routePlayerName,
  selectedEmailSections,
  selectedEmailTemplates,
  user,
}) {
  const selectedContacts = getSelectedEvaluationParentContacts(evaluation)
  const selectedKey = selectedEmailTemplates[evaluation.id] || getEmailTemplateKey(evaluation.decision)
  const inviteDate = getSelectedInviteDate(evaluation)
  const responses = getSelectedExportResponseItems(evaluation)
  const progressionSections = buildProgressionEmailSections({
    progressionData,
    sections: selectedEmailSections,
  })
  const payloads = getContactTemplateAudiences(getEvaluationContactType(evaluation))
    .flatMap((audience) => {
      const contactType = audience === EMAIL_TEMPLATE_AUDIENCES.player ? PLAYER_CONTACT_TYPES.self : PLAYER_CONTACT_TYPES.parent
      const contacts = getEmailReadyContactsForAudience(selectedContacts, contactType)

      if (contacts.length === 0) {
        return []
      }

      const selectedTemplate = getSelectedEmailTemplate(evaluation, audience)

      if (!selectedTemplate) {
        throw new Error(`Create a ${audience} email template before sending an email.`)
      }

      return contacts.flatMap((contact) =>
        getContactEmailAddresses(contact).map((recipientEmail) => {
          const recipientName = getContactRecipientName(
            contact,
            contactType === PLAYER_CONTACT_TYPES.self ? routePlayerName : evaluation.parentName || profileParentName,
          )
          const emailTemplate = renderParentEmailTemplate(selectedTemplate, {
            recipientName,
            parentName: recipientName,
            playerName: routePlayerName,
            coachName: evaluation.coach,
            clubName: user?.clubName,
            teamName: evaluation.team,
            session: evaluation.session,
            inviteDate,
            summary: '',
            templateKey: selectedTemplate.key,
          })

          return {
            audience,
            recipientEmails: recipientEmail,
            recipientNames: recipientName,
            templateName: selectedTemplate.label,
            selectedTemplate,
            payload: {
              clubId: user?.clubId,
              userId: user?.id,
              parentEmail: recipientEmail,
              parentName: recipientName,
              senderEmail: user?.email,
              displayName: user?.displayName || user?.username || user?.name,
              team: user?.emailTeamName || evaluation.team,
              club: user?.emailClubName || user?.clubName,
              section: evaluation.section,
              session: evaluation.session,
              planKey: user?.planKey,
              logoUrl: user?.clubLogoUrl || null,
              replyToEmail: user?.replyToEmail || user?.clubContactEmail,
              clubContactEmail: user?.clubContactEmail,
              playerName: routePlayerName,
              summary: '',
              responses,
              emailSections: progressionSections,
              subject: emailTemplate.subject,
              emailBody: emailTemplate.body,
              pdfHtml: buildAssessmentPdfHtml({
                clubName: user?.emailClubName || user?.clubName,
                playerName: routePlayerName,
                teamName: user?.emailTeamName || evaluation.team,
                section: evaluation.section,
                session: evaluation.session,
                logoUrl: user?.clubLogoUrl || null,
                responseItems: responses,
                emailSections: progressionSections,
              }),
              evaluationId: evaluation.id,
            },
          }
        }),
      )
    })
    .filter(Boolean)

  if (payloads.length === 0) {
    throw new Error('Add an email contact before sending.')
  }

  return {
    evaluation,
    inviteDate,
    recipientEmails: payloads.map((item) => item.recipientEmails).join(','),
    recipientNames: payloads.map((item) => item.recipientNames).join(', '),
    responses,
    emailSections: progressionSections,
    templateKey: selectedKey,
    templateName: payloads.map((item) => item.templateName).join(', '),
    usesDefaultTemplate: payloads.some((item) => item.selectedTemplate?.isDefaultTemplate),
    payloads,
  }
}

export function buildPlayerDirectEmailPayload({
  audience,
  contacts,
  inviteDate = '',
  player,
  responses = [],
  progressionData = null,
  routePlayerName,
  selectedEmailSections = null,
  selectedTemplate,
  sourceEvaluation = null,
  user,
}) {
  if (!selectedTemplate) {
    throw new Error('Choose an email template before sending.')
  }

  const playerName = String(player?.playerName || routePlayerName || '').trim()
  const teamName = String(player?.team || user?.activeTeamName || '').trim()
  const section = String(player?.section || sourceEvaluation?.section || '').trim() || DIRECT_EMAIL_TEMPLATE_SECTION
  const session = sourceEvaluation?.session || ''
  const responseItems = Array.isArray(responses) ? responses : []
  const summary = sourceEvaluation ? buildEvaluationSummary(sourceEvaluation, 'email') : ''
  const progressionSections = progressionData
    ? buildProgressionEmailSections({
        progressionData,
        sections: selectedEmailSections,
      })
    : []
  const contactType = audience === EMAIL_TEMPLATE_AUDIENCES.player ? PLAYER_CONTACT_TYPES.self : PLAYER_CONTACT_TYPES.parent
  const selectedContacts = getEmailReadyContactsForAudience(contacts, contactType)
  const payloads = selectedContacts
    .flatMap((contact) =>
      getContactEmailAddresses(contact).map((recipientEmail) => {
        const recipientName = getContactRecipientName(
          contact,
          contactType === PLAYER_CONTACT_TYPES.self ? playerName : player?.parentName,
        )
        const emailTemplate = renderParentEmailTemplate(selectedTemplate, {
          recipientName,
          parentName: recipientName,
          playerName,
          coachName: user?.displayName || user?.username || user?.name || user?.email,
          clubName: user?.clubName,
          teamName,
          session,
          inviteDate,
          summary,
          templateKey: selectedTemplate.key,
        })

        return {
          audience,
          recipientEmails: recipientEmail,
          recipientNames: recipientName,
          templateName: selectedTemplate.label,
          payload: {
            clubId: user?.clubId,
            userId: user?.id,
            parentEmail: recipientEmail,
            parentName: recipientName,
            senderEmail: user?.email,
            displayName: user?.displayName || user?.username || user?.name,
            team: user?.emailTeamName || teamName,
            club: user?.emailClubName || user?.clubName,
            section,
            session,
            inviteDate,
            planKey: user?.planKey,
            logoUrl: user?.clubLogoUrl || null,
            replyToEmail: user?.replyToEmail || user?.clubContactEmail,
            clubContactEmail: user?.clubContactEmail,
            playerName,
            summary,
            responses: responseItems,
            emailSections: progressionSections,
            subject: emailTemplate.subject,
            emailBody: emailTemplate.body,
            pdfHtml: buildAssessmentPdfHtml({
              clubName: user?.emailClubName || user?.clubName,
              playerName,
              teamName: user?.emailTeamName || teamName,
              section,
              session,
              logoUrl: user?.clubLogoUrl || null,
              responseItems,
              emailSections: progressionSections,
            }),
            evaluationId: sourceEvaluation?.id || null,
          },
          selectedTemplate,
        }
      }),
    )
    .filter(Boolean)

  if (payloads.length === 0) {
    throw new Error('Add an email contact before sending.')
  }

  return {
    evaluation: {
      id: `direct:${player?.id || playerName}`,
      isDirectEmail: true,
      playerId: player?.id || '',
      sourceEvaluationId: sourceEvaluation?.id || '',
      section,
      team: teamName,
    },
    inviteDate,
    recipientEmails: payloads.map((item) => item.recipientEmails).join(','),
    recipientNames: payloads.map((item) => item.recipientNames).join(', '),
    responses: responseItems,
    emailSections: progressionSections,
    templateKey: selectedTemplate.key,
    templateName: selectedTemplate.label,
    usesDefaultTemplate: Boolean(selectedTemplate.isDefaultTemplate),
    payloads,
  }
}

export function getNextEvaluationParentContactIndexes({ contacts, currentIndexes = [], index }) {
  const fallbackIndexes = contacts.map((_, contactIndex) => contactIndex)
  const activeIndexes = currentIndexes.length > 0 ? currentIndexes : fallbackIndexes

  if (activeIndexes.includes(index)) {
    const nextIndexes = activeIndexes.filter((item) => item !== index)
    return nextIndexes.length > 0 ? nextIndexes : [index]
  }

  return [...activeIndexes, index].sort((left, right) => left - right)
}

export function buildReassignedEvaluationPayload({ evaluation, targetPlayer, targetParentContacts, user }) {
  return {
    ...evaluation,
    playerId: targetPlayer.id,
    playerName: targetPlayer.playerName,
    section: targetPlayer.section || evaluation.section,
    team: targetPlayer.team || evaluation.team,
    parentName: targetParentContacts[0]?.name ?? targetPlayer.parentName ?? '',
    parentEmail: targetParentContacts[0]?.email ?? targetPlayer.parentEmail ?? '',
    parentContacts: targetParentContacts,
    updatedBy: user?.id,
    updatedByName: String(user?.username || user?.name || user?.email || '').trim(),
    updatedByEmail: String(user?.email || '').trim().toLowerCase(),
  }
}

export function clearEvaluationIdFromSourceMap(sourceMap, evaluationId) {
  return Object.fromEntries(Object.entries(sourceMap).filter(([, sourceId]) => sourceId !== evaluationId))
}

export function keepOnlySelectedSourceIds(sourceMap, selectedIds) {
  return Object.fromEntries(Object.entries(sourceMap).filter(([, sourceId]) => selectedIds.includes(sourceId)))
}
