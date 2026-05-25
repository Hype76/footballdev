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

function StepMarker({ index, complete }) {
  return (
    <span
      className={[
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-xs font-black',
        complete
          ? 'border-emerald-200 bg-emerald-600 text-white'
          : 'border-slate-200 bg-white text-slate-500',
      ].join(' ')}
      aria-label={complete ? 'Complete' : 'Not complete'}
    >
      {complete ? 'OK' : index + 1}
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
  const nextStep = plan?.steps?.find((step) => !step.complete) ?? plan?.steps?.[0]
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
        <section className="mb-6 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm shadow-slate-200/80">
          <div className="grid gap-0 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1fr)]">
            <div className="border-b border-slate-200 bg-slate-950 p-5 text-white sm:p-6 xl:border-b-0 xl:border-r">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-300">First run setup</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight">{plan.title}</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">{plan.description}</p>

              <div className="mt-5 rounded-3xl border border-white/10 bg-white/10 p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Next useful action</p>
                <h3 className="mt-2 text-lg font-black">{nextStep?.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{nextStep?.detail}</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row xl:flex-col 2xl:flex-row">
                  <Link
                    to={nextStep?.href || plan.firstAction}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-50"
                  >
                    {nextStep?.actionLabel || 'Start setup'}
                  </Link>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/20 bg-transparent px-4 py-3 text-sm font-black text-white transition hover:bg-white/10"
                  >
                    Skip for now
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-xs font-black uppercase tracking-[0.16em] text-slate-300">
                  <span>Progress</span>
                  <span>{progress.completedCount} of {progress.totalCount}</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all"
                    style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-300">
                  {isLoading ? 'Refreshing real workspace data.' : 'Checked against workspace data where possible.'}
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="mb-4 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-black text-amber-950">Rules before features</p>
                <p className="mt-1 text-sm leading-6 text-amber-900">
                  This setup asks for only the data needed to run football this week. Complete a real action, or mark it done when your club does not use that workflow.
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {plan.steps.map((step, index) => (
                  <article
                    key={step.id}
                    className={[
                      'rounded-3xl border p-4 shadow-sm transition',
                      step.complete
                        ? 'border-emerald-200 bg-emerald-50 shadow-emerald-100/70'
                        : 'border-slate-200 bg-white shadow-slate-200/70',
                    ].join(' ')}
                  >
                    <div className="flex gap-3">
                      <StepMarker complete={step.complete} index={index} />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-black text-slate-950">{step.title}</h3>
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{step.rule}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-900">{step.detail}</p>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <Link
                            to={step.href}
                            className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-slate-950 px-3 py-2 text-sm font-black text-white transition hover:bg-slate-800"
                          >
                            {step.actionLabel}
                          </Link>
                          {!step.complete ? (
                            <button
                              type="button"
                              onClick={() => handleCompleteStep(step.id)}
                              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50"
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

              <div className="mt-4 flex flex-col gap-2 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-slate-600">
                  Reset brings the checklist back for testing or a fresh club launch.
                </p>
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-900 transition hover:bg-slate-100"
                >
                  Reset setup
                </button>
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className="border-t border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-900 sm:px-5">
              {errorMessage}
            </div>
          ) : null}
        </section>
      ) : null}
      {children}
    </>
  )
}
