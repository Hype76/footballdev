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
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xs font-black',
        complete
          ? 'border-[#067a46] bg-[#067a46] text-white'
          : 'border-[#9addb4] bg-white text-[#456653]',
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
        <section className="mb-6 overflow-hidden rounded-lg border border-[#b7efce] bg-white shadow-sm shadow-[#d7eadf]/80">
          <div className="border-b border-[#d7f8e5] bg-white px-5 py-5 sm:px-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#067a46]">First run setup</p>
                <h2 className="mt-2 max-w-4xl text-3xl font-black leading-[1.08] tracking-tight text-[#101828] sm:text-4xl">{plan.title}</h2>
                <p className="mt-3 max-w-3xl text-base font-semibold leading-7 text-[#456653]">{plan.description}</p>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <SetupRule title="Use real data" body="Create or confirm the football records the club needs this week." />
                  <SetupRule title="Respect access" body="Only complete setup work this account is allowed to manage." />
                  <SetupRule title="Keep it practical" body="Skip workflows the club does not use and reset setup later if needed." />
                </div>
              </div>
              <div className="grid content-between rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] p-5 shadow-sm shadow-[#d7eadf]/80">
                <div className="flex items-center justify-between text-xs font-black uppercase tracking-[0.14em] text-[#5f7468]">
                  <span>Launch checks</span>
                  <span>{progress.completedCount} of {progress.totalCount}</span>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-lg bg-white ring-1 ring-[#bfe8cd]">
                  <div
                    className="h-full rounded-lg bg-[#067a46] transition-all"
                    style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-xs font-bold text-[#5f7468]">
                  {isLoading ? 'Refreshing real workspace data.' : 'Checked against workspace data where possible.'}
                </p>
                <div className="mt-5 rounded-lg border border-[#b7efce] bg-[#f0fdf6] px-4 py-3">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">Next action</p>
                  <p className="mt-1 text-lg font-black text-[#101828]">{nextStep?.title}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-0 xl:grid-cols-[minmax(20rem,0.62fr)_minmax(0,1fr)]">
            <div className="border-b border-[#bfe8cd] bg-[#f8fdf9] p-5 sm:p-6 xl:border-b-0 xl:border-r">
              <div className="rounded-lg border border-[#b7efce] bg-[#f0fdf6] p-4 shadow-sm shadow-[#b7efce]">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Next useful action</p>
                <h3 className="mt-2 text-lg font-black text-[#101828]">{nextStep?.title}</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{nextStep?.detail}</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row xl:flex-col 2xl:flex-row">
                  <Link
                    to={nextStep?.href || plan.firstAction}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#b7efce] transition hover:bg-[#05603a]"
                  >
                    {nextStep?.actionLabel || 'Start setup'}
                  </Link>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-[#f0fdf6]"
                  >
                    Skip for now
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-[#fedf89] bg-[#fffbeb] px-4 py-3">
                <p className="text-sm font-black text-[#93370d]">Rules before features</p>
                <p className="mt-1 text-sm leading-6 text-[#93370d]">
                  This setup asks for only the data needed to run football this week. Complete a real action, or mark it done when your club does not use that workflow.
                </p>
              </div>
            </div>

            <div className="bg-white p-4 sm:p-5">
              <div className="grid gap-3 lg:grid-cols-2">
                {plan.steps.map((step, index) => (
                  <article
                    key={step.id}
                    className={[
                      'rounded-lg border p-4 shadow-sm transition',
                      step.complete
                        ? 'border-[#b7efce] bg-[#f0fdf6]'
                        : 'border-[#bfe8cd] bg-white',
                    ].join(' ')}
                  >
                    <div className="flex gap-3">
                      <StepMarker complete={step.complete} index={index} />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-black text-[#101828]">{step.title}</h3>
                        <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{step.rule}</p>
                        <p className="mt-2 text-sm leading-6 text-[#456653]">{step.detail}</p>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <Link
                            to={step.href}
                            className="inline-flex min-h-10 min-w-[7rem] items-center justify-center rounded-lg bg-[#067a46] px-4 py-2 text-sm font-black text-white transition hover:bg-[#05603a]"
                          >
                            {step.actionLabel}
                          </Link>
                          {!step.complete ? (
                            <button
                              type="button"
                              onClick={() => handleCompleteStep(step.id)}
                              className="inline-flex min-h-10 min-w-[7rem] items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-4 py-2 text-sm font-black text-[#101828] transition hover:bg-[#f0fdf6]"
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

              <div className="mt-4 flex flex-col gap-2 rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 shadow-sm shadow-[#d7eadf]/70 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-[#5f7468]">
                  Reset brings the checklist back for testing or a fresh club launch.
                </p>
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-3 py-2 text-sm font-black text-[#101828] transition hover:bg-[#f0fdf6]"
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

function SetupRule({ body, title }) {
  return (
    <div className="rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
      <p className="text-sm font-black text-[#101828]">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{body}</p>
    </div>
  )
}
