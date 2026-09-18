import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildUserFeedback } from '../lib/user-feedback.js'
import { createTesterFeedbackReport } from '../lib/domain/tester-feedback.js'

export function UserFeedbackPage() {
  const location = useLocation()
  return <FeedbackForm key={location.search} type={new URLSearchParams(location.search).get('type')} />
}

function FeedbackForm({ type }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  async function submit(event) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      await createTesterFeedbackReport({ report: buildUserFeedback({ type, title, message, device: navigator.userAgent }) })
      setSent(true)
    } catch (failure) {
      setError(failure.message || 'Your message could not be submitted. Please try again.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const field = 'block w-full min-h-12 border-b border-slate-400 bg-white p-3 text-slate-900 focus:outline-2 focus:outline-emerald-700'
  return <main className="mx-auto w-full max-w-xl space-y-6 p-5 text-[var(--text-primary,#172b22)]">
    <button type="button" onClick={() => navigate(-1)} className="min-h-12 font-bold">Back</button>
    {sent ? <h1 role="status" className="text-2xl font-bold">Thank you</h1> : <>
      <h1 className="text-2xl font-bold">{type === 'bug' ? 'Report a Bug' : 'Feedback & Suggestions'}</h1>
      <p>{type === 'bug' ? 'Tell us what went wrong and what you were doing.' : 'Tell us what you think or what you would like to see.'}</p>
      <form onSubmit={submit} className="space-y-5">
        <label className="block">Subject<input className={field} required maxLength={240} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
        <label className="block">Message<textarea className={`${field} min-h-40`} required maxLength={4000} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} /></label>
        {error ? <p role="alert" className="text-red-700">{error}</p> : null}
        <button className="min-h-12 bg-emerald-700 px-6 font-bold text-white disabled:opacity-60" disabled={busy}>{busy ? 'Submitting...' : 'Submit'}</button>
      </form>
    </>}
  </main>
}
