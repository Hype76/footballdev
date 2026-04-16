import { useEffect, useMemo, useRef, useState } from 'react'
import html2pdf from 'html2pdf.js'
import { EmailPreview } from '../components/ui/EmailPreview.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { isSuperAdmin, useAuth } from '../lib/auth.js'
import { createEvaluation, getFormFields } from '../lib/supabase.js'

function createInitialFormData(user) {
  return {
    team: user?.team || '',
    session: '',
    coachName: user?.name || '',
    playerName: '',
    parentEmail: '',
    decision: 'Progress',
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

function normalizeResponseValue(field, value) {
  if (field.type === 'number') {
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

  if (field.type === 'select') {
    return (
      <select
        value={value}
        onChange={(event) => onChange(field.id, event.target.value)}
        required={field.required}
        className={sharedClassName}
      >
        <option value="">Select option</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(event) => onChange(field.id, event.target.value)}
      required={field.required}
      min={field.type === 'number' ? '0' : undefined}
      step={field.type === 'number' ? '1' : undefined}
      className={sharedClassName}
    />
  )
}

function BlankPrintForm({ clubName, fields }) {
  return (
    <div className="print-only hidden bg-white text-slate-900">
      <div className="mx-auto max-w-3xl p-8">
        <div className="border-b border-slate-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Printable Blank Form</p>
          <h1 className="mt-3 text-3xl font-semibold">{clubName}</h1>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {['Player Name', 'Team', 'Coach', 'Parent Email', 'Decision', 'Session'].map((label) => (
            <div key={label} className="rounded-2xl border border-slate-200 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
              <div className="mt-4 h-6 border-b border-slate-300" />
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-4">
          {fields.map((field) => (
            <div key={field.id} className="rounded-2xl border border-slate-200 px-4 py-4">
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
  const [formData, setFormData] = useState(() => createInitialFormData(user))
  const [dynamicFields, setDynamicFields] = useState([])
  const [responseValues, setResponseValues] = useState({})
  const [isFallbackFields, setIsFallbackFields] = useState(false)
  const [isLoadingFields, setIsLoadingFields] = useState(true)
  const [isSaved, setIsSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [isPrintingBlankView, setIsPrintingBlankView] = useState(false)

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
        setResponseValues(createEmptyResponseValues(fields))
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

    setFormData(createInitialFormData(user))
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

  const formResponses = useMemo(
    () => buildFormResponses(dynamicFields, responseValues),
    [dynamicFields, responseValues],
  )
  const scores = useMemo(() => buildScores(formResponses), [formResponses])
  const comments = useMemo(() => buildComments(formResponses), [formResponses])
  const averageScore = useMemo(() => getAverageScore(formResponses), [formResponses])
  const responseItems = useMemo(
    () => createResponseItems(dynamicFields, responseValues),
    [dynamicFields, responseValues],
  )

  const handleFieldChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
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
      console.error(error)
    } finally {
      setIsDownloadingPdf(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const evaluation = {
        playerName: normalizePlayerName(formData.playerName),
        team: String(user?.team || formData.team).trim(),
        clubId: user?.clubId,
        coachId: user?.id,
        coach: String(user?.name || formData.coachName).trim(),
        parentEmail: formData.parentEmail.trim(),
        session: formData.session.trim(),
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
      setFormData(createInitialFormData(user))
      setResponseValues(createEmptyResponseValues(dynamicFields))
      setIsSaved(true)
    } catch (error) {
      console.error(error)
      setIsSaved(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <BlankPrintForm clubName={user?.clubName || user?.team || 'Club Form'} fields={dynamicFields} />

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
                      type="text"
                      name="session"
                      value={formData.session}
                      onChange={handleFieldChange}
                      placeholder="Saturday Trial - 12th April"
                      className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                    />
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
                    ? 'No club-specific form fields found, so the default evaluation form is being used.'
                    : 'These fields are loaded from the club form builder and saved as form responses.'
                }
              >
                <div className="grid gap-4 md:grid-cols-2">
                  {dynamicFields.map((field) => (
                    <label key={field.id} className={field.type === 'textarea' ? 'block md:col-span-2' : 'block'}>
                      <span className="mb-2 block text-sm font-semibold text-slate-700">
                        {field.label}
                        {field.required ? ' *' : ''}
                      </span>
                      <FieldInput field={field} value={responseValues[field.id] ?? ''} onChange={handleResponseChange} />
                    </label>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Submit"
                description="Preview, export, or print the evaluation structure before saving it to Supabase."
              >
                <div className="mb-4 rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm font-semibold text-slate-700">
                  Overall Score: {averageScore !== null ? averageScore.toFixed(1) : '-'}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="submit"
                    disabled={isSubmitting}
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
                    onClick={() => setIsPrintingBlankView(true)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] sm:w-auto"
                  >
                    Print Blank Form
                  </button>
                </div>
              </SectionCard>
            </form>

            <div ref={previewRef}>
              <SectionCard
                title="Preview"
                description="This is the clean parent-facing layout used for PDF export."
              >
                <EmailPreview
                  clubName={user?.clubName || user?.team || 'Club Name'}
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
