/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react'
import { getMainAppOrigin, isParentPortalHost } from './app-origins.js'
import { supabase } from './supabase-client.js'
import { STAFF_SWITCH_PENDING_STORAGE_KEY } from './workspace-routes.js'

const BRIDGE_PATH = '/auth-session-bridge'
const BRIDGE_READY = 'football-player:session-bridge-ready'
const BRIDGE_SESSION = 'football-player:session-bridge-session'
const BRIDGE_COMPLETE = 'football-player:session-bridge-complete'
const BRIDGE_FAILED = 'football-player:session-bridge-failed'
const BRIDGE_TIMEOUT_MS = 10000

function isFixtureMode() {
  return String(import.meta.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES ?? '').trim().toLowerCase() === 'true'
}

function getOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function isTrustedParentOrigin(origin) {
  try {
    return isParentPortalHost(new URL(origin).hostname)
  } catch {
    return false
  }
}

function getFixtureBridgeState() {
  if (!isFixtureMode()) {
    return null
  }

  return {
    email: window.sessionStorage.getItem('auth-access-browser-fixture-email') || '',
    selectedClubId: window.sessionStorage.getItem('selected-club-id') || '',
    selectedTeamId: window.sessionStorage.getItem('selected-team-id') || '',
  }
}

function applyTeamAccessState() {
  window.sessionStorage.setItem('selected-access-mode', 'team')
  window.sessionStorage.setItem('selected-access-mode-explicit', 'true')
  window.sessionStorage.setItem(STAFF_SWITCH_PENDING_STORAGE_KEY, 'true')
  window.sessionStorage.removeItem('login-access-intent')
}

function applyFixtureBridgeState(fixtureState) {
  if (!isFixtureMode() || !fixtureState?.email) {
    return false
  }

  window.sessionStorage.setItem('auth-access-browser-fixture-email', fixtureState.email)
  applyTeamAccessState()

  if (fixtureState.selectedClubId) {
    window.sessionStorage.setItem('selected-club-id', fixtureState.selectedClubId)
  }

  if (fixtureState.selectedTeamId) {
    window.sessionStorage.setItem('selected-team-id', fixtureState.selectedTeamId)
  }

  return true
}

export async function switchToMainAppWorkspace({ session, targetPath = '/coach' } = {}) {
  const mainOrigin = getOrigin(getMainAppOrigin())
  const currentOrigin = getOrigin(window.location.origin)
  const normalizedPath = String(targetPath || '/coach').startsWith('/') ? String(targetPath || '/coach') : `/${targetPath}`
  const targetUrl = `${mainOrigin}${normalizedPath}`

  if (!mainOrigin) {
    throw new Error('Staff access could not be opened. Try again or ask a club admin to review this account.')
  }

  if (mainOrigin === currentOrigin) {
    applyTeamAccessState()
    window.location.assign(targetUrl)
    return
  }

  const hasRuntimeSession = Boolean(session?.access_token && session?.refresh_token)
  const fixtureState = getFixtureBridgeState()

  if (!hasRuntimeSession && !fixtureState?.email) {
    throw new Error('Your secure session could not be transferred. Refresh the parent portal and try again.')
  }

  await new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('message', handleMessage)
      iframe.remove()
    }
    const handleMessage = (event) => {
      if (event.origin !== mainOrigin || event.source !== iframe.contentWindow) {
        return
      }

      if (event.data?.type === BRIDGE_READY) {
        iframe.contentWindow?.postMessage({
          type: BRIDGE_SESSION,
          session: hasRuntimeSession
            ? {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
              }
            : null,
          fixtureState,
        }, mainOrigin)
        return
      }

      if (event.data?.type === BRIDGE_COMPLETE) {
        cleanup()
        resolve()
        return
      }

      if (event.data?.type === BRIDGE_FAILED) {
        cleanup()
        reject(new Error('Your secure session could not be transferred. Refresh the parent portal and try again.'))
      }
    }
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('The staff platform took too long to open. Refresh and try again.'))
    }, BRIDGE_TIMEOUT_MS)

    iframe.hidden = true
    iframe.title = 'Secure workspace session transfer'
    iframe.src = `${mainOrigin}${BRIDGE_PATH}`
    window.addEventListener('message', handleMessage)
    document.body.appendChild(iframe)
  })

  window.location.assign(targetUrl)
}

export function WorkspaceSessionBridge() {
  const [message, setMessage] = useState('Preparing secure workspace access...')

  useEffect(() => {
    if (window.parent === window || !isTrustedParentOrigin(document.referrer)) {
      setMessage('This secure workspace handoff is only available from the parent portal.')
      return undefined
    }

    const parentOrigin = getOrigin(document.referrer)
    let isComplete = false

    const handleMessage = async (event) => {
      if (isComplete || event.origin !== parentOrigin || event.source !== window.parent || event.data?.type !== BRIDGE_SESSION) {
        return
      }

      try {
        if (!applyFixtureBridgeState(event.data.fixtureState)) {
          const accessToken = String(event.data.session?.access_token ?? '').trim()
          const refreshToken = String(event.data.session?.refresh_token ?? '').trim()

          if (!accessToken || !refreshToken) {
            throw new Error('Session details are missing.')
          }

          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })

          if (error) {
            throw error
          }

          applyTeamAccessState()
        }

        isComplete = true
        window.parent.postMessage({ type: BRIDGE_COMPLETE }, parentOrigin)
      } catch (error) {
        console.error(error)
        window.parent.postMessage({ type: BRIDGE_FAILED }, parentOrigin)
      }
    }

    window.addEventListener('message', handleMessage)
    window.parent.postMessage({ type: BRIDGE_READY }, parentOrigin)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7faf8] px-5 text-center">
      <p className="text-sm font-bold text-[#4b5f55]">{message}</p>
    </main>
  )
}
