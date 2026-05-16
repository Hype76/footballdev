import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PlayerDetailsSection } from '../components/players/PlayerDetailsSection.jsx'
import { PlayerEvaluationsHistory } from '../components/players/PlayerEvaluationsHistory.jsx'
import { PlayerMergeAssessments } from '../components/players/PlayerMergeAssessments.jsx'
import { PlayerOverview } from '../components/players/PlayerOverview.jsx'
import { PlayerProfileActions } from '../components/players/PlayerProfileActions.jsx'
import { PlayerProfileModals } from '../components/players/PlayerProfileModals.jsx'
import { PlayerStaffActivity } from '../components/players/PlayerStaffActivity.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canDeletePlayer, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import {
  DIRECT_EMAIL_TEMPLATE_SECTION,
  EMAIL_TEMPLATE_AUDIENCES,
  getEmailTemplateKey,
  mergeEmailTemplatesWithDefaults,
  normalizeEmailTemplateAudience,
} from '../lib/email-templates.js'
import { sendParentEmail, sendParentPortalInvite } from '../lib/email-builder.js'
import { isDemoUser } from '../lib/demo.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  getSavedEvaluationExportLabels,
  getSelectedEvaluationResponses,
  reorderEvaluationExportLabels,
  saveEvaluationExportLabels,
} from '../lib/evaluation-export-selection.js'
import { buildAssessmentPdfHtml } from '../lib/assessment-pdf-html.js'
import {
  buildFieldMovement,
  buildMergeDetailFields,
  buildMergePreviewResponses,
  buildMergedEvaluationPayload,
  buildPlayerProfileCachePayload,
  buildPlayerDirectEmailPayload,
  buildPlayerProfileParentEmailPayload,
  buildReassignedEvaluationPayload,
  buildRatingTrend,
  calculateMergedAverage,
  clearEvaluationIdFromSourceMap,
  addParentContactDraft,
  addPlayerPositionDraft,
  createPlayerDraft,
  getEditableParentContacts,
  getNextEvaluationParentContactIndexes,
  getMergeFieldLabels,
  getRemainingMergeCoreSourceId,
  getProfileContactDetails,
  getProfilePlayers,
  getReassignPlayerOptions,
  keepOnlySelectedSourceIds,
  PROFILE_EVALUATION_PAGE_SIZE,
  removeEvaluationIdFromSelection,
  removeParentContactDraft,
  removePlayerPositionDraft,
  startEditingPlayerDraft,
  updateParentContactDraft,
  updatePlayerDraftValue,
} from '../hooks/players/playerProfileUtils.js'
import { isExportableResponseValue } from '../hooks/evaluations/evaluationFormUtils.js'
import { getRecorderOptions } from '../lib/session-page-utils.js'
import {
  EVALUATION_SECTIONS,
  PLAYER_CONTACT_TYPES,
  archivePlayer,
  createCommunicationLog,
  createPlayerStaffNote,
  createEvaluation,
  deletePlayerStaffNote,
  deleteEvaluation,
  getEvaluations,
  getPlayerCommunicationLogs,
  getPlayerStaffNotes,
  getParentEmailTemplates,
  getContactTemplateAudiences,
  getPlayers,
  normalizeParentContacts,
  normalizePlayerContactType,
  clearViewCaches,
  createParentPortalInvites,
  movePlayerToTrial,
  promotePlayerToSquad,
  readViewCache,
  readViewCacheValue,
  updateEvaluation,
  updatePlayer,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function getPlayerPortalContacts(player) {
  const contacts = Array.isArray(player?.parentContacts) && player.parentContacts.length > 0
    ? player.parentContacts
    : [{ name: player?.parentName || '', email: player?.parentEmail || '' }]

  return contacts
    .map((contact) => ({
      name: String(contact?.name ?? '').trim(),
      email: String(contact?.email ?? '').trim().toLowerCase(),
    }))
    .filter((contact) => contact.email)
}

export function PlayerProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isDemoAccount = isDemoUser(user)
  const { showToast } = useToast()
  const routePlayerName = decodeURIComponent(id)
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'all'
  const cacheKey = user ? `player:${user.id}:${user.clubId || 'platform'}:${activeTeamScope}:${routePlayerName}` : ''
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
  const [isSavingVoiceNote, setIsSavingVoiceNote] = useState(false)
  const [isRecordingVoiceNote, setIsRecordingVoiceNote] = useState(false)
  const [deletingStaffNoteId, setDeletingStaffNoteId] = useState('')
  const [isPromotingId, setIsPromotingId] = useState('')
  const [isReassigningId, setIsReassigningId] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeletingEvaluationId, setIsDeletingEvaluationId] = useState('')
  const [isMergingEvaluations, setIsMergingEvaluations] = useState(false)
  const [emailSendingId, setEmailSendingId] = useState('')
  const [selectedReassignTargets, setSelectedReassignTargets] = useState({})
  const [mergeSelectedIds, setMergeSelectedIds] = useState([])
  const [mergeCoreSourceId, setMergeCoreSourceId] = useState('')
  const [mergeDetailSources, setMergeDetailSources] = useState({})
  const [mergeFieldSources, setMergeFieldSources] = useState({})
  const [selectedEmailTemplates, setSelectedEmailTemplates] = useState({})
  const [emailTemplates, setEmailTemplates] = useState([])
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
  const [noPlaceArchiveTarget, setNoPlaceArchiveTarget] = useState(null)
  const [evaluationDeleteTarget, setEvaluationDeleteTarget] = useState(null)
  const [staffNoteDeleteTarget, setStaffNoteDeleteTarget] = useState(null)
  const [promoteConfirmTarget, setPromoteConfirmTarget] = useState(null)
  const [sendParentPortalLinkOnPromote, setSendParentPortalLinkOnPromote] = useState(true)
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingStartedAtRef = useRef(0)
  const [emailConfirmTarget, setEmailConfirmTarget] = useState(null)
  const [isPdfAttachmentApproved, setIsPdfAttachmentApproved] = useState(false)
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

  const loadEmailTemplates = useCallback(async () => {
    if (!user?.clubId || !hasPlanFeature(user, 'parentEmail')) {
      setEmailTemplates([])
      return
    }

    try {
      const nextTemplates = mergeEmailTemplatesWithDefaults(
        await getParentEmailTemplates({ user, audience: 'all' }),
        'all',
      )
      setEmailTemplates(nextTemplates)
    } catch (error) {
      console.error(error)
      setEmailTemplates(mergeEmailTemplatesWithDefaults([], 'all'))
    }
  }, [user])

  useEffect(() => {
    let isMounted = true

    const loadMountedEmailTemplates = async () => {
      if (!isMounted) {
        return
      }

      await loadEmailTemplates()
    }

    void loadMountedEmailTemplates()

    return () => {
      isMounted = false
    }
  }, [loadEmailTemplates, userScopeKey])

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

  const profilePlayers = useMemo(() => getProfilePlayers(players), [players])
  const lastSection = profilePlayers[0]?.section || evaluations[0]?.section || 'Trial'
  const lastTeam = profilePlayers[0]?.team || evaluations[0]?.team || ''
  const primaryPlayer = profilePlayers[0]
  const {
    profileContactType,
    profileParentContacts,
    profileParentEmail,
    profileParentName,
  } = useMemo(
    () => getProfileContactDetails({ primaryPlayer, evaluations }),
    [evaluations, primaryPlayer],
  )
  const reassignPlayerOptions = useMemo(
    () => getReassignPlayerOptions(allPlayers, routePlayerName),
    [allPlayers, routePlayerName],
  )
  const canMergeEvaluations = Boolean(user?.clubId) && Number(user?.roleRank ?? 0) >= 50 && evaluations.length > 1
  const canDeleteEvaluations = Boolean(user?.id) && (user.role === 'super_admin' || Number(user?.roleRank ?? 0) >= 50)
  const mergeSelectedEvaluations = useMemo(
    () => evaluations.filter((evaluation) => mergeSelectedIds.includes(evaluation.id)),
    [evaluations, mergeSelectedIds],
  )
  const mergeFieldLabels = useMemo(
    () => getMergeFieldLabels(mergeSelectedEvaluations),
    [mergeSelectedEvaluations],
  )
  const mergeCoreSource = mergeSelectedEvaluations.find((evaluation) => evaluation.id === mergeCoreSourceId) ?? mergeSelectedEvaluations[0]
  const getMergeSourceById = (sourceId) =>
    mergeSelectedEvaluations.find((evaluation) => evaluation.id === sourceId) ?? mergeCoreSource ?? mergeSelectedEvaluations[0]
  const getMergeDetailSource = (fieldName) => getMergeSourceById(mergeDetailSources[fieldName] || mergeCoreSource?.id)
  const mergeDetailFields = useMemo(
    () => buildMergeDetailFields(routePlayerName),
    [routePlayerName],
  )
  const mergePreviewResponses = useMemo(
    () => buildMergePreviewResponses({
      mergeCoreSource,
      mergeFieldLabels,
      mergeFieldSources,
      mergeSelectedEvaluations,
    }),
    [mergeCoreSource, mergeFieldLabels, mergeFieldSources, mergeSelectedEvaluations],
  )
  const mergePreviewAverage = useMemo(
    () => calculateMergedAverage(mergePreviewResponses),
    [mergePreviewResponses],
  )

  const activeEmailTemplates = emailTemplates.filter((template) => template.isEnabled !== false)
  const getEvaluationContactType = (evaluation) => normalizePlayerContactType(evaluation.contactType || profileContactType)
  const getEmailPreviewAudience = (evaluation) =>
    getEvaluationContactType(evaluation) === PLAYER_CONTACT_TYPES.self ? EMAIL_TEMPLATE_AUDIENCES.player : EMAIL_TEMPLATE_AUDIENCES.parent
  const getAvailableEmailTemplates = (evaluation, audience = getEmailPreviewAudience(evaluation)) =>
    activeEmailTemplates.filter((template) => {
      if (normalizeEmailTemplateAudience(template.audience) !== audience) {
        return false
      }

      const sectionAvailability = Array.isArray(template.sectionAvailability)
        ? template.sectionAvailability
        : EVALUATION_SECTIONS

      return sectionAvailability.includes(evaluation.section || lastSection)
    })
  const getDirectEmailTemplateOptions = (player) => {
    const contactType = normalizePlayerContactType(player?.contactType || profileContactType)
    const audiences = getContactTemplateAudiences(contactType)

    return activeEmailTemplates
      .filter((template) => {
        if (!audiences.includes(normalizeEmailTemplateAudience(template.audience))) {
          return false
        }

        const sectionAvailability = Array.isArray(template.sectionAvailability)
          ? template.sectionAvailability
          : [DIRECT_EMAIL_TEMPLATE_SECTION]

        return sectionAvailability.includes(DIRECT_EMAIL_TEMPLATE_SECTION)
      })
      .map((template) => ({
        ...template,
        optionKey: `${normalizeEmailTemplateAudience(template.audience)}:${template.key}`,
      }))
  }
  const getSelectedDirectEmailTemplateOption = (player) => {
    const options = getDirectEmailTemplateOptions(player)
    const selectedKey = selectedEmailTemplates[`direct:${player.id}`] || options[0]?.optionKey || ''

    return options.find((template) => template.optionKey === selectedKey) ?? options[0] ?? null
  }
  const getSelectedEmailTemplate = (evaluation, audience = getEmailPreviewAudience(evaluation)) => {
    const availableTemplates = getAvailableEmailTemplates(evaluation, audience)
    const selectedKey = selectedEmailTemplates[evaluation.id] || getEmailTemplateKey(evaluation.decision)
    return availableTemplates.find((template) => template.key === selectedKey) ?? availableTemplates[0] ?? null
  }
  const getSelectedEmailTemplateKey = (evaluation) => getSelectedEmailTemplate(evaluation)?.key || ''
  const getSelectedInviteDate = (evaluation) => selectedInviteDates[evaluation.id] || ''
  const getEvaluationParentContacts = (evaluation) =>
    normalizeParentContacts(evaluation.parentContacts?.length ? evaluation.parentContacts : profileParentContacts, {
      parentName: evaluation.parentName || profileParentName,
      parentEmail: evaluation.parentEmail || profileParentEmail,
      contactType: getEvaluationContactType(evaluation),
    })
  const getSelectedEvaluationParentContacts = (evaluation) => {
    const contacts = getEvaluationParentContacts(evaluation)
    const selectedIndexes = selectedParentContacts[evaluation.id] ?? contacts.map((_, index) => index)
    const nextContacts = contacts.filter((_, index) => selectedIndexes.includes(index))

    return nextContacts.length > 0 ? nextContacts : contacts.slice(0, 1)
  }

  const getExportResponseItems = (evaluation) =>
    Object.entries(evaluation.formResponses ?? {})
      .filter(([, value]) => isExportableResponseValue(value))
      .map(([label, value]) => ({
        label,
        value,
      }))

  const getSelectedExportResponseItems = (evaluation) =>
    getSelectedEvaluationResponses(getExportResponseItems(evaluation), selectedExportLabels)

  const buildParentEmailPayload = (evaluation) => {
    return buildPlayerProfileParentEmailPayload({
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
    })
  }

  const buildDirectEmailPayload = (player) => {
    const selectedTemplate = getSelectedDirectEmailTemplateOption(player)
    const contacts = normalizeParentContacts(player.parentContacts, {
      parentName: player.parentName,
      parentEmail: player.parentEmail,
      contactType: normalizePlayerContactType(player.contactType || profileContactType),
    })

    return buildPlayerDirectEmailPayload({
      audience: normalizeEmailTemplateAudience(selectedTemplate?.audience),
      contacts,
      player,
      routePlayerName,
      selectedTemplate,
      user,
    })
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

  const handleReorderExportField = (sourceLabel, targetLabel, responseItems) => {
    const nextLabels = reorderEvaluationExportLabels({
      sourceLabel,
      targetLabel,
      responseItems,
      selectedLabels: selectedExportLabels,
    })

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

  const handlePlayerDraftChange = (playerId, fieldName, value) => {
    setErrorMessage('')
    setPlayerDrafts((current) => updatePlayerDraftValue(current, playerId, fieldName, value))
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
        setErrorMessage('Add an email contact before sending.')
        return
      }

      setIsPdfAttachmentApproved(false)
      setEmailConfirmTarget(emailDetails)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not prepare the parent email.')
    }
  }

  const handleSendTestEmail = async (evaluation) => {
    if (emailSendingId) {
      return
    }

    setErrorMessage('')

    try {
      if (!hasPlanFeature(user, 'parentEmail')) {
        setErrorMessage(createFeatureUpgradeMessage('parentEmail'))
        return
      }

      if (!user?.email) {
        setErrorMessage('Your account email is not available, so the test email cannot be sent.')
        return
      }

      const responses = getSelectedExportResponseItems(evaluation)
      const recipientName = user.displayName || user.username || user.name || user.email
      const teamName = user.emailTeamName || evaluation.team
      const clubName = user.emailClubName || user.clubName

      setEmailSendingId(`test:${evaluation.id}`)
      await sendParentEmail({
        clubId: user.clubId,
        userId: user.id,
        parentEmail: user.email,
        parentName: recipientName,
        senderEmail: user.email,
        displayName: recipientName,
        team: teamName,
        club: clubName,
        section: evaluation.section,
        session: evaluation.session,
        planKey: user.planKey,
        logoUrl: user.clubLogoUrl || null,
        replyToEmail: user.replyToEmail || user.clubContactEmail,
        clubContactEmail: user.clubContactEmail,
        playerName: routePlayerName,
        responses,
        subject: `Test assessment copy for ${routePlayerName}`,
        emailBody: `This is a test copy of the saved assessment for ${routePlayerName}. It was sent only to your signed-in account.`,
        pdfHtml: buildAssessmentPdfHtml({
          clubName,
          playerName: routePlayerName,
          teamName,
          section: evaluation.section,
          session: evaluation.session,
          logoUrl: user.clubLogoUrl || null,
          responseItems: responses,
        }),
        evaluationId: evaluation.id,
        attachPdf: true,
      })

      showToast({ title: 'Test email sent', message: `Sent to ${user.email}.` })

      const playerId = evaluation.playerId || primaryPlayer?.id
      await createCommunicationLog({
        user,
        playerId,
        evaluationId: evaluation.id,
        channel: 'email',
        action: 'test_email_sent',
        recipientEmail: user.email,
      })

      if (playerId) {
        const nextActivity = await getPlayerCommunicationLogs({ user, playerId })
        setActivityLogs(nextActivity)
      }
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Test email not sent',
        message: error.message || 'The test email could not be sent right now. Try again in a moment.',
        tone: 'error',
      })
    } finally {
      setEmailSendingId('')
    }
  }

  const handleSendDirectEmail = (player) => {
    if (emailSendingId) {
      return
    }

    setErrorMessage('')

    try {
      if (!hasPlanFeature(user, 'parentEmail')) {
        setErrorMessage(createFeatureUpgradeMessage('parentEmail'))
        return
      }

      const emailDetails = buildDirectEmailPayload(player)

      if (!emailDetails.recipientEmails) {
        setErrorMessage('Add an email contact before sending.')
        return
      }

      setIsPdfAttachmentApproved(false)
      setEmailConfirmTarget(emailDetails)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not prepare this email.')
    }
  }

  const confirmSendParentEmail = async () => {
    if (!emailConfirmTarget?.evaluation || emailSendingId) {
      return
    }

    const { evaluation, payloads, recipientEmails } = emailConfirmTarget
    setEmailSendingId(evaluation.id)
    setErrorMessage('')

    try {
      const attachPdf = isPdfAttachmentApproved
      await Promise.all(payloads.map((item) => sendParentEmail({ ...item.payload, attachPdf })))
      showToast({ title: 'Email sent successfully' })

      const playerId = evaluation.playerId || primaryPlayer?.id
      await createCommunicationLog({
        user,
        playerId,
        evaluationId: evaluation.isDirectEmail ? null : evaluation.id,
        channel: 'email',
        action: 'parent_email_sent',
        recipientEmail: recipientEmails,
      })

      if (playerId) {
        const nextActivity = await getPlayerCommunicationLogs({ user, playerId })
        setActivityLogs(nextActivity)
      }

      if (!evaluation.isDirectEmail && emailConfirmTarget.templateKey === 'decline' && canDeletePlayer(user) && players.length > 0) {
        setNoPlaceArchiveTarget({
          playerName: routePlayerName,
          playerCount: players.length,
          evaluationCount: evaluations.length,
        })
      }
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Email not sent',
        message: error.message || 'This email could not be sent right now. Try again in a moment.',
        tone: 'error',
      })
    } finally {
      setEmailSendingId('')
      setEmailConfirmTarget(null)
      setIsPdfAttachmentApproved(false)
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
      showToast({ title: 'Note saved', message: 'The staff note has been saved.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save staff note.')
    } finally {
      setIsSavingNote(false)
    }
  }

  const handleStartProfileVoiceNote = async () => {
    if (!primaryPlayer?.id) {
      setErrorMessage('Player details are not available yet.')
      return
    }

    if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Voice recording is not supported in this browser.')
      showToast({ title: 'Voice note not started', message: 'Voice recording is not supported in this browser.', tone: 'error' })
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new globalThis.MediaRecorder(stream, getRecorderOptions())
      recordingChunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      setIsRecordingVoiceNote(true)
      setErrorMessage('')

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const chunks = recordingChunksRef.current
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000))
        stream.getTracks().forEach((track) => track.stop())
        mediaRecorderRef.current = null
        recordingChunksRef.current = []

        if (chunks.length === 0) {
          setIsRecordingVoiceNote(false)
          setErrorMessage('No audio was captured. Try recording again.')
          return
        }

        const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        setIsSavingVoiceNote(true)

        try {
          const nextNote = await createPlayerStaffNote({
            user,
            playerId: primaryPlayer.id,
            note: noteDraft.trim() || `Voice note for ${primaryPlayer.playerName || routePlayerName}`,
            audioBlob,
            audioDurationSeconds: durationSeconds,
          })
          const nextActivity = await getPlayerCommunicationLogs({ user, playerId: primaryPlayer.id })
          setStaffNotes((current) => [nextNote, ...current])
          setActivityLogs(nextActivity)
          setNoteDraft('')
          showToast({ title: 'Voice note saved', message: 'Saved to this player profile.' })
        } catch (error) {
          console.error(error)
          setErrorMessage(error.message || 'Could not save the voice note.')
          showToast({ title: 'Voice note not saved', message: error.message || 'Could not save the voice note.', tone: 'error' })
        } finally {
          setIsRecordingVoiceNote(false)
          setIsSavingVoiceNote(false)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
    } catch (error) {
      console.error(error)
      setIsRecordingVoiceNote(false)
      setErrorMessage('Microphone access was not allowed.')
      showToast({ title: 'Voice note not started', message: 'Microphone access was not allowed.', tone: 'error' })
    }
  }

  const handleStopProfileVoiceNote = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  const confirmDeleteStaffNote = async () => {
    if (!staffNoteDeleteTarget?.id) {
      return
    }

    setDeletingStaffNoteId(staffNoteDeleteTarget.id)
    setErrorMessage('')

    try {
      await deletePlayerStaffNote({ noteId: staffNoteDeleteTarget.id })
      setStaffNotes((currentNotes) => currentNotes.filter((note) => note.id !== staffNoteDeleteTarget.id))
      showToast({ title: 'Voice note deleted', message: 'The voice note has been removed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Voice note could not be deleted.')
      showToast({ title: 'Voice note not deleted', message: error.message || 'Voice note could not be deleted.', tone: 'error' })
    } finally {
      setDeletingStaffNoteId('')
      setStaffNoteDeleteTarget(null)
    }
  }

  const handleStartEditingPlayer = (player) => {
    setErrorMessage('')
    setPlayerDrafts((current) => startEditingPlayerDraft(current, player))
    setEditingPlayerId(player.id)
  }

  const handleParentContactDraftChange = (playerId, index, fieldName, value) => {
    setErrorMessage('')
    setPlayerDrafts((current) => updateParentContactDraft(current, playerId, index, fieldName, value))
  }

  const handleAddParentContact = (playerId) => {
    setErrorMessage('')
    setPlayerDrafts((current) => addParentContactDraft(current, playerId))
  }

  const handleRemoveParentContact = (playerId, index) => {
    setErrorMessage('')
    setPlayerDrafts((current) => removeParentContactDraft(current, playerId, index))
  }

  const handleToggleEvaluationParentContact = (evaluationId, index, contacts) => {
    setSelectedParentContacts((current) => {
      const currentIndexes = current[evaluationId] ?? contacts.map((_, contactIndex) => contactIndex)
      return {
        ...current,
        [evaluationId]: getNextEvaluationParentContactIndexes({ contacts, currentIndexes, index }),
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
        buildReassignedEvaluationPayload({ evaluation, targetPlayer, targetParentContacts, user }),
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
      writeViewCache(cacheKey, buildPlayerProfileCachePayload({ evaluations: nextEvaluations, players, allPlayers }))
      showToast({ title: 'Assessment moved', message: 'The report has been moved to the selected player.' })
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
        keepOnlySelectedSourceIds(currentSources, nextIds),
      )
      setMergeDetailSources((currentSources) =>
        keepOnlySelectedSourceIds(currentSources, nextIds),
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
      const mergedEvaluation = await createEvaluation(
        buildMergedEvaluationPayload({
          getMergeDetailSource,
          mergeCoreSource,
          mergePreviewAverage,
          mergePreviewResponses,
          mergeSelectedEvaluations,
          primaryPlayer,
          routePlayerName,
          user,
        }),
      )
      const nextEvaluations = [mergedEvaluation, ...evaluations]

      setEvaluations(nextEvaluations)
      setMergeSelectedIds([])
      setMergeCoreSourceId('')
      setMergeDetailSources({})
      setMergeFieldSources({})
      clearViewCaches()
      writeViewCache(cacheKey, buildPlayerProfileCachePayload({ evaluations: nextEvaluations, players, allPlayers }))
      showToast({ title: 'Merged assessment saved', message: 'The selected assessments have been merged.' })
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
      setMergeSelectedIds((currentIds) => removeEvaluationIdFromSelection(currentIds, evaluationDeleteTarget.id))
      setMergeCoreSourceId((currentSourceId) => getRemainingMergeCoreSourceId(currentSourceId, evaluationDeleteTarget.id))
      setMergeFieldSources((currentSources) =>
        clearEvaluationIdFromSourceMap(currentSources, evaluationDeleteTarget.id),
      )
      setMergeDetailSources((currentSources) =>
        clearEvaluationIdFromSourceMap(currentSources, evaluationDeleteTarget.id),
      )
      clearViewCaches()
      writeViewCache(cacheKey, buildPlayerProfileCachePayload({ evaluations: nextEvaluations, players, allPlayers }))
      showToast({ title: 'Assessment deleted', message: 'The assessment has been removed.' })
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
    setPlayerDrafts((current) => addPlayerPositionDraft(current, playerId, nextPosition))
  }

  const handleRemovePlayerPosition = (playerId, positionToRemove) => {
    setErrorMessage('')
    setPlayerDrafts((current) => removePlayerPositionDraft(current, playerId, positionToRemove))
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
          contactType: PLAYER_CONTACT_TYPES.parent,
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
      showToast({ title: 'Player saved', message: `${savedPlayer.playerName} details have been updated.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save player details.')
    } finally {
      setIsSavingPlayer(false)
    }
  }

  const handlePromotePlayer = (playerId) => {
    const targetPlayer = players.find((player) => String(player.id) === String(playerId))

    if (!targetPlayer) {
      setErrorMessage('Player details could not be found.')
      return
    }

    setPromoteConfirmTarget(targetPlayer)
    setSendParentPortalLinkOnPromote(getPlayerPortalContacts(targetPlayer).length > 0)
  }

  const sendParentPortalInvitesForPlayer = async (player) => {
    const contacts = getPlayerPortalContacts(player)

    if (contacts.length === 0) {
      return []
    }

    const invites = await createParentPortalInvites({
      user,
      player,
      contacts,
    })

    await Promise.all(
      invites.map((invite) =>
        sendParentPortalInvite({
          clubId: invite.clubId,
          inviteLinkId: invite.id,
          parentEmail: invite.email,
          senderEmail: user.email,
          displayName: user.displayName || user.username || user.name,
          teamName: invite.teamName,
          clubName: invite.clubName || user.clubName,
          playerName: invite.playerName,
          subject: `Parent portal invite for ${invite.playerName}`,
          inviteUrl: invite.inviteUrl,
        }),
      ),
    )

    return invites
  }

  const confirmPromotePlayer = async () => {
    if (!promoteConfirmTarget?.id) {
      return
    }

    const playerId = promoteConfirmTarget.id
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

      let inviteCount = 0
      let inviteError = null
      if (sendParentPortalLinkOnPromote) {
        try {
          const invites = await sendParentPortalInvitesForPlayer(promotedPlayer)
          inviteCount = invites.length
        } catch (error) {
          console.error(error)
          inviteError = error
          setErrorMessage(error.message || 'Player was promoted, but the parent portal invite could not be sent.')
        }
      }

      showToast({
        title: 'Player promoted',
        message: inviteError
          ? `${promotedPlayer.playerName} has been moved to Squad, but the parent invite could not be sent.`
          : sendParentPortalLinkOnPromote
            ? `${promotedPlayer.playerName} has been moved to Squad. ${inviteCount} parent invite${inviteCount === 1 ? '' : 's'} sent.`
            : `${promotedPlayer.playerName} has been moved to Squad.`,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not promote this player to Squad.')
    } finally {
      setIsPromotingId('')
      setPromoteConfirmTarget(null)
    }
  }

  const handleDeletePlayer = async () => {
    setPlayerDeleteTarget({
      playerName: routePlayerName,
      playerCount: players.length,
      evaluationCount: evaluations.length,
    })
  }

  const handleMovePlayerToTrial = async (playerId) => {
    setIsPromotingId(playerId)
    setErrorMessage('')

    try {
      const movedPlayer = await movePlayerToTrial({ user, playerId })
      const nextPlayers = players.map((player) => (player.id === playerId ? movedPlayer : player))
      setPlayers(nextPlayers)
      setPlayerDrafts(Object.fromEntries(nextPlayers.map((player) => [player.id, createPlayerDraft(player)])))
      writeViewCache(cacheKey, {
        evaluations,
        players: nextPlayers,
      })
      showToast({ title: 'Player moved', message: `${movedPlayer.playerName} has been moved to Trial players.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not move this player to Trial.')
    } finally {
      setIsPromotingId('')
    }
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

  const confirmArchiveAfterNoPlaceEmail = async (_password, reason) => {
    if (!noPlaceArchiveTarget) {
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
      showToast({ title: 'Player archived' })
      navigate('/players', { replace: true })
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not archive this player.')
    } finally {
      setIsDeleting(false)
      setNoPlaceArchiveTarget(null)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Player Profile"
        title={routePlayerName}
        description="Review the assessment history for this player with club-scoped visibility."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Player action not completed"
          message={errorMessage}
        />
      ) : null}

      <PlayerOverview
        evaluationCount={evaluations.length}
        fieldMovement={fieldMovement}
        lastSection={lastSection}
        overallAverage={overallAverage}
        playerName={routePlayerName}
        ratingTrend={ratingTrend}
        ratingTrendMax={ratingTrendMax}
      />

      <PlayerDetailsSection
        directEmailSendingId={emailSendingId}
        editingPlayerId={editingPlayerId}
        getDirectEmailTemplateOptions={getDirectEmailTemplateOptions}
        getSelectedDirectEmailTemplateOption={getSelectedDirectEmailTemplateOption}
        isPromotingId={isPromotingId}
        isSavingPlayer={isSavingPlayer}
        onAddParentContact={handleAddParentContact}
        onAddPlayerPosition={handleAddPlayerPosition}
        onCancelEditing={() => setEditingPlayerId('')}
        onMovePlayerToTrial={(playerId) => void handleMovePlayerToTrial(playerId)}
        onParentContactDraftChange={handleParentContactDraftChange}
        onPlayerDraftChange={handlePlayerDraftChange}
        onPromotePlayer={(playerId) => void handlePromotePlayer(playerId)}
        onRemoveParentContact={handleRemoveParentContact}
        onRemovePlayerPosition={handleRemovePlayerPosition}
        onSavePlayer={(playerId) => void handleSavePlayer(playerId)}
        onRefreshEmailTemplates={() => void loadEmailTemplates()}
        onSelectedDirectEmailTemplateChange={(playerId, value) =>
          setSelectedEmailTemplates((currentTemplates) => ({
            ...currentTemplates,
            [`direct:${playerId}`]: value,
          }))
        }
        onSendDirectEmail={(player) => void handleSendDirectEmail(player)}
        onStartEditingPlayer={handleStartEditingPlayer}
        playerDrafts={playerDrafts}
        profilePlayers={profilePlayers}
      />

      <PlayerProfileActions
        isDeleting={isDeleting}
        lastSection={lastSection}
        lastTeam={lastTeam}
        onDeletePlayer={handleDeletePlayer}
        playerName={routePlayerName}
        user={user}
      />

      {canMergeEvaluations ? (
        <PlayerMergeAssessments
          evaluations={evaluations}
          isMergingEvaluations={isMergingEvaluations}
          mergeCoreSource={mergeCoreSource}
          mergeDetailFields={mergeDetailFields}
          mergeDetailSources={mergeDetailSources}
          mergeFieldLabels={mergeFieldLabels}
          mergeFieldSources={mergeFieldSources}
          mergePreviewAverage={mergePreviewAverage}
          mergePreviewResponses={mergePreviewResponses}
          mergeSelectedEvaluations={mergeSelectedEvaluations}
          mergeSelectedIds={mergeSelectedIds}
          onCreateMergedEvaluation={() => void handleCreateMergedEvaluation()}
          onMergeDetailSourceChange={handleMergeDetailSourceChange}
          onMergeFieldSourceChange={handleMergeFieldSourceChange}
          onMergeSelectionChange={handleToggleMergeEvaluation}
          onMergeSourceChange={setMergeCoreSourceId}
        />
      ) : null}

      <PlayerStaffActivity
        activityLogs={activityLogs}
        deletingNoteId={deletingStaffNoteId}
        isRecordingVoiceNote={isRecordingVoiceNote}
        isSavingNote={isSavingNote}
        isSavingVoiceNote={isSavingVoiceNote}
        noteDraft={noteDraft}
        onDeleteNote={setStaffNoteDeleteTarget}
        onNoteChange={setNoteDraft}
        onSaveNote={() => void handleSaveStaffNote()}
        onStartVoiceNote={() => void handleStartProfileVoiceNote()}
        onStopVoiceNote={handleStopProfileVoiceNote}
        primaryPlayer={primaryPlayer}
        staffNotes={staffNotes}
      />

      <ConfirmModal
        isOpen={Boolean(promoteConfirmTarget)}
        isBusy={Boolean(isPromotingId)}
        title="Move player to Squad"
        message="This moves the player from Trial to Squad and updates their player record."
        items={[
          `Player: ${promoteConfirmTarget?.playerName || 'Selected player'}`,
          `Team: ${promoteConfirmTarget?.team || 'No team entered'}`,
        ]}
        confirmLabel="Move to Squad"
        onCancel={() => setPromoteConfirmTarget(null)}
        onConfirm={() => void confirmPromotePlayer()}
      >
        <label className="flex items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={sendParentPortalLinkOnPromote}
            disabled={getPlayerPortalContacts(promoteConfirmTarget).length === 0}
            onChange={(event) => setSendParentPortalLinkOnPromote(event.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--accent)] disabled:cursor-not-allowed"
          />
          <span>
            <span className="block font-semibold">Send Parent link to Parent Portal</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">
              {getPlayerPortalContacts(promoteConfirmTarget).length > 0
                ? 'Parent contacts saved on this player will receive the portal invite.'
                : 'Add a parent email before sending a parent portal link.'}
            </span>
          </span>
        </label>
      </ConfirmModal>

      <ConfirmModal
        isOpen={Boolean(staffNoteDeleteTarget)}
        isBusy={Boolean(deletingStaffNoteId)}
        title="Delete voice note"
        message="This removes the voice note and its audio file from this player profile."
        items={[
          `Voice note: ${staffNoteDeleteTarget?.note || 'Selected voice note'}`,
          `Created by: ${staffNoteDeleteTarget?.userName || staffNoteDeleteTarget?.userEmail || 'Staff'}`,
        ]}
        confirmLabel="Delete Voice Note"
        onCancel={() => setStaffNoteDeleteTarget(null)}
        onConfirm={() => void confirmDeleteStaffNote()}
      />

      <PlayerEvaluationsHistory
        availablePlayers={reassignPlayerOptions}
        canDeleteEvaluations={canDeleteEvaluations}
        emailSendingId={emailSendingId}
        evaluations={evaluations}
        getAvailableEmailTemplates={getAvailableEmailTemplates}
        getEvaluationParentContacts={getEvaluationParentContacts}
        getExportResponseItems={getExportResponseItems}
        getSelectedEmailTemplateKey={getSelectedEmailTemplateKey}
        getSelectedInviteDate={getSelectedInviteDate}
        isDeleting={isDeleting}
        isDeletingEvaluationId={isDeletingEvaluationId}
        isDemoAccount={isDemoAccount}
        isLoading={isLoading}
        isReassigningId={isReassigningId}
        onClearExportFields={handleClearExportFields}
        onDeleteEvaluation={(evaluation) => void handleDeleteEvaluation(evaluation)}
        onEditEvaluation={(evaluation) =>
          navigate(
            `/assess-player/new?evaluationId=${encodeURIComponent(evaluation.id)}&player=${encodeURIComponent(routePlayerName)}&team=${encodeURIComponent(evaluation.team || '')}&section=${encodeURIComponent(evaluation.section || 'Trial')}&session=${encodeURIComponent(evaluation.session || '')}`,
          )
        }
        onInviteDateChange={(evaluationId, value) =>
          setSelectedInviteDates((currentDates) => ({
            ...currentDates,
            [evaluationId]: value,
          }))
        }
        onPageChange={setEvaluationPage}
        onReassignEvaluation={(evaluation) => void handleReassignEvaluation(evaluation)}
        onReassignTargetChange={handleReassignTargetChange}
        onRemovePlayer={handleDeletePlayer}
        onReorderExportField={handleReorderExportField}
        onSelectAllExportFields={handleSetAllExportFields}
        onSelectedEmailTemplateChange={(evaluationId, value) =>
          setSelectedEmailTemplates((currentTemplates) => ({
            ...currentTemplates,
            [evaluationId]: value,
          }))
        }
        onSendParentEmail={(evaluation) => void handleSendParentEmail(evaluation)}
        onSendTestEmail={(evaluation) => void handleSendTestEmail(evaluation)}
        onToggleEvaluationParentContact={handleToggleEvaluationParentContact}
        onToggleExportField={handleToggleExportField}
        page={evaluationPage}
        paginatedEvaluations={paginatedEvaluations}
        playerName={routePlayerName}
        selectedExportLabels={selectedExportLabels}
        selectedParentContacts={selectedParentContacts}
        selectedReassignTargets={selectedReassignTargets}
        user={user}
      />
      <PlayerProfileModals
        emailConfirmTarget={emailConfirmTarget}
        emailSendingId={emailSendingId}
        evaluationDeleteTarget={evaluationDeleteTarget}
        evaluations={evaluations}
        isDeleting={isDeleting}
        isDeletingEvaluationId={isDeletingEvaluationId}
        isMergeConfirmOpen={isMergeConfirmOpen}
        isMergingEvaluations={isMergingEvaluations}
        isPdfAttachmentApproved={isPdfAttachmentApproved}
        isReassigningId={isReassigningId}
        mergeSelectedEvaluations={mergeSelectedEvaluations}
        noPlaceArchiveTarget={noPlaceArchiveTarget}
        onArchiveAfterNoPlaceEmail={(password, reason) => void confirmArchiveAfterNoPlaceEmail(password, reason)}
        onCancelArchiveAfterNoPlaceEmail={() => setNoPlaceArchiveTarget(null)}
        onCancelDeleteEvaluation={() => setEvaluationDeleteTarget(null)}
        onCancelDeletePlayer={() => setPlayerDeleteTarget(null)}
        onCancelEmail={() => {
          setEmailConfirmTarget(null)
          setIsPdfAttachmentApproved(false)
        }}
        onCancelMerge={() => setIsMergeConfirmOpen(false)}
        onCancelReassign={() => setReassignConfirmTarget(null)}
        onConfirmDeleteEvaluation={(password) => void confirmDeleteEvaluation(password)}
        onConfirmDeletePlayer={(password, reason) => void confirmDeletePlayer(password, reason)}
        onConfirmEmail={() => void confirmSendParentEmail()}
        onConfirmMerge={() => void confirmCreateMergedEvaluation()}
        onConfirmReassign={() => void confirmReassignEvaluation()}
        onPdfAttachmentApprovedChange={setIsPdfAttachmentApproved}
        playerDeleteTarget={playerDeleteTarget}
        players={players}
        reassignConfirmTarget={reassignConfirmTarget}
        routePlayerName={routePlayerName}
      />

    </div>
  )
}
