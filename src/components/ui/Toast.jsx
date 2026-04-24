import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext(null)

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
      ? 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)]'
      : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)]'

  return (
    <div className={`rounded-[20px] border px-4 py-3 shadow-lg shadow-black/20 ${toneClassName}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.message ? <p className="mt-1 text-sm leading-5 opacity-90">{toast.message}</p> : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-xl border border-current/20 text-sm font-semibold"
          aria-label="Dismiss notification"
        >
          x
        </button>
      </div>
    </div>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }

  return context
}
