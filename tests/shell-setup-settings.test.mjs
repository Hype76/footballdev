import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const userSettingsUrl = new URL('../src/pages/UserSettingsPage.jsx', import.meta.url)
const setupSettingsSectionUrl = new URL('../src/components/user-settings/SetupChecklistSettingsSection.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const onboardingProviderUrl = new URL('../src/components/onboarding/OnboardingProvider.jsx', import.meta.url)

test('normal logged-in pages suppress the setup panel before page content', async () => {
  const source = await readFile(layoutUrl, 'utf8')

  assert.match(source, /const shouldSuppressOnboardingSetup = location\.pathname !== '\/user-settings'/)
  assert.match(source, /<OnboardingProvider suppressSetup=\{shouldSuppressOnboardingSetup\}>/)
  assert.doesNotMatch(source, /const shouldSuppressOnboardingSetup = false/)
})

test('settings owns setup progress and non-reset reopen access', async () => {
  const source = await readFile(userSettingsUrl, 'utf8')

  assert.match(source, /buildOnboardingPlan/)
  assert.match(source, /getOnboardingProgress/)
  assert.match(source, /loadOnboardingSnapshot/)
  assert.match(source, /openOnboarding/)
  assert.match(source, /<SetupChecklistSettingsSection/)
  assert.match(source, /plan=\{onboardingPlan\}/)
  assert.match(source, /progress=\{onboardingProgress\}/)
  assert.match(source, /nextStep=\{onboardingNextStep\}/)
  assert.match(source, /onOpen=\{handleOpenSetup\}/)
  assert.doesNotMatch(source, /resetOnboarding/)
  assert.doesNotMatch(source, /handleRestartSetup/)
})

test('team setup settings section shows progress next step and reopen controls', async () => {
  const source = await readFile(setupSettingsSectionUrl, 'utf8')

  assert.match(source, /title="Team setup"/)
  assert.match(source, /data-testid="settings-team-setup"/)
  assert.match(source, /Setup hidden/)
  assert.match(source, /Setup status/)
  assert.match(source, /\$\{completedCount\} of \$\{totalCount\} setup steps complete/)
  assert.match(source, /Next setup step/)
  assert.match(source, /Reopen setup/)
  assert.match(source, /Settings is now the home for setup progress/)
  assert.doesNotMatch(source, /shows it above the page again/)
})

test('settings remains reachable from sidebar while onboarding engine remains available', async () => {
  const [sidebarSource, providerSource] = await Promise.all([
    readFile(sidebarUrl, 'utf8'),
    readFile(onboardingProviderUrl, 'utf8'),
  ])

  assert.match(sidebarSource, /data-tour-id="sidebar-user-settings"/)
  assert.match(sidebarSource, /to="\/user-settings"/)
  assert.match(sidebarSource, /Sign out/)
  assert.match(sidebarSource, /Access view/)
  assert.match(providerSource, /window\.addEventListener\(ONBOARDING_OPEN_EVENT, handleOpenOnboarding\)/)
  assert.match(providerSource, /suppressSetup \|\| !isClubAdminSetup/)
  assert.match(providerSource, /!\s*suppressSetup && isClubAdminSetup && isClubAdminWizardOpen/)
  assert.match(providerSource, /shouldShowReopenOnboarding/)
  assert.match(providerSource, /Reopen setup/)
})
