import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import {
  WALKTHROUGH_EVENT,
  getWalkthroughForPath,
  getWalkthroughState,
  markWalkthroughComplete,
  setWalkthroughDisabled,
} from '../../lib/walkthrough.js'
import { WalkthroughContext } from './walkthrough-context.js'

function getRoleStep(user) {
  if (user?.role === 'super_admin') {
    return 'Review platform clubs, billing options, and platform feedback.'
  }

  if (user?.role === 'admin' && !user?.activeTeamId) {
    return 'Use the Club section for club-wide settings, then use Teams for team setup and team access.'
  }

  if (Number(user?.roleRank ?? 0) >= 50) {
    return 'Check team access, sessions, players, and development settings.'
  }

  return 'Start with Add Player, Sessions, and Players for your active team.'
}

function WalkthroughChecklist({ activeWalkthrough, onComplete, onDisable, user }) {
  const steps = activeWalkthrough?.steps ?? []
  const nextAction = activeWalkthrough?.action ?? null
  const focusStepTarget = (target) => {
    const targetElement = document.querySelector(`[data-tour-id="${target}"]`)

    if (!(targetElement instanceof HTMLElement)) {
      return
    }

    targetElement.setAttribute('tabindex', '-1')
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    targetElement.focus({ preventScroll: true })
    targetElement.classList.add('outline', 'outline-2', 'outline-offset-4', 'outline-[var(--accent)]')
    window.setTimeout(() => {
      targetElement.classList.remove('outline', 'outline-2', 'outline-offset-4', 'outline-[var(--accent)]')
    }, 1600)
  }

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-sm shadow-[#067a46]/10">
      <div className="bg-[#f6fbf8] p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#067a46]">Workspace rules</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-[#10231a]">Complete the next real setup step</h2>
          <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-[#456653]">{getRoleStep(user)}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {nextAction ? (
            nextAction.path ? (
              <Link
                to={nextAction.path}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-2 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a]"
              >
                {nextAction.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => focusStepTarget(nextAction.target)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-2 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a]"
              >
                {nextAction.label}
              </button>
            )
          ) : null}
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6]"
          >
            Mark complete
          </button>
          <button
            type="button"
            onClick={() => onDisable(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-2 text-sm font-black text-[#456653] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6]"
          >
            Hide tips
          </button>
        </div>
      </div>
      </div>
      <details className="border-t border-[#bddcca] bg-white">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black text-[#10231a] sm:px-5">
          View rules and targets
          <span className="text-xs font-black uppercase tracking-[0.12em] text-[#067a46]">{steps.length} steps</span>
        </summary>
        <div className="grid gap-3 border-t border-[#bddcca] bg-[#f6fbf8] p-3 md:grid-cols-2">
          {steps.map((step, index) => (
            <button
              key={`${activeWalkthrough.key}-${step.title}`}
              type="button"
              onClick={() => focusStepTarget(step.target)}
              className="rounded-lg border border-[#bddcca] bg-white p-4 text-left shadow-sm shadow-[#067a46]/10 transition hover:-translate-y-0.5 hover:border-[#20a464] hover:bg-white hover:shadow-md focus:border-[#20a464] focus:outline-none focus:ring-2 focus:ring-[#d7f8e5]"
            >
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Step {index + 1}</p>
              <h3 className="mt-2 text-sm font-black text-[#10231a]">{step.title}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{step.body}</p>
            </button>
          ))}
        </div>
      </details>
    </section>
  )
}

function resolveWalkthrough(pathname, user, walkthroughState) {
  if (!user || walkthroughState.disabled) {
    return null
  }

  if (user.role !== 'super_admin' && user.role !== 'admin' && !user.activeTeamId) {
    return null
  }

  const walkthrough = getWalkthroughForPath(pathname, user)

  if (!walkthrough || walkthroughState.completed?.[walkthrough.key]) {
    return null
  }

  return walkthrough
}

export function WalkthroughProvider({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  const [stateVersion, setStateVersion] = useState(0)
  const walkthroughState = useMemo(() => {
    void stateVersion
    return getWalkthroughState(user)
  }, [stateVersion, user])
  const activeWalkthrough = resolveWalkthrough(location.pathname, user, walkthroughState)

  useEffect(() => {
    const handleReset = () => setStateVersion((current) => current + 1)

    window.addEventListener(WALKTHROUGH_EVENT, handleReset)
    return () => window.removeEventListener(WALKTHROUGH_EVENT, handleReset)
  }, [])

  const completeWalkthrough = () => {
    if (activeWalkthrough?.key) {
      markWalkthroughComplete(user, activeWalkthrough.key)
    }

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
      {activeWalkthrough ? (
        <WalkthroughChecklist
          activeWalkthrough={activeWalkthrough}
          onComplete={completeWalkthrough}
          onDisable={contextValue.setDisabled}
          user={user}
        />
      ) : null}
      {children}
    </WalkthroughContext.Provider>
  )
}
