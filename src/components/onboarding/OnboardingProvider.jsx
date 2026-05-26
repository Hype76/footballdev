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

const eyebrowClass = 'text-[11px] font-black uppercase tracking-[0.18em] text-[#2563eb]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#475569]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2563eb] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 text-sm font-black text-[#0f172a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#3b82f6] hover:bg-[#eff6ff]'

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
          ? 'border-[#2563eb] bg-[#2563eb] text-white'
          : 'border-[#cbd5e1] bg-white text-[#475569]',
      ].join(' ')}
      aria-label={complete ? 'Complete' : 'Not complete'}
    >
      {complete ? 'OK' : index + 1}
    </span>
  )
}

function ConstraintRule({ body, title }) {
  return (
    <div className="rounded-lg border border-[#cbd5e1] bg-white px-4 py-4 shadow-sm shadow-[#2563eb]/10">
      <p className="text-sm font-black text-[#0f172a]">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{body}</p>
    </div>
  )
}

function SetupStepCard({ index, onComplete, step }) {
  return (
    <article
      className={[
        'rounded-lg border p-4 shadow-sm transition',
        step.complete
          ? 'border-[#cbd5e1] bg-[#eff6ff] shadow-[#2563eb]/10'
          : 'border-[#cbd5e1] bg-white shadow-[#2563eb]/10 hover:border-[#3b82f6]',
      ].join(' ')}
    >
      <div className="flex gap-3">
        <StepMarker complete={step.complete} index={index} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black leading-6 text-[#0f172a]">{step.title}</h3>
            <span
              className={[
                'rounded-lg border px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em]',
                step.complete
                  ? 'border-[#cbd5e1] bg-white text-[#1d4ed8]'
                  : 'border-[#fedf89] bg-[#fffbeb] text-[#93370d]',
              ].join(' ')}
            >
              {step.complete ? 'Ready' : 'Needed'}
            </span>
          </div>
          <p className="mt-2 text-sm font-black leading-6 text-[#475569]">{step.rule}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{step.detail}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link
              to={step.href}
              className={primaryButtonClass}
            >
              {step.actionLabel}
            </Link>
            {!step.complete ? (
              <button
                type="button"
                onClick={() => onComplete(step.id)}
                className="inline-flex min-h-10 min-w-[7rem] items-center justify-center rounded-lg border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-black text-[#0f172a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#3b82f6] hover:bg-[#eff6ff]"
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
    <section className="mb-6 overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>First run setup</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[#0f172a]">{plan.title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#475569]">
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
          <div className="mt-4 h-3 overflow-hidden rounded-lg bg-[#e0f2fe] ring-1 ring-[#cbd5e1]">
            <div
              className="h-full rounded-lg bg-[#2563eb] transition-all"
              style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>

        <aside className="border-t border-[#bfdbfe] bg-[#eff6ff] px-5 py-5 sm:px-6 lg:border-l lg:border-t-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#1d4ed8]">Next required action</p>
          <p className="mt-2 text-xl font-black leading-6 text-[#0f172a]">{nextStep?.title}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{nextStep?.detail}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Link
              to={nextStep?.href || plan.firstAction}
              className={primaryButtonClass}
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
        <section className="mb-6 overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
          <div className="border-b border-[#dbe6ef] bg-[#f8fbfd] px-5 py-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <p className={eyebrowClass}>First run setup</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-[#0f172a] sm:text-3xl">
                  {plan.title}
                </h2>
                <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#475569]">{plan.description}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)] xl:min-w-[34rem]">
                <div className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10">
                  <div className="flex items-center justify-between text-xs font-black uppercase tracking-[0.14em] text-[#475569]">
                    <span>Setup progress</span>
                    <span>{progress.completedCount} of {progress.totalCount}</span>
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-lg bg-[#e0f2fe] ring-1 ring-[#cbd5e1]">
                    <div
                      className="h-full rounded-lg bg-[#2563eb] transition-all"
                      style={{ width: `${progress.totalCount ? (progress.completedCount / progress.totalCount) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="mt-3 text-xs font-semibold leading-5 text-[#64748b]">
                    {isLoading ? 'Refreshing workspace data.' : 'Uses live workspace records where possible.'}
                  </p>
                </div>

                <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-4 shadow-sm shadow-[#1d4ed8]/10">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#1d4ed8]">Next action</p>
                  <p className="mt-2 text-lg font-black leading-6 text-[#0f172a]">{nextStep?.title}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Link to={nextStep?.href || plan.firstAction} className={primaryButtonClass}>
                      {nextStep?.actionLabel || 'Start setup'}
                    </Link>
                    <button type="button" onClick={handleDismiss} className={secondaryButtonClass}>
                      Skip for now
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ConstraintRule title="Use real club data" body="Create or confirm the records needed for this week of football." />
              <ConstraintRule title="Respect role limits" body="Only complete setup work this account is allowed to manage." />
              <ConstraintRule title="Do one real action" body="Each setup step should make the workspace ready for a real session, match, or parent update." />
            </div>
          </div>

          <div className="bg-white px-5 py-5 sm:px-6 lg:px-8">
            <div className="grid gap-3 lg:grid-cols-2">
              {plan.steps.map((step, index) => (
                <SetupStepCard key={step.id} index={index} onComplete={handleCompleteStep} step={step} />
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-[#cbd5e1] bg-white px-4 py-3 shadow-sm shadow-[#2563eb]/10 sm:flex-row sm:items-center sm:justify-between">
              <p className={bodyTextClass}>
                Skip pauses setup. Reset starts this first-run path again for a fresh club launch or testing.
              </p>
              <button
                type="button"
                onClick={handleReset}
                className={secondaryButtonClass}
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
        <section className="mb-6 rounded-lg border border-[#cbd5e1] bg-white px-4 py-4 shadow-sm shadow-[#2563eb]/10 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>Setup paused</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-[#0f172a]">{plan.title}</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#475569]">
                {progress.completedCount} of {progress.totalCount} setup checks are complete. Reopen setup when the club is ready to finish the next real action.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[24rem]">
              <Link
                to={nextStep?.href || plan.firstAction}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-black text-[#0f172a] shadow-sm shadow-[#2563eb]/10 transition hover:border-[#3b82f6] hover:bg-[#eff6ff]"
              >
                {nextStep?.actionLabel || 'Open next step'}
              </Link>
              <button
                type="button"
                onClick={handleReopen}
                className={primaryButtonClass}
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
