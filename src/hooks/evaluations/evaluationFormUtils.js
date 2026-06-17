import { getClubSettings } from '../../lib/supabase.js'
import { formatUkDate } from '../../lib/date-format.js'
import {
  EMAIL_TEMPLATE_AUDIENCES,
  normalizeEmailTemplateAudience,
  renderParentEmailTemplate,
} from '../../lib/email-templates.js'
import { sendParentEmail } from '../../lib/email-builder.js'
import { buildAssessmentPdfHtml } from '../../lib/assessment-pdf-html.js'
import {
  formatDefaultAssessmentScoreForParent,
  isAssessmentScoreFieldType,
  isDefaultAssessmentScoreLabel,
  isDefaultAssessmentScoreValue,
} from '../../lib/assessment-scoring.js'

export function createLocalId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function isNetworkError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return !navigator.onLine || message.includes('failed to fetch') || message.includes('network')
}

export function mapEvaluationResponsesToFieldValues(fields, formResponses = {}) {
  return Object.fromEntries(
    fields.map((field) => [field.id, formResponses[field.label] ?? '']),
  )
}

function normalizeAssessmentLabel(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function getContactEmailAddresses(contact) {
  return String(contact?.email ?? '')
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean)
}

export function getContactRecipientName(contact, fallbackName) {
  return String(contact?.name ?? '').trim() || String(fallbackName ?? '').trim() || 'Parent/Guardian'
}

function isEnteredAssessmentValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).length > 0
  }

  return String(value ?? '').trim() !== ''
}

function formatAssessmentValue(label, value) {
  if (isDefaultAssessmentScoreLabel(label) && isDefaultAssessmentScoreValue(value)) {
    return formatDefaultAssessmentScoreForParent(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ')
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }

  return String(value ?? '').trim() || 'No data entered'
}

export function buildPreviousAssessmentItems(evaluation) {
  const items = []
  const usedLabels = new Set()

  const addItem = (label, value) => {
    const cleanLabel = String(label ?? '').trim()

    if (!cleanLabel) {
      return
    }

    const normalizedLabel = normalizeAssessmentLabel(cleanLabel)

    if (usedLabels.has(normalizedLabel)) {
      return
    }

    usedLabels.add(normalizedLabel)
    items.push({
      label: cleanLabel,
      value: isEnteredAssessmentValue(value) ? formatAssessmentValue(cleanLabel, value) : 'No data entered',
    })
  }

  Object.entries(evaluation.formResponses ?? {}).forEach(([label, value]) => {
    addItem(label, value)
  })

  Object.entries(evaluation.scores ?? {}).forEach(([label, value]) => {
    addItem(label, value)
  })

  const comments = evaluation.comments && typeof evaluation.comments === 'object' ? evaluation.comments : {}
  addItem('Strengths', comments.strengths)
  addItem('Improvements', comments.improvements)
  addItem('Overall Comments', comments.overall)

  return items
}

export function createInitialFormData(user, defaults = {}) {
  return {
    team: '',
    section: 'Trial',
    session: '',
    coachName: user?.name || '',
    playerName: '',
    parentName: '',
    parentEmail: '',
    parentContacts: [],
    contactType: 'parent',
    ...defaults,
  }
}

export function getDraftStorageKey(user) {
  if (!user?.id) {
    return ''
  }

  return `create-evaluation-draft:${user.id}:${user.clubId || 'platform'}:${user.activeTeamId || user.activeTeamName || 'all'}`
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

export function normalizePlayerName(value) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function createEmptyResponseValues(fields) {
  return Object.fromEntries(fields.map((field) => [field.id, '']))
}

export function isScoreFieldType(fieldType) {
  return isAssessmentScoreFieldType(fieldType)
}

export function normalizeResponseValue(field, value) {
  if (isScoreFieldType(field.type)) {
    const numericValue = Number(value)
    return Number.isNaN(numericValue) ? '' : numericValue
  }

  return String(value ?? '').trim()
}

export function buildFormResponses(fields, responseValues) {
  return Object.fromEntries(
    fields
      .map((field) => [field.label, normalizeResponseValue(field, responseValues[field.id])])
      .filter(([, value]) => value !== ''),
  )
}

export function buildScores(formResponses) {
  return Object.fromEntries(
    Object.entries(formResponses).filter(([, value]) => typeof value === 'number' && !Number.isNaN(value)),
  )
}

export function buildComments(formResponses) {
  const entries = Object.entries(formResponses)
  const findResponse = (patterns) =>
    entries.find(([label]) => patterns.some((pattern) => label.toLowerCase().includes(pattern)))?.[1] ?? ''

  return {
    strengths: String(findResponse(['strength']))?.trim() || '',
    improvements: String(findResponse(['improvement', 'weakness', 'development']))?.trim() || '',
    overall: String(findResponse(['overall', 'summary', 'comment']))?.trim() || '',
    selectedStrengths: [],
  }
}

export function getAverageScore(formResponses) {
  const values = Object.values(formResponses)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value))

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function createResponseItems(fields, responseValues, includeEmptyValues = false) {
  return fields
    .map((field) => {
      const value = normalizeResponseValue(field, responseValues[field.id])

      if (!includeEmptyValues && !isExportableResponseValue(value)) {
        return null
      }

      return {
        fieldType: field.type,
        isDefault: Boolean(field.isDefault),
        label: field.label,
        value,
      }
    })
    .filter(Boolean)
}

export function sortResponseItemsByValueType(items = []) {
  return [...items].sort((left, right) => {
    const leftIsNumber = typeof left?.value === 'number' && !Number.isNaN(left.value)
    const rightIsNumber = typeof right?.value === 'number' && !Number.isNaN(right.value)

    if (leftIsNumber === rightIsNumber) {
      return 0
    }

    return leftIsNumber ? -1 : 1
  })
}

export function isExportableResponseValue(value) {
  if (typeof value === 'number') {
    return !Number.isNaN(value) && value !== 0
  }

  const trimmedValue = String(value ?? '').trim()
  return trimmedValue !== '' && trimmedValue !== '0'
}

export function parseStoredDraft(storageKey) {
  if (!storageKey) {
    return null
  }

  try {
    const storedValue = sessionStorage.getItem(storageKey)

    if (!storedValue) {
      return null
    }

    const parsedValue = JSON.parse(storedValue)
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null
  } catch (error) {
    console.error(error)
    return null
  }
}

export function normalizeSessionValue(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return parsedDate.toISOString().slice(0, 10)
}

export function normalizeOptionalUuid(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue || ['null', 'undefined', 'none'].includes(normalizedValue.toLowerCase())) {
    return ''
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedValue)
    ? normalizedValue
    : ''
}

