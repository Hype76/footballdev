import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import {
  ONBOARDING_EVENT,
  buildOnboardingPlan,
  dismissOnboarding,
  getOnboardingProgress,
  loadOnboardingSnapshot,
  reopenOnboarding,
  resetOnboarding,
  saveOnboardingStep,
} from '../../lib/onboarding.js'

const eyebrowClass = 'text-[11px] font-black uppercase tracking-[0.18em] text-[#067a46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#456653]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6]'

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
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-xs font-black',
        complete
          ? 'border-[#067a46] bg-[#067a46] text-white'
          : 'border-[#bddcca] bg-white text-[#456653]',
      ].join(' ')}
      aria-label={complete ? 'Complete' : 'Not complete'}
    >
      {complete ? 'OK' : index + 1}
    </span>
  )
}

function ConstraintRule({ body, title }) {
  return (
    <div className="rounded-lg border border-[#bddcca] bg-white px-4 py-4 shadow-sm shadow-[#067a46]/10">
      <p className="text-sm font-black text-[#10231a]">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{body}</p>
    </div>
  )
}

function SetupStepCard({ index, onComplete, step }) {
  return (
    <article
      className={[
        'rounded-lg border p-4 shadow-sm transition',
        step.complete
          ? 'border-[#bddcca] bg-[#f0fdf6] shadow-[#067a46]/10'
          : 'border-[#bddcca] bg-white shadow-[#067a46]/10 hover:border-[#20a464]',
      ].join(' ')}
    >
      <div className="flex gap-3">
        <StepMarker complete={step.complete} index={index} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black leading-6 text-[#10231a]">{step.title}</h3>
            <span
              className={[
                'rounded-lg border px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em]',
                step.complete
                  ? 'border-[#bddcca] bg-white text-[#067647]'
                  : 'border-[#fedf89] bg-[#fffbeb] text-[#93370d]',
              ].join(' ')}
            >
              {step.complete ? 'Ready' : 'Needed'}
            </span>
          </div>
          <p className="mt-2 text-sm font-black leading-6 text-[#456653]">{step.rule}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{step.detail}</p>
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
                onClick={() => onComplete(step.id)}
                className="inline-flex min-h-10 min-w-[7rem] items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6]"
              >
                Confirm not needed
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

function CompactOnboardingPanel({
  errorMessage,
  handleDismiss,
  handleReopenFull,
  handleReset,
  isLoading,
  nextStep,
  plan,
  progress,
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-sm shadow-[#067a46]/10">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>First run setup</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[#10231a]">{plan.title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#456653]">
                {isLoading ? 'Refreshing workspace data.' : `${progress.completedCount} of ${progress.totalCount} setup checks are complete.`}
              </p>
            </div>
            <div className="grid shrink-0 gap-2 sm:grid-cols-2 md:min-w-[17rem]">
              <button
                type="button"
                onClick={handleReopenFull}
                className={secondaryButtonClass}
              >
                View checklist
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className={secondaryButtonClass}
              >
                Skip for now
              </button>
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-lg bg-[#eef8f2] ring-1 ring-[#bddcca]">
            <div
              className="h-full rounded-lg bg-[#067a46] transition-all"
              style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>

        <aside className="border-t border-[#bfdbfe] bg-[#eff6ff] px-5 py-5 sm:px-6 lg:border-l lg:border-t-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#1d4ed8]">Next required action</p>
          <p className="mt-2 text-xl font-black leading-6 text-[#10231a]">{nextStep?.title}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{nextStep?.detail}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Link
              to={nextStep?.href || plan.firstAction}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a]"
            >
              {nextStep?.actionLabel || 'Start setup'}
            </Link>
            <button
              type="button"
              onClick={handleReset}
              className={secondaryButtonClass}
            >
              Reset setup
            </button>
          </div>
        </aside>
      </div>

      {errorMessage ? (
        <div className="border-t border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] sm:px-5">
          {errorMessage}
        </div>
      ) : null}
    </section>
  )
}

export function OnboardingProvider({ children }) {
  const location = useLocation()
  const { updateCurrentUserDetails, user } = useAuth()
  const [snapshot, setSnapshot] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [showFullSetup, setShowFullSetup] = useState(false)
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
  const shouldShowReopenOnboarding = Boolean(
    plan &&
      plan.manualState?.enabled &&
      plan.manualState?.dismissedAt &&
      !progress.isComplete,
  )
  const currentPath = location.pathname || '/'
  const fullSetupPaths = new Set(['/', '/coach', '/club-settings', '/user-settings'])
  const shouldUseFullSetup = showFullSetup || fullSetupPaths.has(currentPath)

  useEffect(() => {
    setShowFullSetup(false)
  }, [currentPath, user?.id])

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

  const handleReopen = async () => {
    if (!plan || !user) {
      return
    }

    try {
      await reopenOnboarding({ scope: plan.scope, user })
      updateCurrentUserDetails(patchUserOnboarding(user, plan.scope, { dismissedAt: null, enabled: true }))
    } catch (error) {
      console.error(error)
      setErrorMessage('Onboarding could not be reopened.')
    }
  }

  return (
    <>
      {shouldShowOnboarding && !shouldUseFullSetup ? (
        <CompactOnboardingPanel
          errorMessage={errorMessage}
          handleDismiss={handleDismiss}
          handleReopenFull={() => setShowFullSetup(true)}
          handleReset={handleReset}
          isLoading={isLoading}
          nextStep={nextStep}
          plan={plan}
          progress={progress}
        />
      ) : null}
      {shouldShowOnboarding && shouldUseFullSetup ? (
        <section className="mb-6 overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-sm shadow-[#067a46]/10">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="px-5 py-6 sm:px-6 lg:px-8">
              <p className={eyebrowClass}>First run setup</p>
              <h2 className="mt-3 max-w-5xl text-4xl font-black leading-[1.05] tracking-tight text-[#10231a] sm:text-5xl">
                {plan.title}
              </h2>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#456653]">{plan.description}</p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <ConstraintRule title="Use real club data" body="Create or confirm the records needed for this week of football." />
                <ConstraintRule title="Respect role limits" body="Only complete setup work this account is allowed to manage." />
                <ConstraintRule title="Do one real action" body="Every setup step should leave the workspace more useful than before." />
              </div>
            </div>

            <aside className="grid content-between border-t border-[#bddcca] bg-[#f0fdf6] p-5 sm:p-6 xl:border-l xl:border-t-0">
              <div>
                <div className="flex items-center justify-between text-xs font-black uppercase tracking-[0.14em] text-[#456653]">
                  <span>Setup progress</span>
                  <span>{progress.completedCount} of {progress.totalCount}</span>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-lg bg-white ring-1 ring-[#d8e3ee]">
                  <div
                    className="h-full rounded-lg bg-[#1d4ed8] transition-all"
                    style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-3 text-sm font-semibold leading-6 text-[#456653]">
                  {isLoading ? 'Refreshing workspace data.' : 'Progress uses real workspace data where possible.'}
                </p>
              </div>
              <div className="mt-5 rounded-lg border border-[#bfdbfe] bg-white p-4 shadow-sm shadow-[#1d4ed8]/10">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#1d4ed8]">Next required action</p>
                <p className="mt-2 text-xl font-black leading-6 text-[#10231a]">{nextStep?.title}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{nextStep?.detail}</p>
                <div className="mt-4 grid gap-2">
                  <Link
                    to={nextStep?.href || plan.firstAction}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a]"
                  >
                    {nextStep?.actionLabel || 'Start setup'}
                  </Link>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className={secondaryButtonClass}
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </aside>
          </div>

          <div className="border-t border-[#bddcca] bg-[#f6fbf8] px-5 py-5 sm:px-6 lg:px-8">
            <div className="grid gap-3 lg:grid-cols-2">
              {plan.steps.map((step, index) => (
                <SetupStepCard key={step.id} index={index} onComplete={handleCompleteStep} step={step} />
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-[#bddcca] bg-white px-4 py-3 shadow-sm shadow-[#067a46]/10 sm:flex-row sm:items-center sm:justify-between">
              <p className={bodyTextClass}>
                Skip pauses setup. Reset starts this first-run path again for a fresh club launch or testing.
              </p>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-3 py-2 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6]"
              >
                Reset setup
              </button>
            </div>
          </div>

          {errorMessage ? (
            <div className="border-t border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] sm:px-5">
              {errorMessage}
            </div>
          ) : null}
        </section>
      ) : null}
      {shouldShowReopenOnboarding ? (
        <section className="mb-6 rounded-lg border border-[#bddcca] bg-white px-4 py-4 shadow-sm shadow-[#067a46]/10 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>Setup paused</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-[#10231a]">{plan.title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#456653]">
                {progress.completedCount} of {progress.totalCount} setup checks are complete. Reopen setup when the club is ready to finish the next real action.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[24rem]">
              <Link
                to={nextStep?.href || plan.firstAction}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6]"
              >
                {nextStep?.actionLabel || 'Open next step'}
              </Link>
              <button
                type="button"
                onClick={handleReopen}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#05603a]"
              >
                Reopen setup
              </button>
            </div>
          </div>
          {errorMessage ? (
            <div className="mt-3 rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]">
              {errorMessage}
            </div>
          ) : null}
        </section>
      ) : null}
      {children}
    </>
  )
}
