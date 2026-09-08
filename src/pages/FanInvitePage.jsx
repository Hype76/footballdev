import { PasswordInput } from '../components/ui/PasswordInput.jsx'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { supabase } from '../lib/supabase-client.js'
import { fanRpc } from '../lib/fans-client.js'
import { fanAccessSummary } from '../lib/fans.js'
import { FanIcon } from '../components/parent-portal/FanIcon.jsx'
import { fetchFansJson } from '../lib/fans-fetch.js'
import { assertPasswordPolicy, PASSWORD_POLICY_SUMMARY } from '../lib/password-policy.js'
import { FanBrandScope, FanClubBrand } from '../components/parent-portal/FanBrand.jsx'
import './fans.css'
export function FanInvitePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState(null)
  const [verificationEmail, setVerificationEmail] = useState('')
  const [invite, setInvite] = useState(null)
  const [branding, setBranding] = useState(null)
  useEffect(() => {
    let active = true
    setBranding(null)
    fanRpc('get_fan_invitation_branding', { token_value: token }).then((brand) => { if (active) setBranding(brand) }).catch(() => { if (active) setBranding(null) })
    return () => { active = false }
  }, [token, session?.user?.id])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const messageRef = useRef(null)
  const confirmationRef = useRef(null)
  useEffect(() => { if (message) messageRef.current?.scrollIntoView({ block: 'nearest' }) }, [message])
  useEffect(() => { if (verificationEmail) confirmationRef.current?.focus() }, [verificationEmail])
  useEffect(() => {
    let active = true
    setInvite(null)
    if (session?.user) fanRpc('get_fan_invitation', { token_value: token }).then((row) => { if (active) setInvite(row) }).catch((e) => { if (active) setMessage(e.message) })
    return () => { active = false }
  }, [session?.user, token])
  const run = async (action) => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setMessage(''); try { await action() } catch (e) { setMessage(e.message || 'Account setup could not finish. Please try again.') } finally { busyRef.current = false; setBusy(false) } }
  const chooseMode = (nextMode) => { setMode(nextMode); setPassword(''); setMessage(''); if (nextMode === 'create') setVerificationEmail('') }
  const submit = async () => {
    if (mode === 'create') {
      assertPasswordPolicy(password)
      const result = await fetchFansJson('/.netlify/functions/create-fan-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, email: email.trim().toLowerCase(), password }) })
      if (result.needsEmailVerification !== true) throw new Error('Account creation could not be confirmed. Please try again.')
      setVerificationEmail(email.trim())
      setMode('signin')
      setPassword('')
      return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error?.code === 'email_not_confirmed') throw new Error('Confirm your email using the confirmation email before signing in. Check your spam folder too.')
    if (error?.code === 'invalid_credentials') throw new Error('We could not sign you in with that email and password. If you are new, choose Create account first and confirm your email. Otherwise check your details or use Forgot password.')
    if (error) throw error
    setPassword('')
  }
  return <FanBrandScope source={invite || branding}><main className="fans"><FanClubBrand source={invite || branding} /><header className="fans-heading"><FanIcon /><h1>Your Fan invitation</h1></header><p>Use the email address the Parent invited. You will only receive the access they selected.</p>
    {message ? <p ref={messageRef} role="alert">{message}</p> : null}
    {!session?.user ? <>
      {!mode ? <><p>New to Football Player? Create an account, confirm your email, then accept this invitation.</p><button className="fans-invite" onClick={() => chooseMode('create')}>Create account</button><p>Already have an account?</p><button onClick={() => chooseMode('signin')}>Sign in</button></> : <>
        {verificationEmail ? <section ref={confirmationRef} tabIndex={-1} aria-label="Email confirmation"><h2>Check your email</h2><p>We sent a confirmation email to {verificationEmail}. Check your spam folder too.</p><p>Open Confirm email, then return here to sign in and accept the invitation. Your Fan access is not active yet.</p></section> : null}
        <h2>{mode === 'create' ? 'Create your Fan account' : 'Sign in to accept'}</h2>
        <form aria-busy={busy} onInvalid={(e) => setMessage(e.target.validationMessage)} onSubmit={(e) => { e.preventDefault(); void run(submit) }}>
          <label>Email<input required type="email" autoComplete="email" disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<PasswordInput key={mode} required autoComplete={mode === 'create' ? 'new-password' : 'current-password'} disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {mode === 'create' ? <p>{PASSWORD_POLICY_SUMMARY}</p> : null}
          <button className="fans-invite" disabled={busy} type="submit">{busy ? 'Please wait...' : mode === 'create' ? 'Create account' : 'Sign in'}</button>
          <div className="fans-actions"><button disabled={busy} type="button" onClick={() => chooseMode(mode === 'create' ? 'signin' : 'create')}>{mode === 'create' ? 'I already have an account' : 'Create account'}</button>{mode === 'signin' ? <Link to="/parent-login">Forgot password?</Link> : null}</div>
        </form>
      </>}
      <p>After accepting, sign in to the Football Player Parent app with the same email and password. Enable phone notifications in Fans for the Game Day alerts the Parent has shared.</p>
    </> : <><p>Signed in as {session.user.email}</p><button disabled={busy} onClick={() => run(() => supabase.auth.signOut())}>Use a different account</button>{invite ? <><h2>Follow {invite.player_name}</h2><ul>{fanAccessSummary(invite.permissions).map((line) => <li key={line}>{line}</li>)}</ul><p>You cannot invite other people or change this child's information. You can remove your own access at any time.</p><p>After accepting, you can sign in to the Parent app with this same account and enable phone notifications in Fans.</p><button disabled={busy} onClick={() => run(async () => { await fanRpc('accept_fan_invitation', { token_value: token }); navigate('/fans', { replace: true }); window.location.reload() })}>Accept invitation</button></> : null}</>}
  </main></FanBrandScope>
}