export function formatSessionForInput(value) {
  const normalizedValue = normalizeSessionValue(value)

  if (!normalizedValue) {
    return ''
  }

  return normalizedValue
}

export function formatSessionForDisplay(value) {
  const normalizedValue = normalizeSessionValue(value)

  if (!normalizedValue) {
    return 'Not scheduled'
  }

  return formatUkDate(normalizedValue, 'Not scheduled')
}

export function parseAssessmentQueue(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(normalizedValue)
    return Array.isArray(parsedValue)
      ? parsedValue.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
  } catch {
    return normalizedValue
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean)
  }
}

export function buildPreviewSummary({ comments, formResponses }) {
  const responseEntries = Object.entries(formResponses ?? {})

  if (responseEntries.length > 0) {
    return responseEntries
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')
  }

  return comments?.overall || comments?.strengths || comments?.improvements || 'No written summary provided.'
}

export function findSavedPlayerForEvaluation(savedPlayers, playerName, team = '', teamId = '') {
  const normalizedPlayerName = normalizePlayerName(playerName)
  const normalizedTeam = String(team ?? '').trim()
  const normalizedTeamId = String(teamId ?? '').trim()
  const sameNamePlayers = savedPlayers.filter((player) => normalizePlayerName(player.playerName) === normalizedPlayerName)

  return (
    sameNamePlayers.find((player) => normalizedTeamId && String(player.teamId ?? '').trim() === normalizedTeamId) ||
    sameNamePlayers.find((player) => !normalizedTeam || player.team === normalizedTeam) ||
    sameNamePlayers[0]
  )
}

