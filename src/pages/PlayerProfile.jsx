import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { canDeletePlayer, canEditEvaluation, canShareEvaluation, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import {
  ASSESSMENT_EMAIL_TEMPLATE,
  PARENT_EMAIL_TEMPLATES,
  buildParentEmailTemplate,
  getEmailTemplateKey,
  isInviteEmailTemplate,
} from '../lib/email-templates.js'
import { sendParentEmail } from '../lib/email-builder.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  getSavedEvaluationExportLabels,
  getSelectedEvaluationResponses,
  saveEvaluationExportLabels,
} from '../lib/evaluation-export-selection.js'
import {
  buildEvaluationSummary,
  buildFieldMovement,
  buildRatingTrend,
  createPlayerDraft,
  formatTrendDate,
  getEditableParentContacts,
  getLatestClubLogoUrl,
} from '../hooks/players/playerProfileUtils.js'
import {
  EVALUATION_SECTIONS,
  archivePlayer,
  createCommunicationLog,
  createPlayerStaffNote,
  createEvaluation,
  deleteEvaluation,
  getEvaluations,
  getPlayerCommunicationLogs,
  getPlayerStaffNotes,
  getPlayers,
  formatParentContactEmails,
  formatParentContactNames,
  normalizeParentContacts,
  clearViewCaches,
  promotePlayerToSquad,
  readViewCache,
  readViewCacheValue,
  updateEvaluation,
  updatePlayer,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function isNumericScore(value) {
  if (value === null || value === undefined || value === '') {
    return false
  }

  return !Number.isNaN(Number(value))
}

function calculateMergedAverage(formResponses) {
  const numericValues = Object.values(formResponses ?? {})
    .filter(isNumericScore)
    .map(Number)

  if (numericValues.length === 0) {
    return null
  }

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
}

function buildCommentsFromMergedResponses(formResponses) {
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

const PROFILE_EVALUATION_PAGE_SIZE = 5

function formatActivityDate(value) {
  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? 'No date entered' : parsedDate.toLocaleString()
}

function getActivityLabel(log) {
  const labels = {
    scored_pdf_downloaded: 'PDF with scores downloaded',
    pdf_without_scores_downloaded: 'PDF without scores downloaded',
    email_template_pdf_downloaded: 'Email template PDF downloaded',
    parent_email_sent: 'Parent email sent',
    staff_note_added: 'Staff note added',
    invite_back_selected: 'Invite back selected',
    no_place_offered_selected: 'No place offered selected',
    offer_place_selected: 'Offer place selected',
  }

  return labels[log?.action] || String(log?.action ?? 'Activity').replaceAll('_', ' ')
}

export function PlayerProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { showToast } = useToast()
  const routePlayerName = decodeURIComponent(id)
  const cacheKey = user ? `player:${user.id}:${user.clubId || 'platform'}:${routePlayerName}` : ''
  const [evaluations, setEvaluations] = useState(() => {
    const cachedEvaluations = readViewCacheValue(cacheKey, 'evaluations', [])
    return Array.isArray(cachedEvaluations) ? cachedEvaluations : []
  })
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [allPlayers, setAllPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'allPlayers', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [staffNotes, setStaffNotes] = useState([])
  const [activityLogs, setActivityLogs] = useState([])
  const [noteDraft, setNoteDraft] = useState('')
  const [editingPlayerId, setEditingPlayerId] = useState('')
  const [playerDrafts, setPlayerDrafts] = useState({})
  const [isLoading, setIsLoading] = useState(() => evaluations.length === 0)
  const [isSavingPlayer, setIsSavingPlayer] = useState(false)
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [isPromotingId, setIsPromotingId] = useState('')
  const [isReassigningId, setIsReassigningId] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeletingEvaluationId, setIsDeletingEvaluationId] = useState('')
  const [isMergingEvaluations, setIsMergingEvaluations] = useState(false)
  const [pdfLoadingId, setPdfLoadingId] = useState('')
  const [emailSendingId, setEmailSendingId] = useState('')
  const [selectedReassignTargets, setSelectedReassignTargets] = useState({})
  const [mergeSelectedIds, setMergeSelectedIds] = useState([])
  const [mergeCoreSourceId, setMergeCoreSourceId] = useState('')
  const [mergeDetailSources, setMergeDetailSources] = useState({})
  const [mergeFieldSources, setMergeFieldSources] = useState({})
  const [selectedEmailTemplates, setSelectedEmailTemplates] = useState({})
  const [selectedParentContacts, setSelectedParentContacts] = useState({})
  const [selectedInviteDates, setSelectedInviteDates] = useState({})
  const [selectedExportLabels, setSelectedExportLabels] = useState(() =>
    getSavedEvaluationExportLabels({
      clubId: user?.clubId,
      playerName: routePlayerName,
    }),
  )
  const [evaluationPage, setEvaluationPage] = useState(1)
  const [playerDeleteTarget, setPlayerDeleteTarget] = useState(null)
  const [evaluationDeleteTarget, setEvaluationDeleteTarget] = useState(null)
  const [emailConfirmTarget, setEmailConfirmTarget] = useState(null)
  const [reassignConfirmTarget, setReassignConfirmTarget] = useState(null)
  const [isMergeConfirmOpen, setIsMergeConfirmOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    setSelectedExportLabels(
      getSavedEvaluationExportLabels({
        clubId: user?.clubId,
        playerName: routePlayerName,
      }),
    )
  }, [routePlayerName, user?.clubId])

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadEvaluations = async () => {
      setErrorMessage('')

      try {
        const [evaluationsResult, playersResult, allPlayersResult] = await Promise.allSettled([
          withRequestTimeout(
            () =>
              getEvaluations({
                user,
                playerName: routePlayerName,
              }),
            'Could not load player history. No data entered yet, or the request took too long.',
          ),
          withRequestTimeout(() => getPlayers({ user, playerName: routePlayerName }), 'Could not load player details.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load player reassignment options.'),
        ])

        if (!isMounted) {
          return
        }

        const nextEvaluations = evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : []
        const nextAllPlayers = allPlayersResult.status === 'fulfilled' ? allPlayersResult.value : cachedValue?.allPlayers || []
        const nextPrimaryPlayer = nextPlayers[0]
        const [notesResult, activityResult] = nextPrimaryPlayer?.id
          ? await Promise.allSettled([
              withRequestTimeout(
                () => getPlayerStaffNotes({ user, playerId: nextPrimaryPlayer.id }),
                'Could not load staff notes.',
              ),
              withRequestTimeout(
                () => getPlayerCommunicationLogs({ user, playerId: nextPrimaryPlayer.id }),
                'Could not load player activity.',
              ),
            ])
          : [{ status: 'fulfilled', value: [] }, { status: 'fulfilled', value: [] }]

        if (evaluationsResult.status === 'rejected') {
          console.error(evaluationsResult.reason)
        }

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        if (allPlayersResult.status === 'rejected') {
          console.error(allPlayersResult.reason)
        }

        setEvaluations(nextEvaluations)
        setPlayers(nextPlayers)
        setAllPlayers(nextAllPlayers)
        setStaffNotes(notesResult.status === 'fulfilled' ? notesResult.value : [])
        setActivityLogs(activityResult.status === 'fulfilled' ? activityResult.value : [])
        setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, createPlayerDraft(player)])))
        writeViewCache(cacheKey, {
          evaluations: nextEvaluations,
          players: nextPlayers,
          allPlayers: nextAllPlayers,
          staffNotes: notesResult.status === 'fulfilled' ? notesResult.value : [],
          activityLogs: activityResult.status === 'fulfilled' ? activityResult.value : [],
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (!cachedValue?.evaluations) {
            setEvaluations([])
          }
          if (!cachedValue?.players) {
            setPlayers([])
          }
          if (!cachedValue?.allPlayers) {
            setAllPlayers([])
          }
          setErrorMessage('Could not load player history.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadEvaluations()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, routePlayerName, user, userScopeKey])

  const scoredEvaluations = useMemo(
    () => evaluations.filter((evaluation) => evaluation.averageScore !== null),
    [evaluations],
  )
  const paginatedEvaluations = useMemo(
    () => getPaginatedItems(evaluations, evaluationPage, PROFILE_EVALUATION_PAGE_SIZE),
    [evaluationPage, evaluations],
  )
  const ratingTrend = useMemo(() => buildRatingTrend(evaluations), [evaluations])
  const fieldMovement = useMemo(() => buildFieldMovement(evaluations), [evaluations])
  const ratingTrendMax = ratingTrend.some((evaluation) => Number(evaluation.averageScore) > 5) ? 10 : 5
  const overallAverage =
    scoredEvaluations.length > 0
      ? scoredEvaluations.reduce((sum, evaluation) => sum + evaluation.averageScore, 0) / scoredEvaluations.length
      : null

  const lastSection = evaluations[0]?.section || 'Trial'
  const lastTeam = evaluations[0]?.team || ''
  const primaryPlayer = players[0]
  const isSquadPlayer =
    players.some((player) => String(player.section ?? '').toLowerCase() === 'squad') ||
    String(lastSection ?? '').toLowerCase() === 'squad'
  const profileParentName = primaryPlayer?.parentName || evaluations.find((evaluation) => evaluation.parentName)?.parentName || ''
  const profileParentEmail = primaryPlayer?.parentEmail || evaluations.find((evaluation) => evaluation.parentEmail)?.parentEmail || ''
  const profileParentContacts = normalizeParentContacts(primaryPlayer?.parentContacts, {
    parentName: profileParentName,
    parentEmail: profileParentEmail,
  })
  const reassignPlayerOptions = useMemo(
    () =>
      allPlayers
        .filter((player) => {
          const playerName = String(player.playerName ?? '').trim()
          return player.id && playerName && playerName.toLowerCase() !== routePlayerName.toLowerCase()
        })
        .sort((left, right) => left.playerName.localeCompare(right.playerName)),
    [allPlayers, routePlayerName],
  )
  const canMergeEvaluations = Boolean(user?.clubId) && Number(user?.roleRank ?? 0) >= 50 && evaluations.length > 1
  const canDeleteEvaluations = Boolean(user?.id) && (user.role === 'super_admin' || Number(user?.roleRank ?? 0) >= 50)
  const mergeSelectedEvaluations = useMemo(
    () => evaluations.filter((evaluation) => mergeSelectedIds.includes(evaluation.id)),
    [evaluations, mergeSelectedIds],
  )
  const mergeFieldLabels = useMemo(
    () =>
      Array.from(
        new Set(
          mergeSelectedEvaluations.flatMap((evaluation) => Object.keys(evaluation.formResponses ?? {})),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [mergeSelectedEvaluations],
  )
  const mergeCoreSource = mergeSelectedEvaluations.find((evaluation) => evaluation.id === mergeCoreSourceId) ?? mergeSelectedEvaluations[0]
  const getMergeSourceById = (sourceId) =>
    mergeSelectedEvaluations.find((evaluation) => evaluation.id === sourceId) ?? mergeCoreSource ?? mergeSelectedEvaluations[0]
  const getMergeDetailSource = (fieldName) => getMergeSourceById(mergeDetailSources[fieldName] || mergeCoreSource?.id)
  const mergeDetailFields = useMemo(
    () => [
      {
        key: 'player',
        label: 'Player, team, and section',
        preview: (evaluation) =>
          `${evaluation?.playerName || routePlayerName} | ${evaluation?.team || 'No team entered'} | ${evaluation?.section || 'Trial'}`,
      },
      {
        key: 'parents',
        label: 'Parent details',
        preview: (evaluation) =>
          formatParentContactNames(evaluation?.parentContacts, evaluation?.parentName) ||
          formatParentContactEmails(evaluation?.parentContacts, evaluation?.parentEmail) ||
          'No parent details entered',
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
    ],
    [routePlayerName],
  )
  const mergePreviewResponses = useMemo(
    () =>
      Object.fromEntries(
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
      ),
    [mergeCoreSource?.id, mergeFieldLabels, mergeFieldSources, mergeSelectedEvaluations],
  )
  const mergePreviewAverage = useMemo(
    () => calculateMergedAverage(mergePreviewResponses),
    [mergePreviewResponses],
  )

  const getSelectedEmailTemplateKey = (evaluation) =>
    isSquadPlayer ? ASSESSMENT_EMAIL_TEMPLATE.key : selectedEmailTemplates[evaluation.id] || getEmailTemplateKey(evaluation.decision)
  const getSelectedInviteDate = (evaluation) => selectedInviteDates[evaluation.id] || ''
  const getEvaluationParentContacts = (evaluation) =>
    normalizeParentContacts(evaluation.parentContacts?.length ? evaluation.parentContacts : profileParentContacts, {
      parentName: evaluation.parentName || profileParentName,
      parentEmail: evaluation.parentEmail || profileParentEmail,
    })
  const getSelectedEvaluationParentContacts = (evaluation) => {
    const contacts = getEvaluationParentContacts(evaluation)
    const selectedIndexes = selectedParentContacts[evaluation.id] ?? contacts.map((_, index) => index)
    const nextContacts = contacts.filter((_, index) => selectedIndexes.includes(index))

    return nextContacts.length > 0 ? nextContacts : contacts.slice(0, 1)
  }

  const getExportResponseItems = (evaluation) =>
    Object.entries(evaluation.formResponses ?? {}).map(([label, value]) => ({
      label,
      value,
    }))

  const getSelectedExportResponseItems = (evaluation) =>
    getSelectedEvaluationResponses(getExportResponseItems(evaluation), selectedExportLabels)

  const buildParentEmailPayload = (evaluation) => {
    const selectedContacts = getSelectedEvaluationParentContacts(evaluation)
    const recipientEmails = formatParentContactEmails(selectedContacts, evaluation.parentEmail || profileParentEmail)
    const recipientNames = formatParentContactNames(selectedContacts, evaluation.parentName || profileParentName)
    const templateKey = getSelectedEmailTemplateKey(evaluation)
    const inviteDate = getSelectedInviteDate(evaluation)
    const emailTemplate = buildParentEmailTemplate({
      parentName: recipientNames,
      playerName: routePlayerName,
      coachName: evaluation.coach,
      clubName: user?.clubName,
      teamName: evaluation.team,
      session: evaluation.session,
      inviteDate,
      templateKey,
    })
    const responses = getSelectedExportResponseItems(evaluation)

    return {
      evaluation,
      inviteDate,
      recipientEmails,
      recipientNames,
      responses,
      templateKey,
      templateName:
        PARENT_EMAIL_TEMPLATES.find((template) => template.key === templateKey)?.label ||
        ASSESSMENT_EMAIL_TEMPLATE.label,
      payload: {
        parentEmail: recipientEmails,
        parentName: recipientNames,
        displayName: user?.displayName || user?.username || user?.name,
        team: user?.emailTeamName || evaluation.team,
        club: user?.emailClubName || user?.clubName,
        logoUrl: user?.clubLogoUrl || null,
        replyToEmail: user?.replyToEmail || user?.clubContactEmail,
        clubContactEmail: user?.clubContactEmail,
        playerName: routePlayerName,
        summary: buildEvaluationSummary(evaluation, 'email'),
        responses,
        subject: emailTemplate.subject,
        emailBody: emailTemplate.body,
        evaluationId: evaluation.id,
      },
    }
  }

  const handleToggleExportField = (label, responseItems) => {
    const allLabels = responseItems.map((item) => item.label)
    const currentLabels = Array.isArray(selectedExportLabels) ? selectedExportLabels : allLabels
    const nextLabels = currentLabels.includes(label)
      ? currentLabels.filter((item) => item !== label)
      : [...currentLabels, label]

    setSelectedExportLabels(nextLabels)
    saveEvaluationExportLabels({
      clubId: user?.clubId,
      playerName: routePlayerName,
      labels: nextLabels,
    })
  }

  const handleSetAllExportFields = (responseItems) => {
    const nextLabels = responseItems.map((item) => item.label)

    setSelectedExportLabels(nextLabels)
    saveEvaluationExportLabels({
      clubId: user?.clubId,
      playerName: routePlayerName,
      labels: nextLabels,
    })
  }

  const handleClearExportFields = () => {
    setSelectedExportLabels([])
    saveEvaluationExportLabels({
      clubId: user?.clubId,
      playerName: routePlayerName,
      labels: [],
    })
  }

  const handleDownloadPdf = async (evaluation, mode) => {
    setPdfLoadingId(`${evaluation.id}:${mode}`)
    setErrorMessage('')

    try {
      if (!hasPlanFeature(user, 'pdfExport')) {
        throw new Error(createFeatureUpgradeMessage('pdfExport'))
      }

      const { exportEvaluationPdf } = await import('../lib/pdf.js')
      const latestClubLogoUrl = await getLatestClubLogoUrl(user)
      const selectedResponseItems = getSelectedExportResponseItems(evaluation)
      const summary = buildEvaluationSummary(evaluation, mode)
      const selectedContacts = getSelectedEvaluationParentContacts(evaluation)
      const recipientNames = formatParentContactNames(selectedContacts, evaluation.parentName || profileParentName)
      const recipientEmails = formatParentContactEmails(selectedContacts, evaluation.parentEmail || profileParentEmail)
      const emailTemplate = buildParentEmailTemplate({
        parentName: recipientNames,
        playerName: routePlayerName,
        coachName: evaluation.coach,
        clubName: user?.clubName,
        teamName: evaluation.team,
        session: evaluation.session,
        inviteDate: getSelectedInviteDate(evaluation),
        templateKey: getSelectedEmailTemplateKey(evaluation),
      })

      await exportEvaluationPdf({
        filename: `${routePlayerName}-${mode}.pdf`,
        mode,
        previewProps: {
          clubName: user?.clubName || user?.team || 'Club Name',
          logoUrl: latestClubLogoUrl || fallbackLogo,
          playerName: routePlayerName,
          team: evaluation.team,
          section: evaluation.section,
          session: evaluation.session,
          summary,
          emailSubject: emailTemplate.subject,
          emailBody: emailTemplate.body,
          recipientNames,
          recipientEmails,
          responseItems: mode !== 'without-scores' ? selectedResponseItems : [],
        },
      })

      void createCommunicationLog({
        user,
        playerId: evaluation.playerId || primaryPlayer?.id,
        evaluationId: evaluation.id,
        channel: 'pdf',
        action:
          mode === 'scored'
            ? 'scored_pdf_downloaded'
            : mode === 'without-scores'
              ? 'pdf_without_scores_downloaded'
              : 'email_template_pdf_downloaded',
        recipientEmail: recipientEmails,
      }).catch((error) => console.error(error))
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not generate the PDF.')
    } finally {
      setPdfLoadingId('')
    }
  }

  const handlePlayerDraftChange = (playerId, fieldName, value) => {
    setErrorMessage('')
    setPlayerDrafts((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        [fieldName]: value,
      },
    }))
  }

  const handleSendParentEmail = (evaluation) => {
    if (emailSendingId) {
      return
    }

    setErrorMessage('')

    try {
      if (!hasPlanFeature(user, 'parentEmail')) {
        setErrorMessage(createFeatureUpgradeMessage('parentEmail'))
        return
      }

      const emailDetails = buildParentEmailPayload(evaluation)

      if (!emailDetails.recipientEmails) {
        setErrorMessage('Add a parent email before sending.')
        return
      }

      setEmailConfirmTarget(emailDetails)
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not prepare the parent email.')
    }
  }

  const confirmSendParentEmail = async () => {
    if (!emailConfirmTarget?.evaluation || emailSendingId) {
      return
    }

    const { evaluation, payload, recipientEmails } = emailConfirmTarget
    setEmailSendingId(evaluation.id)
    setErrorMessage('')

    try {
      await sendParentEmail(payload)
      showToast({ title: 'Email sent successfully' })

      void createCommunicationLog({
        user,
        playerId: evaluation.playerId || primaryPlayer?.id,
        evaluationId: evaluation.id,
        channel: 'email',
        action: 'parent_email_sent',
        recipientEmail: recipientEmails,
      }).catch((error) => console.error(error))
    } catch (error) {
      console.error(error)
      showToast({ title: 'Email failed - will retry automatically', tone: 'error' })
    } finally {
      setEmailSendingId('')
      setEmailConfirmTarget(null)
    }
  }

  const handleSaveStaffNote = async () => {
    if (!primaryPlayer?.id) {
      setErrorMessage('Player details are not available yet.')
      return
    }

    setIsSavingNote(true)
    setErrorMessage('')

    try {
      const nextNote = await createPlayerStaffNote({
        user,
        playerId: primaryPlayer.id,
        note: noteDraft,
      })
      const nextActivity = await getPlayerCommunicationLogs({ user, playerId: primaryPlayer.id })
      setStaffNotes((current) => [nextNote, ...current])
      setActivityLogs(nextActivity)
      setNoteDraft('')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save staff note.')
    } finally {
      setIsSavingNote(false)
    }
  }

  const handleStartEditingPlayer = (player) => {
    setErrorMessage('')
    setPlayerDrafts((current) => ({
      ...current,
      [player.id]: createPlayerDraft(current[player.id] ?? player),
    }))
    setEditingPlayerId(player.id)
  }

  const handleParentContactDraftChange = (playerId, index, fieldName, value) => {
    setErrorMessage('')
    setPlayerDrafts((current) => {
      const draft = current[playerId] ?? {}
      const contacts = Array.isArray(draft.parentContacts) && draft.parentContacts.length > 0
        ? draft.parentContacts
        : [{ name: draft.parentName || '', email: draft.parentEmail || '' }]
      const nextContacts = contacts.length > 0 ? contacts : [{ name: '', email: '' }]
      const updatedContacts = nextContacts.map((contact, contactIndex) =>
        contactIndex === index
          ? {
              ...contact,
              [fieldName]: value,
            }
          : contact,
      )

      return {
        ...current,
        [playerId]: {
          ...draft,
          parentName: updatedContacts[0]?.name ?? '',
          parentEmail: updatedContacts[0]?.email ?? '',
          parentContacts: updatedContacts,
        },
      }
    })
  }

  const handleAddParentContact = (playerId) => {
    setErrorMessage('')
    setPlayerDrafts((current) => {
      const draft = current[playerId] ?? {}
      const contacts = Array.isArray(draft.parentContacts) && draft.parentContacts.length > 0
        ? draft.parentContacts
        : [{ name: draft.parentName || '', email: draft.parentEmail || '' }]

      return {
        ...current,
        [playerId]: {
          ...draft,
          parentContacts: [...contacts, { name: '', email: '' }],
        },
      }
    })
  }

  const handleRemoveParentContact = (playerId, index) => {
    setErrorMessage('')
    setPlayerDrafts((current) => {
      const draft = current[playerId] ?? {}
      const contacts = Array.isArray(draft.parentContacts) && draft.parentContacts.length > 0
        ? draft.parentContacts
        : [{ name: draft.parentName || '', email: draft.parentEmail || '' }]
      const nextContacts = contacts.filter((_, contactIndex) => contactIndex !== index)
      const fallbackContacts = nextContacts.length > 0 ? nextContacts : [{ name: '', email: '' }]

      return {
        ...current,
        [playerId]: {
          ...draft,
          parentName: fallbackContacts[0]?.name ?? '',
          parentEmail: fallbackContacts[0]?.email ?? '',
          parentContacts: fallbackContacts,
        },
      }
    })
  }

  const handleToggleEvaluationParentContact = (evaluationId, index, contacts) => {
    setSelectedParentContacts((current) => {
      const currentIndexes = current[evaluationId] ?? contacts.map((_, contactIndex) => contactIndex)

      if (currentIndexes.includes(index)) {
        const nextIndexes = currentIndexes.filter((item) => item !== index)
        return {
          ...current,
          [evaluationId]: nextIndexes.length > 0 ? nextIndexes : [index],
        }
      }

      return {
        ...current,
        [evaluationId]: [...currentIndexes, index].sort((left, right) => left - right),
      }
    })
  }

  const handleReassignTargetChange = (evaluationId, playerId) => {
    setErrorMessage('')
    setSelectedReassignTargets((currentTargets) => ({
      ...currentTargets,
      [evaluationId]: playerId,
    }))
  }

  const handleReassignEvaluation = async (evaluation) => {
    const targetPlayerId = selectedReassignTargets[evaluation.id]
    const targetPlayer = reassignPlayerOptions.find((player) => player.id === targetPlayerId)

    if (!targetPlayer) {
      setErrorMessage('Choose the correct player before moving this report.')
      return
    }

    setReassignConfirmTarget({
      evaluation,
      targetPlayer,
    })
  }

  const confirmReassignEvaluation = async () => {
    if (!reassignConfirmTarget) {
      return
    }

    const { evaluation, targetPlayer } = reassignConfirmTarget
    setIsReassigningId(evaluation.id)
    setErrorMessage('')

    try {
      const targetParentContacts = normalizeParentContacts(targetPlayer.parentContacts, {
        parentName: targetPlayer.parentName,
        parentEmail: targetPlayer.parentEmail,
      })
      const updatedEvaluation = await updateEvaluation(
        evaluation.id,
        {
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
        },
        user?.clubId,
      )
      const nextEvaluations = evaluations.filter((item) => item.id !== updatedEvaluation.id)

      setEvaluations(nextEvaluations)
      setSelectedReassignTargets((currentTargets) => {
        const nextTargets = { ...currentTargets }
        delete nextTargets[evaluation.id]
        return nextTargets
      })
      clearViewCaches()
      writeViewCache(cacheKey, {
        evaluations: nextEvaluations,
        players,
        allPlayers,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not move this report to the selected player.')
    } finally {
      setIsReassigningId('')
      setReassignConfirmTarget(null)
    }
  }

  const handleToggleMergeEvaluation = (evaluationId, checked) => {
    setErrorMessage('')
    setMergeSelectedIds((currentIds) => {
      const nextIds = checked
        ? [...new Set([...currentIds, evaluationId])]
        : currentIds.filter((id) => id !== evaluationId)

      if (nextIds.length === 0) {
        setMergeCoreSourceId('')
        setMergeDetailSources({})
        setMergeFieldSources({})
        return []
      }

      setMergeCoreSourceId((currentSourceId) => (nextIds.includes(currentSourceId) ? currentSourceId : nextIds[0]))
      setMergeFieldSources((currentSources) =>
        Object.fromEntries(
          Object.entries(currentSources).filter(([, sourceId]) => nextIds.includes(sourceId)),
        ),
      )
      setMergeDetailSources((currentSources) =>
        Object.fromEntries(
          Object.entries(currentSources).filter(([, sourceId]) => nextIds.includes(sourceId)),
        ),
      )

      return nextIds
    })
  }

  const handleMergeFieldSourceChange = (label, sourceId) => {
    setErrorMessage('')
    setMergeFieldSources((currentSources) => ({
      ...currentSources,
      [label]: sourceId,
    }))
  }

  const handleMergeDetailSourceChange = (fieldName, sourceId) => {
    setErrorMessage('')
    setMergeDetailSources((currentSources) => ({
      ...currentSources,
      [fieldName]: sourceId,
    }))
  }

  const handleCreateMergedEvaluation = async () => {
    if (!canMergeEvaluations) {
      setErrorMessage('Only managers and above can merge assessments.')
      return
    }

    if (mergeSelectedEvaluations.length < 2) {
      setErrorMessage('Select at least two assessments to merge.')
      return
    }

    if (!mergeCoreSource) {
      setErrorMessage('Choose a source assessment for the main details.')
      return
    }

    setIsMergeConfirmOpen(true)
  }

  const confirmCreateMergedEvaluation = async () => {
    setIsMergeConfirmOpen(false)

    setIsMergingEvaluations(true)
    setErrorMessage('')

    try {
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
      const mergedEvaluation = await createEvaluation({
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
        date: dateSource?.date || new Date().toLocaleDateString(),
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
      })
      const nextEvaluations = [mergedEvaluation, ...evaluations]

      setEvaluations(nextEvaluations)
      setMergeSelectedIds([])
      setMergeCoreSourceId('')
      setMergeDetailSources({})
      setMergeFieldSources({})
      clearViewCaches()
      writeViewCache(cacheKey, {
        evaluations: nextEvaluations,
        players,
        allPlayers,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not create the merged assessment.')
    } finally {
      setIsMergingEvaluations(false)
    }
  }

  const handleDeleteEvaluation = async (evaluation) => {
    if (!canDeleteEvaluations) {
      setErrorMessage('Only managers and above can delete old assessments.')
      return
    }

    setEvaluationDeleteTarget(evaluation)
  }

  const confirmDeleteEvaluation = async (password) => {
    if (!evaluationDeleteTarget) {
      return
    }

    setIsDeletingEvaluationId(evaluationDeleteTarget.id)
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deleteEvaluation({ user, evaluationId: evaluationDeleteTarget.id })
      const nextEvaluations = evaluations.filter((item) => item.id !== evaluationDeleteTarget.id)

      setEvaluations(nextEvaluations)
      setMergeSelectedIds((currentIds) => currentIds.filter((id) => id !== evaluationDeleteTarget.id))
      setMergeCoreSourceId((currentSourceId) => (currentSourceId === evaluationDeleteTarget.id ? '' : currentSourceId))
      setMergeFieldSources((currentSources) =>
        Object.fromEntries(Object.entries(currentSources).filter(([, sourceId]) => sourceId !== evaluationDeleteTarget.id)),
      )
      setMergeDetailSources((currentSources) =>
        Object.fromEntries(Object.entries(currentSources).filter(([, sourceId]) => sourceId !== evaluationDeleteTarget.id)),
      )
      clearViewCaches()
      writeViewCache(cacheKey, {
        evaluations: nextEvaluations,
        players,
        allPlayers,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not delete this assessment.')
    } finally {
      setIsDeletingEvaluationId('')
      setEvaluationDeleteTarget(null)
    }
  }

  const handleAddPlayerPosition = (playerId) => {
    const draft = playerDrafts[playerId]
    const nextPosition = String(draft?.positionDraft ?? '').trim()

    if (!nextPosition) {
      return
    }

    setErrorMessage('')
    setPlayerDrafts((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        positions: [...new Set([...(current[playerId]?.positions ?? []), nextPosition])],
        positionDraft: '',
      },
    }))
  }

  const handleRemovePlayerPosition = (playerId, positionToRemove) => {
    setErrorMessage('')
    setPlayerDrafts((current) => ({
      ...current,
      [playerId]: {
        ...current[playerId],
        positions: (current[playerId]?.positions ?? []).filter((position) => position !== positionToRemove),
      },
    }))
  }

  const handleSavePlayer = async (playerId) => {
    const draft = playerDrafts[playerId]

    if (!draft) {
      return
    }

    setIsSavingPlayer(true)
    setErrorMessage('')

    try {
      const savedPlayer = await updatePlayer({
        user,
        playerId,
        player: {
          ...draft,
          parentContacts: getEditableParentContacts(draft),
        },
      })
      const nextPlayers = players.map((player) => (player.id === playerId ? savedPlayer : player))
      setPlayers(nextPlayers)
      setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, createPlayerDraft(player)])))
      writeViewCache(cacheKey, {
        evaluations,
        players: nextPlayers,
      })
      setEditingPlayerId('')

      if (savedPlayer.playerName !== routePlayerName) {
        navigate(`/player/${encodeURIComponent(savedPlayer.playerName)}`)
      }
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save player details.')
    } finally {
      setIsSavingPlayer(false)
    }
  }

  const handlePromotePlayer = async (playerId) => {
    setIsPromotingId(playerId)
    setErrorMessage('')

    try {
      const promotedPlayer = await promotePlayerToSquad({ user, playerId })
      const nextPlayers = players.map((player) => (player.id === playerId ? promotedPlayer : player))
      setPlayers(nextPlayers)
      setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, createPlayerDraft(player)])))
      writeViewCache(cacheKey, {
        evaluations,
        players: nextPlayers,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not promote this player to Squad.')
    } finally {
      setIsPromotingId('')
    }
  }

  const handleDeletePlayer = async () => {
    setPlayerDeleteTarget({
      playerName: routePlayerName,
      playerCount: players.length,
      evaluationCount: evaluations.length,
    })
  }

  const confirmDeletePlayer = async (password, reason) => {
    if (!playerDeleteTarget) {
      return
    }

    const archiveReason = String(reason ?? '').trim()

    if (!archiveReason) {
      setErrorMessage('Add a reason before archiving this player.')
      return
    }

    setIsDeleting(true)
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await Promise.all(
        players.map((player) =>
          archivePlayer({
            user,
            playerId: player.id,
            reason: archiveReason,
          }),
        ),
      )
      clearViewCaches()
      navigate('/players', { replace: true })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not archive this player.')
    } finally {
      setIsDeleting(false)
      setPlayerDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Player Profile"
        title={routePlayerName}
        description="Review the evaluation history for this player with club-scoped visibility."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Player history is unavailable right now"
          message="We could not refresh this player's saved assessments. If no history has been entered yet, this page will remain empty."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Player name</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{routePlayerName}</p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Total evaluations</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{evaluations.length}</p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Average score</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
            {overallAverage !== null ? overallAverage.toFixed(1) : '-'}
          </p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Latest section</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{lastSection}</p>
        </div>
      </div>

      <SectionCard
        title="Rating trend"
        description="Shows how the player's assessment scores are moving over time."
      >
        {ratingTrend.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No scored evaluations yet.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ratingTrend.map((evaluation) => {
                const scorePercent = Math.max(0, Math.min(100, (Number(evaluation.averageScore) / ratingTrendMax) * 100))

                return (
                  <div key={evaluation.id} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{formatTrendDate(evaluation)}</p>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{evaluation.averageScore.toFixed(1)}</p>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--panel-soft)]">
                      <div
                        className="h-full rounded-full bg-[var(--button-primary)]"
                        style={{ width: `${scorePercent}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      {evaluation.section || 'Trial'}
                    </p>
                  </div>
                )
              })}
            </div>

            {fieldMovement.length > 0 ? (
              <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Field movement</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {fieldMovement.map((item) => (
                    <div key={item.label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{item.label}</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                        {item.firstValue} to {item.latestValue}
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {item.change > 0 ? '+' : ''}{item.change.toFixed(1)} change
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Player details"
        description="Edit section, team, and parent contact details here."
      >
        {players.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No saved player details yet. This profile was created from assessment history.
          </div>
        ) : (
          <div className="space-y-4">
            {players.map((player) => {
              const draft = playerDrafts[player.id] ?? player
              const isEditing = editingPlayerId === player.id

              return (
                <div key={player.id} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                  {isEditing ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Name</span>
                        <input
                          value={draft.playerName}
                          onChange={(event) => handlePlayerDraftChange(player.id, 'playerName', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Section</span>
                        <select
                          value={draft.section}
                          onChange={(event) => handlePlayerDraftChange(player.id, 'section', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        >
                          {EVALUATION_SECTIONS.map((section) => (
                            <option key={section} value={section}>
                              {section}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
                        <input
                          value={draft.team}
                          onChange={(event) => handlePlayerDraftChange(player.id, 'team', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <div className="md:col-span-2 xl:col-span-3">
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <span className="block text-sm font-semibold text-[var(--text-primary)]">Parent Contacts</span>
                            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                              Add multiple parents or guardians. Each contact can have a separate name and email.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddParentContact(player.id)}
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                          >
                            Add Another Parent
                          </button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {getEditableParentContacts(draft).map((contact, index) => (
                            <div key={index} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
                              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                                Parent {index + 1}
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Parent Name</span>
                                  <input
                                    value={contact.name}
                                    onChange={(event) => handleParentContactDraftChange(player.id, index, 'name', event.target.value)}
                                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Parent Email</span>
                                  <input
                                    type="email"
                                    value={contact.email}
                                    onChange={(event) => handleParentContactDraftChange(player.id, index, 'email', event.target.value)}
                                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                                  />
                                </label>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveParentContact(player.id, index)}
                                className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                              >
                                Remove Parent
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="md:col-span-2 xl:col-span-3">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Positions</span>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <input
                            value={draft.positionDraft ?? ''}
                            onChange={(event) => handlePlayerDraftChange(player.id, 'positionDraft', event.target.value)}
                            placeholder="Add position"
                            className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddPlayerPosition(player.id)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                          >
                            Add Position
                          </button>
                        </div>
                        {(draft.positions ?? []).length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {draft.positions.map((position) => (
                              <button
                                key={position}
                                type="button"
                                onClick={() => handleRemovePlayerPosition(player.id, position)}
                                className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                              >
                                {position} remove
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">No positions entered.</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <button
                          type="button"
                          disabled={isSavingPlayer}
                          onClick={() => void handleSavePlayer(player.id)}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={isSavingPlayer}
                          onClick={() => setEditingPlayerId('')}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="grid flex-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Section</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.section}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Team</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.team || 'No team entered'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Parents</p>
                          <div className="mt-2 space-y-1">
                            {normalizeParentContacts(player.parentContacts, {
                              parentName: player.parentName,
                              parentEmail: player.parentEmail,
                            }).length > 0 ? (
                              normalizeParentContacts(player.parentContacts, {
                                parentName: player.parentName,
                                parentEmail: player.parentEmail,
                              }).map((contact, index) => (
                                <p key={index} className="break-words text-sm font-semibold text-[var(--text-primary)]">
                                  {contact.name || 'Parent/Guardian'}{contact.email ? ` | ${contact.email}` : ''}
                                </p>
                              ))
                            ) : (
                              <p className="text-sm font-semibold text-[var(--text-primary)]">No parent details entered</p>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Positions</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                            {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Status</p>
                          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                            {player.status === 'promoted' ? 'Promoted' : 'Active'}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        {player.section !== 'Squad' ? (
                          <button
                            type="button"
                            disabled={isPromotingId === player.id}
                            onClick={() => void handlePromotePlayer(player.id)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isPromotingId === player.id ? 'Promoting...' : 'Promote to Squad'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleStartEditingPlayer(player)}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                        >
                          Edit Details
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          to={`/create?player=${encodeURIComponent(routePlayerName)}&team=${encodeURIComponent(lastTeam)}&section=${encodeURIComponent(lastSection)}`}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
        >
          Add New Evaluation
        </Link>
        {canDeletePlayer(user) ? (
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleDeletePlayer}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? 'Deleting...' : 'Delete This Player'}
          </button>
        ) : null}
      </div>

      {canMergeEvaluations ? (
        <SectionCard
          title="Merge assessments"
          description="Managers can create one combined assessment from selected reports. Original reports stay in history."
        >
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              {evaluations.map((evaluation) => (
                <label
                  key={evaluation.id}
                  className="flex min-h-11 items-start gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={mergeSelectedIds.includes(evaluation.id)}
                    onChange={(event) => handleToggleMergeEvaluation(evaluation.id, event.target.checked)}
                    className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{evaluation.date || 'No date entered'}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">
                      {evaluation.session || 'No session entered'} | {evaluation.section || 'Trial'} | Score {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : 'No score'}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {mergeSelectedEvaluations.length >= 2 ? (
              <div className="space-y-4 rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Main details source</span>
                  <select
                    value={mergeCoreSource?.id || ''}
                    onChange={(event) => setMergeCoreSourceId(event.target.value)}
                    className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  >
                    {mergeSelectedEvaluations.map((evaluation) => (
                      <option key={evaluation.id} value={evaluation.id}>
                        {evaluation.date || 'No date entered'} | {evaluation.session || 'No session entered'} | {evaluation.section || 'Trial'}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                    This is the default source. You can override each merged detail below.
                  </p>
                </label>

                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Choose report detail sources</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                    Pick which assessment supplies non-score details such as parents, session, date, comments, and status.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {mergeDetailFields.map((field) => {
                      const selectedSource = getMergeDetailSource(field.key)

                      return (
                        <label key={field.key} className="block rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{field.label}</span>
                          <select
                            value={mergeDetailSources[field.key] || mergeCoreSource?.id || ''}
                            onChange={(event) => handleMergeDetailSourceChange(field.key, event.target.value)}
                            className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          >
                            {mergeSelectedEvaluations.map((evaluation) => (
                              <option key={evaluation.id} value={evaluation.id}>
                                {evaluation.date || 'No date entered'} | {evaluation.session || 'No session entered'}
                              </option>
                            ))}
                          </select>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">
                            {field.preview(selectedSource)}
                          </p>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Choose field sources</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                    Pick which assessment should supply each score or text field.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {mergeFieldLabels.map((label) => (
                      <label key={label} className="block rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{label}</span>
                        <select
                          value={
                            mergeFieldSources[label] ||
                            mergeSelectedEvaluations.find((evaluation) =>
                              Object.prototype.hasOwnProperty.call(evaluation.formResponses ?? {}, label),
                            )?.id ||
                            mergeCoreSource?.id ||
                            mergeSelectedEvaluations[0]?.id ||
                            ''
                          }
                          onChange={(event) => handleMergeFieldSourceChange(label, event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        >
                          {mergeSelectedEvaluations
                            .filter((evaluation) => Object.prototype.hasOwnProperty.call(evaluation.formResponses ?? {}, label))
                            .map((evaluation) => (
                              <option key={evaluation.id} value={evaluation.id}>
                                {evaluation.date || 'No date entered'} | {String(evaluation.formResponses?.[label] ?? 'No value')}
                              </option>
                            ))}
                        </select>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">
                          {String(mergePreviewResponses[label] ?? 'No value')}
                        </p>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Merged score preview</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {mergePreviewAverage !== null ? mergePreviewAverage.toFixed(1) : 'No numeric scores selected'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isMergingEvaluations}
                    onClick={() => void handleCreateMergedEvaluation()}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isMergingEvaluations ? 'Saving...' : 'Save Merged Assessment'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
                Select at least two assessments to build a merged report.
              </div>
            )}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Staff notes and activity"
        description="Internal notes and staff actions stay inside the club workspace. They are not added to parent PDFs."
      >
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Add internal note</span>
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                placeholder="Add a staff-only note for this player"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleSaveStaffNote()}
              disabled={isSavingNote || !noteDraft.trim() || !primaryPlayer?.id}
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingNote ? 'Saving...' : 'Save Note'}
            </button>

            <div className="mt-4 space-y-3">
              {staffNotes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
                  No staff notes yet.
                </div>
              ) : (
                staffNotes.map((note) => (
                  <div key={note.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{note.note}</p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {note.userName || note.userEmail || 'Staff'} | {formatActivityDate(note.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Player activity</p>
            <div className="mt-3 space-y-3">
              {activityLogs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
                  No player activity logged yet.
                </div>
              ) : (
                activityLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{getActivityLabel(log)}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {log.userName || log.userEmail || 'Staff'} | {formatActivityDate(log.createdAt)}
                    </p>
                    {log.recipientEmail ? (
                      <p className="mt-1 break-words text-xs text-[var(--text-muted)]">Recipient: {log.recipientEmail}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Past evaluations"
        description="History is scoped by club and role, with sharing actions available on each evaluation."
      >
        {isLoading ? (
          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center text-sm font-medium text-[var(--text-muted)]">
            Loading player history...
          </div>
        ) : evaluations.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Player History</p>
            <p className="mt-3 text-xl font-semibold text-[var(--text-primary)]">No history for this player yet</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Once evaluations are saved for this player, the full review trail will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedEvaluations.items.map((evaluation) => {
              const responseItems = getExportResponseItems(evaluation)
              const selectedResponseItems = getSelectedEvaluationResponses(responseItems, selectedExportLabels)
              const summary = buildEvaluationSummary(evaluation)
              const canShare = canShareEvaluation(user, evaluation)
              const evaluationParentContacts = getEvaluationParentContacts(evaluation)
              const selectedTemplateKey = getSelectedEmailTemplateKey(evaluation)
              const availableEmailTemplates = isSquadPlayer ? [ASSESSMENT_EMAIL_TEMPLATE] : PARENT_EMAIL_TEMPLATES
              const shouldShowInviteDate = isInviteEmailTemplate(selectedTemplateKey)
              const hasSavedExportSelection = Array.isArray(selectedExportLabels)

              return (
                <div
                  key={evaluation.id}
                  className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:p-5"
                >
                  <div>
                    <div>
                      <p className="text-lg font-semibold text-[var(--text-primary)]">{evaluation.date || 'No date entered'}</p>
                      {evaluation.session ? <p className="mt-1 text-sm text-[var(--text-muted)]">Session: {evaluation.session}</p> : null}
                      <p className="mt-1 text-sm text-[var(--text-muted)]">Section: {evaluation.section || 'Trial'}</p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">Move report to another player</p>
                        <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                          Use this if a report was saved against the wrong player.
                        </p>
                      </div>
                      {canDeleteEvaluations ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteEvaluation(evaluation)}
                          disabled={isDeletingEvaluationId === evaluation.id}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-500/40 bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isDeletingEvaluationId === evaluation.id ? 'Deleting...' : 'Delete Assessment'}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                      Deleting an old assessment removes it from this player history and average score calculations.
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Correct player</span>
                        <select
                          value={selectedReassignTargets[evaluation.id] || ''}
                          onChange={(event) => handleReassignTargetChange(evaluation.id, event.target.value)}
                          disabled={reassignPlayerOptions.length === 0}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="">
                            {reassignPlayerOptions.length === 0 ? 'No other players available' : 'Select player'}
                          </option>
                          {reassignPlayerOptions.map((player) => (
                            <option key={player.id} value={player.id}>
                              {player.playerName} | {player.section || 'Trial'} | {player.team || 'No team'}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleReassignEvaluation(evaluation)}
                        disabled={!selectedReassignTargets[evaluation.id] || isReassigningId === evaluation.id}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
                      >
                        {isReassigningId === evaluation.id ? 'Moving...' : 'Move Report'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_minmax(220px,1fr)_auto_auto_auto] xl:items-end">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email template</span>
                      <select
                        value={selectedTemplateKey}
                        onChange={(event) =>
                          setSelectedEmailTemplates((currentTemplates) => ({
                            ...currentTemplates,
                            [evaluation.id]: event.target.value,
                          }))
                        }
                        className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                      >
                        {availableEmailTemplates.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {shouldShowInviteDate ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Invite date</span>
                        <input
                          type="date"
                          value={getSelectedInviteDate(evaluation)}
                          onChange={(event) =>
                            setSelectedInviteDates((currentDates) => ({
                              ...currentDates,
                              [evaluation.id]: event.target.value,
                            }))
                          }
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                    ) : (
                      <div className="hidden xl:block" />
                    )}
                    <div>
                      <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">PDF recipients</span>
                      {evaluationParentContacts.length > 0 ? (
                        <div className="space-y-2 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] p-3">
                          {evaluationParentContacts.map((contact, index) => {
                            const selectedIndexes =
                              selectedParentContacts[evaluation.id] ?? evaluationParentContacts.map((_, contactIndex) => contactIndex)

                            return (
                              <label key={`${contact.email || contact.name}-${index}`} className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                                <input
                                  type="checkbox"
                                  checked={selectedIndexes.includes(index)}
                                  onChange={() => handleToggleEvaluationParentContact(evaluation.id, index, evaluationParentContacts)}
                                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                                />
                                <span className="min-w-0">
                                  <span className="block font-semibold">{contact.name || 'Parent/Guardian'}</span>
                                  <span className="block break-words text-xs text-[var(--text-muted)]">{contact.email || 'No email entered'}</span>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-muted)]">
                          No parent contacts entered.
                        </div>
                      )}
                    </div>
                    <div className="xl:col-span-6">
                      <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">Evaluation details to include</p>
                            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                              Choose what goes into the parent email and PDF. This choice is saved in this browser for {routePlayerName}.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleSetAllExportFields(responseItems)}
                              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={handleClearExportFields}
                              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        {responseItems.length > 0 ? (
                          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {responseItems.map((item) => {
                              const isSelected = hasSavedExportSelection
                                ? selectedExportLabels.includes(item.label)
                                : true

                              return (
                                <label
                                  key={item.label}
                                  className="flex min-h-11 items-start gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleExportField(item.label, responseItems)}
                                    className="mt-1 h-4 w-4 accent-[var(--accent)]"
                                  />
                                  <span className="min-w-0">
                                    <span className="block font-semibold">{item.label}</span>
                                    <span className="line-clamp-2 block break-words text-xs leading-5 text-[var(--text-muted)]">
                                      {String(item.value ?? '').trim() || 'No data entered'}
                                    </span>
                                  </span>
                                </label>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="mt-4 rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-muted)]">
                            No evaluation responses were entered for this assessment.
                          </p>
                        )}

                        <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
                          {selectedResponseItems.length} of {responseItems.length} field{responseItems.length === 1 ? '' : 's'} selected.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(evaluation, 'scored')}
                      disabled={pdfLoadingId === `${evaluation.id}:scored` || !canShare || !hasPlanFeature(user, 'pdfExport')}
                      title="Download scored PDF"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pdfLoadingId === `${evaluation.id}:scored` ? 'Preparing...' : 'PDF With Scores'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(evaluation, 'without-scores')}
                      disabled={pdfLoadingId === `${evaluation.id}:without-scores` || !canShare || !hasPlanFeature(user, 'pdfExport')}
                      title="Download PDF without scores"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pdfLoadingId === `${evaluation.id}:without-scores` ? 'Preparing...' : 'PDF Without Scores'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(evaluation, 'email')}
                      disabled={pdfLoadingId === `${evaluation.id}:email` || !canShare || !hasPlanFeature(user, 'pdfExport')}
                      title="Download email template PDF"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pdfLoadingId === `${evaluation.id}:email` ? 'Preparing...' : 'Email Template PDF'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSendParentEmail(evaluation)}
                      disabled={emailSendingId === evaluation.id || !canShare || !hasPlanFeature(user, 'parentEmail')}
                      title="Send parent email"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {emailSendingId === evaluation.id ? 'Sending...' : 'Email Parents'}
                    </button>
                    {canEditEvaluation(user, evaluation) ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/assess-player?evaluationId=${encodeURIComponent(evaluation.id)}&player=${encodeURIComponent(routePlayerName)}&team=${encodeURIComponent(evaluation.team || '')}&section=${encodeURIComponent(evaluation.section || 'Trial')}&session=${encodeURIComponent(evaluation.session || '')}`)}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Edit Assessment
                      </button>
                    ) : null}
                  </div>

                  {selectedTemplateKey === 'decline' && canDeletePlayer(user) ? (
                    <div className="mt-4 rounded-[20px] border border-red-500/30 bg-red-950/20 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[var(--text-primary)]">No place offered</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                            If this player is no longer needed, you can remove them from the system after preparing the parent PDF.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={handleDeletePlayer}
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isDeleting ? 'Removing...' : 'Remove From System'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {evaluationParentContacts.length > 0 ? (
                    <div className="mt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Parent details</p>
                      <div className="mt-3 space-y-1">
                        {evaluationParentContacts.map((contact, index) => (
                          <p key={index} className="break-words text-sm leading-6 text-[var(--text-muted)]">
                            {contact.name || 'Parent/Guardian'}{contact.email ? ` | ${contact.email}` : ''}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Summary</p>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">{summary}</p>
                  </div>

                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Responses</p>
                    <div className="mt-3 space-y-2">
                      {responseItems.length > 0 ? (
                        responseItems.map((item) => (
                          <div key={item.label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{item.label}</p>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">{String(item.value)}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm leading-6 text-[var(--text-muted)]">No responses provided.</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            <Pagination
              currentPage={evaluationPage}
              onPageChange={setEvaluationPage}
              pageSize={PROFILE_EVALUATION_PAGE_SIZE}
              totalItems={evaluations.length}
            />
          </div>
        )}
      </SectionCard>

      <ConfirmModal
        isOpen={Boolean(evaluationDeleteTarget)}
        isBusy={Boolean(isDeletingEvaluationId)}
        title="Delete assessment"
        message="This removes the assessment from the player history and average score calculations."
        items={[
          `Player: ${evaluationDeleteTarget?.playerName || routePlayerName}`,
          `Date: ${evaluationDeleteTarget?.date || 'No date entered'}`,
          `Session: ${evaluationDeleteTarget?.session || 'No session entered'}`,
          `Team: ${evaluationDeleteTarget?.team || 'No team entered'}`,
        ]}
        confirmLabel="Delete Assessment"
        onCancel={() => setEvaluationDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteEvaluation(password)}
      />

      <ConfirmModal
        isOpen={Boolean(reassignConfirmTarget)}
        isBusy={Boolean(isReassigningId)}
        title="Move assessment"
        message="Use this when a report was saved against the wrong player."
        itemsTitle="This will change:"
        items={[
          `From player: ${routePlayerName}`,
          `To player: ${reassignConfirmTarget?.targetPlayer?.playerName || 'Selected player'}`,
          `Assessment date: ${reassignConfirmTarget?.evaluation?.date || 'No date entered'}`,
        ]}
        confirmLabel="Move Assessment"
        onCancel={() => setReassignConfirmTarget(null)}
        onConfirm={() => void confirmReassignEvaluation()}
      />

      <ConfirmModal
        isOpen={isMergeConfirmOpen}
        isBusy={isMergingEvaluations}
        title="Create merged assessment"
        message="This creates a new merged assessment. Source reports stay in history."
        itemsTitle="This will create:"
        items={[
          `Player: ${routePlayerName}`,
          `${mergeSelectedEvaluations.length} selected assessments merged into one new assessment`,
          'Original assessments will stay unchanged',
        ]}
        confirmLabel="Create Merged Assessment"
        onCancel={() => setIsMergeConfirmOpen(false)}
        onConfirm={() => void confirmCreateMergedEvaluation()}
      />

      <ConfirmModal
        isOpen={Boolean(playerDeleteTarget)}
        isBusy={isDeleting}
        title="Delete player"
        message="This moves the player into archived players. Their saved assessments stay available for record keeping."
        items={[
          `Player: ${playerDeleteTarget?.playerName || routePlayerName}`,
          `${playerDeleteTarget?.playerCount ?? players.length} player record entries moved to archive`,
          `${playerDeleteTarget?.evaluationCount ?? evaluations.length} saved assessments kept in history`,
        ]}
        itemsTitle="This will archive:"
        confirmLabel="Archive Player"
        onCancel={() => setPlayerDeleteTarget(null)}
        requireReason
        reasonLabel="Archive reason"
        reasonPlaceholder="Explain why this player is being archived."
        requirePassword
        onConfirm={(password, reason) => void confirmDeletePlayer(password, reason)}
      />

      <ConfirmModal
        isOpen={Boolean(emailConfirmTarget)}
        isBusy={Boolean(emailConfirmTarget?.evaluation && emailSendingId === emailConfirmTarget.evaluation.id)}
        title="Email parents"
        message="Check the parent email details before sending."
        itemsTitle="This will send:"
        items={[
          `Player: ${routePlayerName}`,
          `Recipients: ${emailConfirmTarget?.recipientEmails || 'No recipients selected'}`,
          `Template: ${emailConfirmTarget?.templateName || 'Parent email'}`,
          `Subject: ${emailConfirmTarget?.payload?.subject || 'Player Feedback Report'}`,
          `Team: ${emailConfirmTarget?.payload?.team || 'No team entered'}`,
          `Club: ${emailConfirmTarget?.payload?.club || 'No club entered'}`,
          `PDF attachment: Yes`,
          `Evaluation fields: ${emailConfirmTarget?.responses?.length || 0} selected`,
          emailConfirmTarget?.inviteDate ? `Invite date: ${emailConfirmTarget.inviteDate}` : 'Invite date: Not included',
        ]}
        confirmLabel="Send Now"
        onCancel={() => setEmailConfirmTarget(null)}
        onConfirm={() => void confirmSendParentEmail()}
      />
    </div>
  )
}
