import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const pageUrl = new URL('../src/pages/InformationPage.jsx', import.meta.url)

test('information route defaults to one compact overview topic', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /searchParams\.get\('topic'\) \|\| 'overview'/)
  assert.match(source, /aria-label="Information topics"/)
  assert.match(source, /activeTopic === 'overview'/)
  assert.match(source, /activeTopic === 'videos'/)
  assert.match(source, /activeTopic === 'plans'/)
  assert.match(source, /<details className=/)
})

test('video and plan libraries open one focused record with a clear Back path', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /searchParams\.get\('guide'\)/)
  assert.match(source, /searchParams\.get\('plan'\)/)
  assert.match(source, /<VideoGuideCard guide=\{selectedGuide\}/)
  assert.match(source, /<PlanCard plan=\{selectedPlan\}/)
  assert.match(source, /backLabel="Back to video guides"/)
  assert.match(source, /backLabel="Back to plan list"/)
})

test('role, plan, billing, platform and quick-link capabilities remain available', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /getRoleQuickLinks\(user\)/)
  assert.match(source, /getPlanLimit\(user, 'players'\)/)
  assert.match(source, /getPlanLimit\(user, 'monthlyEvaluations'\)/)
  assert.match(source, /canUseUiFeature\(user, CAPABILITIES\.parentEmails\)/)
  assert.match(source, /platformAdminGuide\.map/)
  assert.match(source, /activeTopic === 'billing' && platformMode/)
  assert.match(source, /<QuickLinks links=\{quickLinks\} compact/)
})

test('focused navigation is URL stable and does not introduce a mutation path', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /setSearchParams\(next\)/)
  assert.match(source, /next\.set\(key, value\)/)
  assert.doesNotMatch(source, /from ['"]\.\.\/lib\/supabase|sendParentEmail|createCheckoutSession|\.insert\(\{|\.update\(\{/i)
})