export function createEvaluationPayload({
  assessmentSessionId,
  availableTeams,
  averageScore,
  comments,
  editingEvaluation,
  formData,
  formResponses,
  id,
  normalizedContactType,
  parentContacts,
  savedPlayers,
  scores,
  user,
}) {
  const normalizedPlayerName = normalizePlayerName(formData.playerName)
  const matchingTeam = availableTeams.find((team) => team.name === String(formData.team).trim())
  const matchingPlayer = findSavedPlayerForEvaluation(savedPlayers, normalizedPlayerName, formData.team, matchingTeam?.id)
  const normalizedAssessmentSessionId = normalizeOptionalUuid(assessmentSessionId)
  const normalizedId = normalizeOptionalUuid(editingEvaluation?.id || id)

  return {
    ...(editingEvaluation || {}),
    ...(normalizedId ? { id: normalizedId } : {}),
    playerName: normalizedPlayerName,
    playerId: matchingPlayer?.id || '',
    team: String(formData.team).trim(),
    teamId: matchingTeam?.id || '',
    section: formData.section,
    assessmentSessionId: normalizedAssessmentSessionId,
    clubId: user?.clubId,
    coachId: user?.id,
    coach: String(user?.name || formData.coachName).trim(),
    createdByName: String(user?.username || user?.name || formData.coachName || user?.email || '').trim(),
    createdByEmail: String(user?.email || '').trim().toLowerCase(),
    updatedBy: user?.id,
    updatedByName: String(user?.username || user?.name || formData.coachName || user?.email || '').trim(),
    updatedByEmail: String(user?.email || '').trim().toLowerCase(),
    parentName: parentContacts[0]?.name ?? '',
    parentEmail: parentContacts[0]?.email ?? '',
    parentContacts,
    contactType: normalizedContactType,
    session: formData.session,
    date: formatUkDate(new Date().toISOString().slice(0, 10)),
    scores,
    averageScore: averageScore !== null ? Number(averageScore.toFixed(1)) : null,
    comments,
    formResponses,
    decision: editingEvaluation?.decision || '',
    status: editingEvaluation?.status || 'Submitted',
    createdAt: editingEvaluation?.createdAt || new Date().toISOString(),
  }
}

export function getDevelopmentRecordSaveFailureMessage(error) {
  const message = String(error?.message ?? '').toLowerCase()
  const details = String(error?.details ?? '').toLowerCase()
  const hint = String(error?.hint ?? '').toLowerCase()
  const combinedMessage = [message, details, hint].filter(Boolean).join(' ')
  const code = String(error?.code ?? '').trim()

  if (code === '22P02' || combinedMessage.includes('invalid input syntax for type uuid')) {
    return 'The selected player or session link is no longer valid. Reopen the player from the squad list and save again.'
  }

  if (code === '23503' || combinedMessage.includes('foreign key constraint')) {
    return 'The selected player, team, or session could not be matched. Refresh the player details and try again.'
  }

  if (code === '42501' || combinedMessage.includes('row-level security') || combinedMessage.includes('permission denied')) {
    return 'Your account does not have permission to save this development record for the selected player.'
  }

  if (combinedMessage.includes('club_id') || combinedMessage.includes('coach_id')) {
    return 'Your staff account is missing the club or team details needed to save this development record.'
  }

  return 'This development record could not be saved right now. Check the player details and try again.'
}

export function getContactCopy(normalizedContactType) {
  if (normalizedContactType === 'self') {
    return {
      contactLabel: 'Player',
      contactNoun: 'player',
      contactNounPlural: 'player',
    }
  }

  if (normalizedContactType === 'both') {
    return {
      contactLabel: 'Contact',
      contactNoun: 'parent and player',
      contactNounPlural: 'parents and player',
    }
  }

  return {
    contactLabel: 'Parent',
    contactNoun: 'parent',
    contactNounPlural: 'parents',
  }
}

export function getSelectedContactIndexes(contacts) {
  return contacts.length > 0 ? contacts.map((_, index) => index) : [0]
}

export function getNextSelectedContactIndexes(currentIndexes, index) {
  if (currentIndexes.includes(index)) {
    const nextIndexes = currentIndexes.filter((item) => item !== index)
    return nextIndexes.length > 0 ? nextIndexes : [index]
  }

  return [...currentIndexes, index].sort((left, right) => left - right)
}

export function getNextExportLabels({ label, responseItems, selectedExportLabels }) {
  const allLabels = responseItems.map((item) => item.label)
  const currentLabels = Array.isArray(selectedExportLabels) ? selectedExportLabels : allLabels

  return currentLabels.includes(label)
    ? currentLabels.filter((item) => item !== label)
    : [...currentLabels, label]
}

