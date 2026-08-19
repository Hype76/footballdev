import { useEffect, useMemo, useState } from 'react'

export const CONNECTION_ISSUE_GRACE_PERIOD_MS = 30000

export function isTransientConnectionMessage(value) {
  const message = String(value ?? '').trim().toLowerCase()
  return message.includes('no connection')
    || message.includes('could not connect')
    || message.includes('network request failed')
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('offline')
    || message.includes('timed out')
}

export function useConfirmedConnectionIssue(active, delayMs = CONNECTION_ISSUE_GRACE_PERIOD_MS) {
  const activationToken = useMemo(() => ({ active, delayMs }), [active, delayMs])
  const [confirmedToken, setConfirmedToken] = useState(null)

  useEffect(() => {
    if (!activationToken.active) return undefined

    const timer = setTimeout(() => setConfirmedToken(activationToken), activationToken.delayMs)
    return () => clearTimeout(timer)
  }, [activationToken])

  return Boolean(active && confirmedToken === activationToken)
}

export function useConfirmedConnectionMessage(message, delayMs = CONNECTION_ISSUE_GRACE_PERIOD_MS) {
  const transient = isTransientConnectionMessage(message)
  const confirmed = useConfirmedConnectionIssue(Boolean(message) && transient, delayMs)
  return transient && !confirmed ? '' : message
}
