import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { supabase } from '../lib/supabase-client.js'
import { uploadClubLogo, updateClubDisplaySettings } from '../lib/domain/club-settings-actions.js'
import { getWorkspaceScope } from '../lib/workspace-scope.js'
import { COACH_BRANDING_RETURN_URL } from '../lib/team-branding-onboarding.js'

const actionClass = 'inline-flex min-h-12 items-center px-3 py-2 font-bold underline underline-offset-4 disabled:opacity-50'
const inputClass = 'min-h-12 w-full border-b border-[#ccd8d0] bg-white py-2 text-base'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pickerColour = value => ({ yellow: '#facc15', blue: '#1d4ed8', green: '#15803d', red: '#dc2626', purple: '#7c3aed' }[value] || (/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#047857'))

export function ClubAppearanceSetupPage() {
  const { search } = useLocation()
  const clubId = new URLSearchParams(search).get('clubId') || ''
  const { user, session, isLoading, isProfileLoading, signInWithPassword, signOut } = useAuth()
  const actorId = session?.user?.id || ''
  const [checked, setChecked] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [accent, setAccent] = useState('#047857')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState('')
  const [retry, setRetry] = useState(0)
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const generation = useRef(0), inFlight = useRef(false)

  async function verify() {
    if (!actorId || user?.id !== actorId || user.clubId !== clubId || user.role !== 'admin' || Number(user.roleRank) < 90) throw new Error('Only the Club admin can change Club branding. Sign in with that account.')
    const [role, rank, clubScope, club, logoAccess, colourAccess] = await Promise.all([
      supabase.rpc('current_user_role'), supabase.rpc('current_user_role_rank'), supabase.rpc('current_user_club_id'),
      supabase.from('clubs').select('id,plan_key,status,archived_at,logo_url,theme_accent,theme_button_style').eq('id', clubId).maybeSingle(),
      supabase.rpc('can_use_plan_feature', { target_club_id: clubId, feature_name: 'basicLogoBranding' }),
      supabase.rpc('can_use_plan_feature', { target_club_id: clubId, feature_name: 'customColoursBranding' }),
    ])
    if ([role, rank, clubScope, club, logoAccess, colourAccess].some(value => value.error) || role.data !== 'admin'
      || Number(rank.data) < 90 || clubScope.data !== clubId || club.data?.id !== clubId
      || club.data.status !== 'active' || club.data.archived_at || getWorkspaceScope(club.data.plan_key).key !== 'club'
      || logoAccess.data !== true || colourAccess.data !== true) throw new Error('Club admin branding access could not be verified. No branding has changed.')
    return club.data
  }
  useEffect(() => {
    const attempt = ++generation.current
    setChecked(null); setError(''); setMessage(''); setFile(null); setBusy(''); inFlight.current = false
    if (actorId && user && UUID.test(clubId)) verify().then(club => {
      if (generation.current === attempt) { setChecked({ club, profile: user, actorId }); setAccent(pickerColour(club.theme_accent)) }
    }).catch(failure => { if (generation.current === attempt) setError(failure.message) })
    return () => { generation.current += 1 }
    // Discard all selected artwork and pending checks on account or club changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, user, clubId, retry])
  async function signIn(event) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true; setBusy('Signing in...'); setError('')
    try { await signInWithPassword({ ...credentials, email: credentials.email.trim(), preferredAccessMode: 'club' }); setCredentials({ email: '', password: '' }) }
    catch (failure) { setError(failure.message || 'Sign in could not be completed.') }
    finally { inFlight.current = false; setBusy('') }
  }
  async function save(kind) {
    if (inFlight.current) return
    const attempt = generation.current
    inFlight.current = true; setBusy(kind === 'badge' ? 'Uploading badge...' : 'Saving colour...'); setError(''); setMessage('')
    try {
      const club = await verify()
      if (attempt !== generation.current) return
      if (kind === 'badge') {
        const logoUrl = await uploadClubLogo({ clubId, file, user })
        if (attempt === generation.current) { setChecked({ club: { ...club, logo_url: logoUrl }, profile: user, actorId }); setFile(null); setMessage('Club badge saved.') }
      } else {
        const saved = await updateClubDisplaySettings({ clubId, themeAccent: accent, themeButtonStyle: club.theme_button_style, user })
        if (attempt === generation.current) { setChecked({ club: { ...club, theme_accent: saved.themeAccent }, profile: user, actorId }); setMessage('Club colour saved.') }
      }
    } catch (failure) { if (attempt === generation.current) setError(failure.message || 'Branding could not save. Your selected changes are still here.') }
    finally { if (attempt === generation.current) { inFlight.current = false; setBusy('') } }
  }
  const ready = checked?.profile === user && checked?.actorId === actorId && checked?.club.id === clubId
  return <main className="mx-auto min-h-screen max-w-2xl space-y-4 bg-white px-4 py-6 text-[#101828]">
    <h1 className="text-2xl font-bold">Club badge and colour</h1>
    <p>These changes apply to the whole Club. Only the Club admin can save them.</p>
    {!UUID.test(clubId) ? <p role="alert">Open Club branding from Coach settings.</p> : !actorId ? <form className="divide-y divide-[#ccd8d0]" onSubmit={signIn}>
      <label className="block py-2">Email<input className={inputClass} type="email" autoComplete="username" required value={credentials.email} onChange={event => setCredentials({ ...credentials, email: event.target.value })} /></label>
      <label className="block py-2">Password<input className={inputClass} type="password" autoComplete="current-password" required value={credentials.password} onChange={event => setCredentials({ ...credentials, password: event.target.value })} /></label>
      <button className={actionClass} disabled={Boolean(busy) || isLoading}>{busy || 'Sign in'}</button>
    </form> : ready ? <div className="divide-y divide-[#ccd8d0]">
      <label className="block py-3">Club badge
        {checked.club.logo_url && <img src={checked.club.logo_url} alt="Saved Club badge" className="my-2 h-24 w-24 object-contain" />}
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy)} onChange={event => setFile(event.target.files?.[0] || null)} className="block min-h-12 w-full py-2" />
        <span className="text-sm">PNG, JPG or WebP, up to 2 MB. Choose from photos or files.</span>
      </label>
      <button className={actionClass} disabled={Boolean(busy) || !file} onClick={() => void save('badge')}>Upload Club badge</button>
      <label className="flex min-h-12 items-center justify-between py-3">Club colour<input type="color" aria-label="Club colour" value={accent} disabled={Boolean(busy)} onChange={event => setAccent(event.target.value)} className="h-12 w-16" /></label>
      <button className={actionClass} disabled={Boolean(busy) || accent === pickerColour(checked.club.theme_accent)} onClick={() => void save('colour')}>Save Club colour</button>
    </div> : isLoading || isProfileLoading || (user && !error) ? <p role="status">Checking Club admin access...</p> : null}
    {error && <p role="alert">{error}</p>}
    <p role="status">{busy || message}</p>
    {actorId && error && <button className={actionClass} onClick={() => setRetry(value => value + 1)} disabled={Boolean(busy)}>Retry access check</button>}
    <div className="flex flex-wrap gap-2 border-t border-[#ccd8d0] py-3">
      <a className={actionClass} href={COACH_BRANDING_RETURN_URL} onClick={event => { if (busy) event.preventDefault() }}>Return to Coach</a>
      {actorId && <button className={actionClass} disabled={Boolean(busy)} onClick={() => signOut()}>Use another account</button>}
    </div>
    <p className="text-sm">Wait for the save confirmation, then return to Coach to refresh your Club branding.</p>
  </main>
}
