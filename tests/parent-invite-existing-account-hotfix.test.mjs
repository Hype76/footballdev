import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  buildParentInviteAcceptancePath,
  buildParentInviteSuccessPath,
  getParentInviteToken,
  isParentInviteSignInIntent,
} from '../src/lib/parent-auth-intent.js'

const loginPageUrl = new URL('../src/pages/LoginPage.jsx', import.meta.url)
const parentInvitePageUrl = new URL('../src/pages/ParentInvitePage.jsx', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)

test('parent invite intent keeps the opaque token and builds the authoritative acceptance route', () => {
  assert.equal(getParentInviteToken('?tab=parent&parentInvite=invite%2Ftoken%2Bvalue'), 'invite/token+value')
  assert.equal(buildParentInviteAcceptancePath('invite/token+value'), '/parent-invite/invite%2Ftoken%2Bvalue?accept=1')
  assert.equal(buildParentInviteAcceptancePath('  '), '')
  assert.equal(isParentInviteSignInIntent({ pathname: '/sign-in', search: '?parentInvite=token' }), true)
  assert.equal(isParentInviteSignInIntent({ pathname: '/sign-in', search: '?tab=parent' }), false)
  assert.equal(isParentInviteSignInIntent({ pathname: '/', search: '?parentInvite=token' }), false)
})

test('successful invite acceptance targets the newly linked child with a visible success marker', () => {
  assert.equal(buildParentInviteSuccessPath('new-child-link'), '/parent-portal?linked=1&parentLinkId=new-child-link')
  assert.equal(buildParentInviteSuccessPath(), '/parent-portal?linked=1')
})

test('unified sign-in gives parent invitation intent priority over default workspace routing', async () => {
  const [loginSource, routerSource] = await Promise.all([
    readFile(loginPageUrl, 'utf8'),
    readFile(routerUrl, 'utf8'),
  ])

  assert.match(routerSource, /isParentIntentPath\(location\.pathname\) \|\| isParentInviteSignInIntent\(location\)/)
  assert.match(loginSource, /session\?\.user && !parentInviteRedirectStartedRef\.current/)
  assert.match(loginSource, /window\.location\.replace\(buildParentInviteAcceptancePath\(nextParentInviteToken\)\)/)
  assert.match(loginSource, /window\.location\.assign\(buildParentInviteAcceptancePath\(parentInviteToken\)\)/)
  assert.doesNotMatch(loginSource, /window\.location\.assign\(`\/parent-invite\/\$\{parentInviteToken\}`\)/)
})

test('authenticated invite landing keeps the session and delegates wrong-account rejection to the RPC', async () => {
  const source = await readFile(parentInvitePageUrl, 'utf8')

  assert.match(source, /continueExistingSession/)
  assert.match(source, /canRenderOnCurrentHost = isParentHost \|\| getMainAppOrigin\(\) === window\.location\.origin/)
  assert.match(source, /window\.location\.replace\(buildCurrentParentFlowUrl\(buildParentInviteAcceptancePath\(token\), isParentHost\)\)/)
  assert.doesNotMatch(source, /await signOut\(\)/)
  assert.doesNotMatch(source, /sessionEmail.*inviteEmail/s)
})

test('main-site login completes acceptance without moving the session to another origin', async () => {
  const source = await readFile(parentInvitePageUrl, 'utf8')

  assert.match(source, /function buildCurrentParentFlowUrl\(path, isParentHost\)/)
  assert.match(source, /return isParentHost \? buildParentAppUrl\(path\) : path/)
  assert.match(source, /buildCurrentParentFlowUrl\(buildParentInviteSuccessPath\(link\.id\), isParentHost\)/)
})

test('acceptance has one app call, waits for its result, then refreshes parent access before navigation', async () => {
  const [inviteSource, domainSource] = await Promise.all([
    readFile(parentInvitePageUrl, 'utf8'),
    readFile(parentPortalDomainUrl, 'utf8'),
  ])
  const acceptanceCalls = inviteSource.match(/acceptParentPortalInvite\(token\)/g) ?? []

  assert.equal(acceptanceCalls.length, 1)
  assert.match(inviteSource, /const link = await acceptParentPortalInvite\(token\)/)
  assert.match(inviteSource, /await selectAccessMode\('parent'\)[\s\S]*buildParentInviteSuccessPath\(link\.id\)/)
  assert.doesNotMatch(inviteSource, /withTimeout\(\s*acceptParentPortalInvite/)
  assert.match(domainSource, /supabase\.rpc\('accept_parent_player_link', \{\s*invite_token_value: token,\s*\}\)/)
})

test('parent portal selects the accepted child and shows a clear success state', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /links\.find\(\(link\) => link\.id === selectedLinkId\)/)
  assert.match(source, /links\.some\(\(link\) => link\.id === requestedParentLinkId\)/)
  assert.match(source, /searchParams\.get\('linked'\) === '1'/)
  assert.match(source, /title="Child linked"/)
  assert.match(source, /is now available in your family portal/)
})

test('hotfix sources do not log invitation tokens or browser session secrets', async () => {
  const sources = await Promise.all([
    readFile(loginPageUrl, 'utf8'),
    readFile(parentInvitePageUrl, 'utf8'),
    readFile(routerUrl, 'utf8'),
  ])

  for (const source of sources) {
    assert.doesNotMatch(source, /console\.(?:log|info|debug)\([^\n]*(?:parentInvite|inviteToken|access_token|refresh_token)/i)
  }
})
