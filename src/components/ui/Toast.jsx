import { useCallback, useMemo, useState } from 'react'
import { ToastContext } from './toast-context.js'

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId))
  }, [])

  const showToast = useCallback(({ title, message = '', tone = 'success' }) => {
    const toastId = `${Date.now()}-${Math.random().toString(16).slice(2)}`

    setToasts((current) => [
      ...current,
      {
        id: toastId,
        title,
        message,
        tone,
      },
    ])

    window.setTimeout(() => {
      dismissToast(toastId)
    }, 3500)
  }, [dismissToast])

  const value = useMemo(
    () => ({
      showToast,
    }),
    [showToast],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <ToastMessage key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastMessage({ toast, onDismiss }) {
  const toneClassName =
    toast.tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-emerald-200 bg-white text-slate-950'

  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClassName}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.message ? <p className="mt-1 text-sm leading-5 opacity-90">{toast.message}</p> : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-current/20 text-sm font-semibold"
          aria-label="Dismiss notification"
        >
          x
        </button>
      </div>
    </div>
  )
}
