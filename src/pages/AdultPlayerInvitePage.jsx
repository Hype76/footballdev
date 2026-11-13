import { useRef, useState } from 'react'
import { PasswordInput } from '../components/ui/PasswordInput.jsx'
import { useAuth } from '../lib/auth.js'
import { assertPasswordPolicy, PASSWORD_POLICY_SUMMARY } from '../lib/password-policy.js'

async function submitInvite(body, accessToken) {
  const response = await fetch('/.netlify/functions/adult-player-setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.success) throw new Error(result.message || 'Player access could not be set up. Please try again.')
}

export function AdultPlayerInvitePage() {
  const { signInWithPassword } = useAuth()
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [existingAccount, setExistingAccount] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submission = useRef(false)

  async function accept(event) {
    event.preventDefault()
    if (!token || submission.current) return
    submission.current = true
    setBusy(true)
    setError('')
    try {
      const address = email.trim().toLowerCase()
      if (!existingAccount) {
        assertPasswordPolicy(password)
        await submitInvite({ action: 'create', email: address, password, token })
      }
      const result = await signInWithPassword({ email: address, password })
      if (existingAccount) {
        if (!result.session?.access_token) throw new Error('Sign in again to accept your invitation.')
        await submitInvite({ action: 'accept', token }, result.session.access_token)
      }
      window.location.replace('/player')
    } catch (failure) {
      setError(failure.message || 'Player access could not be set up. Please try again.')
    } finally {
      setBusy(false)
      submission.current = false
    }
  }

  return (
    <main className="mx-auto max-w-lg space-y-5 p-6 text-[#101828]">
      <h1 className="text-2xl font-bold">Set up your Player access</h1>
      <p>Use the email address your club invited. You can then sign in on the website to respond to fixtures and training.</p>
      {!token ? <p role="alert">Open the Player invitation from your email. If you already set up access, <a className="underline" href="/sign-in">sign in</a>.</p> : (
        <form className="space-y-4" onSubmit={accept}>
          <label className="block">
            <span className="block font-semibold">Player email</span>
            <input className="min-h-11 w-full rounded border border-[#b9c9c2] px-3" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
          </label>
          <label className="block">
            <span className="block font-semibold">{existingAccount ? 'Password' : 'Create a password'}</span>
            <PasswordInput className="min-h-11 w-full rounded border border-[#b9c9c2] px-3" label={existingAccount ? 'Password' : 'Create a password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={existingAccount ? 'current-password' : 'new-password'} required />
          </label>
          {!existingAccount ? <p className="text-sm">{PASSWORD_POLICY_SUMMARY}</p> : null}
          {error ? <p role="alert" className="text-[#a11919]">{error}</p> : null}
          <button className="min-h-11 rounded bg-[#047857] px-4 font-bold text-white" disabled={busy}>{busy ? 'Setting up access...' : existingAccount ? 'Sign in and accept' : 'Create Player login'}</button>
          <button className="block min-h-11 text-[#047857] underline" type="button" disabled={busy} onClick={() => { setExistingAccount(!existingAccount); setPassword(''); setError('') }}>
            {existingAccount ? 'Create a Player login' : 'I already have an account'}
          </button>
        </form>
      )}
    </main>
  )
}
