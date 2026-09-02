import { useCallback, useEffect, useRef, useState } from 'react'
export function useGuestScorerManagement(matchId, request) {
  const [guest, setGuest] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const currentMatch = useRef(matchId)
  currentMatch.current = matchId
  const run = useCallback(async (action = 'status', sessionId = null) => {
    if (lock.current) return
    lock.current = true
    if (action !== 'status') setBusy(true)
    try {
      const result = await request({ mode: 'coach', matchId, action, sessionId })
      if (currentMatch.current !== matchId) return
      setGuest((prior) => ({ ...result, ...(result.id === prior?.id && result.status === 'offered' ? { qr: result.qr || prior.qr, url: result.url || prior.url } : {}) }))
      setError('')
    } catch (failure) { if (currentMatch.current === matchId) setError(failure.message) }
    finally { lock.current = false; setBusy(false) }
  }, [matchId, request])
  useEffect(() => {
    setGuest(null); setError(''); void run()
    const timer = setInterval(() => { void run() }, 4000)
    return () => clearInterval(timer)
  }, [run])
  return { guest, error, busy, run }
}
