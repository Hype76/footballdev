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

registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload()
  },
})

function TestSiteBanner() {
  const isTestSite = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'

  if (!isTestSite) {
    return null
  }

  return (
    <div className="sticky top-0 z-[1000] border-b-2 border-[#7f1d1d] bg-[#dc2626] px-4 py-2 text-center text-sm font-black uppercase tracking-[0.22em] text-white shadow-lg shadow-black/25">
      Test Site Only. Not Live.
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <TestSiteBanner />
        <OfflineDraftSync />
        <GlobalInstallAppButton />
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
)
