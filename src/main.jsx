import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router.jsx'
import InstallPrompt from './components/pwa/InstallPrompt.jsx'
import OfflineDraftSync from './components/pwa/OfflineDraftSync.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'
import { AuthProvider } from './lib/auth.js'
import { recoverFromStaleChunk } from './lib/chunkRecovery.js'
import './index.css'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  recoverFromStaleChunk(event.payload)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <OfflineDraftSync />
        <InstallPrompt />
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
)