export function applyMatchedPlayerToFormData({
  currentFormData,
  fieldName,
  matchingParentContacts,
  matchingPlayer,
  normalizePlayerContactType,
  value,
}) {
  if (fieldName === 'playerName') {
    return {
      ...currentFormData,
      playerName: value,
      parentName: matchingPlayer ? matchingParentContacts[0]?.name || '' : currentFormData.parentName,
      parentEmail: matchingPlayer ? matchingParentContacts[0]?.email || '' : currentFormData.parentEmail,
      parentContacts: matchingPlayer ? matchingParentContacts : currentFormData.parentContacts,
      contactType: matchingPlayer ? normalizePlayerContactType(matchingPlayer.contactType) : currentFormData.contactType,
      team: matchingPlayer?.team || currentFormData.team,
      section: matchingPlayer?.section || currentFormData.section,
    }
  }

  if (fieldName === 'team') {
    return {
      ...currentFormData,
      team: value,
      parentName: matchingPlayer ? matchingParentContacts[0]?.name || '' : currentFormData.parentName,
      parentEmail: matchingPlayer ? matchingParentContacts[0]?.email || '' : currentFormData.parentEmail,
      parentContacts: matchingPlayer ? matchingParentContacts : currentFormData.parentContacts,
      contactType: matchingPlayer ? normalizePlayerContactType(matchingPlayer.contactType) : currentFormData.contactType,
      section: matchingPlayer?.section || currentFormData.section,
    }
  }

  return {
    ...currentFormData,
    [fieldName]: value,
  }
}

export function getMatchedPlayerFieldUpdate({
  fieldName,
  formData,
  normalizeParentContacts,
  normalizePlayerContactType,
  savedPlayers,
  value,
}) {
  const matchingPlayer = fieldName === 'playerName'
    ? findSavedPlayerForEvaluation(savedPlayers, value, formData.team)
    : findSavedPlayerForEvaluation(savedPlayers, formData.playerName, value)
  const matchingParentContacts = normalizeParentContacts(matchingPlayer?.parentContacts, {
    parentName: matchingPlayer?.parentName,
    parentEmail: matchingPlayer?.parentEmail,
  })

  return {
    matchingParentContacts,
    nextFormData: (currentFormData) => applyMatchedPlayerToFormData({
      currentFormData,
      fieldName,
      matchingParentContacts,
      matchingPlayer,
      normalizePlayerContactType,
      value,
    }),
  }
}

export function getCurrentMonthEvaluationCount(evaluations) {
  const currentMonth = new Date().toISOString().slice(0, 7)

  return evaluations.filter((item) => {
    const createdValue = item.createdAt || item.created_at || item.date
    const parsedDate = new Date(createdValue)
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 7) === currentMonth
  }).length
}

export function writeSessionAssessmentProgress({ assessmentSessionId, playerName, user }) {
  if (!user?.clubId || !assessmentSessionId) {
    return
  }

  const progressKey = `session-assessment-progress:${user.clubId}:${assessmentSessionId}`

  try {
    const storedProgress = localStorage.getItem(progressKey)
    const parsedProgress = storedProgress ? JSON.parse(storedProgress) : []
    const completedPlayers = Array.isArray(parsedProgress) ? parsedProgress : []
    localStorage.setItem(
      progressKey,
      JSON.stringify([...new Set([...completedPlayers, normalizePlayerName(playerName).toLowerCase()])]),
    )
  } catch (error) {
    console.error(error)
  }
}

export function buildParentEmailJobs({
  attachPdf = false,
  contactAudiences,
  emailSections = [],
  emailTemplates,
  evaluation,
  formData,
  inviteDate,
  normalizedPlayerName,
  playerContactTypes,
  selectedEmailTemplateKey,
  selectedParentContacts,
  selectedResponseItems,
  user,
}) {
  return contactAudiences
    .flatMap((audience) => {
      const contactType = audience === EMAIL_TEMPLATE_AUDIENCES.player ? playerContactTypes.self : playerContactTypes.parent
      const contacts = selectedParentContacts.filter((contact) => contact.type === contactType)

      if (contacts.length === 0) {
        return []
      }

      const template = emailTemplates.find(
        (item) =>
          normalizeEmailTemplateAudience(item.audience) === audience &&
          item.key === selectedEmailTemplateKey &&
          item.isEnabled !== false,
      )

      if (!template) {
        throw new Error(`Create a ${audience} email template before sending an email.`)
      }

      return contacts.flatMap((contact) =>
        getContactEmailAddresses(contact).map((recipientEmail) => {
          const recipientName = getContactRecipientName(
            contact,
            contactType === playerContactTypes.self ? formData.playerName : formData.parentName,
          )
          const renderedTemplate = renderParentEmailTemplate(template, {
            recipientName,
            parentName: recipientName,
            playerName: normalizedPlayerName,
            coachName: formData.coachName,
            clubName: user?.clubName,
            teamName: formData.team,
            session: formData.session,
            inviteDate,
            summary: '',
          })

          const payload = {
            clubId: user?.clubId,
            userId: user?.id,
            parentEmail: recipientEmail,
            parentName: recipientName,
            senderEmail: user?.email,
            displayName: user?.displayName || user?.display_name || user?.username || user?.name,
            teamName: user?.team_name || user?.emailTeamName || formData.team,
            clubName: user?.club_name || user?.emailClubName || user?.clubName,
            section: formData.section,
            session: formData.session,
            planKey: user?.planKey,
            logoUrl: user?.clubLogoUrl || null,
            replyToEmail: user?.reply_to_email || user?.replyToEmail || user?.clubContactEmail,
            clubContactEmail: user?.clubContactEmail,
            playerName: normalizedPlayerName,
            summary: '',
            responses: selectedResponseItems,
            emailSections,
            subject: renderedTemplate.subject,
            emailBody: renderedTemplate.body,
            pdfHtml: buildAssessmentPdfHtml({
              clubName: user?.club_name || user?.emailClubName || user?.clubName,
              playerName: normalizedPlayerName,
              teamName: user?.team_name || user?.emailTeamName || formData.team,
              section: formData.section,
              session: formData.session,
              logoUrl: user?.clubLogoUrl || null,
              responseItems: selectedResponseItems,
              emailSections,
            }),
            evaluationId: evaluation.id,
            attachPdf,
          }

          return {
            recipientEmail,
            templateName: template.label,
            payload,
            job: () => sendParentEmail(payload),
          }
        }),
      )
    })
    .filter(Boolean)
}

