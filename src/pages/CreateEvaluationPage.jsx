import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'
import { BlankPrintForm } from '../components/evaluations/BlankPrintForm.jsx'
import { ConfiguredFieldsSection } from '../components/evaluations/ConfiguredFieldsSection.jsx'
import { EvaluationAvailabilityState } from '../components/evaluations/EvaluationAvailabilityState.jsx'
import { EvaluationPlayerDetailsSection } from '../components/evaluations/EvaluationPlayerDetailsSection.jsx'
import { PreviousAssessmentsSection } from '../components/evaluations/PreviousAssessmentsSection.jsx'
import { SubmitExportSection } from '../components/evaluations/SubmitExportSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageUsers, isSuperAdmin, useAuth } from '../lib/auth.js'
import {
  EMAIL_TEMPLATE_AUDIENCES,
  isInviteEmailTemplate,
  mergeEmailTemplatesWithDefaults,
  normalizeEmailTemplateAudience,
} from '../lib/email-templates.js'
import { isDemoUser } from '../lib/demo.js'
import { sendParentEmail } from '../lib/email-builder.js'
import { sendParentMobilePushNotification } from '../lib/push-notifications.js'
import {
  createFeatureUpgradeMessage,
  createLimitUpgradeMessage,
  hasPlanFeature,
  isWithinPlanLimit,
} from '../lib/plans.js'
import {
  getSavedEvaluationExportLabels,
  getSelectedEvaluationResponses,
  reorderEvaluationExportLabels,
  saveEvaluationExportLabels,
} from '../lib/evaluation-export-selection.js'
import { removeDraft, saveDraft } from '../lib/offline-drafts.js'
import {
  buildComments,
  buildFormResponses,
  buildParentEmailJobs,
  buildScores,
  createEvaluationPayload,
  createOfflineEvaluationDraft,
  createLocalId,
  createEmptyResponseValues,
  createInitialFormData,
  createPostAssessmentFormData,
  createResponseItems,
  formatSessionForDisplay,
  getAverageScore,
  getContactCopy,
  getCurrentMonthEvaluationCount,
  getMatchedPlayerFieldUpdate,
  getNextExportLabels,
  getNextSelectedContactIndexes,
  getPostAssessmentNavigation,
  getSelectedContactIndexes,
  getDraftStorageKey,
  isNetworkError,
  mapEvaluationResponsesToFieldValues,
  normalizePlayerName,
  normalizeSessionValue,
  parseStoredDraft,
  writeSessionAssessmentProgress,
} from '../hooks/evaluations/evaluationFormUtils.js'
import {
  EVALUATION_SECTIONS,
  PLAYER_CONTACT_TYPES,
  createCommunicationLog,
  createEvaluation,
  getContactTemplateAudiences,
  getEvaluations,
  getAvailableTeamsForUser,
  getDefaultFormFields,
  getFormFields,
  getParentEmailTemplates,
  getPlayers,
  formatParentContactEmails,
  normalizeParentContacts,
  normalizePlayerContactType,
  clearViewCaches,
  readViewCache,
  readViewCacheValue,
  updateEvaluation,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

export function CreateEvaluationPage() {
  const { user } = useAuth()
  const isPlatformOwner = isSuperAdmin(user)
  const formRef = useRef(null)
  const hasInitializedRef = useRef(false)
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [searchParams] = useSearchParams()
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''
  const searchParamsKey = searchParams.toString()
  const editingEvaluationId = String(searchParams.get('evaluationId') ?? '').trim()
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'all'
  const teamsCacheKey = user ? `assessment-teams:${user.id}:${user.clubId || 'platform'}:${activeTeamScope}` : ''
  const fieldsCacheKey = user ? `assessment-fields:${user.id}:${user.clubId || 'platform'}:${activeTeamScope}` : ''
  const cachedTeams = readViewCacheValue(teamsCacheKey, 'availableTeams', [])
  const cachedFields = readViewCache(fieldsCacheKey)
  const [formData, setFormData] = useState(() => createInitialFormData(user))
  const [dynamicFields, setDynamicFields] = useState(() => {
    const nextCachedFields = Array.isArray(cachedFields?.dynamicFields) ? cachedFields.dynamicFields : []
    return nextCachedFields
  })
  const [availableTeams, setAvailableTeams] = useState(() => (Array.isArray(cachedTeams) ? cachedTeams : []))
  const [savedPlayers, setSavedPlayers] = useState([])
  const [previousEvaluations, setPreviousEvaluations] = useState([])
  const [editingEvaluation, setEditingEvaluation] = useState(null)
  const [responseValues, setResponseValues] = useState({})
  const [isFallbackFields, setIsFallbackFields] = useState(() => Boolean(cachedFields?.isFallbackFields))
  const [isLoadingFields, setIsLoadingFields] = useState(() => !cachedFields?.dynamicFields)
  const [isLoadingTeams, setIsLoadingTeams] = useState(() => !cachedTeams?.length)
  const [isSaved, setIsSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSendingParentEmail, setIsSendingParentEmail] = useState(false)
  const [isPrintingBlankView, setIsPrintingBlankView] = useState(false)
  const [lastSavedPlayerName, setLastSavedPlayerName] = useState('')
  const [lastUsedSession, setLastUsedSession] = useState('')
  const [previewMode, setPreviewMode] = useState('scored')
  const [isPdfAttachmentApproved, setIsPdfAttachmentApproved] = useState(false)
  const [emailSendMode, setEmailSendMode] = useState('now')
  const [scheduledEmailDateTime, setScheduledEmailDateTime] = useState('')
  const [isDefaultTemplateConfirmOpen, setIsDefaultTemplateConfirmOpen] = useState(false)
  const [hasApprovedDefaultTemplate, setHasApprovedDefaultTemplate] = useState(false)
  const [showPreviousAssessments, setShowPreviousAssessments] = useState(false)
  const [isPreviousScoresConfirmOpen, setIsPreviousScoresConfirmOpen] = useState(false)
  const [previousScoresPromptKey, setPreviousScoresPromptKey] = useState('')
  const promptedPreviousScoresKeyRef = useRef('')
  const [emailTemplateKey, setEmailTemplateKey] = useState('')
  const [emailTemplates, setEmailTemplates] = useState([])
  const [isLoadingEmailTemplates, setIsLoadingEmailTemplates] = useState(false)
  const [selectedParentContactIndexes, setSelectedParentContactIndexes] = useState([0])
  const [inviteDate, setInviteDate] = useState('')
  const [selectedExportLabels, setSelectedExportLabels] = useState(null)
  const [actionErrorMessage, setActionErrorMessage] = useState('')
  const [dataRefreshNotice, setDataRefreshNotice] = useState('')
  const [teamsLoadErrorMessage, setTeamsLoadErrorMessage] = useState('')
  const [offlineDraftId, setOfflineDraftId] = useState(createLocalId)
  const [offlineStatusMessage, setOfflineStatusMessage] = useState('')
  const [nextAssessmentReminderTarget, setNextAssessmentReminderTarget] = useState(null)
  const [nextAssessmentReminderDate, setNextAssessmentReminderDate] = useState('')
  const [isSavingNextAssessmentReminder, setIsSavingNextAssessmentReminder] = useState(false)

  const draftStorageKey = getDraftStorageKey(user)

  useEffect(() => {
    if (!user) {
      return
    }

    const requestedPlayerName = String(searchParams.get('player') ?? '').trim()
    const requestedTeam = String(searchParams.get('team') ?? '').trim()
    const requestedSession = normalizeSessionValue(searchParams.get('session'))
    const requestedSection = String(searchParams.get('section') ?? '').trim()
    const storedDraft = editingEvaluationId ? null : parseStoredDraft(draftStorageKey)
    const restoredFormData =
      storedDraft?.formData && typeof storedDraft.formData === 'object' ? storedDraft.formData : {}
    const restoredOfflineDraftId = String(storedDraft?.offlineDraftId ?? '').trim()
    const restoredSession = normalizeSessionValue(restoredFormData.session)
    const rememberedSession = normalizeSessionValue(storedDraft?.lastUsedSession)
    const nextSessionValue = requestedSession || restoredSession || rememberedSession
    const nextFormData = createInitialFormData(user, {
      ...restoredFormData,
      playerName: requestedPlayerName || String(restoredFormData.playerName ?? '').trim(),
      team: requestedTeam || String(restoredFormData.team ?? '').trim(),
      section: EVALUATION_SECTIONS.includes(requestedSection)
        ? requestedSection
        : String(restoredFormData.section ?? 'Trial'),
      session: nextSessionValue,
      coachName: user.name || '',
    })

    setFormData(nextFormData)
    setPreviewMode(['scored', 'email'].includes(String(storedDraft?.previewMode)) ? String(storedDraft.previewMode) : 'scored')
    setEmailTemplateKey(String(storedDraft?.emailTemplateKey ?? ''))
    setSelectedParentContactIndexes(
      Array.isArray(storedDraft?.selectedParentContactIndexes) && storedDraft.selectedParentContactIndexes.length > 0
        ? storedDraft.selectedParentContactIndexes
        : [0],
    )
    setInviteDate(normalizeSessionValue(storedDraft?.inviteDate))
    setResponseValues(
      storedDraft?.responseValues && typeof storedDraft.responseValues === 'object' ? storedDraft.responseValues : {},
    )
    setLastUsedSession(nextSessionValue)
    setOfflineDraftId(restoredOfflineDraftId || createLocalId())
    hasInitializedRef.current = true
  }, [draftStorageKey, editingEvaluationId, searchParams, searchParamsKey, user, userScopeKey])

  useEffect(() => {
    let isMounted = true
    const cachedTeamsValue = readViewCacheValue(teamsCacheKey, 'availableTeams', [])

    const loadTeams = async () => {
      if (!user || isPlatformOwner) {
        setAvailableTeams([])
        setIsLoadingTeams(false)
        return
      }

      setTeamsLoadErrorMessage('')

      try {
        const nextTeams = await withRequestTimeout(
          () => getAvailableTeamsForUser(user),
          'Could not load teams. No team data entered yet, or the request took too long.',
        )

        if (!isMounted) {
          return
        }

        setAvailableTeams(nextTeams)
        setDataRefreshNotice((current) =>
          current.startsWith('Live team data') || current.startsWith('The latest team list')
            ? ''
            : current,
        )
        writeViewCache(teamsCacheKey, {
          availableTeams: nextTeams,
        })
        setFormData((current) => {
          const requestedTeam = String(searchParams.get('team') ?? '').trim()
          const currentTeam = String(current.team ?? '').trim()

          if (currentTeam && nextTeams.some((team) => team.name === currentTeam)) {
            return current
          }

          if (requestedTeam && nextTeams.some((team) => team.name === requestedTeam)) {
            return {
              ...current,
              team: requestedTeam,
            }
          }

          return {
            ...current,
            team: nextTeams[0]?.name || '',
          }
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (cachedTeamsValue?.length) {
            setDataRefreshNotice('The latest team list could not be refreshed. The last available team setup is still shown.')
          } else {
            setAvailableTeams([])
            setTeamsLoadErrorMessage('Team data could not be loaded right now. Try again in a moment.')
          }
        }
      } finally {
        if (isMounted) {
          setIsLoadingTeams(false)
        }
      }
    }

    void loadTeams()

    return () => {
      isMounted = false
    }
  }, [isPlatformOwner, searchParams, searchParamsKey, teamsCacheKey, user, userScopeKey])

  useEffect(() => {
    let isMounted = true

    const loadSavedPlayers = async () => {
      if (!user || isPlatformOwner) {
        setSavedPlayers([])
        return
      }

      try {
        const nextPlayers = await withRequestTimeout(() => getPlayers({ user }), 'Could not load saved players.')

        if (!isMounted) {
          return
        }

        setSavedPlayers(nextPlayers)
        const requestedPlayerName = String(searchParams.get('player') ?? '').trim()
        const requestedTeam = String(searchParams.get('team') ?? '').trim()
        const requestedSection = String(searchParams.get('section') ?? '').trim()
        const matchingPlayer = (() => {
          const normalizedPlayerName = normalizePlayerName(requestedPlayerName)
          const sameNamePlayers = nextPlayers.filter((player) => normalizePlayerName(player.playerName) === normalizedPlayerName)

          return (
            sameNamePlayers.find(
              (player) =>
                (!requestedTeam || player.team === requestedTeam) &&
                (!requestedSection || player.section === requestedSection),
            ) ||
            sameNamePlayers.find((player) => !requestedTeam || player.team === requestedTeam) ||
            sameNamePlayers[0]
          )
        })()

        if (matchingPlayer) {
          const parentContacts = normalizeParentContacts(matchingPlayer.parentContacts, {
            parentName: matchingPlayer.parentName,
            parentEmail: matchingPlayer.parentEmail,
          })

          setFormData((current) => ({
            ...current,
            playerName: matchingPlayer.playerName,
            parentName: parentContacts[0]?.name || '',
            parentEmail: parentContacts[0]?.email || '',
            parentContacts,
            contactType: normalizePlayerContactType(matchingPlayer.contactType),
            team: requestedTeam || matchingPlayer.team || current.team,
            section: matchingPlayer.section || requestedSection || current.section,
          }))
          setSelectedParentContactIndexes(parentContacts.length > 0 ? parentContacts.map((_, index) => index) : [0])
        }
      } catch (error) {
        console.error(error)
      }
    }

    void loadSavedPlayers()

    return () => {
      isMounted = false
    }
  }, [isPlatformOwner, searchParams, searchParamsKey, user, userScopeKey])

  useEffect(() => {
    let isMounted = true
    const playerName = normalizePlayerName(formData.playerName)

    const loadPreviousEvaluations = async () => {
      if (!user || isPlatformOwner || !playerName) {
        setPreviousEvaluations([])
        return
      }

      try {
        const nextEvaluations = await withRequestTimeout(
          () => getEvaluations({ user, playerName }),
          'Could not load previous assessments.',
        )

        if (!isMounted) {
          return
        }

        setPreviousEvaluations(
          nextEvaluations
            .filter((evaluation) => String(evaluation.id) !== String(editingEvaluationId))
            .filter((evaluation) => !formData.team || evaluation.team === formData.team)
            .slice(0, 5),
        )
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setPreviousEvaluations([])
        }
      }
    }

    void loadPreviousEvaluations()

    return () => {
      isMounted = false
    }
  }, [editingEvaluationId, formData.playerName, formData.team, isPlatformOwner, user, userScopeKey])

  useEffect(() => {
    const playerName = normalizePlayerName(formData.playerName)
    const team = String(formData.team ?? '').trim()
    const promptKey = `${playerName}:${team}`

    if (editingEvaluation || previousEvaluations.length === 0 || !playerName || promptedPreviousScoresKeyRef.current === promptKey) {
      return
    }

    promptedPreviousScoresKeyRef.current = promptKey
    setPreviousScoresPromptKey(promptKey)
    setIsPreviousScoresConfirmOpen(true)
  }, [editingEvaluation, formData.playerName, formData.team, previousEvaluations.length])

  useEffect(() => {
    let isMounted = true

    const loadEditingEvaluation = async () => {
      if (!editingEvaluationId || !user || isPlatformOwner) {
        setEditingEvaluation(null)
        return
      }

      try {
        const nextEvaluations = await withRequestTimeout(() => getEvaluations({ user }), 'Could not load assessment.')
        const targetEvaluation = nextEvaluations.find((evaluation) => String(evaluation.id) === editingEvaluationId)

        if (!isMounted) {
          return
        }

        if (!targetEvaluation) {
          setActionErrorMessage('This assessment could not be found. It may have been removed or you may not have access.')
          setEditingEvaluation(null)
          return
        }

        setEditingEvaluation(targetEvaluation)
        setFormData((current) =>
          createInitialFormData(user, {
            ...current,
            playerName: targetEvaluation.playerName,
            team: targetEvaluation.team,
            section: targetEvaluation.section || 'Trial',
            session: normalizeSessionValue(targetEvaluation.session),
            coachName: targetEvaluation.coach || current.coachName,
            parentName: targetEvaluation.parentName,
            parentEmail: targetEvaluation.parentEmail,
            parentContacts: normalizeParentContacts(targetEvaluation.parentContacts, {
              parentName: targetEvaluation.parentName,
              parentEmail: targetEvaluation.parentEmail,
            }),
            contactType: normalizePlayerContactType(targetEvaluation.contactType),
          }),
        )
        setSelectedParentContactIndexes(
          targetEvaluation.parentContacts?.length
            ? targetEvaluation.parentContacts.map((_, index) => index)
            : [0],
        )
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setActionErrorMessage('This assessment could not be loaded for editing. Try again in a moment.')
          setEditingEvaluation(null)
        }
      }
    }

    void loadEditingEvaluation()

    return () => {
      isMounted = false
    }
  }, [editingEvaluationId, isPlatformOwner, user, userScopeKey])

  useEffect(() => {
    let isMounted = true
    const cachedFieldsValue = readViewCache(fieldsCacheKey)

    const loadFields = async () => {
      if (!user || isPlatformOwner) {
        setDynamicFields([])
        setResponseValues({})
        setIsLoadingFields(false)
        return
      }

      try {
        const { fields, isFallback } = await withRequestTimeout(
          () => getFormFields({ user }),
          'Could not load form fields. Showing default empty form instead.',
        )

        if (!isMounted) {
          return
        }

        setDynamicFields(fields)
        setResponseValues((current) => {
          const emptyValues = createEmptyResponseValues(fields)

          return Object.fromEntries(Object.keys(emptyValues).map((key) => [key, current[key] ?? '']))
        })
        setIsFallbackFields(isFallback)
        setDataRefreshNotice((current) =>
          current.startsWith('Live form fields') || current.startsWith('Default assessment fields')
            ? ''
            : current,
        )
        writeViewCache(fieldsCacheKey, {
          dynamicFields: fields,
          isFallbackFields: isFallback,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          const fallbackFields = getDefaultFormFields()
          if (!cachedFieldsValue?.dynamicFields) {
            setDynamicFields(fallbackFields)
            setResponseValues(createEmptyResponseValues(fallbackFields))
            setIsFallbackFields(true)
            setDataRefreshNotice('Default assessment fields are in use because the saved club form could not be loaded.')
          } else {
            setDataRefreshNotice('Live form fields could not be refreshed. The last available form setup is still shown.')
          }
        }
      } finally {
        if (isMounted) {
          setIsLoadingFields(false)
        }
      }
    }

    void loadFields()

    return () => {
      isMounted = false
    }
  }, [fieldsCacheKey, isPlatformOwner, user, userScopeKey])

  useEffect(() => {
    let isMounted = true

    const loadEmailTemplates = async () => {
      if (!user?.clubId || !hasPlanFeature(user, 'parentEmail')) {
        setEmailTemplates([])
        return
      }

      setIsLoadingEmailTemplates(true)

      try {
        const nextTemplates = mergeEmailTemplatesWithDefaults(
          await getParentEmailTemplates({ user, audience: 'all' }),
          'all',
        )

        if (isMounted) {
          setEmailTemplates(nextTemplates)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setEmailTemplates(mergeEmailTemplatesWithDefaults([], 'all'))
        }
      } finally {
        if (isMounted) {
          setIsLoadingEmailTemplates(false)
        }
      }
    }

    void loadEmailTemplates()

    return () => {
      isMounted = false
    }
  }, [user, userScopeKey])

  useEffect(() => {
    if (!isSaved) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setIsSaved(false)
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [isSaved])

  useEffect(() => {
    if (!isPrintingBlankView) {
      return undefined
    }

    const handleAfterPrint = () => {
      setIsPrintingBlankView(false)
    }

    const timeoutId = window.setTimeout(() => {
      window.print()
    }, 100)

    window.addEventListener('afterprint', handleAfterPrint)

    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [isPrintingBlankView])

  useEffect(() => {
    if (!hasInitializedRef.current || !draftStorageKey || isPlatformOwner || editingEvaluationId) {
      return
    }

    try {
      sessionStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          formData,
          responseValues,
          lastUsedSession,
          previewMode,
          emailTemplateKey,
          selectedParentContactIndexes,
          inviteDate,
          offlineDraftId,
        }),
      )
    } catch (error) {
      console.error(error)
    }
  }, [
    draftStorageKey,
    editingEvaluationId,
    emailTemplateKey,
    formData,
    inviteDate,
    isPlatformOwner,
    lastUsedSession,
    offlineDraftId,
    previewMode,
    responseValues,
    selectedParentContactIndexes,
  ])

  useEffect(() => {
    if (!editingEvaluation || dynamicFields.length === 0) {
      return
    }

    setResponseValues(mapEvaluationResponsesToFieldValues(dynamicFields, editingEvaluation.formResponses))
  }, [dynamicFields, editingEvaluation])

  const enabledFields = useMemo(() => dynamicFields.filter((field) => field.isEnabled), [dynamicFields])
  const formResponses = useMemo(() => buildFormResponses(enabledFields, responseValues), [enabledFields, responseValues])
  const scores = useMemo(() => buildScores(formResponses), [formResponses])
  const comments = useMemo(() => buildComments(formResponses), [formResponses])
  const averageScore = useMemo(() => getAverageScore(formResponses), [formResponses])
  const responseItems = useMemo(() => createResponseItems(enabledFields, responseValues), [enabledFields, responseValues])
  const canSubmitEvaluation = availableTeams.length > 0
  const canUseParentEmail = hasPlanFeature(user, 'parentEmail')
  const normalizedContactType = normalizePlayerContactType(formData.contactType)
  const contactAudiences = getContactTemplateAudiences(normalizedContactType)
  const contactAudience = normalizedContactType === PLAYER_CONTACT_TYPES.self ? EMAIL_TEMPLATE_AUDIENCES.player : EMAIL_TEMPLATE_AUDIENCES.parent
  const { contactLabel, contactNoun, contactNounPlural } = getContactCopy(normalizedContactType)
  const selectedResponseItems = useMemo(
    () => getSelectedEvaluationResponses(responseItems, selectedExportLabels),
    [responseItems, selectedExportLabels],
  )
  const hasSavedExportSelection = Array.isArray(selectedExportLabels)
  const readableSession = useMemo(() => formatSessionForDisplay(formData.session), [formData.session])
  const availableEmailTemplates = useMemo(
    () =>
      emailTemplates.filter(
        (template) => {
          const sectionAvailability = Array.isArray(template.sectionAvailability)
            ? template.sectionAvailability
            : EVALUATION_SECTIONS

          return (
            normalizeEmailTemplateAudience(template.audience) === contactAudience &&
            sectionAvailability.includes(formData.section) &&
            template.isEnabled !== false
          )
        },
      ),
    [contactAudience, emailTemplates, formData.section],
  )
  const selectedEmailTemplateKey = availableEmailTemplates.some((template) => template.key === emailTemplateKey)
    ? emailTemplateKey
    : availableEmailTemplates[0]?.key || ''
  const selectedEmailTemplate = availableEmailTemplates.find((template) => template.key === selectedEmailTemplateKey) ?? null
  const shouldShowInviteDate = previewMode === 'email' && isInviteEmailTemplate(selectedEmailTemplateKey)
  const parentContacts = useMemo(
    () =>
      normalizeParentContacts(formData.parentContacts, {
        parentName: formData.parentName,
        parentEmail: formData.parentEmail,
        contactType: normalizedContactType,
      }),
    [formData.parentContacts, formData.parentEmail, formData.parentName, normalizedContactType],
  )
  const savedParentContacts = useMemo(
    () => normalizeParentContacts(formData.parentContacts, { contactType: normalizedContactType }),
    [formData.parentContacts, normalizedContactType],
  )
  const selectedParentContacts = useMemo(() => {
    const selectedContacts = parentContacts.filter((_, index) => selectedParentContactIndexes.includes(index))
    return selectedContacts.length > 0 ? selectedContacts : parentContacts.slice(0, 1)
  }, [parentContacts, selectedParentContactIndexes])
  const selectedParentEmail = formatParentContactEmails(selectedParentContacts, formData.parentEmail)
  const isDemoAccount = isDemoUser(user)
  const noTeamsMessage = canManageUsers(user)
    ? 'No teams exist for this club yet. Create a team first, then assessments can be assigned correctly.'
    : 'No teams exist for this club yet. Ask a manager to create a team before adding assessments.'

  useEffect(() => {
    setHasApprovedDefaultTemplate(false)
  }, [previewMode, selectedEmailTemplateKey])

  useEffect(() => {
    if (isDemoAccount && previewMode === 'email') {
      setPreviewMode('scored')
    }
  }, [isDemoAccount, previewMode])

  useEffect(() => {
    const playerName = normalizePlayerName(formData.playerName)

    setSelectedExportLabels(
      getSavedEvaluationExportLabels({
        clubId: user?.clubId,
        playerName,
      }),
    )
  }, [formData.playerName, user?.clubId])

  const buildEvaluationPayload = useCallback((id = offlineDraftId) => {
    const assessmentSessionId = String(searchParams.get('sessionId') ?? '').trim()

    return createEvaluationPayload({
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
    })
  }, [
    averageScore,
    availableTeams,
    comments,
    editingEvaluation,
    formData,
    formResponses,
    normalizedContactType,
    offlineDraftId,
    parentContacts,
    savedPlayers,
    scores,
    searchParams,
    user,
  ])

  useEffect(() => {
    if (!hasInitializedRef.current || !user || isPlatformOwner || !offlineDraftId) {
      return undefined
    }

    const hasDraftContent =
      String(formData.playerName ?? '').trim() ||
      Object.values(responseValues).some((value) => String(value ?? '').trim()) ||
      parentContacts.some((contact) => contact.name || contact.email)

    if (!hasDraftContent) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      try {
        saveDraft({
          id: offlineDraftId,
          operation: editingEvaluation ? 'update' : 'create',
          evaluationId: editingEvaluation?.id || null,
          clubId: user.clubId,
          data: buildEvaluationPayload(offlineDraftId),
          createdAt: new Date().toISOString(),
          readyToSync: false,
          synced: false,
        })

        if (!navigator.onLine) {
          setOfflineStatusMessage('Offline - this assessment is being saved locally.')
        }
      } catch (error) {
        console.error('Offline draft save failed', error)
      }
    }, 900)

    return () => window.clearTimeout(timeoutId)
  }, [
    averageScore,
    availableTeams,
    buildEvaluationPayload,
    comments,
    editingEvaluation,
    formData,
    formResponses,
    isPlatformOwner,
    offlineDraftId,
    parentContacts,
    responseValues,
    savedPlayers,
    scores,
    user,
  ])

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
    setActionErrorMessage('')

    if (name === 'session') {
      const nextSessionValue = normalizeSessionValue(value)

      setFormData((current) => ({
        ...current,
        session: nextSessionValue,
      }))
      setLastUsedSession(nextSessionValue)
      return
    }

    if (name === 'team' && formData.playerName) {
      const currentPlayerName = normalizePlayerName(formData.playerName)
      const currentSection = String(formData.section ?? '').trim()
      const matchingPlayer = savedPlayers.find(
        (player) =>
          normalizePlayerName(player.playerName) === currentPlayerName &&
          player.team === value &&
          (!currentSection || player.section === currentSection),
      )

      if (!matchingPlayer) {
        setSelectedParentContactIndexes([0])
        setFormData((current) => ({
          ...current,
          team: value,
          playerName: '',
          parentName: '',
          parentEmail: '',
          parentContacts: [],
        }))
        return
      }
    }

    if (name === 'playerName' || name === 'team') {
      const { matchingParentContacts, nextFormData } = getMatchedPlayerFieldUpdate({
        fieldName: name,
        formData,
        normalizeParentContacts,
        normalizePlayerContactType,
        savedPlayers,
        value,
      })
      setFormData(nextFormData)
      setSelectedParentContactIndexes(getSelectedContactIndexes(matchingParentContacts))
      return
    }

    if (name === 'section') {
      const currentPlayerName = normalizePlayerName(formData.playerName)
      const currentTeam = String(formData.team ?? '').trim()
      const matchingPlayer = savedPlayers.find(
        (player) =>
          normalizePlayerName(player.playerName) === currentPlayerName &&
          player.section === value &&
          (!currentTeam || player.team === currentTeam),
      )

      if (matchingPlayer) {
        setFormData((current) => ({
          ...current,
          section: value,
        }))
      } else {
        setSelectedParentContactIndexes([0])
        setFormData((current) => ({
          ...current,
          section: value,
          playerName: '',
          parentName: '',
          parentEmail: '',
          parentContacts: [],
        }))
      }
      return
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleResponseChange = (fieldId, value) => {
    setIsSaved(false)
    setActionErrorMessage('')
    setResponseValues((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleToggleParentContact = (index) => {
    setSelectedParentContactIndexes((current) => getNextSelectedContactIndexes(current, index))
  }

  const saveExportSelection = (labels) => {
    const playerName = normalizePlayerName(formData.playerName)

    setSelectedExportLabels(labels)
    saveEvaluationExportLabels({
      clubId: user?.clubId,
      playerName,
      labels,
    })
  }

  const handleToggleExportField = (label) => {
    saveExportSelection(getNextExportLabels({ label, responseItems, selectedExportLabels }))
  }

  const handleReorderExportField = (sourceLabel, targetLabel, currentResponseItems) => {
    saveExportSelection(
      reorderEvaluationExportLabels({
        sourceLabel,
        targetLabel,
        responseItems: currentResponseItems,
        selectedLabels: selectedExportLabels,
      }),
    )
  }

  const handleSetAllExportFields = () => {
    saveExportSelection(responseItems.map((item) => item.label))
  }

  const handleClearExportFields = () => {
    saveExportSelection([])
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!user?.clubId && !isPlatformOwner) {
      console.error('Assessment submit failed: missing club ID for current user.')
      setActionErrorMessage('Your account is missing a club assignment.')
      return
    }

    if (!String(formData.team ?? '').trim()) {
      console.error('Assessment submit failed: no team selected.')
      setActionErrorMessage('Select a team before submitting the assessment.')
      return
    }

    if (previewMode === 'email' && selectedEmailTemplate?.isDefaultTemplate && !hasApprovedDefaultTemplate) {
      setIsDefaultTemplateConfirmOpen(true)
      return
    }

    setIsSubmitting(true)
    setActionErrorMessage('')

    try {
      const normalizedPlayerName = normalizePlayerName(formData.playerName)
      const evaluation = buildEvaluationPayload(offlineDraftId)

      if (!editingEvaluation?.id && user?.clubId) {
        const allEvaluations = await getEvaluations({ user })
        const monthlyEvaluationCount = getCurrentMonthEvaluationCount(allEvaluations)

        if (!isWithinPlanLimit(user, 'monthlyEvaluations', monthlyEvaluationCount)) {
          throw new Error(createLimitUpgradeMessage(user, 'monthlyEvaluations', 'Monthly assessments'))
        }
      }

      if (!navigator.onLine) {
        saveDraft(createOfflineEvaluationDraft({ data: evaluation, editingEvaluation, id: offlineDraftId, user }))
        setOfflineStatusMessage('Saved offline - this assessment will sync when the connection returns.')
        showToast({ title: 'Saved offline', message: 'This assessment will sync when you are back online.' })
        setIsSaved(true)
        return
      }

      const savedEvaluation = editingEvaluation
        ? await updateEvaluation(editingEvaluation.id, evaluation, user?.clubId)
        : await createEvaluation(evaluation)

      clearViewCaches()

      if (editingEvaluation) {
        setEditingEvaluation(savedEvaluation)
      } else {
        setOfflineDraftId(createLocalId())
      }

      removeDraft(offlineDraftId)

      if (previewMode === 'email' && selectedParentEmail) {
        try {
          if (!canUseParentEmail) {
            throw new Error(createFeatureUpgradeMessage('parentEmail'))
          }

          setIsSendingParentEmail(true)
          const isScheduledSend = emailSendMode === 'scheduled'

          if (isScheduledSend && (!scheduledEmailDateTime || Number.isNaN(new Date(scheduledEmailDateTime).getTime()))) {
            throw new Error('Choose a valid scheduled send date and time.')
          }

          const scheduledAt = isScheduledSend ? new Date(scheduledEmailDateTime).toISOString() : ''

          const emailJobs = buildParentEmailJobs({
            attachPdf: isPdfAttachmentApproved,
            contactAudiences,
            emailTemplates,
            evaluation: {
              id: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
            },
            formData,
            inviteDate,
            normalizedPlayerName,
            playerContactTypes: PLAYER_CONTACT_TYPES,
            selectedEmailTemplateKey,
            selectedParentContacts,
            selectedResponseItems,
            user,
          })

          if (emailJobs.length === 0) {
            throw new Error(`Add a ${contactNoun} email before sending.`)
          }

          await Promise.all(emailJobs.map((emailJob) => sendParentEmail({
            ...emailJob.payload,
            attachPdf: isPdfAttachmentApproved,
            teamId: user?.activeTeamId || '',
            scheduledAt,
            communicationLog: isScheduledSend
              ? {
                  clubId: user?.clubId || '',
                  playerId: savedEvaluation?.playerId || evaluation.playerId || null,
                  evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
                  userId: user?.id || '',
                  userName: user?.displayName || user?.username || user?.name || user?.email || '',
                  userEmail: user?.email || '',
                  recipientEmail: emailJob.recipientEmail,
                  metadata: {
                    subject: emailJob.payload?.subject || '',
                    body: emailJob.payload?.emailBody || '',
                    templateName: emailJob.templateName || '',
                    team: emailJob.payload?.team || '',
                    club: emailJob.payload?.club || '',
                    playerName: normalizedPlayerName,
                    hasAttachment: isPdfAttachmentApproved,
                    scheduledAt,
                    assessmentFields: selectedResponseItems,
                    pdfHtml: isPdfAttachmentApproved ? emailJob.payload?.pdfHtml || '' : '',
                  },
                }
              : null,
          })))
          const communicationLog = await createCommunicationLog({
            user,
            playerId: savedEvaluation?.playerId || evaluation.playerId,
            evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
            channel: 'email',
            action: isScheduledSend ? 'parent_email_scheduled' : 'parent_email_sent',
            recipientEmail: emailJobs.map((emailJob) => emailJob.recipientEmail).join(','),
            metadata: {
              subject: emailJobs[0]?.payload?.subject || '',
              body: emailJobs[0]?.payload?.emailBody || '',
              templateName: emailJobs.map((emailJob) => emailJob.templateName).join(', '),
              team: emailJobs[0]?.payload?.team || '',
              club: emailJobs[0]?.payload?.club || '',
              playerName: normalizedPlayerName,
              hasAttachment: isPdfAttachmentApproved,
              scheduledAt,
              assessmentFields: selectedResponseItems,
              pdfHtml: isPdfAttachmentApproved ? emailJobs[0]?.payload?.pdfHtml || '' : '',
            },
          })
          if (!isScheduledSend && communicationLog?.id) {
            await sendParentMobilePushNotification({
              id: communicationLog.id,
              type: 'parent_message',
            })
          }
          showToast({ title: isScheduledSend ? 'Email scheduled' : 'Email sent successfully' })
        } catch (emailError) {
          console.error('Email failed', emailError)
          showToast({
            title: 'Email not sent',
            message: emailError.message || 'This assessment was saved, but the email could not be sent right now.',
            tone: 'error',
          })
        }
      }

      const assessmentSessionId = String(searchParams.get('sessionId') ?? '').trim()

      writeSessionAssessmentProgress({
        assessmentSessionId,
        playerName: normalizedPlayerName,
        user,
      })

      if (draftStorageKey) {
        sessionStorage.removeItem(draftStorageKey)
      }

      const postAssessmentNavigation = getPostAssessmentNavigation({
        assessmentSessionId,
        availableTeams,
        editingEvaluation,
        formData,
        lastUsedSession,
        normalizedPlayerName,
        searchParams,
      })

      if (postAssessmentNavigation.url) {
        navigate(postAssessmentNavigation.url)
        return
      }

      setLastSavedPlayerName(normalizedPlayerName)
      setSelectedParentContactIndexes([0])
      if (!editingEvaluation) {
        setFormData(
          createPostAssessmentFormData({
            currentSection: formData.section,
            evaluationSections: EVALUATION_SECTIONS,
            postAssessmentNavigation,
            user,
          }),
        )
        setResponseValues(createEmptyResponseValues(dynamicFields))
      }
      setLastUsedSession(postAssessmentNavigation.nextSessionValue)
      setIsSaved(true)
      setOfflineStatusMessage('')
      showToast({
        title: editingEvaluation ? 'Assessment updated' : 'Assessment saved',
        message: `${normalizedPlayerName} assessment has been saved.`,
      })
      setNextAssessmentReminderTarget({
        evaluationId: savedEvaluation?.id || editingEvaluation?.id || evaluation.id,
        playerId: savedEvaluation?.playerId || evaluation.playerId,
        playerName: normalizedPlayerName,
        team: formData.team,
        section: formData.section,
      })
    } catch (error) {
      console.error('Assessment submit failed', error)
      setIsSaved(false)

      if (isNetworkError(error)) {
        try {
          saveDraft(createOfflineEvaluationDraft({
            data: buildEvaluationPayload(offlineDraftId),
            editingEvaluation,
            id: offlineDraftId,
            user,
          }))
          setOfflineStatusMessage('Saved offline - this assessment will sync when the connection returns.')
          showToast({ title: 'Saved offline', message: 'This assessment will sync when you are back online.' })
          return
        } catch (draftError) {
          console.error('Offline draft queue failed', draftError)
        }
      }

      setActionErrorMessage('This assessment could not be saved right now. Check the player details and try again.')
    } finally {
      setIsSendingParentEmail(false)
      setIsSubmitting(false)
    }
  }

  const handleContinueWithDefaultTemplate = () => {
    setHasApprovedDefaultTemplate(true)
    setIsDefaultTemplateConfirmOpen(false)
    window.setTimeout(() => formRef.current?.requestSubmit(), 0)
  }

  const handleEmailAfterSaveChange = (shouldEmail) => {
    setPreviewMode(shouldEmail ? 'email' : 'scored')
    setHasApprovedDefaultTemplate(false)

    if (!shouldEmail) {
      setIsPdfAttachmentApproved(false)
      setEmailSendMode('now')
      setScheduledEmailDateTime('')
    }
  }

  const handleShowPreviousScores = () => {
    promptedPreviousScoresKeyRef.current = previousScoresPromptKey
    setShowPreviousAssessments(true)
    setIsPreviousScoresConfirmOpen(false)
  }

  const handleHidePreviousScores = () => {
    promptedPreviousScoresKeyRef.current = previousScoresPromptKey
    setShowPreviousAssessments(false)
    setIsPreviousScoresConfirmOpen(false)
  }

  const handleSaveNextAssessmentReminder = async () => {
    if (!nextAssessmentReminderTarget || !nextAssessmentReminderDate) {
      return
    }

    setIsSavingNextAssessmentReminder(true)

    try {
      await createCommunicationLog({
        user,
        playerId: nextAssessmentReminderTarget.playerId,
        evaluationId: nextAssessmentReminderTarget.evaluationId,
        channel: 'reminder',
        action: 'next_assessment_reminder_set',
        metadata: {
          dueDate: nextAssessmentReminderDate,
          playerName: nextAssessmentReminderTarget.playerName,
          team: nextAssessmentReminderTarget.team,
          section: nextAssessmentReminderTarget.section,
        },
      })
      showToast({
        title: 'Reminder saved',
        message: `Next assessment reminder set for ${nextAssessmentReminderDate}.`,
      })
      setNextAssessmentReminderTarget(null)
      setNextAssessmentReminderDate('')
    } catch (error) {
      console.error(error)
      showToast({
        title: 'Reminder not saved',
        message: error.message || 'The assessment was saved, but the reminder could not be saved.',
        tone: 'error',
      })
    } finally {
      setIsSavingNextAssessmentReminder(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <BlankPrintForm
        clubName={user?.clubName || 'Club Form'}
        logoUrl={user?.clubLogoUrl || fallbackLogo}
        fields={enabledFields}
      />

      <ConfirmModal
        isOpen={isDefaultTemplateConfirmOpen}
        title="Default template"
        message="You are sending a default template. You can continue now, or open Templates to customise it first."
        itemsTitle="Template"
        items={[
          selectedEmailTemplate?.label || 'Default template',
          `Recipient type: ${contactNounPlural}`,
        ]}
        confirmLabel="Continue"
        cancelLabel="Configure Email Templates"
        onCancel={() => navigate('/parent-email-templates')}
        onClose={() => setIsDefaultTemplateConfirmOpen(false)}
        onConfirm={handleContinueWithDefaultTemplate}
      />

      <ConfirmModal
        isOpen={isPreviousScoresConfirmOpen}
        title="Previous assessment found"
        message="This player already has assessment history. Do you want to open the previous scores while completing this assessment?"
        cancelLabel="Keep Closed"
        confirmLabel="Show Previous Scores"
        onCancel={handleHidePreviousScores}
        onClose={handleHidePreviousScores}
        onConfirm={handleShowPreviousScores}
      />

      <ConfirmModal
        isOpen={Boolean(nextAssessmentReminderTarget)}
        isBusy={isSavingNextAssessmentReminder}
        title="Set next assessment reminder"
        message="Do you want to set a reminder for the next assessment?"
        cancelLabel="Not Now"
        confirmLabel="Save Reminder"
        confirmDisabled={!nextAssessmentReminderDate}
        onCancel={() => {
          setNextAssessmentReminderTarget(null)
          setNextAssessmentReminderDate('')
        }}
        onClose={() => {
          setNextAssessmentReminderTarget(null)
          setNextAssessmentReminderDate('')
        }}
        onConfirm={() => void handleSaveNextAssessmentReminder()}
      >
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Reminder date</span>
          <input
            type="date"
            value={nextAssessmentReminderDate}
            onChange={(event) => setNextAssessmentReminderDate(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
      </ConfirmModal>

      <div className={isPrintingBlankView ? 'no-print' : ''}>
        <PageHeader
          eyebrow="Assessment"
          title="Assess player"
          description="Capture a trial or squad assessment, choose what to include, and save it when ready."
        />

        {isSaved ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
            Assessment saved
          </div>
        ) : null}

        {actionErrorMessage ? (
          <NoticeBanner
            title="Action not completed"
            message={actionErrorMessage}
          />
        ) : null}

        {offlineStatusMessage ? (
          <NoticeBanner title="Offline draft saved" message={offlineStatusMessage} tone="info" />
        ) : null}

        {dataRefreshNotice ? <NoticeBanner title="Using available club data" message={dataRefreshNotice} tone="info" /> : null}

        <EvaluationAvailabilityState
          availableTeams={availableTeams}
          isLoadingFields={isLoadingFields}
          isLoadingTeams={isLoadingTeams}
          noTeamsMessage={noTeamsMessage}
          teamsLoadErrorMessage={teamsLoadErrorMessage}
          user={user}
        >
            <form ref={formRef} className="space-y-5 sm:space-y-6 no-print" onSubmit={handleSubmit}>
              <EvaluationPlayerDetailsSection
                availableTeams={availableTeams}
                contactLabel={contactLabel}
                contactNoun={contactNoun}
                contactNounPlural={contactNounPlural}
                evaluationSections={EVALUATION_SECTIONS}
                formData={formData}
                onFieldChange={handleFieldChange}
                onToggleParentContact={handleToggleParentContact}
                parentContacts={savedParentContacts}
                readableSession={readableSession}
                savedPlayers={savedPlayers}
                selectedParentContactIndexes={selectedParentContactIndexes}
                user={user}
              />

              <PreviousAssessmentsSection
                isOpen={showPreviousAssessments}
                onToggle={() => setShowPreviousAssessments((current) => !current)}
                previousEvaluations={previousEvaluations}
              />

              <ConfiguredFieldsSection
                enabledFields={enabledFields}
                isFallbackFields={isFallbackFields}
                onResponseChange={handleResponseChange}
                responseValues={responseValues}
              />

              <SubmitExportSection
                availableEmailTemplates={availableEmailTemplates}
                averageScore={averageScore}
                canSubmitEvaluation={canSubmitEvaluation}
                contactNoun={contactNoun}
                hasSavedExportSelection={hasSavedExportSelection}
                inviteDate={inviteDate}
                isDemoAccount={isDemoAccount}
                isLoadingEmailTemplates={isLoadingEmailTemplates}
                isPdfAttachmentApproved={isPdfAttachmentApproved}
                isSaved={isSaved}
                isSendingParentEmail={isSendingParentEmail}
                isSubmitting={isSubmitting}
                lastSavedPlayerName={lastSavedPlayerName}
                onClearExportFields={handleClearExportFields}
                emailSendMode={emailSendMode}
                onEmailTemplateChange={setEmailTemplateKey}
                onEmailSendModeChange={setEmailSendMode}
                onGoToPlayer={() => navigate(`/player/${encodeURIComponent(lastSavedPlayerName)}`)}
                onInviteDateChange={setInviteDate}
                onPdfAttachmentApprovedChange={setIsPdfAttachmentApproved}
                onScheduledEmailDateTimeChange={setScheduledEmailDateTime}
                onEmailAfterSaveChange={handleEmailAfterSaveChange}
                onPrintBlankForm={() => setIsPrintingBlankView(true)}
                onReorderExportField={handleReorderExportField}
                onSelectAllExportFields={handleSetAllExportFields}
                onToggleExportField={handleToggleExportField}
                previewMode={previewMode}
                responseItems={responseItems}
                selectedEmailTemplateKey={selectedEmailTemplateKey}
                selectedExportLabels={selectedExportLabels}
                selectedResponseItems={selectedResponseItems}
                scheduledEmailDateTime={scheduledEmailDateTime}
                shouldShowInviteDate={shouldShowInviteDate}
              />
            </form>
        </EvaluationAvailabilityState>
      </div>
    </div>
  )
}
