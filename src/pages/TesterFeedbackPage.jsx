import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import {
  TESTER_FEEDBACK_MODULES,
  TESTER_FEEDBACK_SEVERITIES,
  TESTER_FEEDBACK_TYPES,
  createTesterFeedbackReport,
} from '../lib/domain/tester-feedback.js'

const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-bold text-[#101828] outline-none transition focus:border-[#047857] focus:ring-2 focus:ring-[#d1fae5]'
const textareaClass = 'min-h-28 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-bold leading-6 text-[#101828] outline-none transition focus:border-[#047857] focus:ring-2 focus:ring-[#d1fae5]'
const labelClass = 'mb-2 block text-sm font-black text-[#101828]'

function getDefaultBrowserDevice() {
  const parts = [
    navigator.userAgent,
    `${window.innerWidth}x${window.innerHeight}`,
  ].filter(Boolean)

  return parts.join(' | ')
}

export function TesterFeedbackPage() {
  const { user } = useAuth()
  const location = useLocation()
  const routeFromQuery = useMemo(() => new URLSearchParams(location.search).get('route') || '', [location.search])
  const [form, setForm] = useState({
    feedbackType: 'bug',
    severity: 'medium',
    module: 'Shell/auth/workspace',
    phase: 'production',
    route: routeFromQuery || '/',
    pageTitle: document.title || '',
    title: '',
    summary: '',
    reproductionSteps: '',
    expectedResult: '',
    actualResult: '',
    browserDevice: getDefaultBrowserDevice(),
    screenshotUrl: '',
    logReference: '',
  })
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setStatusMessage('')
    setErrorMessage('')
    setIsSaving(true)

    try {
      const created = await createTesterFeedbackReport({ report: form, user })
      setStatusMessage(`Feedback sent. Report ID: ${created.id}`)
      setForm((current) => ({
        ...current,
        title: '',
        summary: '',
        reproductionSteps: '',
        expectedResult: '',
        actualResult: '',
        screenshotUrl: '',
        logReference: '',
      }))
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Feedback could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="border-b border-[#d7e5dc] bg-[#ecfdf5] px-5 py-6 sm:px-7">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Support</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-[#101828]">Report issue</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
            Send bugs, confusion, and missing setup details to the Football Player support team.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-5 px-5 py-6 sm:px-7">
          <div className="grid gap-4 lg:grid-cols-4">
            <label className="block">
              <span className={labelClass}>Type</span>
              <select value={form.feedbackType} onChange={(event) => updateField('feedbackType', event.target.value)} className={fieldClass}>
                {TESTER_FEEDBACK_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Severity</span>
              <select value={form.severity} onChange={(event) => updateField('severity', event.target.value)} className={fieldClass}>
                {TESTER_FEEDBACK_SEVERITIES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Module</span>
              <select value={form.module} onChange={(event) => updateField('module', event.target.value)} className={fieldClass}>
                {TESTER_FEEDBACK_MODULES.map((moduleName) => (
                  <option key={moduleName} value={moduleName}>{moduleName}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Phase</span>
              <input value={form.phase} onChange={(event) => updateField('phase', event.target.value)} className={fieldClass} />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Route</span>
              <input value={form.route} onChange={(event) => updateField('route', event.target.value)} className={fieldClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Page title</span>
              <input value={form.pageTitle} onChange={(event) => updateField('pageTitle', event.target.value)} className={fieldClass} />
            </label>
          </div>

          <label className="block">
            <span className={labelClass}>Title</span>
            <input value={form.title} onChange={(event) => updateField('title', event.target.value)} className={fieldClass} required />
          </label>

          <label className="block">
            <span className={labelClass}>Summary</span>
            <textarea value={form.summary} onChange={(event) => updateField('summary', event.target.value)} className={textareaClass} required />
          </label>

          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block">
              <span className={labelClass}>Reproduction steps</span>
              <textarea value={form.reproductionSteps} onChange={(event) => updateField('reproductionSteps', event.target.value)} className={textareaClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Expected result</span>
              <textarea value={form.expectedResult} onChange={(event) => updateField('expectedResult', event.target.value)} className={textareaClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Actual result</span>
              <textarea value={form.actualResult} onChange={(event) => updateField('actualResult', event.target.value)} className={textareaClass} />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block">
              <span className={labelClass}>Browser/device</span>
              <textarea value={form.browserDevice} onChange={(event) => updateField('browserDevice', event.target.value)} className={textareaClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Screenshot URL</span>
              <input value={form.screenshotUrl} onChange={(event) => updateField('screenshotUrl', event.target.value)} className={fieldClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Log reference</span>
              <input value={form.logReference} onChange={(event) => updateField('logReference', event.target.value)} className={fieldClass} />
            </label>
          </div>

          {statusMessage ? (
            <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857]">
              {statusMessage}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Sending feedback...' : 'Send feedback'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
