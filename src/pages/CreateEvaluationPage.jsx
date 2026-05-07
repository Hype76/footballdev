import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { BlankPrintForm } from '../components/evaluations/BlankPrintForm.jsx'
import { EvaluationFieldInput } from '../components/evaluations/EvaluationFieldInput.jsx'
import { EmailPreview } from '../components/ui/EmailPreview.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { canCreateEvaluation, canManageUsers, isSuperAdmin, useAuth } from '../lib/auth.js'
import {
  EMAIL_TEMPLATE_AUDIENCES,
  isInviteEmailTemplate,
  normalizeEmailTemplateAudience,
  renderParentEmailTemplate,
} from '../lib/email-templates.js'
import { sendParentEmail } from '../lib/email-builder.js'
import { isDemoUser } from '../lib/demo.js'
import {
  createFeatureUpgradeMessage,
  createLimitUpgradeMessage,
  hasPlanFeature,
  isWithinPlanLimit,
} from '../lib/plans.js'
import {
  getSavedEvaluationExportLabels,
  getSelectedEvaluationResponses,
  saveEvaluationExportLabels,
} from '../lib/evaluation-export-selection.js'
import { removeDraft, saveDraft } from '../lib/offline-drafts.js'
import {
  buildComments,
  buildFormResponses,
  buildPreviewSummary,
  buildScores,
  createEmptyResponseValues,
  createInitialFormData,
  createResponseItems,
  formatSessionForDisplay,
  formatSessionForInput,
  getAverageScore,
  getDraftStorageKey,
  getLatestClubLogoUrl,
  normalizePlayerName,
  normalizeSessionValue,
  parseAssessmentQueue,
  parseStoredDraft,
} from '../hooks/evaluations/evaluationFormUtils.js'
import {
  EVALUATION_SECTIONS,
  PLAYER_CONTACT_TYPES,
  createEvaluation,
  getContactTemplateAudiences,
  getEvaluations,
  getAvailableTeamsForUser,
  getDefaultFormFields,
  getFormFields,
  getParentEmailTemplates,
  getPlayers,
  formatParentContactEmails,
  formatParentContactNames,
  normalizeParentContacts,
  normalizePlayerContactType,
  readViewCache,
  readViewCacheValue,
  updateEvaluation,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function createLocalId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isNetworkError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return !navigator.onLine || message.includes('failed to fetch') || message.includes('network')
}

function mapEvaluationResponsesToFieldValues(fields, formResponses = {}) {
  return Object.fromEntries(
    fields.map((field) => [field.id, formResponses[field.label] ?? '']),
  )
}

function normalizeAssessmentLabel(value) {
  return String(value ?? '').trim().toLowerCase()
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

function formatAssessmentValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ')
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }

  return String(value ?? '').trim() || 'No data entered'
}