export function createOfflineEvaluationDraft({
  data,
  editingEvaluation,
  id,
  user,
  readyToSync = true,
}) {
  return {
    id,
    operation: editingEvaluation ? 'update' : 'create',
    evaluationId: editingEvaluation?.id || null,
    clubId: user.clubId,
    data,
    createdAt: new Date().toISOString(),
    readyToSync,
    synced: false,
  }
}

export function createPostAssessmentFormData({
  currentSection,
  evaluationSections,
  postAssessmentNavigation,
  user,
}) {
  return createInitialFormData(user, {
    playerName: postAssessmentNavigation.queryPlayerName,
    team: postAssessmentNavigation.nextTeamValue,
    session: postAssessmentNavigation.nextSessionValue,
    section: evaluationSections.includes(postAssessmentNavigation.querySection)
      ? postAssessmentNavigation.querySection
      : currentSection,
  })
}

export function getPostAssessmentNavigation({
  assessmentSessionId,
  availableTeams,
  editingEvaluation,
  formData,
  lastUsedSession,
  normalizedPlayerName,
  searchParams,
}) {
  const queryPlayerName = String(searchParams.get('player') ?? '').trim()
  const queryTeam = String(searchParams.get('team') ?? '').trim()
  const querySession = normalizeSessionValue(searchParams.get('session'))
  const querySection = String(searchParams.get('section') ?? '').trim()
  const nextSessionValue = querySession || lastUsedSession
  const nextTeamValue =
    queryTeam && availableTeams.some((team) => team.name === queryTeam)
      ? queryTeam
      : String(formData.team ?? '').trim()
  const assessmentQueue = parseAssessmentQueue(searchParams.get('queue'))
  const currentQueueIndex = assessmentQueue.findIndex(
    (playerName) => normalizePlayerName(playerName) === normalizedPlayerName,
  )
  const nextQueuedPlayer =
    currentQueueIndex >= 0
      ? assessmentQueue.slice(currentQueueIndex + 1).find(Boolean)
      : assessmentQueue.find((playerName) => normalizePlayerName(playerName) !== normalizedPlayerName)

  if (!editingEvaluation && nextQueuedPlayer) {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('player', nextQueuedPlayer)
    nextSearchParams.set('team', nextTeamValue)
    nextSearchParams.set('session', nextSessionValue)
    nextSearchParams.set('section', querySection || formData.section)

    return {
      type: 'next-player',
      url: `/assess-player?${nextSearchParams.toString()}`,
      nextSessionValue,
      nextTeamValue,
      queryPlayerName,
      querySection,
    }
  }

  if (!editingEvaluation && assessmentQueue.length > 0 && assessmentSessionId) {
    const completedCount = Number(searchParams.get('queueTotal') ?? assessmentQueue.length) || assessmentQueue.length
    const completedSearchParams = new URLSearchParams()
    completedSearchParams.set('completedSessionId', assessmentSessionId)
    completedSearchParams.set('completedCount', String(completedCount))

    return {
      type: 'session-complete',
      url: `/sessions?${completedSearchParams.toString()}`,
      nextSessionValue,
      nextTeamValue,
      queryPlayerName,
      querySection,
    }
  }

  return {
    type: 'reset-form',
    nextSessionValue,
    nextTeamValue,
    queryPlayerName,
    querySection,
  }
}
