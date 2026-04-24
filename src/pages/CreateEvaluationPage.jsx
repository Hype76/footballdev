import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { EmailPreview } from '../components/ui/EmailPreview.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canCreateEvaluation, canManageUsers, isSuperAdmin, useAuth } from '../lib/auth.js'
import {
  PARENT_EMAIL_TEMPLATES,
  buildParentEmailTemplate,
  getEmailTemplateKey,
  isInviteEmailTemplate,
} from '../lib/email-templates.js'
import {
  EVALUATION_SECTIONS,
  createEvaluation,
  getAvailableTeamsForUser,
  getClubSettings,
  getDefaultFormFields,
  getFormFields,
  getPlayers,
  formatParentContactEmails,
  formatParentContactNames,
  normalizeParentContacts,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function createInitialFormData(user, defaults = {}) {
  return {
    team: '',
    section: 'Trial',
    session: '',
    coachName: user?.name || '',
    playerName: '',
    parentName: '',
    parentEmail: '',
    parentContacts: [],
    decision: 'Progress',
    ...defaults,
  }
}

function getDraftStorageKey(user) {
  if (!user?.id) {
    return ''
  }

  return `create-evaluation-draft:${user.id}:${user.clubId || 'platform'}`
}

async function getLatestClubLogoUrl(user) {
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

function normalizePlayerName(value) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function createEmptyResponseValues(fields) {
  return Object.fromEntries(fields.map((field) => [field.id, '']))
}

function isScoreFieldType(fieldType) {
  return fieldType === 'score_1_5' || fieldType === 'score_1_10' || fieldType === 'number'
}

function createScoreOptions(fieldType) {
  const maxValue = fieldType === 'score_1_10' ? 10 : 5
  return Array.from({ length: maxValue }, (_, index) => String(index + 1))
}

function getFieldSelectOptions(field) {
  if (field.type === 'select') {
    return field.options
  }

  if (isScoreFieldType(field.type)) {
    return createScoreOptions(field.type)
  }

  return []
}

function normalizeResponseValue(field, value) {
  if (isScoreFieldType(field.type)) {
    const numericValue = Number(value)
    return Number.isNaN(numericValue) ? '' : numericValue
  }

  return String(value ?? '').trim()
}

function buildFormResponses(fields, responseValues) {
  return Object.fromEntries(
    fields
      .map((field) => [field.label, normalizeResponseValue(field, responseValues[field.id])])
      .filter(([, value]) => value !== ''),
  )
}

function buildScores(formResponses) {
  return Object.fromEntries(
    Object.entries(formResponses).filter(([, value]) => typeof value === 'number' && !Number.isNaN(value)),
  )
}

function buildComments(formResponses) {
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

function getAverageScore(formResponses) {
  const values = Object.values(formResponses)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value))

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function createResponseItems(fields, responseValues, includeEmptyValues = false) {
  return fields
    .map((field) => {
      const value = normalizeResponseValue(field, responseValues[field.id])

      if (!includeEmptyValues && value === '') {
        return null
      }

      return {
        label: field.label,
        value,
      }
    })
    .filter(Boolean)
}

function parseStoredDraft(storageKey) {
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

function normalizeSessionValue(value) {
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

function formatSessionForInput(value) {
  const normalizedValue = normalizeSessionValue(value)

  if (!normalizedValue) {
    return ''
  }

  return normalizedValue
}

function formatSessionForDisplay(value) {
  const normalizedValue = normalizeSessionValue(value)

  if (!normalizedValue) {
    return 'Not scheduled'
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${normalizedValue}T00:00:00`))
}

function parseAssessmentQueue(value) {
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

function buildPreviewSummary({ comments, formResponses }) {
  const responseEntries = Object.entries(formResponses ?? {})

  if (responseEntries.length > 0) {
    return responseEntries
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')
  }

  return comments?.overall || comments?.strengths || comments?.improvements || 'No written summary provided.'
}

function FieldInput({ field, value, onChange }) {
  const sharedClassName =
    'min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]'

  if (field.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange(field.id, event.target.value)}
        required={field.required}
        rows="4"
        className="min-h-32 w-full rounded-3xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
      />
    )
  }

  if (field.type === 'select' || isScoreFieldType(field.type)) {
    const options = getFieldSelectOptions(field)

    return (
      <select
        value={value}
        onChange={(event) => onChange(field.id, event.target.value)}
        required={field.required}
        className={sharedClassName}
      >
        <option value="">{isScoreFieldType(field.type) ? 'Select score' : 'Select option'}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(field.id, event.target.value)}
      required={field.required}
      className={sharedClassName}
    />
  )
}

function BlankPrintForm({ clubName, logoUrl, fields }) {
  const resolvedLogoUrl = logoUrl || fallbackLogo

  return (
    <div className="print-only hidden bg-white text-slate-900">
      <div className="print-container mx-auto max-w-3xl p-8">
        <div className="section border-b border-slate-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Printable Blank Form</p>
          <div className="mt-4">
            <img src={resolvedLogoUrl} alt={clubName} className="max-h-20 w-auto max-w-[150px] object-contain" />
          </div>
          <h1 className="mt-3 text-3xl font-semibold">{clubName}</h1>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {['Player Name', 'Team', 'Coach', 'Parent Email', 'Decision', 'Session', 'Section'].map((label) => (
            <div key={label} className="section rounded-2xl border border-slate-200 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
              <div className="mt-4 h-6 border-b border-slate-300" />
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-4">
          {fields.map((field) => (
            <div key={field.id} className="section rounded-2xl border border-slate-200 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{field.label}</p>
              {field.type === 'textarea' ? (
                <div className="mt-4 h-28 rounded-2xl border border-slate-200 bg-slate-50" />
              ) : (
                <div className="mt-4 h-10 rounded-2xl border border-slate-200 bg-slate-50" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CreateEvaluationPage() {
  const { user } = useAuth()
  const isPlatformOwner = isSuperAdmin(user)
  const formRef = useRef(null)
  const hasInitializedRef = useRef(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''
  const searchParamsKey = searchParams.toString()
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
  const [responseValues, setResponseValues] = useState({})
  const [isFallbackFields, setIsFallbackFields] = useState(() => Boolean(cachedFields?.isFallbackFields))
  const [isLoadingFields, setIsLoadingFields] = useState(() => !cachedFields?.dynamicFields)
  const [isLoadingTeams, setIsLoadingTeams] = useState(() => !cachedTeams?.length)
  const [isSaved, setIsSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isPrintingBlankView, setIsPrintingBlankView] = useState(false)
  const [lastSavedPlayerName, setLastSavedPlayerName] = useState('')
  const [lastUsedSession, setLastUsedSession] = useState('')
  const [previewMode, setPreviewMode] = useState('scored')
  const [emailTemplateKey, setEmailTemplateKey] = useState('')
  const [selectedParentContactIndexes, setSelectedParentContactIndexes] = useState([0])
  const [inviteDate, setInviteDate] = useState('')
  const [actionErrorMessage, setActionErrorMessage] = useState('')
  const [dataRefreshNotice, setDataRefreshNotice] = useState('')
  const [teamsLoadErrorMessage, setTeamsLoadErrorMessage] = useState('')

  const draftStorageKey = getDraftStorageKey(user)

  useEffect(() => {
    if (!user) {
      return
    }

    const requestedPlayerName = String(searchParams.get('player') ?? '').trim()
    const requestedTeam = String(searchParams.get('team') ?? '').trim()
    const requestedSession = normalizeSessionValue(searchParams.get('session'))
    const requestedSection = String(searchParams.get('section') ?? '').trim()
    const storedDraft = parseStoredDraft(draftStorageKey)
    const restoredFormData =
      storedDraft?.formData && typeof storedDraft.formData === 'object' ? storedDraft.formData : {}
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
    setPreviewMode(String(storedDraft?.previewMode ?? 'scored') === 'email' ? 'email' : 'scored')
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
    hasInitializedRef.current = true
  }, [draftStorageKey, searchParamsKey, user, userScopeKey])

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
        const matchingPlayer = nextPlayers.find((player) => player.playerName === requestedPlayerName)

        if (matchingPlayer) {
          const parentContacts = normalizeParentContacts(matchingPlayer.parentContacts, {
            parentName: matchingPlayer.parentName,
            parentEmail: matchingPlayer.parentEmail,
          })

          setFormData((current) => ({
            ...current,
            parentName: current.parentName || parentContacts[0]?.name || matchingPlayer.parentName,
            parentEmail: current.parentEmail || parentContacts[0]?.email || matchingPlayer.parentEmail,
            parentContacts: current.parentContacts?.length ? current.parentContacts : parentContacts,
            team: current.team || matchingPlayer.team,
            section: current.section || matchingPlayer.section,
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
    if (!hasInitializedRef.current || !draftStorageKey || isPlatformOwner) {
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
        }),
      )
    } catch (error) {
      console.error(error)
    }
  }, [
    draftStorageKey,
    emailTemplateKey,
    formData,
    inviteDate,
    isPlatformOwner,
    lastUsedSession,
    previewMode,
    responseValues,
    selectedParentContactIndexes,
  ])

  const enabledFields = useMemo(() => dynamicFields.filter((field) => field.isEnabled), [dynamicFields])
  const formResponses = useMemo(() => buildFormResponses(enabledFields, responseValues), [enabledFields, responseValues])
  const scores = useMemo(() => buildScores(formResponses), [formResponses])
  const comments = useMemo(() => buildComments(formResponses), [formResponses])
  const averageScore = useMemo(() => getAverageScore(formResponses), [formResponses])
  const responseItems = useMemo(() => createResponseItems(enabledFields, responseValues), [enabledFields, responseValues])
  const readableSession = useMemo(() => formatSessionForDisplay(formData.session), [formData.session])
  const selectedEmailTemplateKey = emailTemplateKey || getEmailTemplateKey(formData.decision)
  const shouldShowInviteDate = previewMode === 'email' && isInviteEmailTemplate(selectedEmailTemplateKey)
  const parentContacts = useMemo(
    () =>
      normalizeParentContacts(formData.parentContacts, {
        parentName: formData.parentName,
        parentEmail: formData.parentEmail,
      }),
    [formData.parentContacts, formData.parentEmail, formData.parentName],
  )
  const selectedParentContacts = useMemo(() => {
    const selectedContacts = parentContacts.filter((_, index) => selectedParentContactIndexes.includes(index))
    return selectedContacts.length > 0 ? selectedContacts : parentContacts.slice(0, 1)
  }, [parentContacts, selectedParentContactIndexes])
  const selectedParentName = formatParentContactNames(selectedParentContacts, formData.parentName)
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
    () =>
      buildParentEmailTemplate({
        parentName: selectedParentName,
        playerName: formData.playerName,
        coachName: formData.coachName,
        clubName: user?.clubName,
        teamName: formData.team,
        session: formData.session,
        inviteDate,
        decision: formData.decision,
        templateKey: selectedEmailTemplateKey,
      }),
    [
      formData.coachName,
      formData.decision,
      formData.playerName,
      formData.session,
      formData.team,
      emailTemplateKey,
      inviteDate,
      selectedEmailTemplateKey,
      selectedParentName,
      user?.clubName,
    ],
  )
  const canSubmitEvaluation = enabledFields.length > 0 && availableTeams.length > 0
  const noTeamsMessage = canManageUsers(user)
    ? 'No teams exist for this club yet. Create a team first, then assessments can be assigned correctly.'
    : 'No teams are assigned to your account yet. Ask a manager to allocate you to at least one team.'

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
      const matchingPlayer = savedPlayers.find((player) => player.playerName === value)
      const matchingParentContacts = normalizeParentContacts(matchingPlayer?.parentContacts, {
        parentName: matchingPlayer?.parentName,
        parentEmail: matchingPlayer?.parentEmail,
      })

      setFormData((current) => ({
        ...current,
        playerName: value,
        parentName: matchingParentContacts[0]?.name || matchingPlayer?.parentName || current.parentName,
        parentEmail: matchingParentContacts[0]?.email || matchingPlayer?.parentEmail || current.parentEmail,
        parentContacts: matchingParentContacts.length > 0 ? matchingParentContacts : current.parentContacts,
        team: matchingPlayer?.team || current.team,
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

  const handleDownloadPdf = async (mode = previewMode) => {
    setIsGeneratingPdf(true)
    setActionErrorMessage('')

    try {
      const { exportEvaluationPdf } = await import('../lib/pdf.js')
      const latestClubLogoUrl = await getLatestClubLogoUrl(user)

      await exportEvaluationPdf({
        filename: `${normalizePlayerName(formData.playerName || 'evaluation')}-${mode}.pdf`,
        mode,
        previewProps: {
          clubName: user?.clubName || 'Club Name',
          logoUrl: latestClubLogoUrl || fallbackLogo,
          playerName: formData.playerName || 'Player Name',
          team: formData.team,
          section: formData.section,
          session: formData.session,
          decision: formData.decision,
          summary: previewSummary,
          emailSubject: parentEmailTemplate.subject,
          emailBody: parentEmailTemplate.body,
          recipientNames: selectedParentName,
          recipientEmails: selectedParentEmail,
          responseItems: mode === 'scored' ? responseItems : [],
        },
      })
    } catch (error) {
      console.error('PDF export failed', error)
      setActionErrorMessage('The PDF could not be generated right now. Try again in a moment.')
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  const handlePrintPreview = () => {
    window.print()
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
      const matchingTeam = availableTeams.find((team) => team.name === String(formData.team).trim())
      const matchingPlayer = savedPlayers.find(
        (player) =>
          player.playerName === normalizedPlayerName &&
          player.section === formData.section &&
          (!formData.team || player.team === String(formData.team).trim()),
      )
      const evaluation = {
        playerName: normalizedPlayerName,
        playerId: matchingPlayer?.id || '',
        team: String(formData.team).trim(),
        teamId: matchingTeam?.id || '',
        section: formData.section,
        clubId: user?.clubId,
        coachId: user?.id,
        coach: String(user?.name || formData.coachName).trim(),
        parentName: parentContacts[0]?.name ?? '',
        parentEmail: parentContacts[0]?.email ?? '',
        parentContacts,
        session: formData.session,
        date: new Date().toLocaleDateString(),
        scores,
        averageScore: averageScore !== null ? Number(averageScore.toFixed(1)) : null,
        comments,
        formResponses,
        decision: formData.decision,
        status: 'Submitted',
        createdAt: new Date().toISOString(),
      }

      await createEvaluation(evaluation)

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

      if (nextQueuedPlayer) {
        const nextSearchParams = new URLSearchParams(searchParams)
        nextSearchParams.set('player', nextQueuedPlayer)
        nextSearchParams.set('team', nextTeamValue)
        nextSearchParams.set('session', nextSessionValue)
        nextSearchParams.set('section', EVALUATION_SECTIONS.includes(querySection) ? querySection : formData.section)
        navigate(`/assess-player?${nextSearchParams.toString()}`)
        return
      }

      if (assessmentQueue.length > 0) {
        const completedSessionId = String(searchParams.get('sessionId') ?? '').trim()
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
      setFormData(
        createInitialFormData(user, {
          playerName: queryPlayerName,
          team: nextTeamValue,
          session: nextSessionValue,
          section: EVALUATION_SECTIONS.includes(querySection) ? querySection : formData.section,
        }),
      )
      setResponseValues(createEmptyResponseValues(dynamicFields))
      setLastUsedSession(nextSessionValue)
      setIsSaved(true)
    } catch (error) {
      console.error('Evaluation submit failed', error)
      setIsSaved(false)
      setActionErrorMessage('The evaluation could not be submitted right now. Try again in a moment.')
    } finally {
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
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Parent PDF Recipients</span>
                    {parentContacts.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
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
                              <span className="block font-semibold">{contact.name || 'Parent/Guardian'}</span>
                              <span className="block break-words text-xs text-[var(--text-muted)]">{contact.email || 'No email entered'}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Parent Name</span>
                          <input
                            type="text"
                            name="parentName"
                            value={formData.parentName}
                            onChange={handleFieldChange}
                            className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Parent Email</span>
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
                      Selected parents are used for parent email PDF templates.
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

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Decision</span>
                    <select
                      name="decision"
                      value={formData.decision}
                      onChange={handleFieldChange}
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                      <option value="Progress">Progress</option>
                    </select>
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {EVALUATION_SECTIONS.map((section) => (
                    <button
                      key={section}
                      type="button"
                      onClick={() => setFormData((current) => ({ ...current, section }))}
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
                        <FieldInput field={field} value={responseValues[field.id] ?? ''} onChange={handleResponseChange} />
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
                    { key: 'email', label: 'Email Template Preview' },
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
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Email template</span>
                      <select
                        value={selectedEmailTemplateKey}
                        onChange={(event) => setEmailTemplateKey(event.target.value)}
                        className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                      >
                        {PARENT_EMAIL_TEMPLATES.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </label>

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

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={handleSubmitClick}
                    disabled={isSubmitting || !canSubmitEvaluation}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {isSubmitting ? 'Saving...' : 'Submit Evaluation'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPdf(previewMode)}
                    disabled={isGeneratingPdf}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {isGeneratingPdf ? 'Preparing PDF...' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintPreview}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                  >
                    Print
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
                description="This preview updates live. Switch between the full scored report and the parent email template."
              >
                <EmailPreview
                  clubName={user?.clubName || 'Club Name'}
                  logoUrl={user?.clubLogoUrl || fallbackLogo}
                  playerName={formData.playerName || 'Player Name'}
                  team={formData.team}
                  section={formData.section}
                  session={formData.session}
                  decision={formData.decision}
                  summary={previewSummary}
                  emailSubject={parentEmailTemplate.subject}
                  emailBody={parentEmailTemplate.body}
                  responseItems={previewMode === 'scored' ? responseItems : []}
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
