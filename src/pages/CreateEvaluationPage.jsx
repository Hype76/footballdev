import { useEffect, useMemo, useRef, useState } from 'react'
import html2pdf from 'html2pdf.js'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmailPreview } from '../components/ui/EmailPreview.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { isSuperAdmin, useAuth } from '../lib/auth.js'
import { createEvaluation, getFormFields } from '../lib/supabase.js'

function createInitialFormData(user, defaults = {}) {
  return {
    team: user?.team || '',
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
    'min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white'

  if (field.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange(field.id, event.target.value)}
        required={field.required}
        rows="4"
        className="min-h-32 w-full rounded-3xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
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
  return (
    <div className="print-only hidden bg-white text-slate-900">
      <div className="print-container mx-auto max-w-3xl p-8">
        <div className="section border-b border-slate-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Printable Blank Form</p>
          {logoUrl ? (
            <div className="mt-4">
              <img src={logoUrl} alt={clubName} className="max-h-20 w-auto max-w-[150px] object-contain" />
            </div>
          ) : null}
          <h1 className="mt-3 text-3xl font-semibold">{clubName}</h1>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {['Player Name', 'Team', 'Coach', 'Parent Email', 'Decision', 'Session'].map((label) => (
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
  const previewRef = useRef(null)
  const hasInitializedRef = useRef(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [formData, setFormData] = useState(() => createInitialFormData(user))
  const [dynamicFields, setDynamicFields] = useState([])
  const [responseValues, setResponseValues] = useState({})
  const [isFallbackFields, setIsFallbackFields] = useState(false)
  const [isLoadingFields, setIsLoadingFields] = useState(true)
  const [isSaved, setIsSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [isPrintingBlankView, setIsPrintingBlankView] = useState(false)
  const [lastSavedPlayerName, setLastSavedPlayerName] = useState('')
  const [lastUsedSession, setLastUsedSession] = useState('')

  const draftStorageKey = getDraftStorageKey(user)

  useEffect(() => {
    if (!user) {
      return
    }

    const requestedPlayerName = String(searchParams.get('player') ?? '').trim()
    const requestedSession = normalizeSessionValue(searchParams.get('session'))
    const storedDraft = parseStoredDraft(draftStorageKey)
    const restoredFormData =
      storedDraft?.formData && typeof storedDraft.formData === 'object' ? storedDraft.formData : {}
    const restoredSession = normalizeSessionValue(restoredFormData.session)
    const rememberedSession = normalizeSessionValue(storedDraft?.lastUsedSession)
    const nextSessionValue = requestedSession || restoredSession || rememberedSession
    const nextFormData = createInitialFormData(user, {
      ...restoredFormData,
      playerName: requestedPlayerName || String(restoredFormData.playerName ?? '').trim(),
      session: nextSessionValue,
      team: user.team || '',
      coachName: user.name || '',
    })

    setFormData(nextFormData)
    setResponseValues(
      storedDraft?.responseValues && typeof storedDraft.responseValues === 'object' ? storedDraft.responseValues : {},
    )
    setLastUsedSession(nextSessionValue)
    hasInitializedRef.current = true
  }, [draftStorageKey, searchParams, user])

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

      try {
        const { fields, isFallback } = await getFormFields({ user })

        if (!isMounted) {
          return
        }

        setDynamicFields(fields)
        setResponseValues((current) => {
          const emptyValues = createEmptyResponseValues(fields)

          return Object.fromEntries(
            Object.keys(emptyValues).map((key) => [key, current[key] ?? '']),
          )
        })
        setIsFallbackFields(isFallback)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setDynamicFields([])
          setResponseValues({})
          setIsFallbackFields(true)
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
        }),
      )
    } catch (error) {
      console.error(error)
    }
  }, [draftStorageKey, formData, isPlatformOwner, lastUsedSession, responseValues])

  const enabledFields = useMemo(
    () => dynamicFields.filter((field) => field.isEnabled),
    [dynamicFields],
  )

  const formResponses = useMemo(
    () => buildFormResponses(enabledFields, responseValues),
    [enabledFields, responseValues],
  )
  const scores = useMemo(() => buildScores(formResponses), [formResponses])
  const comments = useMemo(() => buildComments(formResponses), [formResponses])
  const averageScore = useMemo(() => getAverageScore(formResponses), [formResponses])
  const responseItems = useMemo(
    () => createResponseItems(enabledFields, responseValues),
    [enabledFields, responseValues],
  )
  const readableSession = useMemo(() => formatSessionForDisplay(formData.session), [formData.session])

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)

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
    setResponseValues((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleDownloadPdf = async () => {
    if (!previewRef.current) {
      return
    }

    setIsDownloadingPdf(true)

    try {
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve)
        })
      })

      await html2pdf()
        .set({
          margin: 10,
          filename: `${normalizePlayerName(formData.playerName || 'evaluation')}-feedback.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(previewRef.current)
        .save()
    } catch (error) {
      console.error('PDF export failed', error)
    } finally {
      setIsDownloadingPdf(false)
    }
  }

  const handlePrintPreview = () => {
    window.print()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const normalizedPlayerName = normalizePlayerName(formData.playerName)
      const evaluation = {
        playerName: normalizedPlayerName,
        team: String(user?.team || formData.team).trim(),
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

      console.log('Submitting evaluation', evaluation)
      await createEvaluation(evaluation)
      console.log('Evaluation submitted successfully', evaluation.playerName)

      const queryPlayerName = String(searchParams.get('player') ?? '').trim()
      const querySession = normalizeSessionValue(searchParams.get('session'))
      const nextSessionValue = querySession || lastUsedSession

      if (draftStorageKey) {
        sessionStorage.removeItem(draftStorageKey)
      }

      setLastSavedPlayerName(normalizedPlayerName)
      setFormData(
        createInitialFormData(user, {
          playerName: queryPlayerName,
          session: nextSessionValue,
        }),
      )
      setResponseValues(createEmptyResponseValues(dynamicFields))
      setLastUsedSession(nextSessionValue)
      setIsSaved(true)
    } catch (error) {
      console.error('Evaluation submit failed', error)
      setIsSaved(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <BlankPrintForm
        clubName={user?.clubName || user?.team || 'Club Form'}
        logoUrl={user?.clubLogoUrl || ''}
        fields={enabledFields}
      />

      <div className={isPrintingBlankView ? 'no-print' : ''}>
        <PageHeader
          eyebrow="Evaluation"
          title="Create evaluation"
          description="Capture a club-specific evaluation form and export it when needed."
        />

        {isSaved ? (
          <div className="rounded-[20px] border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#46604a]">
            Evaluation saved
          </div>
        ) : null}

        {isPlatformOwner ? (
          <SectionCard
            title="Platform account"
            description="Super admins are not tied to one club, so evaluation creation stays with club users."
          >
            <div className="rounded-[20px] border border-[#dbe3d6] bg-[#f8faf7] px-4 py-4 text-sm leading-6 text-slate-600">
              Use this account to oversee clubs, users, approvals, and platform-wide data. Create evaluations from a
              manager or coach account inside the relevant club.
            </div>
          </SectionCard>
        ) : isLoadingFields ? (
          <SectionCard title="Form" description="Loading the configured evaluation fields for this club.">
            <div className="rounded-[20px] border border-[#dbe3d6] bg-[#f8faf7] px-4 py-4 text-sm text-slate-600">
              Loading form fields...
            </div>
          </SectionCard>
        ) : (
          <>
            <form className="space-y-5 sm:space-y-6 no-print" onSubmit={handleSubmit}>
              <SectionCard
                title="Player details"
                description="Locked fields stay consistent while the rest of the evaluation can be configured per club."
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Player Name</span>
                    <input
                      type="text"
                      name="playerName"
                      value={formData.playerName}
                      onChange={handleFieldChange}
                      required
                      className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Team</span>
                    <input
                      type="text"
                      name="team"
                      value={formData.team}
                      readOnly
                      className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm text-slate-900 outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Coach</span>
                    <input
                      type="text"
                      name="coachName"
                      value={formData.coachName}
                      readOnly
                      className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm text-slate-900 outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Parent Email</span>
                    <input
                      type="email"
                      name="parentEmail"
                      value={formData.parentEmail}
                      onChange={handleFieldChange}
                      className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Session</span>
                    <input
                      type="datetime-local"
                      name="session"
                      value={formatSessionForInput(formData.session)}
                      onChange={handleFieldChange}
                      className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                    />
                    <p className="mt-2 text-xs leading-5 text-slate-500">Stored as ISO. Current session: {readableSession}</p>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Decision</span>
                    <select
                      name="decision"
                      value={formData.decision}
                      onChange={handleFieldChange}
                      className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                      <option value="Progress">Progress</option>
                    </select>
                  </label>
                </div>
              </SectionCard>

              <SectionCard
                title="Configured fields"
                description={
                  isFallbackFields
                    ? 'No club-specific form fields were found, so default fields were loaded for this club.'
                    : 'These enabled fields are loaded from the club form builder and saved as form responses.'
                }
              >
                {enabledFields.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-[#cfd8c9] bg-[#f7faf5] px-4 py-6 text-sm text-slate-600">
                    No evaluation fields are enabled for this club. Enable fields in the form builder first.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {enabledFields.map((field) => (
                      <label key={field.id} className={field.type === 'textarea' ? 'block md:col-span-2' : 'block'}>
                        <span className="mb-2 block text-sm font-semibold text-slate-700">
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
                title="Submit"
                description="Preview, export, or print the evaluation before saving it to Supabase."
              >
                <div className="mb-4 rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm font-semibold text-slate-700">
                  Overall Score: {averageScore !== null ? averageScore.toFixed(1) : '-'}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="submit"
                    disabled={isSubmitting || enabledFields.length === 0}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500 sm:w-auto"
                  >
                    {isSubmitting ? 'Saving...' : 'Submit Evaluation'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={isDownloadingPdf}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] sm:w-auto"
                  >
                    {isDownloadingPdf ? 'Preparing PDF...' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintPreview}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] sm:w-auto"
                  >
                    Print
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPrintingBlankView(true)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] sm:w-auto"
                  >
                    Print Blank Form
                  </button>
                  {isSaved && lastSavedPlayerName ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/player/${encodeURIComponent(lastSavedPlayerName)}`)}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] sm:w-auto"
                    >
                      Save & Go to Player
                    </button>
                  ) : null}
                </div>
              </SectionCard>
            </form>

            <div ref={previewRef} className="section">
              <SectionCard
                title="Preview"
                description="This preview updates live and is used directly for PDF export and print."
              >
                <EmailPreview
                  clubName={user?.clubName || user?.team || 'Club Name'}
                  logoUrl={user?.clubLogoUrl || ''}
                  playerName={formData.playerName || 'Player Name'}
                  team={formData.team}
                  session={formData.session}
                  decision={formData.decision}
                  responseItems={responseItems}
                />
              </SectionCard>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
