import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sources = {
  calendar: new URL('../src/pages/SessionsPage.jsx', import.meta.url),
  createEvaluation: new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
  doc: new URL('../docs/architecture/v1-regression-firewall-and-feature-preservation-rule.md', import.meta.url),
  emailBuilder: new URL('../src/lib/email-builder.js', import.meta.url),
  feedbackForms: new URL('../src/pages/FeedbackFormsPage.jsx', import.meta.url),
  layout: new URL('../src/components/layout/Layout.jsx', import.meta.url),
  matchDay: new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
  navigation: new URL('../src/app/navigation.js', import.meta.url),
  parentDomain: new URL('../src/lib/domain/parent-portal.js', import.meta.url),
  parentInviteFunction: new URL('../netlify/functions/send-parent-portal-invite.js', import.meta.url),
  parentLogin: new URL('../src/pages/ParentLoginPage.jsx', import.meta.url),
  parentPortal: new URL('../src/pages/ParentPortalPage.jsx', import.meta.url),
  platformDeleteFunction: new URL('../netlify/functions/platform-delete-team.js', import.meta.url),
  roleQuickLinks: new URL('../src/lib/role-quick-links.js', import.meta.url),
  router: new URL('../src/app/router.jsx', import.meta.url),
  safety: new URL('../scripts/netlify-deploy-safety-check.mjs', import.meta.url),
  sidebar: new URL('../src/components/layout/Sidebar.jsx', import.meta.url),
}

async function readSource(key) {
  return readFile(sources[key], 'utf8')
}

test('V1 regression firewall source note names the protected release rules', async () => {
  const doc = await readSource('doc')

  assert.match(doc, /# V1 Regression Firewall and Feature Preservation Rule/)
  assert.match(doc, /V1 must not remove approved live behaviour unless Steve explicitly asks\./)
  assert.match(doc, /Branch lineage must be checked before deploy\./)
  assert.match(doc, /Current production source must be verified before deploy\./)
  assert.match(doc, /Recovery must preserve emergency fixes and newer approved work\./)
  assert.match(doc, /An older branch must not be deployed directly to recover a feature\./)
  assert.match(doc, /Missing approved behaviour is a blocker, not a cosmetic issue\./)
})

test('Feedback Forms remains visible and Development Fields direct route stays preserved', async () => {
  const [router, navigation, sidebar, roleQuickLinks, createEvaluation, feedbackForms] = await Promise.all([
    readSource('router'),
    readSource('navigation'),
    readSource('sidebar'),
    readSource('roleQuickLinks'),
    readSource('createEvaluation'),
    readSource('feedbackForms'),
  ])

  assert.match(router, /path: 'feedback-forms'/)
  assert.match(router, /path: 'form-builder'/)
  assert.match(router, /function RequireFeedbackFormsAccess/)
  assert.match(router, /function RequireFormBuilderAccess/)
  assert.match(navigation, /label: 'Feedback Forms'[\s\S]*path: '\/feedback-forms'/)
  assert.doesNotMatch(navigation, /label: 'Development Fields'[\s\S]*path: '\/form-builder'/)
  assert.match(sidebar, /canManageFeedbackForms\(displayUser\)/)
  assert.match(sidebar, /'\/form-builder': 'fields'/)
  assert.match(roleQuickLinks, /label: 'Feedback Forms', path: '\/feedback-forms'/)
  assert.doesNotMatch(roleQuickLinks, /label: 'Development Fields', path: '\/form-builder'/)
  assert.match(createEvaluation, /getActiveFeedbackForms/)
  assert.match(createEvaluation, /Choose a form/)
  assert.match(feedbackForms, /Create form/)
  assert.match(feedbackForms, /Duplicate/)
  assert.match(feedbackForms, /Archive/)
  assert.match(feedbackForms, /Historical responses stay readable\./)
})

test('parent invite flow avoids duplicate staff email and supports existing parent sign-in', async () => {
  const [sendFunction, emailBuilder, parentDomain, parentLogin] = await Promise.all([
    readSource('parentInviteFunction'),
    readSource('emailBuilder'),
    readSource('parentDomain'),
    readSource('parentLogin'),
  ])

  assert.match(sendFunction, /copySender = false/)
  assert.match(sendFunction, /copySender === true \? getSenderCopyEmails\(senderEmail, recipient\) : \[\]/)
  assert.match(sendFunction, /replyTo: safeReplyTo \|\| undefined/)
  assert.match(parentDomain, /\.eq\('status', 'active'\)[\s\S]*\.in\('email', emails\)/)
  assert.match(parentDomain, /existingParentPortalUser: existingActiveParentEmails\.has/)
  assert.match(emailBuilder, /existingParentPortalUser = false/)
  assert.match(emailBuilder, /Sign in to parent portal/)
  assert.match(emailBuilder, /\/parent-login\?parentInvite=/)
  assert.match(parentLogin, /window\.location\.assign\(buildParentAppUrl\(`\/parent-invite\/\$\{parentInviteToken\}\?accept=1`\)\)/)
})

test('calendar and Match Day approved actions remain present', async () => {
  const [layout, calendar, matchDay, parentPortal] = await Promise.all([
    readSource('layout'),
    readSource('calendar'),
    readSource('matchDay'),
    readSource('parentPortal'),
  ])

  assert.match(layout, /function QuickActionHotbar/)
  assert.match(layout, /setQuickActionPosition/)
  assert.match(layout, /saveQuickActionPosition/)
  assert.match(calendar, /eventType: 'training'/)
  assert.match(calendar, /eventType: 'match'/)
  assert.match(calendar, /const eventType = \(isClubWideCalendar \|\| calendarOnly\) \? 'general' : defaultForm\.eventType/)
  assert.match(calendar, /eventType,/)
  assert.match(calendar, /Move or reschedule/)
  assert.match(calendar, /Cancel fixture/)
  assert.match(calendar, /Save changes/)
  assert.match(matchDay, /fetch\('\/\.netlify\/functions\/send-match-day-availability-requests'/)
  assert.match(matchDay, /Selected:/)
  assert.match(matchDay, /Not selected, another volunteer selected/)
  assert.match(matchDay, /Not available/)
  assert.match(matchDay, /No response/)
  assert.match(parentPortal, /Volunteer role status/)
  assert.match(parentPortal, /You have been selected as \$\{roleLabel\} for this fixture\./)
  assert.match(parentPortal, /Another volunteer has been selected\./)
  assert.match(parentPortal, /The team has not selected anyone yet\./)
})

test('production preservation guards stay present before deploy', async () => {
  const [safety, platformDeleteFunction] = await Promise.all([
    readSource('safety'),
    readSource('platformDeleteFunction'),
  ])

  assert.match(safety, /liveProjectRef = 'hvapkizujvsahvgspser'/)
  assert.match(safety, /legacyStagingProjectRef = 'llpufwzvgxyczxcjwupu'/)
  assert.match(safety, /V1 staging deploy safety checks are retired/)
  assert.match(safety, /Production prep requires the exact deploy command to be reviewed\./)
  assert.match(safety, /Unexpected legacy staging Supabase ref appears in a live-target build\./)
  assert.match(platformDeleteFunction, /export async function handler/)
  assert.match(platformDeleteFunction, /createSupabaseAdminClient/)
  assert.match(platformDeleteFunction, /verifyPlatformAdminPassword/)
  assert.match(platformDeleteFunction, /delete_platform_team_transaction/)
})
