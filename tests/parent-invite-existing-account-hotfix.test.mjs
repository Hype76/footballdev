import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parse } from '@babel/parser'
import {
  buildParentInviteAcceptancePath,
  buildParentInviteLoginPath,
  buildParentInviteSuccessPath,
  getParentInviteToken,
  isParentInviteSignInIntent,
  isParentInviteAccountMismatch,
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

test('authenticated invite landing keeps the session until the user chooses account recovery', async () => {
  const source = await readFile(parentInvitePageUrl, 'utf8')

  assert.match(source, /continueExistingSession/)
  assert.match(source, /canRenderOnCurrentHost = isParentHost \|\| getMainAppOrigin\(\) === window\.location\.origin/)
  assert.match(source, /window\.location\.replace\(buildCurrentParentFlowUrl\(buildParentInviteAcceptancePath\(token\), isParentHost\)\)/)
  const page = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(node => node.declaration?.id?.name === 'ParentInvitePage').declaration
  for (const statement of page.body.body) {
    if (statement.expression?.callee?.name === 'useEffect') assert.doesNotMatch(source.slice(statement.start, statement.end), /signOut\(/)
  }
  assert.doesNotMatch(source, /sessionEmail.*inviteEmail/s)
})

test('forwarded invitation recovery preserves the exact token on the current app host', () => {
  const token = 'invite/token+value'
  for (const parentHost of [false, true]) {
    const url = new URL(buildParentInviteLoginPath(token, parentHost), 'https://example.com')
    assert.equal(url.pathname, parentHost ? '/parent-login' : '/sign-in')
    assert.equal(url.searchParams.get('parentInvite'), token)
  }
  assert.equal(isParentInviteAccountMismatch('This Parent app link is for a different email address.'), true)
  assert.equal(isParentInviteAccountMismatch('This Parent app link is already connected to another account.'), true)
  assert.equal(isParentInviteAccountMismatch('This invitation has expired.'), false)
})

test('explicit account recovery waits for sign-out, retains the invite and allows retry after failure', async () => {
  const source = await readFile(parentInvitePageUrl, 'utf8')
  const page = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(node => node.declaration?.id?.name === 'ParentInvitePage').declaration
  const handler = page.body.body.flatMap(node => node.declarations || []).find(node => node.id.name === 'handleSwitchAccount').init
  const createHandler = new Function('submitLockRef', 'setIsSubmitting', 'setSwitchAccountError', 'signOut', 'window', 'buildCurrentParentFlowUrl', 'buildParentInviteLoginPath', 'token', 'isParentHost', `return (${source.slice(handler.start, handler.end)})`)
  for (const fail of [false, true]) {
    const calls = []; const lock = { current: false }
    const run = createHandler(lock, value => calls.push(['busy', value]), value => calls.push(['error', value]), async () => { calls.push(['signOut']); if (fail) throw new Error('offline') }, { location: { assign: url => calls.push(['navigate', url]) } }, path => path, buildParentInviteLoginPath, 'opaque-token', false)
    assert.deepEqual(calls, [])
    await run()
    assert.equal(lock.current, false)
    if (fail) { assert.ok(!calls.some(c => c[0] === 'navigate')); assert.ok(calls.some(c => c[0] === 'error' && c[1].includes('try again'))) }
    else { assert.ok(calls.findIndex(c => c[0] === 'navigate') > calls.findIndex(c => c[0] === 'signOut')); assert.equal(new URL(calls.find(c => c[0] === 'navigate')[1], 'https://example.com').searchParams.get('parentInvite'), 'opaque-token') }
  }
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
  assert.match(source, /title="Player linked"/)
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
