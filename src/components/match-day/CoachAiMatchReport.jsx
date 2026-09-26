import { useEffect, useState } from 'react'
import { downloadCompletedReportPdf } from '../../lib/matchday-report-export.js'
import { buildCompletedMatchEventPresentation, buildFinalMatchReportSummary } from '../../lib/matchday-final-report.js'

const questions = [
  ['flow', 'How did the match flow?'],
  ['outstandingPlayers', 'Which players stood out?'],
  ['standoutMoment', 'What really stood out?'],
  ['disagreements', 'Is there anything you disagree with in the recorded events?'],
  ['eventComments', 'Any other comments on the events?'],
]

async function requestReport(token, payload) {
  const response = await fetch('/.netlify/functions/coach-ai-match-report', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'The report could not be completed.')
  return result
}

async function loadSavedReport(token, matchDayId) {
  const response = await fetch(`/.netlify/functions/coach-ai-match-report?matchDayId=${encodeURIComponent(matchDayId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'The saved report could not be loaded.')
  return result
}

export function CoachAiMatchReport({ match, token }) {
  const facts = buildFinalMatchReportSummary(match)
  const [mode, setMode] = useState('choice')
  const [answers, setAnswers] = useState({})
  const [draft, setDraft] = useState('')
  const [savedText, setSavedText] = useState('')
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    loadSavedReport(token, match.id).then((saved) => {
      if (cancelled) return
      if (saved.narrative) {
        setAnswers((current) => Object.values(current).some(Boolean) ? current : saved.answers || {})
        setDraft((current) => current || saved.narrative)
        setSavedText(saved.narrative)
        setMode((current) => current === 'choice' ? 'report' : current)
      }
    }).catch((error) => { if (!cancelled) setMessage(error.message) })
      .finally(() => { if (!cancelled) setLoadingSaved(false) })
    return () => { cancelled = true }
  }, [match.id, token])

  const generate = async () => {
    setBusy('generate')
    setMessage('')
    try {
      const result = await requestReport(token, { action: 'generate', matchDayId: match.id, answers })
      setDraft(result.narrative)
      setMode('report')
      setMessage('Review the draft against the recorded match facts, then save it.')
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }

  const save = async () => {
    setBusy('save')
    setMessage('')
    try {
      const result = await requestReport(token, { action: 'save', matchDayId: match.id, answers, narrative: draft })
      setSavedText(result.narrative)
      setMessage('Report saved to this match.')
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }

  const download = async () => {
    setBusy('pdf')
    try {
      await downloadCompletedReportPdf(match, { audience: 'staff', coachNarrative: savedText, accessContext: { planKey: 'matchday' } })
      setMessage('PDF downloaded.')
    } catch { setMessage('The PDF could not be downloaded.') }
    finally { setBusy('') }
  }

  return <section className="mt-5 border-t border-[var(--border-color)] pt-4" aria-label="Coach match report">
    <h6 className="text-base font-black text-[var(--text-primary)]">Coach match report</h6>
    {loadingSaved ? <p className="mt-2 text-sm">Checking for a saved report...</p> : null}
    {!loadingSaved && mode === 'choice' ? <div className="mt-2 flex flex-wrap items-center gap-3">
      <button type="button" className="text-sm font-bold underline" onClick={() => setMode('questions')}>Generate a report</button>
      <button type="button" className="text-sm font-bold underline" onClick={() => setMode('existing')}>Use the Matchday report</button>
    </div> : null}
    {mode === 'existing' ? <p className="mt-2 text-sm">The recorded Matchday report and its PDF are shown above. You can still generate a coach report later. <button type="button" className="font-bold underline" onClick={() => setMode('questions')}>Generate now</button></p> : null}
    {mode === 'questions' ? <div className="mt-3 space-y-3">
      <p className="text-sm text-[var(--text-muted)]">All questions are optional. The score and recorded events stay unchanged.</p>
      {questions.map(([key, label]) => <label key={key} className="block border-b border-[var(--border-color)] pb-3">
        <span className="block text-sm font-bold">{label}</span>
        <textarea className="mt-1 w-full rounded border border-[var(--border-color)] p-2 text-sm" rows="2" maxLength={1000} value={answers[key] || ''} onChange={(event) => setAnswers({ ...answers, [key]: event.target.value })} />
      </label>)}
      <button type="button" disabled={Boolean(busy)} className="min-h-10 rounded bg-[#0b6b46] px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={generate}>{busy === 'generate' ? 'Generating...' : 'Generate draft'}</button>
    </div> : null}
    {mode === 'report' ? <div className="mt-3 space-y-3">
      <p className="text-sm text-[var(--text-muted)]">Check the draft against the recorded result and events above. You can edit the wording before saving.</p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(14rem,1fr)]">
        <label className="block"><span className="block text-sm font-bold">Report text</span>
          <textarea className="mt-1 w-full rounded border border-[var(--border-color)] p-2 text-sm" rows="12" maxLength={5000} value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <aside className="max-h-80 overflow-y-auto border-t border-[var(--border-color)] pt-2 text-sm lg:border-l lg:border-t-0 lg:pl-4" aria-label="Recorded match facts">
          <p className="font-black">Recorded facts</p>
          <p className="mt-1 font-bold">Final score: {facts.result.finalScore}</p>
          <p className="mt-1">{facts.activeEvents.length} active events, {facts.voidedEvents.length} corrected or voided</p>
          {facts.activeEvents.map((event) => {
            const item = buildCompletedMatchEventPresentation(event, match, { includeNotes: true })
            return <p key={event.id} className="mt-2 border-t border-[var(--border-color)] pt-2">{item.minuteLabel} {item.title}{item.detail ? `: ${item.detail}` : ''}</p>
          })}
        </aside>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={Boolean(busy) || !draft.trim() || draft.trim() === savedText.trim()} className="min-h-10 rounded bg-[#0b6b46] px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={save}>{busy === 'save' ? 'Saving...' : 'Save to match'}</button>
        <button type="button" className="min-h-10 px-2 text-sm font-bold underline" onClick={() => setMode('questions')}>Change answers or regenerate</button>
        {savedText ? <button type="button" className="min-h-10 px-2 text-sm font-bold underline" onClick={async () => { await navigator.clipboard.writeText(savedText); setMessage('Saved report copied.') }}>Copy saved text</button> : null}
        {savedText ? <button type="button" disabled={Boolean(busy)} className="min-h-10 px-2 text-sm font-bold underline" onClick={download}>Download PDF</button> : null}
      </div>
      {savedText && draft.trim() !== savedText.trim() ? <p className="text-sm">Save your edits to update the copy and PDF versions.</p> : null}
    </div> : null}
    {message ? <p role="status" className="mt-2 text-sm font-semibold">{message}</p> : null}
  </section>
}
