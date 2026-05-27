import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router.jsx'
import { TestSiteBanner } from './components/layout/TestSiteBanner.jsx'
import { AppUpdatePrompt } from './components/pwa/AppUpdatePrompt.jsx'
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

if (import.meta.env.MODE === 'production') {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh() {
        window.dispatchEvent(new Event('football-player:update-ready'))
      },
    })

    window.footballPlayerApplyUpdate = () => updateServiceWorker(true)
  })
} else if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister()
    })
  })

  if ('caches' in window) {
    void caches.keys().then((cacheNames) => {
      cacheNames
        .filter((cacheName) => cacheName.includes('workbox') || cacheName.includes('app-navigation'))
        .forEach((cacheName) => {
          void caches.delete(cacheName)
        })
    })
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <TestSiteBanner />
        <OfflineDraftSync />
        <AppUpdatePrompt />
        <GlobalInstallAppButton />
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
)
