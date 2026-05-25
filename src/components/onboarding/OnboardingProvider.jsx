import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import {
  ONBOARDING_EVENT,
  buildOnboardingPlan,
  dismissOnboarding,
  getOnboardingProgress,
  loadOnboardingSnapshot,
  resetOnboarding,
  saveOnboardingStep,
} from '../../lib/onboarding.js'

function patchUserOnboarding(user, scope, patch = {}) {
  if (scope === 'workspace') {
    return {
      ...user,
      workspaceOnboardingCompletedSteps:
        patch.completedSteps ?? user.workspaceOnboardingCompletedSteps ?? [],
      workspaceOnboardingDismissedAt:
        patch.dismissedAt !== undefined ? patch.dismissedAt : user.workspaceOnboardingDismissedAt,
      workspaceOnboardingEnabled:
        patch.enabled !== undefined ? patch.enabled : user.workspaceOnboardingEnabled,
      workspaceOnboardingResetAt:
        patch.resetAt !== undefined ? patch.resetAt : user.workspaceOnboardingResetAt,
    }
  }

  return {
    ...user,
    userOnboardingCompletedSteps:
      patch.completedSteps ?? user.userOnboardingCompletedSteps ?? [],
    userOnboardingDismissedAt:
      patch.dismissedAt !== undefined ? patch.dismissedAt : user.userOnboardingDismissedAt,
    userOnboardingEnabled:
      patch.enabled !== undefined ? patch.enabled : user.userOnboardingEnabled,
    userOnboardingResetAt:
      patch.resetAt !== undefined ? patch.resetAt : user.userOnboardingResetAt,
  }
}

function StepStatus({ complete }) {
  return (
    <span
      className={[
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
        complete
          ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
          : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-muted)]',
      ].join(' ')}
      aria-label={complete ? 'Complete' : 'Not complete'}
    >
      {complete ? 'OK' : ''}
    </span>
  )
}

export function OnboardingProvider({ children }) {
  const { updateCurrentUserDetails, user } = useAuth()
  const [snapshot, setSnapshot] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [stateVersion, setStateVersion] = useState(0)

  useEffect(() => {
    let isMounted = true

    async function loadSnapshot() {
      if (!user?.id) {
        setSnapshot(null)
        return
      }

      setIsLoading(true)
      setErrorMessage('')

      try {
        const nextSnapshot = await loadOnboardingSnapshot(user)

        if (isMounted) {
          setSnapshot(nextSnapshot)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Setup progress could not be refreshed.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadSnapshot()

    const handleStateChange = () => {
      setStateVersion((current) => current + 1)
      void loadSnapshot()
    }

    window.addEventListener(ONBOARDING_EVENT, handleStateChange)

    return () => {
      isMounted = false
      window.removeEventListener(ONBOARDING_EVENT, handleStateChange)
    }
  }, [stateVersion, user, user?.activeTeamId, user?.clubId, user?.id])

  const plan = useMemo(() => buildOnboardingPlan(user, snapshot ?? {}), [snapshot, user])
  const progress = useMemo(() => getOnboardingProgress(plan), [plan])
  const shouldShowOnboarding = Boolean(
    plan &&
      plan.manualState?.enabled &&
      !plan.manualState?.dismissedAt &&
      !progress.isComplete,
  )

  const handleCompleteStep = async (stepId) => {
    if (!plan || !user) {
      return
    }

    try {
      await saveOnboardingStep({ scope: plan.scope, stepId, user })
      const currentSteps =
        plan.scope === 'workspace'
          ? user.workspaceOnboardingCompletedSteps ?? []
          : user.userOnboardingCompletedSteps ?? []
      updateCurrentUserDetails(
        patchUserOnboarding(user, plan.scope, {
          completedSteps: Array.from(new Set([...currentSteps, stepId])),
          dismissedAt: null,
        }),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage('This onboarding step could not be saved.')
    }
  }

  const handleDismiss = async () => {
    if (!plan || !user) {
      return
    }

    try {
      const dismissedAt = new Date().toISOString()
      await dismissOnboarding({ scope: plan.scope, user })
      updateCurrentUserDetails(patchUserOnboarding(user, plan.scope, { dismissedAt }))
    } catch (error) {
      console.error(error)
      setErrorMessage('Onboarding could not be skipped.')
    }
  }

  const handleReset = async () => {
    if (!plan || !user) {
      return
    }

    try {
      const resetAt = new Date().toISOString()
      await resetOnboarding({ scope: plan.scope, user })
      updateCurrentUserDetails(
        patchUserOnboarding(user, plan.scope, {
          completedSteps: [],
          dismissedAt: null,
          enabled: true,
          resetAt,
        }),
      )
    } catch (error) {
      console.error(error)
      setErrorMessage('Onboarding could not be reset.')
    }
  }

  return (
    <>
      {shouldShowOnboarding ? (
        <section className="mb-4 overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm shadow-slate-900/5">
          <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">First run setup</p>
                <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950">{plan.title}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">{plan.description}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Link
                  to={plan.firstAction}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700"
                >
                  Start setup
                </Link>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-emerald-50"
                >
                  Skip for now
                </button>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-emerald-800">
              {progress.completedCount} of {progress.totalCount} setup checks complete
              {isLoading ? ' | refreshing' : ''}
            </p>
          </div>

          <div className="grid gap-3 p-4 sm:p-5 xl:grid-cols-2">
            {plan.steps.map((step) => (
              <article
                key={step.id}
                className={[
                  'rounded-lg border p-4',
                  step.complete
                    ? 'border-emerald-100 bg-emerald-50/70'
                    : 'border-[var(--border-color)] bg-[var(--panel-bg)]',
                ].join(' ')}
              >
                <div className="flex gap-3">
                  <StepStatus complete={step.complete} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{step.rule}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-primary)]">{step.detail}</p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <Link
                        to={step.href}
                        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-3 py-2 text-sm font-bold text-[var(--text-primary)] transition hover:border-emerald-300 hover:bg-emerald-50"
                      >
                        {step.actionLabel}
                      </Link>
                      {!step.complete ? (
                        <button
                          type="button"
                          onClick={() => handleCompleteStep(step.id)}
                          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                        >
                          Mark done
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-[var(--border-color)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-sm text-[var(--text-muted)]">
              Onboarding uses real workspace data where possible. Manual steps are for rules or choices the system cannot infer.
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-bold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Reset setup
            </button>
          </div>

          {errorMessage ? (
            <div className="border-t border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)] sm:px-5">
              {errorMessage}
            </div>
          ) : null}
        </section>
      ) : null}
      {children}
    </>
  )
}
