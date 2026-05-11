import {
  PLAYER_CONTACT_TYPES,
  formatParentContactEmails,
  formatParentContactNames,
  getClubSettings,
  normalizeParentContacts,
  normalizePlayerContactType,
} from '../../lib/supabase.js'
import { formatUkDate, formatUkDateTime } from '../../lib/date-format.js'
import {
  EMAIL_TEMPLATE_AUDIENCES,
  DIRECT_EMAIL_TEMPLATE_SECTION,
  renderParentEmailTemplate,
} from '../../lib/email-templates.js'

export const PROFILE_EVALUATION_PAGE_SIZE = 5

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
  return String(contact?.email ?? '')
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean)
}

export function getContactRecipientName(contact, fallbackName) {
  return String(contact?.name ?? '').trim() || String(fallbackName ?? '').trim() || 'Parent/Guardian'
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
    return evaluation.date
  }

  return evaluation.createdAt ? formatUkDate(evaluation.createdAt, 'No date entered') : 'No date entered'
}

export function buildRatingTrend(evaluations) {
  return [...evaluations]
    .filter((evaluation) => evaluation.averageScore !== null)
    .sort((left, right) => left.createdAt - right.createdAt)
}

export function buildFieldMovement(evaluations) {
  const chronologicalEvaluations = [...evaluations].sort((left, right) => left.createdAt - right.createdAt)
  const fieldValues = new Map()

  chronologicalEvaluations.forEach((evaluation) => {
    Object.entries(evaluation.formResponses ?? {}).forEach(([label, value]) => {
      const numericValue = Number(value)

      if (Number.isNaN(numericValue)) {
        return
      }

      if (!fieldValues.has(label)) {
        fieldValues.set(label, [])
      }

      fieldValues.get(label).push(numericValue)
    })
  })

  return Array.from(fieldValues.entries())
    .map(([label, values]) => {
      const firstValue = values[0]
      const latestValue = values[values.length - 1]

      return {
        label,
        firstValue,
        latestValue,
        change: latestValue - firstValue,
      }
    })
    .filter((item) => item.firstValue !== undefined && item.latestValue !== undefined)
}

export function getProfilePlayers(players) {
  if (players.length <= 1) {
    return players
  }

  const squadPlayer = players.find((player) => String(player.section ?? '').toLowerCase() === 'squad')
  return [squadPlayer ?? players[0]]
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
  profileParentName,
  routePlayerName,
  selectedEmailTemplates,
  user,
}) {
  const selectedContacts = getSelectedEvaluationParentContacts(evaluation)
  const selectedKey = selectedEmailTemplates[evaluation.id] || getEmailTemplateKey(evaluation.decision)
  const inviteDate = getSelectedInviteDate(evaluation)
  const responses = getSelectedExportResponseItems(evaluation)
  const payloads = getContactTemplateAudiences(getEvaluationContactType(evaluation))
    .flatMap((audience) => {
      const contactType = audience === EMAIL_TEMPLATE_AUDIENCES.player ? PLAYER_CONTACT_TYPES.self : PLAYER_CONTACT_TYPES.parent
      const contacts = selectedContacts.filter((contact) => contact.type === contactType)

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
            payload: {
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
              subject: emailTemplate.subject,
              emailBody: emailTemplate.body,
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
    templateKey: selectedKey,
    templateName: payloads.map((item) => item.templateName).join(', '),
    payloads,
  }
}

export function buildPlayerDirectEmailPayload({
  audience,
  contacts,
  player,
  routePlayerName,
  selectedTemplate,
  user,
}) {
  if (!selectedTemplate) {
    throw new Error('Choose an email template before sending.')
  }

  const playerName = String(player?.playerName || routePlayerName || '').trim()
  const teamName = String(player?.team || user?.activeTeamName || '').trim()
  const section = String(player?.section || '').trim() || DIRECT_EMAIL_TEMPLATE_SECTION
  const contactType = audience === EMAIL_TEMPLATE_AUDIENCES.player ? PLAYER_CONTACT_TYPES.self : PLAYER_CONTACT_TYPES.parent
  const selectedContacts = contacts.filter((contact) => contact.type === contactType)
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
          session: '',
          inviteDate: '',
          summary: '',
          templateKey: selectedTemplate.key,
        })

        return {
          audience,
          recipientEmails: recipientEmail,
          recipientNames: recipientName,
          templateName: selectedTemplate.label,
          payload: {
            parentEmail: recipientEmail,
            parentName: recipientName,
            senderEmail: user?.email,
            displayName: user?.displayName || user?.username || user?.name,
            team: user?.emailTeamName || teamName,
            club: user?.emailClubName || user?.clubName,
            section,
            session: '',
            planKey: user?.planKey,
            logoUrl: user?.clubLogoUrl || null,
            replyToEmail: user?.replyToEmail || user?.clubContactEmail,
            clubContactEmail: user?.clubContactEmail,
            playerName,
            summary: '',
            responses: [],
            subject: emailTemplate.subject,
            emailBody: emailTemplate.body,
            evaluationId: null,
          },
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
      section,
      team: teamName,
    },
    inviteDate: '',
    recipientEmails: payloads.map((item) => item.recipientEmails).join(','),
    recipientNames: payloads.map((item) => item.recipientNames).join(', '),
    responses: [],
    templateKey: selectedTemplate.key,
    templateName: selectedTemplate.label,
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
