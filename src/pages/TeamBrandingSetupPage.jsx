import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { supabase } from '../lib/supabase-client.js'
import { getScopedTeamBranding } from '../lib/team-branding-display.js'
import { COACH_BRANDING_RETURN_URL, readBrandingSetupSelection, requestTeamBrandingSetup } from '../lib/team-branding-onboarding.js'
import { formatUkDate } from '../lib/date-format.js'

const actionClass = 'min-h-11 px-3 py-2 font-bold underline underline-offset-4 disabled:opacity-50'
const inputClass = 'min-h-11 w-full border-b border-[#ccd8d0] bg-white py-2 text-base'

export function TeamBrandingSetupPage() {
  const { search } = useLocation()
  const { teamId, fromCoach } = readBrandingSetupSelection(search)
  const { isLoading, isProfileLoading, session, user, signInWithPassword, signOut } = useAuth()
  const [state, setState] = useState(null)
  const [display, setDisplay] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [accent, setAccent] = useState('#047857')
  const [colourChanged, setColourChanged] = useState(false)
  const [file, setFile] = useState(null)
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const actorId = session?.user?.id || ''

  async function readCurrent(signal) {
    const management = await requestTeamBrandingSetup({ client: supabase, teamId, signal, expectedActorId: actorId })
    if (!management.enabled) return { management, resolved: null }
    const { data, error: displayError } = await supabase.rpc('get_team_branding_display', {
      team_value: teamId, club_value: management.clubId,
    })
    const resolved = data === null ? null : getScopedTeamBranding({ teamId, clubId: management.clubId, teamBrandingDisplay: data })
    if (displayError || (data !== null && !resolved)) throw new Error('Branding access could not be verified. Try again.')
    return { management, resolved }
  }

  useEffect(() => {
    const controller = new AbortController()
    const current = ++generation.current
    setState(null); setDisplay(null); setError(''); setMessage(''); setAccepted(false); setFile(null); setColourChanged(false)
    if (actorId && user && teamId) readCurrent(controller.signal).then(({ management, resolved }) => {
      if (current !== generation.current || controller.signal.aborted) return
      setState(management); setDisplay(resolved)
      setAccent(/^#[0-9a-f]{6}$/i.test(management.accent || '') ? management.accent : '#047857')
    }).catch(failure => { if (!controller.signal.aborted && current === generation.current) setError(failure.message) })
    return () => { controller.abort(); generation.current += 1 }
    // Each account/team change discards pending reads and selected artwork.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, user, teamId, retry])

  async function signIn(event) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      await signInWithPassword({ ...credentials, email: credentials.email.trim(), preferredAccessMode: 'team' })
      setCredentials({ email: '', password: '' })
    } catch (failure) { setError(failure.message || 'Sign in could not be completed.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function act(action) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setMessage('')
    const current = generation.current
    try {
      const fresh = await readCurrent()
      if (current !== generation.current) return
      setState(fresh.management); setDisplay(fresh.resolved)
      if (!fresh.management.enabled) throw new Error('This offer is not available yet.')
      if (fresh.resolved?.source === 'paid_club') throw new Error('Your branding is managed by your Club.')
      let extra
      if (action === 'claim') {
        if (fresh.management.claimAllowed !== true) throw new Error('New promotional places are available to Matchday teams only.')
        if (!accepted || state?.termsVersion !== fresh.management.termsVersion) {
          setAccepted(false)
          throw new Error('Read and accept the current offer terms before claiming.')
        }
        extra = { termsVersion: fresh.management.termsVersion }
      } else {
        extra = fresh.management.coloursAllowed && colourChanged ? { accent } : {}
        if (file) {
          if (!fresh.management.logoAllowed) throw new Error('Badge access is no longer available.')
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
            throw new Error('Choose a PNG, JPG or WebP badge smaller than 5 MB.')
          }
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The badge could not be read. Choose it again.')); reader.readAsDataURL(file)
          })
          extra = { ...extra, dataBase64: String(dataUrl).split(',')[1], mimeType: file.type, fileName: file.name }
        }
      }
      if (current !== generation.current) return
      await requestTeamBrandingSetup({ client: supabase, teamId, action, extra, expectedActorId: actorId })
      const updated = await readCurrent()
      if (current !== generation.current) return
      setState(updated.management); setDisplay(updated.resolved); setFile(null); setAccepted(false); setColourChanged(false)
      setMessage(action === 'claim' ? 'Your place is reserved. Add your badge and colour below.' : 'Team branding saved. Return to Coach to refresh it.')
    } catch (failure) { if (current === generation.current) setError(failure.message || 'Your saved artwork was kept. Try again.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  const signedIn = Boolean(actorId)
  const paidClub = display?.source === 'paid_club'
  return <main className="mx-auto min-h-screen max-w-lg bg-white px-5 py-6 text-[#142a1d]">
    <h1 className="text-2xl font-bold">Your team badge and colour</h1>
    <p className="py-3 text-base">Use your club badge for this team. This does not change your Club's shared branding.</p>
    {!teamId ? <p role="alert">Open this page from your selected team in Coach.</p> : !signedIn ? <>
      <p className="py-3">Sign in with your Football Player account. Your browser session is separate from the Coach app.</p>
      <form onSubmit={signIn} className="divide-y divide-[#ccd8d0]">
        <label className="block py-2">Email<input className={inputClass} type="email" autoComplete="username" required value={credentials.email} onChange={event => setCredentials({ ...credentials, email: event.target.value })} /></label>
        <label className="block py-2">Password<input className={inputClass} type="password" autoComplete="current-password" required value={credentials.password} onChange={event => setCredentials({ ...credentials, password: event.target.value })} /></label>
        <button className={actionClass} disabled={busy || isLoading}>Sign in</button>
      </form>
      <a className={`inline-flex items-center ${actionClass}`} href="/sign-in">Account or password help</a>
    </> : isProfileLoading || (!user && isLoading) ? <p role="status">Checking team access...</p> : !user ? <p role="alert">This account has no available team workspace.</p> : !state && !error ? <p role="status">Checking branding access...</p> : state?.enabled === false ? <p>This offer is not available yet. You can continue team setup and try later.</p> : state?.enabled ? <>
      {paidClub ? <p className="py-3">Branding managed by your Club. Your Club badge and colours take priority; team uploads will not replace them.</p> : <>
        <p className="py-3">{['grandfathered', 'permanent'].includes(state.state) ? 'Your team has permanent promotional branding.' : state.state === 'provisional' ? `Qualify by ${formatUkDate(state.deadlineAt)}: ${state.playersWithAcceptedParent}/7 active players with accepted Parent links and ${state.completedMatches}/10 completed matches.` : state.state === 'failed' ? 'The qualification window has ended. Saved artwork is retained; an eligible paid plan can restore display.' : 'Claim one of the first 250 team places.'}</p>
        {state.state === 'unclaimed' && state.claimAllowed !== true && <p>New promotional places are available to Matchday teams only.</p>}
        {state.state === 'unclaimed' && state.claimAllowed === true && <>
          <p>Three calendar months from claiming to reach seven distinct active players with accepted Parent links and ten completed matches. Branding is available immediately and becomes permanent when both are met. Otherwise promotional display ends and artwork is kept. One place per team.</p>
          <label className="flex min-h-12 items-center gap-3 py-2"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy} />I accept the offer terms ({state.termsVersion}).</label>
          <button className={actionClass} disabled={!accepted || busy} onClick={() => act('claim')}>Claim this team's place</button>
        </>}
        {(state.logoAllowed || state.coloursAllowed) && <div className="divide-y divide-[#ccd8d0]">
          {state.logoAllowed && <label className="block py-3">Club badge for this team
            {state.logoUrl && <img src={state.logoUrl} alt="Saved team badge" className="my-2 h-16 w-16 object-contain" />}
            <input className="block min-h-12 w-full py-2" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} />
            <span className="text-sm">PNG, JPG or WebP, up to 5 MB. Choose from photos or files.</span>
          </label>}
          {state.coloursAllowed && <label className="flex min-h-12 items-center justify-between py-3">Team colour<input aria-label="Team colour" type="color" className="h-12 w-16" value={accent} onChange={event => { setAccent(event.target.value); setColourChanged(true) }} disabled={busy} /></label>}
          <button className={actionClass} disabled={busy || (!colourChanged && !file)} onClick={() => act('save')}>Save team branding</button>
        </div>}
      </>}
    </> : null}
    {error && <p role="alert" className="py-3 text-[#a11919]">{error}</p>}
    {signedIn && error && <button className={actionClass} disabled={busy} onClick={() => setRetry(value => value + 1)}>Retry access check</button>}
    <p role="status" className="py-2">{busy ? 'Please wait...' : message}</p>
    <div className="flex flex-wrap gap-2 border-t border-[#ccd8d0] py-3">
      {fromCoach ? <a className={`inline-flex items-center ${actionClass}`} href={COACH_BRANDING_RETURN_URL} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault() }}>{message ? 'Return to Coach' : 'Do this later and return to Coach'}</a> : <a className={`inline-flex items-center ${actionClass}`} href="/coach" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault() }}>Continue team setup</a>}
      {signedIn && <button className={actionClass} disabled={busy} onClick={() => signOut()}>Use another account</button>}
    </div>
    {fromCoach && <p className="text-sm">If Coach does not open, switch back to the app. Open Team branding in Settings to edit later.</p>}
  </main>
}
