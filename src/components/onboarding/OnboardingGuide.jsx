import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  getVisibleOnboardingSteps,
  readDismissedOnboarding,
  writeDismissedOnboarding,
} from '../../lib/onboarding.js'
import { useAuth } from '../../lib/auth.js'
import { getPlanKey } from '../../lib/plans.js'
import { updateOwnOnboardingSettings } from '../../lib/supabase.js'

function findTargetRect(target) {
  const element = document.querySelector(`[data-onboarding="${target}"]`)

  if (!element) {
    return null
  }

  return element.getBoundingClientRect()
}

export function OnboardingGuide() {
  const { authUser, updateCurrentUserDetails, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState(null)
  const [hiddenUserId, setHiddenUserId] = useState('')
  const [restartCount, setRestartCount] = useState(0)
  const planKey = getPlanKey(user)
  const steps = useMemo(() => getVisibleOnboardingSteps({ user, planKey }), [planKey, user])
  const currentStep = steps[stepIndex] ?? null
  const isEnabled = user?.onboardingEnabled !== false
  const isVisible = Boolean(
    user?.id &&
      hiddenUserId !== user.id &&
      isEnabled &&
      steps.length > 0 &&
      !readDismissedOnboarding(user),
  )

  useEffect(() => {
    const handleRestart = () => {
      setHiddenUserId('')
      setStepIndex(0)
      setRestartCount((current) => current + 1)
    }

    window.addEventListener('player-feedback:onboarding-restart', handleRestart)

    return () => {
      window.removeEventListener('player-feedback:onboarding-restart', handleRestart)
    }
  }, [])

  useEffect(() => {
    if (!isVisible || !currentStep) {
      return undefined
    }

    const updateTarget = () => {
      setTargetRect(findTargetRect(currentStep.target))
    }

    const frame = window.requestAnimationFrame(updateTarget)
    window.addEventListener('resize', updateTarget)
    window.addEventListener('scroll', updateTarget, true)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateTarget)
      window.removeEventListener('scroll', updateTarget, true)
    }
  }, [currentStep, isVisible, location.pathname, restartCount])

  if (!isVisible || !currentStep) {
    return null
  }

  const handleClose = async () => {
    writeDismissedOnboarding(user)
    setHiddenUserId(user?.id || '')

    try {
      const updatedProfile = await updateOwnOnboardingSettings({
        authUser,
        enabled: false,
      })
      updateCurrentUserDetails(updatedProfile)
    } catch (error) {
      console.error(error)
    }
  }

  const handleNext = () => {
    const nextIndex = stepIndex + 1

    if (nextIndex >= steps.length) {
      void handleClose()
      return
    }

    setStepIndex(nextIndex)
    if (steps[nextIndex]?.path && steps[nextIndex].path !== location.pathname) {
      navigate(steps[nextIndex].path)
    }
  }

  const handleBack = () => {
    const nextIndex = Math.max(0, stepIndex - 1)
    setStepIndex(nextIndex)

    if (steps[nextIndex]?.path && steps[nextIndex].path !== location.pathname) {
      navigate(steps[nextIndex].path)
    }
  }

  const handleOpenTarget = () => {
    if (currentStep.path && currentStep.path !== location.pathname) {
      navigate(currentStep.path)
    }
  }

  const tooltipStyle = targetRect
    ? {
        left: Math.min(Math.max(targetRect.left, 16), window.innerWidth - 360),
        top: Math.min(targetRect.bottom + 12, window.innerHeight - 240),
      }
    : {
        left: 16,
        bottom: 16,
      }

  return (
    <div className="fixed inset-0 z-[65] pointer-events-none">
      {targetRect ? (
        <div
          className="absolute rounded-2xl border-2 border-[var(--accent)] shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]"
          style={{
            left: targetRect.left - 4,
            top: targetRect.top - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        className="pointer-events-auto fixed w-[calc(100vw-2rem)] max-w-sm rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 shadow-2xl shadow-black/40"
        style={tooltipStyle}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{currentStep.title}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{currentStep.body}</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleOpenTarget}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]"
          >
            Open
          </button>
          <button
            type="button"
            onClick={handleBack}
            disabled={stepIndex === 0}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)]"
          >
            {stepIndex + 1 >= steps.length ? 'Done' : 'Next'}
          </button>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-2 text-xs font-semibold text-[var(--text-muted)]"
        >
          Turn off onboarding
        </button>
      </div>
    </div>
  )
}
