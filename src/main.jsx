import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { router } from './app/router.jsx'
import GlobalInstallAppButton from './components/pwa/GlobalInstallAppButton.jsx'
import OfflineDraftSync from './components/pwa/OfflineDraftSync.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'
import { AuthProvider } from './lib/auth.js'
import { recoverFromStaleChunk } from './lib/chunkRecovery.js'
import './index.css'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  recoverFromStaleChunk(event.payload)
})

registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <OfflineDraftSync />
        <GlobalInstallAppButton />
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
)
