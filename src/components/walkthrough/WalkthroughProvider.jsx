import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import { getRoleNextAction } from '../../lib/role-quick-links.js'
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
    return 'Create teams, add staff logins, then allocate staff to teams.'
  }

  if (Number(user?.roleRank ?? 0) >= 50) {
    return 'Check team access, sessions, players, and assessment settings.'
  }

  return 'Start with Add Player, Sessions, and Players for your active team.'
}

function WalkthroughChecklist({ activeWalkthrough, onComplete, onDisable, user }) {
  const steps = activeWalkthrough?.steps ?? []
  const nextAction = getRoleNextAction(user)
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
    <section className="mb-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Next best action</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text-primary)]">Set up this workspace</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{getRoleStep(user)}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {nextAction ? (
            <Link
              to={nextAction.path}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-text)]"
            >
              {nextAction.label}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)]"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => onDisable(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-2 text-sm font-semibold text-[var(--text-muted)]"
          >
            Hide tips
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {steps.map((step, index) => (
          <button
            key={`${activeWalkthrough.key}-${step.title}`}
            type="button"
            onClick={() => focusStepTarget(step.target)}
            className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-left transition hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:border-[var(--accent)] focus:outline-none"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Step {index + 1}</p>
            <h3 className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{step.title}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{step.body}</p>
          </button>
        ))}
      </div>
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
