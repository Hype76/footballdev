import { useEffect, useRef, useState } from 'react'
const emptyForm = { name: '', email: '', clubTeam: '', message: '' }
export function MarketingContactDialog({ open, onClose }) {
  const dialog = useRef(null), submitting = useRef(false), lifetime = useRef(null)
  const [form, setForm] = useState(emptyForm), [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  useEffect(() => { const token = { active: true }; lifetime.current = token; return () => { token.active = false } }, [])
  useEffect(() => { if (open && !dialog.current.open) dialog.current.showModal(); if (!open && dialog.current.open) dialog.current.close() }, [open])
  const change = event => { setStatus(''); setForm(current => ({ ...current, [event.target.name]: event.target.value })) }
  const submit = async event => {
    event.preventDefault(); if (submitting.current) return
    const owner = lifetime.current; submitting.current = true; setBusy(true); setStatus('')
    try {
      const response = await fetch('/.netlify/functions/send-contact-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), phone: '', message: (form.clubTeam.trim() ? 'Club or team: ' + form.clubTeam.trim() + '\n\n' : '') + form.message.trim(), sourcePath: window.location.pathname }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success !== true || !result.id) throw new Error(result.message || 'Your enquiry could not be sent. Please try again.')
      if (owner.active) { setForm(emptyForm); setStatus('Your enquiry has been sent. We will be in touch shortly.') }
    } catch (error) { if (owner.active) setStatus(error.message || 'Your enquiry could not be sent. Please try again.') }
    finally { submitting.current = false; if (owner.active) setBusy(false) }
  }
  return <dialog ref={dialog} id="marketing-contact-dialog" aria-labelledby="marketing-contact-title" onCancel={onClose} onClose={onClose}>
    <button type="button" className="contact-close" aria-label="Close contact form" onClick={onClose}>×</button><h2 id="marketing-contact-title">Talk to us</h2><p>Tell us about your club and how we can help.</p>
    <form onSubmit={submit}><label>Your name<input name="name" autoComplete="name" maxLength={120} required value={form.name} onChange={change} /></label><label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required value={form.email} onChange={change} /></label><label>Club or team (optional)<input name="clubTeam" autoComplete="organization" maxLength={160} value={form.clubTeam} onChange={change} /></label><label>How can we help?<textarea name="message" rows={5} maxLength={5000} required value={form.message} onChange={change} /></label><p>Please do not include passwords or children's personal information.</p><button className="button" type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send enquiry'}</button><p role="status" className="marketing-form-message">{status}</p></form>
  </dialog>
}
