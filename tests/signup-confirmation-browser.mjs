import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const userId = '10000000-0000-4000-8000-000000000001'
const clubId = '20000000-0000-4000-8000-000000000002'
const teamId = '30000000-0000-4000-8000-000000000003'
const authUser = { id: userId, email: 'signup@example.test', email_confirmed_at: '2026-09-30T05:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { name: 'Test Coach', club_name: 'FP TEST Signup', signup_plan_key: 'matchday', account_type: 'coach' } }
const club = { id: clubId, name: 'FP TEST Signup', status: 'active', plan_key: 'matchday', plan_status: 'active', matchday_free_forever: true, workspace_owner_user_id: userId }
const profile = { id: userId, email: authUser.email, name: 'Test Coach', username: 'Test Coach', display_name: 'Test Coach', role: 'head_manager', role_label: 'Team Admin', role_rank: 70, club_id: clubId, status: 'active', onboarding_enabled: false }
const team = { id: teamId, club_id: clubId, name: club.name, archived_at: null }
const jwtPart = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = `${jwtPart({ alg: 'HS256', typ: 'JWT' })}.${jwtPart({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture-signature`
process.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES = 'false'
process.env.VITE_SUPABASE_URL = 'https://signup.example.test'
process.env.VITE_SUPABASE_ANON_KEY = 'fixture-anon-key'
const liveBaseUrl = String(process.env.SIGNUP_BROWSER_BASE_URL || '').replace(/\/$/, '')
const server = liveBaseUrl ? null : await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
if (server) await server.listen()
const baseUrl = liveBaseUrl || `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  let provisioned = false
  let provisionRequests = 0
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    const respond = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.startsWith('/.netlify/functions/')) {
      if (url.pathname.endsWith('/ensure-signup-club-profile')) {
        assert.equal(route.request().headers().authorization, `Bearer ${token}`)
        provisionRequests++
        provisioned = true
        return respond({ success: true, profile, club })
      }
      return respond({ success: true, hasPlatformAdminAccess: false })
    }
    if (url.hostname === 'signup.example.test' || url.hostname.endsWith('.supabase.co')) {
      if (url.pathname === '/auth/v1/user') return respond(authUser)
      if (url.pathname === '/auth/v1/logout') return respond({})
      if (url.pathname.startsWith('/rest/v1/rpc/')) return respond([])
      const table = url.pathname.split('/').pop()
      const singular = String(route.request().headers().accept || '').includes('object')
      let rows = []
      if (provisioned && table === 'users') rows = [profile]
      if (provisioned && table === 'clubs') rows = [club]
      if (provisioned && table === 'teams') rows = [team]
      if (provisioned && table === 'user_club_memberships') rows = [{ id: 'test-membership', auth_user_id: userId, club_id: clubId, role: profile.role, role_label: profile.role_label, role_rank: 70, clubs: club }]
      if (provisioned && table === 'team_staff') rows = [{ id: 'test-assignment', team_id: teamId, user_id: userId, role_key: profile.role, role_label: 'Team Admin', role_rank: 70, teams: team, team }]
      return respond(singular ? rows[0] || null : rows)
    }
    if (url.origin !== baseUrl) return route.abort()
    return route.continue()
  })
  await page.goto(`${baseUrl}/sign-in#access_token=${token}&refresh_token=fixture-refresh&expires_in=3600&token_type=bearer&type=signup`)
  await page.waitForURL(url => url.pathname === '/coach', { timeout: 20000 })
  await page.getByText('FP TEST Signup', { exact: true }).first().waitFor({ timeout: 15000 })
  assert.equal(provisionRequests, 1, 'confirmation must provision the workspace once')
  assert.equal(await page.getByText(/Payment is required to continue/).count(), 0)
  assert.deepEqual(errors, [])
  await page.reload()
  await page.getByText('FP TEST Signup', { exact: true }).first().waitFor({ timeout: 15000 })
  assert.equal(provisionRequests, 1, 'existing Coach returns without creating another workspace')
  assert.deepEqual(errors, [])
  console.log('PASS: confirmed account without a staff role provisions once, opens Coach workspace and survives reload')
} finally {
  await browser.close()
  if (server) await server.close()
}
