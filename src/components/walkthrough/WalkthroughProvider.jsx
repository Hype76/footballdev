import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import {
  WALKTHROUGH_EVENT,
  getWalkthroughForPath,
  getWalkthroughState,
  markWalkthroughComplete,
  setWalkthroughDisabled,
} from '../../lib/walkthrough.js'

const WalkthroughContext = createContext(null)

function getElementRect(targetId) {
  const target = document.querySelector(`[data-tour-id="${targetId}"]`)

  if (!target) {
    return null
  }

  target.scrollIntoView({
    block: 'center',
    inline: 'center',
    behavior: 'smooth',
  })

  const rect = target.getBoundingClientRect()

  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }

  return {
    top: Math.max(rect.top - 8, 8),
    left: Math.max(rect.left - 8, 8),
    width: Math.min(rect.width + 16, window.innerWidth - Math.max(rect.left - 8, 8) - 8),
    height: Math.min(rect.height + 16, window.innerHeight - Math.max(rect.top - 8, 8) - 8),
  }
}

function getTooltipStyle(rect) {
  if (!rect) {
    return {
      left: 16,
      top: 16,
      right: 16,
    }
  }

  const tooltipWidth = Math.min(360, window.innerWidth - 32)
  const hasSpaceBelow = rect.top + rect.height + 24 + 220 < window.innerHeight
  const top = hasSpaceBelow ? rect.top + rect.height + 16 : Math.max(16, rect.top - 236)
  const preferredLeft = rect.left + rect.width + 16 < window.innerWidth - tooltipWidth
    ? rect.left + rect.width + 16
    : rect.left
  const left = Math.min(Math.max(preferredLeft, 16), window.innerWidth - tooltipWidth - 16)

  return {
    left,
    top,
    width: tooltipWidth,
  }
}

function WalkthroughOverlay({
  activeStep,
  currentIndex,
  onBack,
  onFinish,
  onNext,
  onSkip,
  rect,
  totalSteps,
}) {
  const tooltipStyle = getTooltipStyle(rect)
  const topHeight = rect ? rect.top : 0
  const leftWidth = rect ? rect.left : 0
  const rightLeft = rect ? rect.left + rect.width : 0
  const bottomTop = rect ? rect.top + rect.height : 0

  return (
    <div className="fixed inset-0 z-[90]">
      {rect ? (
        <>
          <div className="absolute left-0 right-0 top-0 bg-black/70" style={{ height: topHeight }} />
          <div
            className="absolute bg-black/70"
            style={{
              left: 0,
              top: rect.top,
              width: leftWidth,
              height: rect.height,
            }}
          />
          <div
            className="absolute bg-black/70"
            style={{
              left: rightLeft,
              top: rect.top,
              right: 0,
              height: rect.height,
            }}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-black/70" style={{ top: bottomTop }} />
          <div
            className="pointer-events-none absolute rounded-[24px] border-2 border-[var(--accent)] shadow-[0_0_0_4px_rgba(255,255,255,0.08),0_0_36px_rgba(203,255,51,0.35)]"
            style={rect}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}

      <div
        className="absolute rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 shadow-2xl shadow-black/50 sm:p-5"
        style={tooltipStyle}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
          Step {currentIndex + 1} of {totalSteps}
        </p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-[var(--text-primary)]">{activeStep.title}</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{activeStep.body}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)]"
          >
            Skip
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onBack}
              disabled={currentIndex === 0}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={currentIndex + 1 >= totalSteps ? onFinish : onNext}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-text)]"
            >
              {currentIndex + 1 >= totalSteps ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function WalkthroughProvider({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  const [activeWalkthrough, setActiveWalkthrough] = useState(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [stateVersion, setStateVersion] = useState(0)
  const walkthroughState = useMemo(() => getWalkthroughState(user), [stateVersion, user])
  const activeStep = activeWalkthrough?.steps?.[currentIndex]

  useEffect(() => {
    const handleReset = () => setStateVersion((current) => current + 1)

    window.addEventListener(WALKTHROUGH_EVENT, handleReset)
    return () => window.removeEventListener(WALKTHROUGH_EVENT, handleReset)
  }, [])

  useEffect(() => {
    if (!user || walkthroughState.disabled) {
      setActiveWalkthrough(null)
      return undefined
    }

    if (user.role !== 'super_admin' && user.role !== 'admin' && !user.activeTeamId) {
      setActiveWalkthrough(null)
      return undefined
    }

    const walkthrough = getWalkthroughForPath(location.pathname, user)

    if (!walkthrough || walkthroughState.completed?.[walkthrough.key]) {
      setActiveWalkthrough(null)
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setActiveWalkthrough(walkthrough)
      setCurrentIndex(0)
    }, 350)

    return () => window.clearTimeout(timeoutId)
  }, [location.pathname, user, walkthroughState.completed, walkthroughState.disabled])

  useEffect(() => {
    if (!activeStep) {
      setRect(null)
      return undefined
    }

    let frameId = 0

    const updateRect = () => {
      setRect(getElementRect(activeStep.target))
    }

    frameId = window.requestAnimationFrame(updateRect)
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [activeStep])

  const completeWalkthrough = () => {
    if (activeWalkthrough?.key) {
      markWalkthroughComplete(user, activeWalkthrough.key)
    }

    setActiveWalkthrough(null)
    setCurrentIndex(0)
    setStateVersion((current) => current + 1)
  }

  const contextValue = useMemo(
    () => ({
      disabled: walkthroughState.disabled,
      setDisabled: (disabled) => {
        setWalkthroughDisabled(user, disabled)
        setStateVersion((current) => current + 1)
      },
    }),
    [user, walkthroughState.disabled],
  )

  return (
    <WalkthroughContext.Provider value={contextValue}>
      {children}
      {activeWalkthrough && activeStep ? (
        <WalkthroughOverlay
          activeStep={activeStep}
          currentIndex={currentIndex}
          onBack={() => setCurrentIndex((current) => Math.max(0, current - 1))}
          onFinish={completeWalkthrough}
          onNext={() => setCurrentIndex((current) => Math.min(activeWalkthrough.steps.length - 1, current + 1))}
          onSkip={completeWalkthrough}
          rect={rect}
          totalSteps={activeWalkthrough.steps.length}
        />
      ) : null}
    </WalkthroughContext.Provider>
  )
}

export function useWalkthrough() {
  return useContext(WalkthroughContext)
}
