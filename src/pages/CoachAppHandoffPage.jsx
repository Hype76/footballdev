import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { supabase } from '../lib/supabase-client.js'
import { exchangeCoachWebHandoff } from '../lib/coach-web-handoff.js'

export function CoachAppHandoffPage() {
  const navigate = useNavigate()
  const { authUser, isLoading, isProfileLoading, selectAccessMode } = useAuth()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const started = useRef(false)
  const selected = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void exchangeCoachWebHandoff({ client: supabase, fragment: window.location.hash,
      clearFragment: () => {
        window.history.replaceState(null, '', window.location.pathname)
        window.sessionStorage.setItem('selected-access-mode', 'team')
        window.sessionStorage.setItem('selected-access-mode-explicit', 'true')
        window.sessionStorage.removeItem('selected-club-id')
        window.sessionStorage.removeItem('selected-team-id')
      } })
      .then(setResult).catch(failure => setError(failure.message))
  }, [])
  useEffect(() => {
    if (!result || selected.current || isLoading || isProfileLoading || authUser?.id !== result.actorId) return
    selected.current = true
    void selectAccessMode('team').then(profile => {
      if (profile?.id !== result.actorId) throw new Error('Coach access could not be opened. Return to Coach and try again.')
      navigate(result.destination, { replace: true })
    }).catch(failure => setError(failure.message))
  }, [result, authUser?.id, isLoading, isProfileLoading, selectAccessMode, navigate])
  useEffect(() => {
    const timer = window.setTimeout(() => setError(current => current || 'Your account could not be opened. Return to Coach and try again when connected.'), 20000)
    return () => window.clearTimeout(timer)
  }, [])
  return <main className="mx-auto max-w-lg px-5 py-8 text-[#142a1d]">
    <h1 className="text-2xl font-bold">Football Player</h1>
    <p role={error ? 'alert' : 'status'} className="py-4">{error || 'Opening your account securely...'}</p>
    {error && <p>Return to Coach and open the action again. Your app account stays signed in.</p>}
  </main>
}
