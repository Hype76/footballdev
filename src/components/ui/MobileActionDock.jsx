import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  MOBILE_ACTION_DOCK_LAYOUT_EVENT,
  MOBILE_ACTION_DOCK_PREFERENCE_EVENT,
  MOBILE_ACTION_DOCK_STORAGE_KEY,
  isMobileVirtualKeyboardOpen,
  readMobileActionDockCollapsed,
  writeMobileActionDockCollapsed,
} from '../../lib/mobile-action-dock.js'

const visibilityByBreakpoint = {
  lg: {
    desktop: 'hidden lg:flex',
    mobile: 'lg:hidden',
  },
  sm: {
    desktop: 'hidden sm:flex',
    mobile: 'sm:hidden',
  },
}

function announceLayoutChange() {
  window.dispatchEvent(new CustomEvent(MOBILE_ACTION_DOCK_LAYOUT_EVENT))
}

function getStatusLabel({ hasError, hasUnsavedChanges }) {
  if (hasError && hasUnsavedChanges) return 'Error and unsaved changes'
  if (hasError) return 'Error'
  if (hasUnsavedChanges) return 'Unsaved changes'
  return ''
}

export function MobileActionDock({
  actionsClassName = '',
  attentionKey = '',
  breakpoint = 'lg',
  children,
  desktopClassName = '',
  hasError = false,
  hasUnsavedChanges = false,
  label = 'Page actions',
  mode = 'page',
  onAttentionFocus,
  renderDesktop = true,
  testId = 'mobile-action-dock',
}) {
  const dockId = useId()
  const collapseButtonRef = useRef(null)
  const expandButtonRef = useRef(null)
  const pendingFocusRef = useRef('')
  const [isCollapsed, setIsCollapsed] = useState(readMobileActionDockCollapsed)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const visibility = visibilityByBreakpoint[breakpoint] || visibilityByBreakpoint.lg
  const statusLabel = getStatusLabel({ hasError, hasUnsavedChanges })

  const setCollapsedPreference = useCallback((nextCollapsed, { focus = true } = {}) => {
    setIsCollapsed(nextCollapsed)
    writeMobileActionDockCollapsed(nextCollapsed)
    window.dispatchEvent(new CustomEvent(MOBILE_ACTION_DOCK_PREFERENCE_EVENT, {
      detail: { collapsed: nextCollapsed },
    }))
    setAnnouncement(nextCollapsed ? 'Actions collapsed' : 'Actions expanded')
    pendingFocusRef.current = focus ? (nextCollapsed ? 'expand' : 'collapse') : ''
  }, [])

  useEffect(() => {
    const syncPreference = (event) => {
      const nextCollapsed = event.type === 'storage'
        ? readMobileActionDockCollapsed()
        : Boolean(event.detail?.collapsed)
      setIsCollapsed(nextCollapsed)
    }

    window.addEventListener('storage', syncPreference)
    window.addEventListener(MOBILE_ACTION_DOCK_PREFERENCE_EVENT, syncPreference)
    return () => {
      window.removeEventListener('storage', syncPreference)
      window.removeEventListener(MOBILE_ACTION_DOCK_PREFERENCE_EVENT, syncPreference)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.mobileActionDockState = isCollapsed ? 'collapsed' : 'expanded'
    announceLayoutChange()

    return () => {
      if (root.dataset.mobileActionDockState === (isCollapsed ? 'collapsed' : 'expanded')) {
        delete root.dataset.mobileActionDockState
        announceLayoutChange()
      }
    }
  }, [isCollapsed])

  useEffect(() => {
    if (!attentionKey) return undefined
    const frame = window.requestAnimationFrame(() => {
      setCollapsedPreference(false, { focus: false })
      onAttentionFocus?.()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [attentionKey, onAttentionFocus, setCollapsedPreference])

  useEffect(() => {
    if (!pendingFocusRef.current) return
    const target = pendingFocusRef.current === 'expand' ? expandButtonRef.current : collapseButtonRef.current
    pendingFocusRef.current = ''
    window.requestAnimationFrame(() => target?.focus())
  }, [isCollapsed])

  useEffect(() => {
    if (mode !== 'page') return undefined
    const updateKeyboardState = () => setIsKeyboardOpen(isMobileVirtualKeyboardOpen())
    const viewport = window.visualViewport

    viewport?.addEventListener('resize', updateKeyboardState)
    viewport?.addEventListener('scroll', updateKeyboardState)
    window.addEventListener('resize', updateKeyboardState)
    document.addEventListener('focusin', updateKeyboardState)
    document.addEventListener('focusout', updateKeyboardState)
    updateKeyboardState()

    return () => {
      viewport?.removeEventListener('resize', updateKeyboardState)
      viewport?.removeEventListener('scroll', updateKeyboardState)
      window.removeEventListener('resize', updateKeyboardState)
      document.removeEventListener('focusin', updateKeyboardState)
      document.removeEventListener('focusout', updateKeyboardState)
    }
  }, [mode])

  const status = statusLabel ? (
    <span className="inline-flex min-h-7 items-center rounded-full border border-current px-2 py-1 text-[0.68rem] font-black leading-tight" data-testid="mobile-action-dock-status">
      {statusLabel}
    </span>
  ) : null

  const expandedClassName = mode === 'contained'
    ? `shrink-0 border-t border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${visibility.mobile}`
    : `fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-color)] bg-[var(--panel-bg)]/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl backdrop-blur ${visibility.mobile}`
  const collapsedClassName = mode === 'contained'
    ? `shrink-0 flex justify-end border-t border-[var(--border-color)] bg-[var(--panel-bg)] py-2 pl-3 pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] ${visibility.mobile}`
    : `fixed right-0 z-40 ${visibility.mobile}`

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      {isCollapsed ? (
        <div
          id={dockId}
          className={`${collapsedClassName} ${isKeyboardOpen ? 'pointer-events-none translate-x-full opacity-0' : 'transition duration-150 motion-reduce:transition-none'}`}
          style={mode === 'page' ? { bottom: 'max(var(--mobile-action-dock-edge-gap), env(safe-area-inset-bottom))' } : undefined}
          data-mobile-action-dock="collapsed"
          data-mobile-action-dock-mode={mode}
          data-testid={testId}
        >
          <button
            ref={expandButtonRef}
            type="button"
            aria-controls={dockId}
            aria-expanded="false"
            aria-label={`Expand actions${statusLabel ? `, ${statusLabel.toLowerCase()}` : ''}`}
            onClick={() => setCollapsedPreference(false)}
            className="flex min-h-12 min-w-12 max-w-28 flex-col items-center justify-center gap-0.5 rounded-l-xl border border-r-0 border-[var(--border-color)] bg-[var(--panel-bg)] px-2 py-2 text-[var(--text-primary)] shadow-xl transition hover:bg-[var(--panel-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none"
          >
            <span aria-hidden="true" className="text-lg font-black leading-none">&lt;</span>
            {status}
          </button>
        </div>
      ) : (
        <div
          id={dockId}
          aria-label={label}
          className={`${expandedClassName} ${isKeyboardOpen ? 'pointer-events-none translate-y-full opacity-0' : 'transition duration-150 motion-reduce:transition-none'}`}
          data-mobile-action-dock="expanded"
          data-mobile-action-dock-mode={mode}
          data-testid={testId}
        >
          {status ? <div className="mx-auto mb-1 flex max-w-3xl items-center text-[var(--text-primary)]">{status}</div> : null}
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <div className={`min-w-0 flex-1 ${actionsClassName}`}>{children}</div>
            <button
              ref={collapseButtonRef}
              type="button"
              aria-controls={dockId}
              aria-expanded="true"
              aria-label="Collapse actions"
              onClick={() => setCollapsedPreference(true)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-3 text-sm font-black text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none"
            >
              <span aria-hidden="true">v</span>
              <span className="sr-only">Collapse actions</span>
            </button>
          </div>
        </div>
      )}
      {renderDesktop ? (
        <div className={`${visibility.desktop} ${desktopClassName}`} data-mobile-action-dock-desktop="true">
          {children}
        </div>
      ) : null}
    </>
  )
}

export { MOBILE_ACTION_DOCK_STORAGE_KEY }
