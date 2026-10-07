import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { supabase } from '../lib/supabase-client.js'
import { COACH_RESOURCE_RETURN_URL, readCoachResourceUploadScope, verifyCoachResourceUploadScope } from '../lib/coach-resource-upload-handoff.js'
import { ResourceLibraryPage } from './ResourceLibraryPage.jsx'

const actionClass = 'inline-flex min-h-12 items-center px-3 py-2 font-bold underline underline-offset-4 disabled:opacity-50'
const inputClass = 'min-h-12 w-full border-b border-[#ccd8d0] bg-white py-2 text-base'

export function CoachResourceUploadPage() {
  const { search } = useLocation()
  const scope = readCoachResourceUploadScope(search)
  const { user, session, isLoading, isProfileLoading, signInWithPassword, signOut } = useAuth()
  const actorId = session?.user?.id || ''
  const [checked, setChecked] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const generation = useRef(0)
  const signingIn = useRef(false)
  const scopeKey = `${actorId}:${user?.id}:${user?.clubId}:${scope?.clubId}:${scope?.teamId}`
  useEffect(() => {
    const attempt = ++generation.current
    setChecked(null); setError('')
    if (actorId && user && scope) {
      verifyCoachResourceUploadScope(supabase, user, scope, actorId).then(scopedUser => {
        if (generation.current === attempt) setChecked({ key: scopeKey, profile: user, user: scopedUser })
      }).catch(failure => { if (generation.current === attempt) setError(failure.message || 'Team access could not be checked. Try again.') })
    }
    return () => { generation.current += 1 }
  // The scope is parsed from the URL. Only its primitive identifiers identify this request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, user, scope?.teamId, scope?.clubId, scopeKey, retry])
  async function signIn(event) {
    event.preventDefault()
    if (signingIn.current) return
    signingIn.current = true; setBusy(true); setError('')
    try {
      await signInWithPassword({ ...credentials, email: credentials.email.trim(), preferredAccessMode: 'team' })
      setCredentials({ email: '', password: '' })
    } catch (failure) { setError(failure.message || 'Sign in could not be completed.') }
    finally { signingIn.current = false; setBusy(false) }
  }
  const ready = checked?.key === scopeKey && checked.profile === user && checked.user.id === actorId
  return <main className="mx-auto min-h-screen max-w-5xl space-y-4 bg-white px-4 py-6 text-[#101828]">
    <h1 className="text-2xl font-bold">Upload team resources</h1>
    <p>Choose files or photos from your phone. Uploads stay with the team selected in Coach.</p>
    {!scope ? <p role="alert">Open this page using Upload files or photos in Coach resources.</p> : !actorId ? <>
      <p>Your browser session is separate from the Coach app. Sign in with the same club account.</p>
      <form onSubmit={signIn} className="divide-y divide-[#ccd8d0]">
        <label className="block py-2">Email<input className={inputClass} type="email" autoComplete="username" required value={credentials.email} onChange={event => setCredentials({ ...credentials, email: event.target.value })} /></label>
        <label className="block py-2">Password<input className={inputClass} type="password" autoComplete="current-password" required value={credentials.password} onChange={event => setCredentials({ ...credentials, password: event.target.value })} /></label>
        <button className={actionClass} disabled={busy || isLoading}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
      <a className={actionClass} href="/sign-in">Account or password help</a>
    </> : !user && !isLoading && !isProfileLoading ? <p role="alert">This account has no available team workspace. Use your Coach account to continue.</p> : isProfileLoading || isLoading || (!ready && !error) ? <p role="status">Checking your team upload access...</p> : ready ? <ResourceLibraryPage key={scopeKey} scopedUser={checked.user} /> : null}
    {error && <p role="alert">{error}</p>}
    {actorId && error && <button className={actionClass} onClick={() => setRetry(value => value + 1)}>Retry team access</button>}
    <div className="flex flex-wrap gap-2 border-t border-[#ccd8d0] py-3">
      <a className={actionClass} href={COACH_RESOURCE_RETURN_URL}>Return to Coach</a>
      {actorId && <button className={actionClass} onClick={() => signOut()}>Use another account</button>}
    </div>
    <p className="text-sm">Wait for the upload confirmation before leaving this page. If Coach does not open, switch back to the app and refresh resources.</p>
  </main>
}
