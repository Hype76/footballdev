import { useEffect, useState } from 'react'
import { CLUB_TV_EMBED_PATH, CLUB_TV_VIEW_HOST, CLUB_TV_VIEW_PATH, clubTvSlugStatus, normalizeClubTvSlug, normalizeTvPreferences } from '../lib/club-matchday-tv.js'
import { getClubMatchdayTv } from '../lib/domain/club-matchday-tv.js'
import { supabase } from '../lib/supabase-client.js'
import { ClubMatchdayTvDisplay } from './ClubMatchdayTvDisplay.jsx'

function getViewerLink() {
  const { hostname, pathname } = window.location
  const prefix = hostname === CLUB_TV_VIEW_HOST
    ? pathname.startsWith(CLUB_TV_EMBED_PATH) ? CLUB_TV_EMBED_PATH : '/'
    : hostname === 'fpmd.online' ? '/' : CLUB_TV_VIEW_PATH
  if (!pathname.startsWith(prefix)) return null
  const raw = pathname.slice(prefix.length).replace(/\/$/, '')
  const slug = normalizeClubTvSlug(raw)
  if (clubTvSlugStatus(slug) !== 'valid') return null
  return { slug, canonicalPath: `${prefix}${slug}` }
}

export function StandaloneClubMatchdayTv() {
  const [link] = useState(getViewerLink)
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    if (!link) return undefined
    if (window.location.pathname !== link.canonicalPath) window.history.replaceState(null, '', link.canonicalPath)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || '')
    })
    return () => subscription.unsubscribe()
  }, [link])

  if (!link) return <ViewerStatus><p>This Matchday TV link is unavailable. Check the link with your Club Admin.</p></ViewerStatus>
  if (userId === null) return <ViewerStatus><p role="status">Connecting to your club…</p></ViewerStatus>
  return <AuthorizedViewer key={userId} userId={userId} slug={link.slug} />
}

function ViewerStatus({ children }) {
  return <main className="mx-auto grid min-h-svh w-full max-w-md content-center gap-4 px-6">
    <h1 className="text-2xl font-bold">Club Matchday TV</h1>
    {children}
  </main>
}

function ViewerSignIn() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function signIn(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = event.currentTarget
    const { email, password } = Object.fromEntries(new FormData(form))
    form.reset()
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error || !result.data?.session) setError('Could not sign in. Check your Club Admin email and password.')
    } catch { setError('Sign-in is temporarily unavailable. Try again.') }
    finally { setBusy(false) }
  }

  return <ViewerStatus>
    <p>Sign in with your Club Admin account to open this display.</p>
    <form className="grid gap-3" onSubmit={signIn}>
      <label className="grid gap-1">Email <input className="min-h-11 rounded border px-3" type="email" name="email" autoComplete="username" required /></label>
      <label className="grid gap-1">Password <input className="min-h-11 rounded border px-3" type="password" name="password" autoComplete="current-password" required /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button className="min-h-11 rounded border px-3" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </ViewerStatus>
}

function AuthorizedViewer({ userId, slug }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('The display request timed out.')), 15000)
    getClubMatchdayTv({ action: 'view', slug, signal: controller.signal })
      .then((payload) => { if (!controller.signal.aborted) setResult(payload) })
      .catch((failure) => {
        if (!controller.signal.aborted || controller.signal.reason?.message === 'The display request timed out.') setError(failure)
      })
      .finally(() => clearTimeout(timer))
    return () => { controller.abort(); clearTimeout(timer) }
  }, [slug, attempt])

  if (error?.status === 401 && !userId) return <ViewerSignIn />
  if (error) return <ViewerStatus>
    <p role="alert">{error.message}</p>
    {error.status !== 403 ? <button className="min-h-11 rounded border px-3" onClick={() => { setError(null); setAttempt(attempt + 1) }}>Try again</button> : null}
    {userId ? <button className="min-h-11 rounded border px-3" onClick={() => { void supabase.auth.signOut({ scope: 'local' }) }}>Sign in with a different account</button> : null}
  </ViewerStatus>
  if (!result) return <ViewerStatus><p role="status">Opening Matchday TV…</p></ViewerStatus>
  return <ClubMatchdayTvDisplay standalone viewerSlug={slug} onAccessDenied={setError} weatherConfigured={result.weatherConfigured}
    user={{ id: userId, clubId: result.club.id }} preferences={normalizeTvPreferences(result.settings?.preferences)} />
}
