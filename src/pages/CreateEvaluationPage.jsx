import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { EmailPreview } from '../components/ui/EmailPreview.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canCreateEvaluation, canManageUsers, isSuperAdmin, useAuth } from '../lib/auth.js'
import { buildEvaluationSummary, exportEvaluationPdf } from '../lib/pdf.js'
import {
  EVALUATION_SECTIONS,
  createEvaluation,
  getAvailableTeamsForUser,
  getDefaultFormFields,
  getFormFields,
  withRequestTimeout,
} from '../lib/supabase.js'

function createInitialFormData(user, defaults = {}) {
  return {
    team: '',
    section: 'Trial',
    session: '',
    coachName: user?.name || '',
    playerName: '',
    parentEmail: '',
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

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return parsedDate.toISOString()
}

function formatSessionForInput(value) {
  const normalizedValue = normalizeSessionValue(value)

  if (!normalizedValue) {
    return ''
  }

  const date = new Date(normalizedValue)
  const timezoneOffset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - timezoneOffset * 60 * 1000)

  return localDate.toISOString().slice(0, 16)
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
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(normalizedValue))
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
  const [formData, setFormData] = useState(() => createInitialFormData(user))
  const [dynamicFields, setDynamicFields] = useState([])
  const [availableTeams, setAvailableTeams] = useState([])
  const [responseValues, setResponseValues] = useState({})
  const [isFallbackFields, setIsFallbackFields] = useState(false)
  const [isLoadingFields, setIsLoadingFields] = useState(true)
  const [isLoadingTeams, setIsLoadingTeams] = useState(true)
  const [isSaved, setIsSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isPrintingBlankView, setIsPrintingBlankView] = useState(false)
  const [lastSavedPlayerName, setLastSavedPlayerName] = useState('')
  const [lastUsedSession, setLastUsedSession] = useState('')
  const [previewMode, setPreviewMode] = useState('scored')
  const [errorMessage, setErrorMessage] = useState('')

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
    setResponseValues(
      storedDraft?.responseValues && typeof storedDraft.responseValues === 'object' ? storedDraft.responseValues : {},
    )
    setLastUsedSession(nextSessionValue)
    hasInitializedRef.current = true
  }, [draftStorageKey, searchParams, user])

  useEffect(() => {
    let isMounted = true

    const loadTeams = async () => {
      if (!user || isPlatformOwner) {
        setAvailableTeams([])
        setIsLoadingTeams(false)
        return
      }

      setIsLoadingTeams(true)
      setErrorMessage('')

      try {
        const nextTeams = await withRequestTimeout(
          () => getAvailableTeamsForUser(user),
          'Could not load teams. No team data entered yet, or the request took too long.',
        )

        if (!isMounted) {
          return
        }

        setAvailableTeams(nextTeams)
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
          setAvailableTeams([])
          setErrorMessage(error.message || 'Could not load teams.')
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
  }, [isPlatformOwner, searchParams, user])

  useEffect(() => {
    let isMounted = true

    const loadFields = async () => {
      if (!user || isPlatformOwner) {
        setDynamicFields([])
        setResponseValues({})
        setIsLoadingFields(false)
        return
      }

      setIsLoadingFields(true)
      setErrorMessage('')

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
      } catch (error) {
        console.error(error)

        if (isMounted) {
          const fallbackFields = getDefaultFormFields()
          setDynamicFields(fallbackFields)
          setResponseValues(createEmptyResponseValues(fallbackFields))
          setIsFallbackFields(true)
          setErrorMessage(error.message || 'Could not load form fields.')
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
  }, [isPlatformOwner, user])

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
        }),
      )
    } catch (error) {
      console.error(error)
    }
  }, [draftStorageKey, formData, isPlatformOwner, lastUsedSession, previewMode, responseValues])

  const enabledFields = useMemo(() => dynamicFields.filter((field) => field.isEnabled), [dynamicFields])
  const formResponses = useMemo(() => buildFormResponses(enabledFields, responseValues), [enabledFields, responseValues])
  const scores = useMemo(() => buildScores(formResponses), [formResponses])
  const comments = useMemo(() => buildComments(formResponses), [formResponses])
  const averageScore = useMemo(() => getAverageScore(formResponses), [formResponses])
  const responseItems = useMemo(() => createResponseItems(enabledFields, responseValues), [enabledFields, responseValues])
  const readableSession = useMemo(() => formatSessionForDisplay(formData.session), [formData.session])
  const previewSummary = useMemo(
    () =>
      buildEvaluationSummary({
        comments,
        formResponses,
      }),
    [comments, formResponses],
  )
  const canSubmitEvaluation = enabledFields.length > 0 && availableTeams.length > 0
  const noTeamsMessage = canManageUsers(user)
    ? 'No teams exist for this club yet. Create a team first, then assessments can be assigned correctly.'
    : 'No teams are assigned to your account yet. Ask a manager to allocate you to at least one team.'

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
    setErrorMessage('')

    if (name === 'session') {
      const nextSessionValue = normalizeSessionValue(value)

      setFormData((current) => ({
        ...current,
        session: nextSessionValue,
      }))
      setLastUsedSession(nextSessionValue)
      return
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleResponseChange = (fieldId, value) => {
    setIsSaved(false)
    setErrorMessage('')
    setResponseValues((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleDownloadPdf = async (mode = previewMode) => {
    setIsGeneratingPdf(true)
    setErrorMessage('')

    try {
      await exportEvaluationPdf({
        filename: `${normalizePlayerName(formData.playerName || 'evaluation')}-${mode}.pdf`,
        mode,
        previewProps: {
          clubName: user?.clubName || 'Club Name',
          logoUrl: user?.clubLogoUrl || fallbackLogo,
          playerName: formData.playerName || 'Player Name',
          team: formData.team,
          section: formData.section,
          session: formData.session,
          decision: formData.decision,
          summary: previewSummary,
          responseItems,
        },
      })
    } catch (error) {
      console.error('PDF export failed', error)
      setErrorMessage('Could not generate the PDF. Check the console for details.')
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
      setErrorMessage('Your account is missing a club assignment.')
      return
    }

    if (!String(formData.team ?? '').trim()) {
      console.error('Evaluation submit failed: no team selected.')
      setErrorMessage('Select a team before submitting the evaluation.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')

    try {
      const normalizedPlayerName = normalizePlayerName(formData.playerName)
      const evaluation = {
        playerName: normalizedPlayerName,
        team: String(formData.team).trim(),
        section: formData.section,
        clubId: user?.clubId,
        coachId: user?.id,
        coach: String(user?.name || formData.coachName).trim(),
        parentEmail: formData.parentEmail.trim(),
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

      setLastSavedPlayerName(normalizedPlayerName)
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
      setErrorMessage('Could not submit the evaluation. Check the console for details.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitClick = () => {
    setErrorMessage('')

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

        {errorMessage ? (
          <div className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
            {errorMessage}
          </div>
        ) : null}

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
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    />
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

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Parent Email</span>
                    <input
                      type="email"
                      name="parentEmail"
                      value={formData.parentEmail}
                      onChange={handleFieldChange}
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Session</span>
                    <input
                      type="datetime-local"
                      name="session"
                      value={formatSessionForInput(formData.session)}
                      onChange={handleFieldChange}
                      className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    />
                    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Stored as ISO. Current session: {readableSession}</p>
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
                  responseItems={responseItems}
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