function buildPreviousAssessmentItems(evaluation) {
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
      value: isEnteredAssessmentValue(value) ? formatAssessmentValue(value) : 'No data entered',
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
  const teamsCacheKey = user ? `assessment-teams:${user.id}:${user.clubId || 'platform'}` : ''
  const fieldsCacheKey = user ? `assessment-fields:${user.id}:${user.clubId || 'platform'}` : ''
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
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isPrintingBlankView, setIsPrintingBlankView] = useState(false)
  const [lastSavedPlayerName, setLastSavedPlayerName] = useState('')
  const [lastUsedSession, setLastUsedSession] = useState('')
  const [previewMode, setPreviewMode] = useState('scored')
  const [showPreviousAssessments, setShowPreviousAssessments] = useState(false)
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
    setPreviewMode(['scored', 'without-scores', 'email'].includes(String(storedDraft?.previewMode)) ? String(storedDraft.previewMode) : 'scored')
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
  }, [draftStorageKey, editingEvaluationId, searchParamsKey, user, userScopeKey])

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
  }, [isPlatformOwner, searchParamsKey, teamsCacheKey, user, userScopeKey])

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
            section: requestedSection || matchingPlayer.section || current.section,
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
  }, [isPlatformOwner, searchParamsKey, user, userScopeKey])

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
        const nextTemplates = await getParentEmailTemplates({ user, audience: 'all' })

        if (isMounted) {
          setEmailTemplates(nextTemplates)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setEmailTemplates([])
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
  const canSubmitEvaluation = enabledFields.length > 0 && availableTeams.length > 0
  const canUsePdfExport = hasPlanFeature(user, 'pdfExport')
  const canUseParentEmail = hasPlanFeature(user, 'parentEmail')
  const normalizedContactType = normalizePlayerContactType(formData.contactType)
  const contactAudiences = getContactTemplateAudiences(normalizedContactType)
  const contactAudience = normalizedContactType === PLAYER_CONTACT_TYPES.self ? EMAIL_TEMPLATE_AUDIENCES.player : EMAIL_TEMPLATE_AUDIENCES.parent
  const contactNoun =
    normalizedContactType === PLAYER_CONTACT_TYPES.self
      ? 'player'
      : normalizedContactType === PLAYER_CONTACT_TYPES.both
        ? 'parent and player'
        : 'parent'
  const contactNounPlural =
    normalizedContactType === PLAYER_CONTACT_TYPES.self
      ? 'player'
      : normalizedContactType === PLAYER_CONTACT_TYPES.both
        ? 'parents and player'
        : 'parents'
  const contactLabel =
    normalizedContactType === PLAYER_CONTACT_TYPES.self
      ? 'Player'
      : normalizedContactType === PLAYER_CONTACT_TYPES.both
        ? 'Contact'
        : 'Parent'
  const selectedResponseItems = useMemo(
    () => getSelectedEvaluationResponses(responseItems, selectedExportLabels),
    [responseItems, selectedExportLabels],
  )
  const previewResponseItems = useMemo(
    () => {
      if (previewMode === 'without-scores') {
        return []
      }

      return canUsePdfExport || canUseParentEmail ? selectedResponseItems : responseItems
    },
    [canUseParentEmail, canUsePdfExport, previewMode, responseItems, selectedResponseItems],
  )
  const hasSavedExportSelection = Array.isArray(selectedExportLabels)
  const readableSession = useMemo(() => formatSessionForDisplay(formData.session), [formData.session])
  const availableEmailTemplates = useMemo(
    () =>
      emailTemplates.filter(
        (template) =>
          normalizeEmailTemplateAudience(template.audience) === contactAudience &&
          template.key !== 'assessment' &&
          template.isEnabled !== false,
      ),
    [contactAudience, emailTemplates],
  )
  const selectedEmailTemplateKey = emailTemplateKey || availableEmailTemplates[0]?.key || ''
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
  const selectedParentContacts = useMemo(() => {
    const selectedContacts = parentContacts.filter((_, index) => selectedParentContactIndexes.includes(index))
    return selectedContacts.length > 0 ? selectedContacts : parentContacts.slice(0, 1)
  }, [parentContacts, selectedParentContactIndexes])
  const previewContactType = contactAudience === EMAIL_TEMPLATE_AUDIENCES.player ? PLAYER_CONTACT_TYPES.self : PLAYER_CONTACT_TYPES.parent
  const selectedPreviewContacts = selectedParentContacts.filter((contact) => contact.type === previewContactType)
  const selectedParentName = formatParentContactNames(
    selectedPreviewContacts.length > 0 ? selectedPreviewContacts : selectedParentContacts,
    previewContactType === PLAYER_CONTACT_TYPES.self ? formData.playerName : formData.parentName,
  )
  const selectedParentEmail = formatParentContactEmails(selectedParentContacts, formData.parentEmail)
  const previewSummary = useMemo(
    () =>
      buildPreviewSummary({
        comments,
        formResponses,
      }),
    [comments, formResponses],
  )
  const parentEmailTemplate = useMemo(
    () => {
      const fields = {
        recipientName: selectedParentName,
        parentName: selectedParentName,
        playerName: formData.playerName,
        coachName: formData.coachName,
        clubName: user?.clubName,
        teamName: formData.team,
        session: formData.session,
        inviteDate,
        summary: previewSummary,
      }

      return selectedEmailTemplate
        ? renderParentEmailTemplate(selectedEmailTemplate, fields)
        : { key: '', label: '', subject: '', body: '' }
    },
    [
      formData.coachName,
      formData.playerName,
      formData.session,
      formData.team,
      inviteDate,
      previewSummary,
      selectedEmailTemplate,
      selectedParentName,
      user?.clubName,
    ],
  )
  const isDemoAccount = isDemoUser(user)
  const noTeamsMessage = canManageUsers(user)
    ? 'No teams exist for this club yet. Create a team first, then assessments can be assigned correctly.'
    : 'No teams are assigned to your account yet. Ask a manager to allocate you to at least one team.'

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
    const normalizedPlayerName = normalizePlayerName(formData.playerName)
    const matchingTeam = availableTeams.find((team) => team.name === String(formData.team).trim())
    const matchingPlayer = savedPlayers.find(
      (player) =>
        player.playerName === normalizedPlayerName &&
        player.section === formData.section &&
        (!formData.team || player.team === String(formData.team).trim()),
    )

    return {
      ...(editingEvaluation || {}),
      id: editingEvaluation?.id || id,
      playerName: normalizedPlayerName,
      playerId: matchingPlayer?.id || '',
      team: String(formData.team).trim(),
      teamId: matchingTeam?.id || '',
      section: formData.section,
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
      date: new Date().toLocaleDateString(),
      scores,
      averageScore: averageScore !== null ? Number(averageScore.toFixed(1)) : null,
      comments,
      formResponses,
      decision: '',
      status: editingEvaluation?.status || 'Submitted',
      createdAt: editingEvaluation?.createdAt || new Date().toISOString(),
    }
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

  const findSavedPlayer = (playerName, team = formData.team, section = formData.section) => {
    const normalizedPlayerName = normalizePlayerName(playerName)
    const normalizedTeam = String(team ?? '').trim()
    const normalizedSection = String(section ?? '').trim()
    const sameNamePlayers = savedPlayers.filter((player) => normalizePlayerName(player.playerName) === normalizedPlayerName)

    return (
      sameNamePlayers.find(
        (player) =>
          (!normalizedTeam || player.team === normalizedTeam) &&
          (!normalizedSection || player.section === normalizedSection),
      ) ||
      sameNamePlayers.find((player) => !normalizedTeam || player.team === normalizedTeam) ||
      sameNamePlayers[0]
    )
  }

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

    if (name === 'playerName') {
      const matchingPlayer = findSavedPlayer(value)
      const matchingParentContacts = normalizeParentContacts(matchingPlayer?.parentContacts, {
        parentName: matchingPlayer?.parentName,
        parentEmail: matchingPlayer?.parentEmail,
      })

      setFormData((current) => ({
        ...current,
        playerName: value,
        parentName: matchingPlayer ? matchingParentContacts[0]?.name || '' : current.parentName,
        parentEmail: matchingPlayer ? matchingParentContacts[0]?.email || '' : current.parentEmail,
        parentContacts: matchingPlayer ? matchingParentContacts : current.parentContacts,
        contactType: matchingPlayer ? normalizePlayerContactType(matchingPlayer.contactType) : current.contactType,
        team: matchingPlayer?.team || current.team,
        section: matchingPlayer?.section || current.section,
      }))
      setSelectedParentContactIndexes(matchingParentContacts.length > 0 ? matchingParentContacts.map((_, index) => index) : [0])
      return
    }

    if (name === 'team') {
      const matchingPlayer = findSavedPlayer(formData.playerName, value, formData.section)
      const matchingParentContacts = normalizeParentContacts(matchingPlayer?.parentContacts, {
        parentName: matchingPlayer?.parentName,
        parentEmail: matchingPlayer?.parentEmail,
      })

      setFormData((current) => ({
        ...current,
        team: value,
        parentName: matchingPlayer ? matchingParentContacts[0]?.name || '' : current.parentName,
        parentEmail: matchingPlayer ? matchingParentContacts[0]?.email || '' : current.parentEmail,
        parentContacts: matchingPlayer ? matchingParentContacts : current.parentContacts,
        contactType: matchingPlayer ? normalizePlayerContactType(matchingPlayer.contactType) : current.contactType,
        section: matchingPlayer?.section || current.section,
      }))
      setSelectedParentContactIndexes(matchingParentContacts.length > 0 ? matchingParentContacts.map((_, index) => index) : [0])
      return
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleSectionChange = (section) => {
    const matchingPlayer = findSavedPlayer(formData.playerName, formData.team, section)
    const matchingParentContacts = normalizeParentContacts(matchingPlayer?.parentContacts, {
      parentName: matchingPlayer?.parentName,
      parentEmail: matchingPlayer?.parentEmail,
    })

    setFormData((current) => ({
      ...current,
      section,
      parentName: matchingPlayer ? matchingParentContacts[0]?.name || '' : current.parentName,
      parentEmail: matchingPlayer ? matchingParentContacts[0]?.email || '' : current.parentEmail,
      parentContacts: matchingPlayer ? matchingParentContacts : current.parentContacts,
      contactType: matchingPlayer ? normalizePlayerContactType(matchingPlayer.contactType) : current.contactType,
      team: matchingPlayer?.team || current.team,
    }))
    setSelectedParentContactIndexes(matchingParentContacts.length > 0 ? matchingParentContacts.map((_, index) => index) : [0])
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
    setSelectedParentContactIndexes((current) => {
      if (current.includes(index)) {
        const nextIndexes = current.filter((item) => item !== index)
        return nextIndexes.length > 0 ? nextIndexes : [index]
      }

      return [...current, index].sort((left, right) => left - right)
    })
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
    const allLabels = responseItems.map((item) => item.label)
    const currentLabels = Array.isArray(selectedExportLabels) ? selectedExportLabels : allLabels
    const nextLabels = currentLabels.includes(label)
      ? currentLabels.filter((item) => item !== label)
      : [...currentLabels, label]

    saveExportSelection(nextLabels)
  }

  const handleSetAllExportFields = () => {
    saveExportSelection(responseItems.map((item) => item.label))
  }

  const handleClearExportFields = () => {
    saveExportSelection([])
  }

  const handleDownloadPdf = async (mode = previewMode) => {
    setIsGeneratingPdf(true)
    setActionErrorMessage('')

    try {
      if (!canUsePdfExport) {
        throw new Error(createFeatureUpgradeMessage('pdfExport'))
      }

      if (mode === 'email' && !selectedEmailTemplate) {
        throw new Error(`Create a ${contactNoun} email template before exporting an email template PDF.`)
      }

      const { exportEvaluationPdf } = await import('../lib/pdf.js')
      const latestClubLogoUrl = await getLatestClubLogoUrl(user)

      await exportEvaluationPdf({
        filename: `${normalizePlayerName(formData.playerName || 'evaluation')}-${mode}.pdf`,
        mode,
        previewProps: {
          clubName: user?.clubName || 'Club Name',
          planKey: user?.planKey,
          logoUrl: latestClubLogoUrl || fallbackLogo,
          playerName: formData.playerName || 'Player Name',
          team: formData.team,
          section: formData.section,
          session: formData.session,
          summary: previewSummary,
          emailSubject: parentEmailTemplate.subject,
          emailBody: parentEmailTemplate.body,
          recipientNames: selectedParentName,
          recipientEmails: selectedParentEmail,
          responseItems: mode !== 'without-scores' ? selectedResponseItems : [],
        },
      })
    } catch (error) {
      console.error('PDF export failed', error)
      setActionErrorMessage(error.message || 'The PDF could not be generated right now. Try again in a moment.')
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!user?.clubId && !isPlatformOwner) {
      console.error('Evaluation submit failed: missing club ID for current user.')
      setActionErrorMessage('Your account is missing a club assignment.')
      return
    }

    if (!String(formData.team ?? '').trim()) {
      console.error('Evaluation submit failed: no team selected.')
      setActionErrorMessage('Select a team before submitting the evaluation.')
      return
    }

    setIsSubmitting(true)
    setActionErrorMessage('')

    try {
      const normalizedPlayerName = normalizePlayerName(formData.playerName)
      const evaluation = buildEvaluationPayload(offlineDraftId)

      if (!editingEvaluation?.id && user?.clubId) {
        const allEvaluations = await getEvaluations({ user })
        const currentMonth = new Date().toISOString().slice(0, 7)
        const monthlyEvaluationCount = allEvaluations.filter((item) => {
          const createdValue = item.createdAt || item.created_at || item.date
          const parsedDate = new Date(createdValue)
          return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 7) === currentMonth
        }).length

        if (!isWithinPlanLimit(user, 'monthlyEvaluations', monthlyEvaluationCount)) {
          throw new Error(createLimitUpgradeMessage(user, 'monthlyEvaluations', 'Monthly assessments'))
        }
      }

      if (!navigator.onLine) {
        saveDraft({
          id: offlineDraftId,
          operation: editingEvaluation ? 'update' : 'create',
          evaluationId: editingEvaluation?.id || null,
          clubId: user.clubId,
          data: evaluation,
          createdAt: new Date().toISOString(),
          readyToSync: true,
          synced: false,
        })
        setOfflineStatusMessage('Saved offline - this assessment will sync when the connection returns.')
        showToast({ title: 'Saved offline', message: 'This assessment will sync when you are back online.' })
        setIsSaved(true)
        return
      }

      if (editingEvaluation) {
        await updateEvaluation(editingEvaluation.id, evaluation, user?.clubId)
      } else {
        await createEvaluation(evaluation)
      }

      removeDraft(offlineDraftId)

      if (previewMode === 'email' && selectedParentEmail) {
        try {
          if (!canUseParentEmail) {
            throw new Error(createFeatureUpgradeMessage('parentEmail'))
          }

          setIsSendingParentEmail(true)
          const emailJobs = contactAudiences
            .map((audience) => {
              const contactType = audience === EMAIL_TEMPLATE_AUDIENCES.player ? PLAYER_CONTACT_TYPES.self : PLAYER_CONTACT_TYPES.parent
              const contacts = selectedParentContacts.filter((contact) => contact.type === contactType)
              const recipientEmail = contacts.length > 0 ? formatParentContactEmails(contacts) : ''
              const recipientName = contacts.length > 0 ? formatParentContactNames(contacts, contactType === PLAYER_CONTACT_TYPES.self ? formData.playerName : formData.parentName) : ''

              if (!recipientEmail) {
                return null
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

              const renderedTemplate = renderParentEmailTemplate(template, {
                recipientName,
                parentName: recipientName,
                playerName: normalizedPlayerName,
                coachName: formData.coachName,
                clubName: user?.clubName,
                teamName: formData.team,
                session: formData.session,
                inviteDate,
                summary: previewSummary,
              })

              return sendParentEmail({
                parentEmail: recipientEmail,
                parentName: recipientName,
                senderEmail: user?.email,
                displayName: user?.displayName || user?.display_name || user?.username || user?.name,
                teamName: user?.team_name || user?.emailTeamName || formData.team,
                clubName: user?.club_name || user?.emailClubName || user?.clubName,
                planKey: user?.planKey,
                logoUrl: user?.clubLogoUrl || null,
                replyToEmail: user?.reply_to_email || user?.replyToEmail || user?.clubContactEmail,
                clubContactEmail: user?.clubContactEmail,
                playerName: normalizedPlayerName,
                summary: previewSummary,
                responses: selectedResponseItems,
                subject: renderedTemplate.subject,
                emailBody: renderedTemplate.body,
                evaluationId: editingEvaluation?.id || evaluation.id,
              })
            })
            .filter(Boolean)

          if (emailJobs.length === 0) {
            throw new Error(`Add a ${contactNoun} email before sending.`)
          }

          await Promise.all(emailJobs)
          showToast({ title: 'Email sent successfully' })
        } catch (emailError) {
          console.error('Email failed', emailError)
          showToast({ title: 'Email failed - will retry automatically', tone: 'error' })
        }
      }

      const assessmentSessionId = String(searchParams.get('sessionId') ?? '').trim()

      if (user?.clubId && assessmentSessionId) {
        const progressKey = `session-assessment-progress:${user.clubId}:${assessmentSessionId}`

        try {
          const storedProgress = localStorage.getItem(progressKey)
          const parsedProgress = storedProgress ? JSON.parse(storedProgress) : []
          const completedPlayers = Array.isArray(parsedProgress) ? parsedProgress : []
          localStorage.setItem(
            progressKey,
            JSON.stringify([...new Set([...completedPlayers, normalizePlayerName(normalizedPlayerName).toLowerCase()])]),
          )
        } catch (error) {
          console.error(error)
        }
      }

      const queryPlayerName = String(searchParams.get('player') ?? '').trim()
      const queryTeam = String(searchParams.get('team') ?? '').trim()
      const querySession = normalizeSessionValue(searchParams.get('session'))
      const querySection = String(searchParams.get('section') ?? '').trim()
      const nextSessionValue = querySession || lastUsedSession
      const nextTeamValue =
        queryTeam && availableTeams.some((team) => team.name === queryTeam)
          ? queryTeam
          : String(formData.team ?? '').trim()

      if (draftStorageKey) {
        sessionStorage.removeItem(draftStorageKey)
      }

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
        nextSearchParams.set('section', EVALUATION_SECTIONS.includes(querySection) ? querySection : formData.section)
        navigate(`/assess-player?${nextSearchParams.toString()}`)
        return
      }

      if (!editingEvaluation && assessmentQueue.length > 0) {
        const completedSessionId = assessmentSessionId
        const completedCount = Number(searchParams.get('queueTotal') ?? assessmentQueue.length) || assessmentQueue.length

        if (completedSessionId) {
          const completedSearchParams = new URLSearchParams()
          completedSearchParams.set('completedSessionId', completedSessionId)
          completedSearchParams.set('completedCount', String(completedCount))
          navigate(`/sessions?${completedSearchParams.toString()}`)
          return
        }
      }

      setLastSavedPlayerName(normalizedPlayerName)
      setSelectedParentContactIndexes([0])
      if (editingEvaluation) {
        setEditingEvaluation(evaluation)
      } else {
        setFormData(
          createInitialFormData(user, {
            playerName: queryPlayerName,
            team: nextTeamValue,
            session: nextSessionValue,
            section: EVALUATION_SECTIONS.includes(querySection) ? querySection : formData.section,
          }),
        )
        setResponseValues(createEmptyResponseValues(dynamicFields))
      }
      setLastUsedSession(nextSessionValue)
      setIsSaved(true)
      setOfflineStatusMessage('')
      setOfflineDraftId(createLocalId())
    } catch (error) {
      console.error('Evaluation submit failed', error)
      setIsSaved(false)

      if (isNetworkError(error)) {
        try {
          saveDraft({
            id: offlineDraftId,
            operation: editingEvaluation ? 'update' : 'create',
            evaluationId: editingEvaluation?.id || null,
            clubId: user.clubId,
            data: buildEvaluationPayload(offlineDraftId),
            createdAt: new Date().toISOString(),
            readyToSync: true,
            synced: false,
          })
          setOfflineStatusMessage('Saved offline - this assessment will sync when the connection returns.')
          showToast({ title: 'Saved offline', message: 'This assessment will sync when you are back online.' })
          return
        } catch (draftError) {
          console.error('Offline draft queue failed', draftError)
        }
      }

      setActionErrorMessage('This evaluation could not be saved right now. Check the player details and try again.')
    } finally {
      setIsSendingParentEmail(false)
      setIsSubmitting(false)
    }
  }

  const handleSubmitClick = () => {
    setActionErrorMessage('')

    if (!formRef.current?.reportValidity()) {
      return
    }

    formRef.current.requestSubmit()
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <BlankPrintForm
        clubName={user?.clubName || 'Club Form'}
        logoUrl={user?.clubLogoUrl || fallbackLogo}
        fields={enabledFields}
      />

      <div className={isPrintingBlankView ? 'no-print' : ''}>
        <PageHeader
          eyebrow="Assessment"
          title="Assess player"
          description="Capture a trial or squad assessment, preview the export live, and save it when ready."
        />

        {isSaved ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
            Evaluation saved
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

        {!canCreateEvaluation(user) ? (
          <SectionCard
            title="Platform account"
            description="Super admins oversee the platform. Assessments must be created from a club user account."
          >
            <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm leading-6 text-[var(--text-muted)]">
              Use this account to manage clubs, users, and the wider workspace. Switch into a club-linked account to
              assess players.
            </div>
          </SectionCard>
        ) : isLoadingFields ? (
          <SectionCard title="Form" description="Loading the configured evaluation fields for this club.">
            <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
              Loading form fields...
            </div>
          </SectionCard>
        ) : isLoadingTeams ? (
          <SectionCard title="Teams" description="Loading the available teams for this account.">
            <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
              Loading teams...
            </div>
          </SectionCard>
        ) : teamsLoadErrorMessage ? (
          <SectionCard title="Teams unavailable" description="The team list could not be loaded for this account just now.">
            <div className="space-y-4 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm leading-6 text-[var(--text-muted)]">
              <p>{teamsLoadErrorMessage}</p>
              {canManageUsers(user) ? (
                <div>
                  <Link
                    to="/teams"
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                  >
                    Open Team Management
                  </Link>
                </div>
              ) : null}
            </div>
          </SectionCard>
        ) : availableTeams.length === 0 ? (
          <SectionCard
            title="No teams available"
            description="Assessments now use real club teams so staff can be routed and filtered correctly."
          >
            <div className="space-y-4 rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm leading-6 text-[var(--text-muted)]">
              <p>{noTeamsMessage}</p>
              {canManageUsers(user) ? (
                <div>
                  <Link
                    to="/teams"
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
                  >
                    Open Team Management
                  </Link>
                </div>
              ) : null}
            </div>
          </SectionCard>
        ) : (
          <>
            <form ref={formRef} className="space-y-5 sm:space-y-6 no-print" onSubmit={handleSubmit}>
              <SectionCard
                title="Player details"
                description="Core details stay consistent while the club-configured evaluation fields adapt below."
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Name</span>
                    <input
                      type="text"
                      name="playerName"
                      value={formData.playerName}
                      onChange={handleFieldChange}
                      required
                      list="saved-player-list"
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    />
                    <datalist id="saved-player-list">
                      {savedPlayers.map((player) => (
                        <option key={player.id} value={player.playerName} />
                      ))}
                    </datalist>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
                    <select
                      name="team"
                      value={formData.team}
                      onChange={handleFieldChange}
                      required
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    >
                      <option value="">Select team</option>
                      {availableTeams.map((team) => (
                        <option key={team.id} value={team.name}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                      {canManageUsers(user)
                        ? 'Managers and admins can assess against any club team.'
                        : 'You can only assess players for teams assigned to your account.'}
                    </p>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Coach</span>
                    <input
                      type="text"
                      name="coachName"
                      value={formData.coachName}
                      readOnly
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none"
                    />
                  </label>

                  <div className="md:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">{contactLabel} PDF Recipients</span>
                    {parentContacts.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">
                        {parentContacts.map((contact, index) => (
                          <label
                            key={`${contact.email || contact.name}-${index}`}
                            className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)]"
                          >
                            <input
                              type="checkbox"
                              checked={selectedParentContactIndexes.includes(index)}
                              onChange={() => handleToggleParentContact(index)}
                              className="h-4 w-4 accent-[var(--accent)]"
                            />
                            <span className="min-w-0">
                              <span className="block font-semibold">{contact.name || (contact.type === PLAYER_CONTACT_TYPES.self ? 'Player' : 'Parent/Guardian')}</span>
                              <span className="block break-words text-xs text-[var(--text-muted)]">{contact.email || 'No email entered'}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                            {contactLabel} Name
                          </span>
                          <input
                            type="text"
                            name="parentName"
                            value={formData.parentName}
                            onChange={handleFieldChange}
                            className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                            {contactLabel} Email
                          </span>
                          <input
                            type="email"
                            name="parentEmail"
                            value={formData.parentEmail}
                            onChange={handleFieldChange}
                            className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          />
                        </label>
                      </div>
                    )}
                    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                      Selected {contactNounPlural} are used for {contactNoun} email PDF templates.
                    </p>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Session</span>
                    <input
                      type="date"
                      name="session"
                      value={formatSessionForInput(formData.session)}
                      onChange={handleFieldChange}
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    />
                    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Current session: {readableSession}</p>
                  </label>

                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {EVALUATION_SECTIONS.map((section) => (
                    <button
                      key={section}
                      type="button"
                      onClick={() => handleSectionChange(section)}
                      className={[
                        'inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition',
                        formData.section === section
                          ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                          : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                      ].join(' ')}
                    >
                      {section}
                    </button>
                  ))}
                </div>
              </SectionCard>

              {previousEvaluations.length > 0 ? (
                <SectionCard
                  title="Previous assessments"
                  description="Use this while assessing an existing player. These notes are for reference only and are not added to the new PDF."
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-6 text-[var(--text-muted)]">
                      {previousEvaluations.length} previous assessment{previousEvaluations.length === 1 ? '' : 's'} found for this player.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowPreviousAssessments((current) => !current)}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                    >
                      {showPreviousAssessments ? 'Hide Previous Assessments' : 'View Previous Assessments'}
                    </button>
                  </div>
                  {showPreviousAssessments ? (
                    <div className="mt-4 grid gap-3">
                      {previousEvaluations.map((evaluation) => {
                        const previousAssessmentItems = buildPreviousAssessmentItems(evaluation)

                        return (
                          <div key={evaluation.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <p className="font-semibold text-[var(--text-primary)]">{evaluation.date || 'No date entered'}</p>
                              <p className="text-sm font-semibold text-[var(--text-secondary)]">
                                Score: {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}
                              </p>
                            </div>
                            <div className="mt-2 grid gap-1 text-sm text-[var(--text-muted)] sm:grid-cols-2">
                              <p>Session: {evaluation.session || 'No session entered'}</p>
                              <p>Section: {evaluation.section || 'No section entered'}</p>
                              <p>Team: {evaluation.team || 'No team entered'}</p>
                              <p>Coach: {evaluation.coach || 'No coach entered'}</p>
                            </div>
                            <div className="mt-3 grid gap-2 md:grid-cols-2">
                              {previousAssessmentItems.length > 0 ? (
                                previousAssessmentItems.map((item) => (
                                  <div key={item.label} className="rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2">
                                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">{item.label}</p>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{item.value}</p>
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm text-[var(--text-muted)] md:col-span-2">
                                  No assessment details were entered.
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </SectionCard>
              ) : null}

              <SectionCard
                title="Configured fields"
                description={
                  isFallbackFields
                    ? 'No club-specific form fields were found, so the default assessment fields were loaded.'
                    : 'These enabled fields come from the club form builder and are saved as form responses.'
                }
              >
                {enabledFields.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
                    No evaluation fields are enabled for this club. Enable fields in the form builder first.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {enabledFields.map((field) => (
                      <label key={field.id} className={field.type === 'textarea' ? 'block md:col-span-2' : 'block'}>
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
                          {field.label}
                          {field.required ? ' *' : ''}
                        </span>
                        <EvaluationFieldInput field={field} value={responseValues[field.id] ?? ''} onChange={handleResponseChange} />
                      </label>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Submit and export"
                description="Choose the preview mode, export the PDF, or print the blank form before saving."
              >
                <div className="mb-4 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
                  Overall Score: {averageScore !== null ? averageScore.toFixed(1) : '-'}
                </div>

                <div className="mb-4 flex flex-wrap gap-3">
                  {[
                    { key: 'scored', label: 'Scored Preview' },
                    { key: 'without-scores', label: 'Preview Without Scores' },
                    ...(isDemoAccount ? [] : [{ key: 'email', label: 'Email Template Preview' }]),
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setPreviewMode(option.key)}
                      className={[
                        'inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition',
                        previewMode === option.key
                          ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                          : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                      ].join(' ')}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {previewMode === 'email' ? (
                  <div className="mb-4 grid gap-4 md:grid-cols-2">
                    {availableEmailTemplates.length > 0 ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email template</span>
                        <select
                          value={selectedEmailTemplateKey}
                          onChange={(event) => setEmailTemplateKey(event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        >
                          {availableEmailTemplates.map((template) => (
                            <option key={template.key} value={template.key}>
                              {template.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <NoticeBanner
                        title="Create an email template first"
                        message={
                          isLoadingEmailTemplates
                            ? `Loading ${contactNoun} email templates...`
                            : `Ask a manager to save a club ${contactNoun} email template before sending emails.`
                        }
                        tone="info"
                      />
                    )}

                    {shouldShowInviteDate ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
                          Invite date
                        </span>
                        <input
                          type="date"
                          value={inviteDate}
                          onChange={(event) => setInviteDate(normalizeSessionValue(event.target.value))}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                          This is only used in invite email templates. The Session field above remains the saved current session date.
                        </p>
                      </label>
                    ) : null}
                  </div>
                ) : null}

                <div className="mb-4 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">Evaluation details to include</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                        Choose what goes into the {contactNoun} email and PDF. This choice is saved in this browser for this player.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleSetAllExportFields}
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
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {responseItems.map((item) => {
                        const isSelected = hasSavedExportSelection ? selectedExportLabels.includes(item.label) : true

                        return (
                          <label
                            key={item.label}
                            className="flex min-h-11 items-start gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleExportField(item.label)}
                              className="mt-1 h-4 w-4 accent-[var(--accent)]"
                            />
                            <span className="min-w-0">
                              <span className="block font-semibold">{item.label}</span>
                              <span className="block break-words text-xs leading-5 text-[var(--text-muted)]">
                                {String(item.value ?? '').trim() || 'No data entered'}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mt-4 rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-muted)]">
                      No evaluation responses have been entered yet.
                    </p>
                  )}

                  <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
                    {selectedResponseItems.length} of {responseItems.length} field{responseItems.length === 1 ? '' : 's'} selected.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={handleSubmitClick}
                    disabled={isSubmitting || !canSubmitEvaluation}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {isSubmitting ? (isSendingParentEmail ? 'Sending Email...' : 'Saving...') : 'Submit Evaluation'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPdf(previewMode)}
                    disabled={isGeneratingPdf || !canUsePdfExport}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {isGeneratingPdf ? 'Preparing PDF...' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPdf('without-scores')}
                    disabled={isGeneratingPdf || !canUsePdfExport}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {isGeneratingPdf ? 'Preparing PDF...' : 'PDF Without Scores'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPrintingBlankView(true)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                  >
                    Print Blank Form
                  </button>
                  {isSaved && lastSavedPlayerName ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/player/${encodeURIComponent(lastSavedPlayerName)}`)}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                    >
                      Save & Go to Player
                    </button>
                  ) : null}
                </div>
              </SectionCard>
            </form>

            <div className="section">
              <SectionCard
                title="Preview"
                description={`This preview updates live. Switch between the full scored report and the ${contactNoun} email template.`}
              >
                <EmailPreview
                  clubName={user?.clubName || 'Club Name'}
                  planKey={user?.planKey}
                  logoUrl={user?.clubLogoUrl || fallbackLogo}
                  playerName={formData.playerName || 'Player Name'}
                  team={formData.team}
                  section={formData.section}
                  session={formData.session}
                  summary={previewSummary}
                  emailSubject={parentEmailTemplate.subject}
                  emailBody={parentEmailTemplate.body}
                  recipientNames={selectedParentName}
                  responseItems={previewResponseItems}
                  mode={previewMode}
                />
              </SectionCard>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
