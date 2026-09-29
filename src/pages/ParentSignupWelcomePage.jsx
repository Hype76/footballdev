import { useState } from 'react'
import fallbackLogo from '../assets/football-player-logo.webp'
import { APP_DOWNLOAD_LINKS } from '../lib/app-download-links.js'
import { buildParentAppUrl } from '../lib/app-origins.js'
import { useAuth } from '../lib/auth.js'

const inputClass = 'mt-2 min-h-12 w-full rounded-lg border border-[#b9c9c2] bg-white px-4 py-3 text-[#101828] focus:border-[#047857] focus:outline-none focus:ring-2 focus:ring-[#bbf7d0]'
const buttonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 font-bold text-white hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'

function invitationPath(value) {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' || !['footballplayer.online', 'www.footballplayer.online', 'parent.footballplayer.online'].includes(url.hostname)) {
    throw new Error('Paste the full Football Player invitation link from your email.')
  }
  const match = url.pathname.match(/^\/parent-invite\/([^/]+)\/?$/)
  if (!match || match[1].length > 256) throw new Error('Paste a player invitation link from your Coach.')
  return `/parent-invite/${match[1]}?accept=1`
}

export function ParentSignupWelcomePage() {
  const { session } = useAuth()
  const [name, setName] = useState(String(session?.user?.user_metadata?.name || '').trim())
  const [coachEmail, setCoachEmail] = useState('')
  const [message, setMessage] = useState('')
  const [invitation, setInvitation] = useState('')
  const [preview, setPreview] = useState(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function requestReferral(action) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/.netlify/functions/invite-coach', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name, email: coachEmail, message }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success === false) throw new Error(result.message || 'Please try again.')
      if (action === 'preview') setPreview(result)
      else { setSent(true); setPreview(null) }
    } catch (failure) {
      setError(failure.message || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function openInvitation(event) {
    event.preventDefault()
    try {
      setError('')
      window.location.assign(buildParentAppUrl(invitationPath(invitation)))
    } catch (failure) {
      setError(failure.message)
    }
  }

  return (
    <main className="min-h-screen bg-[#f7faf8] px-5 py-12 text-[#101828] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <img src={fallbackLogo} alt="Football Player" className="h-16 w-16 object-contain" />
        <h1 className="mt-8 text-4xl font-black tracking-tight sm:text-5xl">Your Parent account is ready.</h1>
        <p className="mt-5 text-lg leading-8 text-[#425850]">You are signed in. Your Coach needs to invite this email address to a player before fixtures, messages and live match alerts appear.</p>
        <p className="mt-3 font-semibold text-[#214c86]">{session?.user?.email}</p>

        <section className="mt-10 border-t border-[#b9c9c2] pt-8">
          <h2 className="text-2xl font-bold">Invite your Coach</h2>
          <p className="mt-2 text-[#425850]">Send a one-off Football Player introduction with the free Match Day option, app links and what the team can do.</p>
          {sent ? (
            <p className="mt-5 font-semibold text-[#047857]" role="status">Invitation sent to {coachEmail}. Your Coach can now set up the team and invite you.</p>
          ) : preview ? (
            <div className="mt-5 space-y-4">
              <p className="font-semibold">To: {coachEmail}</p>
              <p className="font-bold">{preview.subject}</p>
              <pre className="whitespace-pre-wrap font-sans leading-7 text-[#425850]">{preview.text}</pre>
              <div className="flex flex-wrap gap-3">
                <button type="button" className={buttonClass} disabled={busy} onClick={() => requestReferral('send')}>{busy ? 'Sending...' : 'Send invitation'}</button>
                <button type="button" className="min-h-12 px-4 font-bold text-[#214c86]" disabled={busy} onClick={() => setPreview(null)}>Edit details</button>
              </div>
            </div>
          ) : (
            <form className="mt-5 space-y-5" onSubmit={(event) => { event.preventDefault(); requestReferral('preview') }}>
              <label className="block font-bold">Your name<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label>
              <label className="block font-bold">Coach email address<input className={inputClass} type="email" value={coachEmail} onChange={(event) => setCoachEmail(event.target.value)} required /></label>
              <label className="block font-bold">Personal message (optional)<textarea className={inputClass} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} rows={3} /></label>
              <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Preparing...' : 'Preview invitation'}</button>
            </form>
          )}
        </section>

        <section className="mt-10 border-t border-[#b9c9c2] pt-8">
          <h2 className="text-2xl font-bold">Already have a player invitation?</h2>
          <p className="mt-2 text-[#425850]">Open the link from your Coach's email, or paste it here to connect this account.</p>
          <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={openInvitation}>
            <label className="flex-1 font-bold">Invitation link<input className={inputClass} type="url" value={invitation} onChange={(event) => setInvitation(event.target.value)} required /></label>
            <button type="submit" className={`${buttonClass} self-end`}>Open invitation</button>
          </form>
        </section>

        {error ? <p className="mt-6 font-semibold text-[#a52323]" role="alert">{error}</p> : null}
        <section className="mt-10 border-t border-[#b9c9c2] pt-8">
          <h2 className="text-2xl font-bold">Continue on your phone</h2>
          <p className="mt-2 text-[#425850]">Return to the Football Player Parent app and sign in with this email. You can invite your Coach and check for your player link there too.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a className={buttonClass} href={APP_DOWNLOAD_LINKS.parent.apple}>Parent app for iPhone</a>
            <a className={buttonClass} href={APP_DOWNLOAD_LINKS.parent.android}>Parent app for Android</a>
          </div>
        </section>
      </div>
    </main>
  )
}
