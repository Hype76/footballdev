import { useEffect, useRef, useState } from 'react'

const emptyForm = { clubName: '', name: '', email: '', teamCount: '', message: '', website: '' }

export function MarketingClubQuoteDialog({ open, onClose }) {
  const dialog = useRef(null), submitting = useRef(false), lifetime = useRef(null)
  const [form, setForm] = useState(emptyForm), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [confirmation, setConfirmation] = useState(null)
  useEffect(() => { const token = { active: true }; lifetime.current = token; return () => { token.active = false } }, [])
  useEffect(() => { if (open && !dialog.current.open) dialog.current.showModal(); if (!open && dialog.current.open) dialog.current.close() }, [open])
  const change = event => { setStatus(''); setForm(current => ({ ...current, [event.target.name]: event.target.value })) }
  const submit = async event => {
    event.preventDefault()
    if (submitting.current) return
    const teamCount = Number(form.teamCount)
    if (!Number.isInteger(teamCount) || teamCount < 21 || teamCount > 10000) { setStatus('Enter a whole number of teams between 21 and 10000.'); return }
    const request = { enquiryType: 'club_quote', clubName: form.clubName.trim(), name: form.name.trim(), email: form.email.trim(), teamCount, message: form.message.trim(), website: form.website, sourcePath: window.location.pathname }
    const owner = lifetime.current
    submitting.current = true; setBusy(true); setStatus('')
    try {
      const response = await fetch('/.netlify/functions/send-contact-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success !== true || !result.id) throw new Error(result.message || 'Your quote request could not be sent. Please try again.')
      if (owner.active) { setConfirmation(request); setForm(emptyForm) }
    } catch (error) { if (owner.active) setStatus(error.message || 'Your quote request could not be sent. Please try again.') }
    finally { submitting.current = false; if (owner.active) setBusy(false) }
  }
  return <dialog ref={dialog} id="marketing-club-quote-dialog" aria-labelledby="marketing-club-quote-title" onCancel={onClose} onClose={onClose}>
    <button type="button" className="contact-close" aria-label="Close quote form" onClick={onClose}>×</button>
    <h2 id="marketing-club-quote-title">Need more teams?</h2>
    {confirmation ? <div role="status" className="quote-confirmation"><h3>Thank you, {confirmation.name}.</h3><p>You have requested a quote for <strong>{confirmation.clubName}</strong> with <strong>{confirmation.teamCount} teams</strong>.</p><p>We will be in touch shortly at <strong>{confirmation.email}</strong>.</p><button className="button" type="button" onClick={onClose}>Done</button><button className="quote-another" type="button" onClick={() => setConfirmation(null)}>Request another quote</button></div> : <><p>Club includes up to 20 teams. Tell us what your larger club needs and we will prepare a tailored quote.</p>
      <form onSubmit={submit}><label>Club name<input name="clubName" autoComplete="organization" maxLength={160} required value={form.clubName} onChange={change} /></label><label>Your name<input name="name" autoComplete="name" maxLength={120} required value={form.name} onChange={change} /></label><label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required value={form.email} onChange={change} /></label><label>Number of teams<input name="teamCount" type="number" inputMode="numeric" min="21" max="10000" step="1" required value={form.teamCount} onChange={change} /></label><label>Anything else we should know? (optional)<textarea name="message" rows={3} maxLength={5000} value={form.message} onChange={change} /></label><label className="quote-honeypot" aria-hidden="true">Leave this field empty<input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={change} /></label><p>Please do not include passwords or players' personal information.</p><button className="button" type="submit" disabled={busy}>{busy ? 'Sending...' : 'Submit for quote'}</button><p role="status" className="marketing-form-message">{status}</p></form></>}
  </dialog>
}
