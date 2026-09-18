import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const onboardingProviderUrl = new URL('../src/components/onboarding/OnboardingProvider.jsx', import.meta.url)
const onboardingLibUrl = new URL('../src/lib/onboarding.js', import.meta.url)
const phaseSetupGuideUrl = new URL('../src/components/setup/PhaseSetupGuide.jsx', import.meta.url)
const userFeedbackLinksUrl = new URL('../src/components/layout/UserFeedbackLinks.jsx', import.meta.url)

test('authenticated sidebar omits setup guide trigger but keeps feedback and sign-out actions', async () => {
  const [source, feedbackLinksSource] = await Promise.all([
    readFile(sidebarUrl, 'utf8'),
    readFile(userFeedbackLinksUrl, 'utf8'),
  ])

  assert.doesNotMatch(source, /Open setup guide/)
  assert.doesNotMatch(source, /openOnboarding/)
  assert.doesNotMatch(source, /canShowSetupGuide/)
  assert.match(feedbackLinksSource, /Feedback & Suggestions/)
  assert.match(feedbackLinksSource, /Report a Bug/)
  assert.match(feedbackLinksSource, /sidebar-user-feedback/)
  assert.match(feedbackLinksSource, /sidebar-tester-feedback/)
  assert.match(source, /Sign out/)
})

test('setup guide feature remains available outside the sidebar footer action', async () => {
  const [providerSource, onboardingSource, phaseSetupGuideSource] = await Promise.all([
    readFile(onboardingProviderUrl, 'utf8'),
    readFile(onboardingLibUrl, 'utf8'),
    readFile(phaseSetupGuideUrl, 'utf8'),
  ])

  assert.match(onboardingSource, /ONBOARDING_OPEN_EVENT/)
  assert.match(onboardingSource, /export async function reopenOnboarding/)
  assert.match(providerSource, /window\.addEventListener\(ONBOARDING_OPEN_EVENT, handleOpenOnboarding\)/)
  assert.match(providerSource, /shouldShowReopenOnboarding/)
  assert.match(providerSource, /Setup guide/)
  assert.match(phaseSetupGuideSource, /Setup guide/)
})
