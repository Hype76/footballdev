import { useEffect, useRef, useState } from 'react'
import { PasswordInput } from '../components/ui/PasswordInput.jsx'
import { createTemporaryPlayerInviteClient, supabase } from '../lib/supabase-client.js'
import { rememberLoginAccessIntent } from '../lib/login-access-intent.js'
import { assertPasswordPolicy, PASSWORD_POLICY_SUMMARY } from '../lib/password-policy.js'
import fallbackLogo from '../assets/football-player-logo.webp'
import { adultInvitePalette } from '../lib/adult-player-invite-branding.js'

const inputClass = 'min-h-12 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-3 text-base text-[var(--text-primary)] outline-none focus:border-[var(--focus-ring)] focus:ring-2 focus:ring-[var(--focus-ring)] disabled:opacity-60'

async function submitInvite(body, accessToken, signal) {
  const response = await fetch('/.netlify/functions/adult-player-setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.success) {
    const error = new Error(result.message || 'Player access could not be set up. Please try again.')
    error.state = result.state
    error.status = response.status
    throw error
  }
  return result
}

export function AdultPlayerInvitePage() {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [existingAccount, setExistingAccount] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState({ status: 'loading' })
  const [logoFailed, setLogoFailed] = useState(false)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const submission = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const onHashChange = () => {
      setToken(new URLSearchParams(window.location.hash.slice(1)).get('invite'))
      setPassword('')
      setError('')
      setLogoFailed(false)
      setPreview({ status: 'loading' })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    if (!token) return
    let current = true
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    async function loadPreview() {
      try {
        const result = await submitInvite({ action: 'preview', token }, undefined, controller.signal)
        if (!current) return
        setPreview({ ...result, status: 'ready' })
        if (result.state === 'accepted') setExistingAccount(true)
      } catch (failure) {
        if (current) setPreview({ status: 'error', message: failure.status ? failure.message : 'We could not check your invitation. Check your connection and try again.' })
      } finally {
        window.clearTimeout(timeout)
      }
    }
    void loadPreview()
    return () => { current = false; window.clearTimeout(timeout); controller.abort() }
  }, [token, previewAttempt])
  const stillOnInvite = () => mounted.current && window.location.pathname.replace(/\/+$/, '') === '/player-invite'
    && new URLSearchParams(window.location.hash.slice(1)).get('invite') === token

  async function accept(event) {
    event.preventDefault()
    if (!token || preview.status !== 'ready' || submission.current || !stillOnInvite()) return
    submission.current = true
    setBusy(true)
    setError('')
    try {
      const address = email.trim().toLowerCase()
      if (!existingAccount) {
        assertPasswordPolicy(password)
        await submitInvite({ action: 'create', email: address, password, token })
      }
      if (!stillOnInvite()) return
      const temporaryClient = createTemporaryPlayerInviteClient()
      const { data: result, error: signInError } = await temporaryClient.auth.signInWithPassword({ email: address, password })
      if (signInError || !result?.session?.access_token || !result.session.refresh_token) {
        throw new Error('Unable to sign in. Check your email and password and try again.')
      }
      if (!stillOnInvite()) return
      if (existingAccount) {
        await submitInvite({ action: 'accept', token }, result.session.access_token)
      }
      if (!stillOnInvite()) return
      const { error: sessionError } = await supabase.auth.setSession({ access_token: result.session.access_token, refresh_token: result.session.refresh_token })
      if (sessionError) throw new Error('Your Player access is linked, but sign in could not be completed. Sign in again.')
      if (!stillOnInvite()) return
      rememberLoginAccessIntent('player')
      window.sessionStorage.setItem('selected-access-mode', 'player')
      window.sessionStorage.setItem('selected-access-mode-explicit', 'true')
      window.sessionStorage.removeItem('selected-club-id')
      window.sessionStorage.removeItem('selected-team-id')
      window.location.replace('/player')
    } catch (failure) {
      if (failure.state === 'account_exists') {
        setExistingAccount(true)
        setPassword('')
      }
      setError(failure.message || 'Player access could not be set up. Please try again.')
    } finally {
      setBusy(false)
      submission.current = false
    }
  }

  const clubName = preview.clubName || 'Football Player'
  const hasClubLogo = preview.status === 'ready' && preview.logoUrl && !logoFailed
  const logoUrl = hasClubLogo ? preview.logoUrl : fallbackLogo
  const palette = adultInvitePalette(preview.accent)
  return (
    <main className="min-h-screen bg-[var(--app-bg)] px-5 py-6 text-[var(--text-primary)] sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center gap-4 border-b border-t-4 border-[var(--border-color)] pb-6 pt-5" style={{ borderTopColor: palette.background }}>
          <img className="h-16 w-16 shrink-0 rounded bg-white object-contain p-1" src={logoUrl} alt={hasClubLogo ? `${clubName} badge` : 'Football Player'} referrerPolicy="no-referrer" onError={() => setLogoFailed(true)} />
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-widest text-[var(--text-muted)]">Player invitation</p>
            <p className="mt-1 break-words text-xl font-extrabold">{clubName}</p>
            {preview.teamName ? <p className="mt-1 text-sm text-[var(--text-muted)]">{preview.teamName}</p> : null}
          </div>
        </header>
        <div className="grid gap-8 py-8 sm:gap-12 lg:grid-cols-2 lg:py-12">
          <section>
            <p className="mb-3 text-xs font-extrabold uppercase tracking-widest text-[var(--text-primary)]">Your team, together</p>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Set up your Player access</h1>
            <p className="mt-4 leading-relaxed text-[var(--text-muted)]">Join your team online. See what is coming up and respond to your invitations.</p>
            <ul className="mt-6 hidden divide-y divide-[var(--border-color)] text-sm font-semibold lg:block">
              <li className="py-3">Respond to match, training and event invitations</li>
              <li className="py-3">See your upcoming dates and team details</li>
              <li className="py-3">Keep existing Parent access on the same account</li>
            </ul>
          </section>
          <section aria-label="Player account setup">
      {!token ? <div role="alert" className="space-y-3"><h2 className="text-xl font-bold">Open your invitation email</h2><p className="text-[var(--text-muted)]">Use the full Player setup link from your club. If you already set up access, <a className="font-bold text-[var(--text-primary)] underline" href="/sign-in?access=player">sign in</a>.</p></div>
        : preview.status === 'loading' ? <p role="status">Checking your invitation...</p>
          : preview.status === 'error' ? <div role="alert" className="space-y-4"><h2 className="text-xl font-bold">We could not open this invitation</h2><p className="text-[var(--text-muted)]">{preview.message || 'Check your connection and try again. If the link has expired, ask your club to resend it.'}</p><button type="button" className="min-h-12 font-bold text-[var(--text-primary)] underline" onClick={() => { setPreview({ status: 'loading' }); setPreviewAttempt(value => value + 1) }}>Check link again</button><a className="block min-h-11 font-bold text-[var(--text-primary)] underline" href="/sign-in?access=player">Already set up? Sign in</a></div> : (
        <form className="space-y-5" onSubmit={accept}>
          <div><h2 className="text-xl font-bold">{existingAccount ? 'Sign in and join your team' : 'Create your Player login'}</h2><p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{preview.state === 'accepted' ? 'Your Player access is already linked. Sign in with the account that accepted this invitation.' : 'Use the email address your club invited.'}{existingAccount ? ' Your existing Parent access will stay available.' : ' Already have a Football Player or Parent account? Choose sign in below.'}</p></div>
          <label className="block">
            <span className="mb-2 block text-sm font-bold">Player email</span>
            <input className={inputClass} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} required />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold">{existingAccount ? 'Password' : 'Create a password'}</span>
            <PasswordInput className={inputClass} label={existingAccount ? 'Password' : 'Create a password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={existingAccount ? 'current-password' : 'new-password'} disabled={busy} required />
          </label>
          {!existingAccount ? <p className="text-sm leading-relaxed text-[var(--text-muted)]">{PASSWORD_POLICY_SUMMARY}</p> : <a className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--text-primary)] underline" href="/reset-password">Forgot your password?</a>}
          {error ? <p role="alert" className="rounded border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{error}</p> : null}
          <button className="min-h-12 w-full rounded-lg px-4 py-3 font-extrabold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus-ring)] disabled:cursor-wait disabled:opacity-60" style={{ backgroundColor: palette.background, color: palette.foreground }} disabled={busy}>{busy ? 'Setting up access...' : existingAccount ? 'Sign in and accept' : 'Create Player login'}</button>
          {preview.state !== 'accepted' ? <button className="block min-h-11 w-full text-sm font-bold text-[var(--text-primary)] underline" type="button" disabled={busy} onClick={() => { setExistingAccount(!existingAccount); setPassword(''); setError('') }}>
            {existingAccount ? 'Create a Player login' : 'I already have an account'}
          </button> : null}
        </form>
      )}
          </section>
        </div>
        <footer className="border-t border-[var(--border-color)] pt-5 text-xs leading-relaxed text-[var(--text-muted)]">Powered by Football Player. This invitation is for your own Player access. If your details are wrong, contact your club before continuing.</footer>
      </div>
    </main>
  )
}
