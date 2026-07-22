import { useEffect, useState } from 'react'
import {
  createServerClockSampleFromDateHeader,
  getServerSyncedNowMs,
} from '../lib/matchday-timer.js'

function getTimerSyncUrl() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return '/'
  }

  return `${window.location.origin}/?match-timer-sync=${Date.now()}`
}

async function readServerClockSample() {
  if (typeof fetch !== 'function') {
    return null
  }

  const response = await fetch(getTimerSyncUrl(), {
    cache: 'no-store',
    method: 'HEAD',
  })

  if (!response.ok) {
    return null
  }

  return createServerClockSampleFromDateHeader(response.headers.get('date'), {
    sampledAtMs: Date.now(),
  })
}

export function useServerSyncedClock({
  syncIntervalMs = 30000,
  tickIntervalMs = 1000,
} = {}) {
  const [clockSample, setClockSample] = useState(null)
  const [nowMs, setNowMs] = useState(null)

  useEffect(() => {
    let isCurrent = true

    async function syncClock() {
      try {
        const nextSample = await readServerClockSample()

        if (isCurrent && nextSample) {
          setClockSample(nextSample)
          setNowMs(getServerSyncedNowMs(nextSample))
        }
      } catch {
        // Keep the last valid sample, or the unavailable state, until a retry succeeds.
      }
    }

    void syncClock()

    const intervalId = window.setInterval(() => {
      void syncClock()
    }, syncIntervalMs)

    return () => {
      isCurrent = false
      window.clearInterval(intervalId)
    }
  }, [syncIntervalMs])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(getServerSyncedNowMs(clockSample))
    }, tickIntervalMs)

    return () => window.clearInterval(intervalId)
  }, [clockSample, tickIntervalMs])

  return nowMs
}
