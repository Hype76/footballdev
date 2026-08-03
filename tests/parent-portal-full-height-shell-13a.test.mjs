import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [layoutSource, shellSource, portalSource, shellPolicySource] = await Promise.all([
  readFile(new URL('../src/components/layout/Layout.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ParentPortalPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/parent-portal-shell.js', import.meta.url), 'utf8'),
])

test('desktop Family Portal owns one bounded viewport without document scrolling', () => {
  assert.match(layoutSource, /isParentPortalShell[\s\S]*lg:flex lg:h-dvh lg:min-h-0 lg:flex-col lg:overflow-hidden/)
  assert.match(layoutSource, /lg:min-h-0 lg:flex-1 lg:overflow-hidden/)
  assert.match(layoutSource, /lg:h-full lg:min-h-0/)
  assert.match(shellSource, /lg:h-full lg:min-h-0 lg:space-y-0 lg:pb-0/)
  assert.match(shellSource, /lg:h-full lg:min-h-0 lg:grid-cols-/)
})

test('desktop sidebar and content use separate single scroll regions', () => {
  assert.match(shellSource, /flex h-full min-h-0 flex-col overflow-hidden/)
  assert.match(shellSource, /grid h-full min-h-0 gap-2 overflow-y-auto overscroll-contain/)
  assert.match(shellSource, /<nav aria-label="Parent portal sections" className=\{variant === 'desktop' \? 'min-h-0 flex-1 overflow-hidden'/)
  assert.match(shellSource, /mt-auto shrink-0 border-t/)
  assert.match(shellSource, /<main className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain/)
})

test('mobile keeps natural page flow with a safe-area reachable action bar', () => {
  assert.match(shellSource, /fixed inset-x-0 bottom-0/)
  assert.match(shellSource, /max-h-\[38dvh\] overflow-y-auto/)
  assert.match(shellSource, /pb-\[max\(0\.5rem,env\(safe-area-inset-bottom\)\)\]/)
  assert.match(shellSource, /pb-\[var\(--parent-portal-mobile-nav-content-padding,18rem\)\]/)
  assert.match(shellSource, /variant === 'mobile' && canOpenTeamWorkspace \? 'grid grid-cols-2 gap-2'/)
  assert.match(shellSource, /min-h-11/)
})

test('dashboard uses the shared shell and the server-authoritative staff return option', () => {
  assert.match(portalSource, /<ParentPortalRouteShell/)
  assert.match(portalSource, /onSelectedParentLinkChange=\{handleParentLinkSelect\}/)
  assert.match(shellSource, /getParentPortalStaffReturnMode\(\{ accessModeOptions, user \}\)/)
  assert.match(shellSource, /selectAccessMode\('team', \{ deferCommit: true \}\)/)
  assert.equal(shellPolicySource.includes("Return to staff platform"), true)
  assert.doesNotMatch(shellPolicySource, /Back to club workspace/)
})

test('Phase 13A focused files contain no em dash characters', () => {
  for (const source of [layoutSource, shellSource, portalSource, shellPolicySource]) {
    assert.doesNotMatch(source, /\u2014/)
  }
})
