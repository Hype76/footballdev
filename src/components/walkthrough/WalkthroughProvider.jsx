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
    return 'Check team access, sessions, players, and assessment settings.'
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
    <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Next best action</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Set up this workspace</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{getRoleStep(user)}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {nextAction ? (
            nextAction.path ? (
              <Link
                to={nextAction.path}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800"
              >
                {nextAction.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => focusStepTarget(nextAction.target)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-800"
              >
                {nextAction.label}
              </button>
            )
          ) : null}
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-50"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => onDisable(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          >
            Hide tips
          </button>
        </div>
      </div>
      <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-bold text-slate-950">
          View setup tips
          <span className="text-xs font-black uppercase tracking-[0.12em] text-emerald-700">{steps.length} steps</span>
        </summary>
        <div className="grid gap-3 border-t border-slate-200 p-3 md:grid-cols-2">
          {steps.map((step, index) => (
            <button
              key={`${activeWalkthrough.key}-${step.title}`}
              type="button"
              onClick={() => focusStepTarget(step.target)}
              className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50 focus:border-emerald-500 focus:outline-none"
            >
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Step {index + 1}</p>
              <h3 className="mt-2 text-sm font-bold text-slate-950">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
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
