import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const code = 'FP-0123456789ABCDEF'
const userId = '10000000-0000-4000-8000-000000000001', clubId = '20000000-0000-4000-8000-000000000002', teamId = '30000000-0000-4000-8000-000000000003'
const authUser = { id: userId, email: 'signup@example.test', email_confirmed_at: '2026-10-15T08:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { name: 'Test Coach', club_name: 'FP TEST Referral', signup_plan_key: 'matchday', account_type: 'coach', club_signup_intent: { code, teamCapacity: 20, offerKey: 'club_20' } } }
const club = { id: clubId, name: 'FP TEST Referral', status: 'active', plan_key: 'matchday', plan_status: 'active', matchday_free_forever: true, workspace_owner_user_id: userId }
const profile = { id: userId, email: authUser.email, name: 'Test Coach', username: 'Test Coach', role: 'head_manager', role_label: 'Team Admin', role_rank: 70, club_id: clubId, status: 'active', onboarding_enabled: false }
const team = { id: teamId, club_id: clubId, name: club.name, archived_at: null }
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture-signature`
process.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES = 'false'
process.env.VITE_SUPABASE_URL = 'https://referral.example.test'
process.env.VITE_SUPABASE_ANON_KEY = 'fixture-anon-key'
process.env.VITE_PAYMENTS_DISABLED = 'false'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch()
let debugPage
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  debugPage = page
  page.setDefaultTimeout(15000)
  const errors = [], signups = [], signupRedirects = [], checkouts = []
  let existingPage
  let provisioned = false, allowCheckout = false
  page.on('pageerror', error => errors.push(error.message))
  const routeFixture = async route => {
    const url = new URL(route.request().url())
    const returnedUser = authUser
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.startsWith('/.netlify/functions/')) {
      if (url.pathname.endsWith('/ensure-signup-club-profile')) { provisioned = true; return respond({ success: true, profile, club }) }
      if (url.pathname.endsWith('/create-workspace-checkout-session')) {
        assert.equal(route.request().headers().authorization, `Bearer ${token}`)
        checkouts.push(route.request().postDataJSON())
        return allowCheckout ? respond({ success: true, url: 'https://checkout.stripe.com/c/pay/fixture' }) : respond({ success: false, message: 'This offer is for new paid clubs only.' }, 409)
      }
      return respond({ success: true, hasPlatformAdminAccess: false })
    }
    if (url.hostname === 'checkout.stripe.com') return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Fixture checkout only</h1>' })
    if (url.hostname === 'referral.example.test' || url.hostname.endsWith('.supabase.co')) {
      if (url.pathname === '/auth/v1/signup') { signups.push(route.request().postDataJSON()); signupRedirects.push(url.searchParams.get('redirect_to')); return respond({ user: { ...authUser, email_confirmed_at: null }, session: null }) }
      if (url.pathname === '/auth/v1/user') return respond(authUser)
      if (url.pathname === '/auth/v1/token') return respond({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user: returnedUser })
      if (url.pathname === '/auth/v1/logout') return respond({})
      if (url.pathname.startsWith('/rest/v1/rpc/')) return respond([])
      const table = url.pathname.split('/').pop(), singular = String(route.request().headers().accept || '').includes('object')
      let rows = []
      if (provisioned && table === 'users') rows = [profile]
      if (provisioned && table === 'clubs') rows = [club]
      if (provisioned && table === 'teams') rows = [team]
      if (provisioned && table === 'user_club_memberships') rows = [{ id: 'membership', auth_user_id: userId, club_id: clubId, role: profile.role, role_label: profile.role_label, role_rank: 70, clubs: club }]
      if (provisioned && table === 'team_staff') rows = [{ id: 'assignment', team_id: teamId, user_id: userId, role_key: profile.role, role_label: profile.role_label, role_rank: 70, teams: team, team }]
      return respond(singular ? rows[0] || null : rows)
    }
    if (url.origin !== baseUrl) return route.abort()
    return route.continue()
  }
  await page.route('**/*', routeFixture)
  await page.goto(`${baseUrl}/club-signup?ref=${code}&teams=20&offer=club_20`)
  await page.getByLabel('Promotion code (optional)', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Promotion code (optional)', { exact: true }).inputValue(), code)
  assert.equal(await page.getByText('Tester access code', { exact: true }).count(), 0)
  await page.getByLabel('Club name', { exact: true }).fill(club.name)
  await page.getByLabel('Email', { exact: true }).fill(authUser.email)
  await page.locator('input[name="password"]').fill('Fixture-Password-2026!')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByText(/If this is a new account/).waitFor()
  assert.equal(signups.length, 1)
  assert.equal(signups[0].data.signup_plan_key, 'matchday', 'signup metadata must not grant the paid plan')
  assert.equal(signups[0].data.club_signup_intent.code, code)
  assert.equal(new URL(signupRedirects[0]).pathname, '/club-signup')
  assert.equal(new URL(signupRedirects[0]).search, '')
  await page.goto('about:blank')
  await page.goto(`${baseUrl}/club-signup#access_token=${token}&refresh_token=fixture-refresh&expires_in=3600&token_type=bearer&type=signup`)
  await page.getByRole('heading', { name: 'Complete your Club sign-up' }).waitFor()
  assert.equal(await page.getByLabel('Promotion code (optional)', { exact: true }).inputValue(), code)
  await page.getByRole('button', { name: 'Continue to secure checkout' }).click()
  await page.getByRole('alert').filter({ hasText: 'new paid clubs only' }).waitFor()
  assert.equal(checkouts[0].referralCode, code)
  assert.equal(checkouts[0].clubSignup, true)
  assert.equal(checkouts[0].billingCycle, 'monthly')
  assert.equal('livePromotionCodeId' in checkouts[0], false)
  await mkdir('output/playwright/coach-club-promotion', { recursive: true })
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `output/playwright/coach-club-promotion/signup-${width}.png`, fullPage: true })
  }
  allowCheckout = true
  await page.getByRole('button', { name: 'Continue to secure checkout' }).click()
  await page.waitForURL('https://checkout.stripe.com/c/pay/fixture')
  existingPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  existingPage.setDefaultTimeout(15000)
  existingPage.on('pageerror', error => errors.push(error.message))
  await existingPage.route('**/*', routeFixture)
  const newCoachCode = 'FP-FEDCBA9876543210'
  await existingPage.goto(`${baseUrl}/club-signup?ref=${newCoachCode}&teams=20&offer=club_20`)
  await existingPage.getByRole('button', { name: 'Sign in', exact: true }).click()
  await existingPage.getByLabel('Email', { exact: true }).fill(authUser.email)
  await existingPage.locator('input[name="password"]').fill('Fixture-Password-2026!')
  await existingPage.getByRole('button', { name: 'Log in', exact: true }).click()
  await existingPage.getByRole('heading', { name: 'Complete your Club sign-up' }).waitFor()
  assert.equal(await existingPage.getByLabel('Promotion code (optional)', { exact: true }).inputValue(), newCoachCode, 'an old signup intent must not replace a new Coach share link')
  allowCheckout = false
  await existingPage.getByRole('button', { name: 'Continue to secure checkout' }).click()
  await existingPage.getByRole('alert').filter({ hasText: 'new paid clubs only' }).waitFor()
  assert.equal(checkouts.at(-1).referralCode, newCoachCode)
  assert.deepEqual(errors, [])
  console.log('PASS: Club sign-up prefilled code, verified own account, authenticated checkout, eligibility error, Stripe handoff and 320/390/1280px layouts; synthetic accounts only')
} catch (error) {
  console.error((await debugPage?.locator('body').innerText())?.slice(0, 2000))
  throw error
} finally { await browser.close(); await server.close() }
