import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router.jsx'
import { AuthProvider } from './lib/auth.js'
import './index.css'

const STALE_CHUNK_RELOAD_KEY = 'stale-chunk-reload-attempted'

function reloadAfterChunkFailure() {
  try {
    if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) === 'true') {
      sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY)
      return
    }

    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, 'true')
  } catch (error) {
    console.error(error)
  }

  window.location.reload()
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault?.()
  reloadAfterChunkFailure()
})

window.addEventListener('unhandledrejection', (event) => {
  const message = String(event.reason?.message ?? event.reason ?? '')

  if (!message.includes('Failed to fetch dynamically imported module')) {
    return
  }

  event.preventDefault()
  reloadAfterChunkFailure()
})

window.addEventListener('load', () => {
  try {
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY)
  } catch (error) {
    console.error(error)
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
