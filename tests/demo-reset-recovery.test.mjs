import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import { DEMO_RESET_MANIFEST } from '../netlify/functions/lib/_demo-reset-manifest.js'

const migrationUrl = new URL('../supabase/migrations/20260719092052_p0_demo_reset_atomic_recovery.sql', import.meta.url)
const publicFunctionUrl = new URL('../netlify/functions/reset-demo-account.js', import.meta.url)
const loginPageUrl = new URL('../src/pages/LoginPage.jsx', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)

test('public demo maintenance is absent from the browser and Netlify function surface', async () => {
  const [loginPage, routerSource] = await Promise.all([
    readFile(loginPageUrl, 'utf8'),
    readFile(routerUrl, 'utf8'),
  ])

  await assert.rejects(access(publicFunctionUrl))
  assert.doesNotMatch(loginPage, /reset-demo-account|prepareDemoAccount|operationId|DEMO_RESET_PENDING/)
  assert.doesNotMatch(routerSource, /isDemoResetPending|DEMO_RESET_PENDING/)
  assert.match(loginPage, /signInWithPassword\(\{\s*email: DEMO_EMAIL,\s*password: DEMO_PASSWORD/)
})

test('internal atomic demo recovery remains service-role only and server-scoped', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /pg_try_advisory_xact_lock\(hashtextextended\('footballplayer:demo-reset:v1', 0\)\)/)
  assert.match(migration, /language plpgsql\s+security definer\s+set search_path = ''/)
  assert.match(migration, /revoke all on function public\."reset_demo_account_atomic"\(uuid, uuid\) from public/)
  assert.match(migration, /revoke all on function public\."reset_demo_account_atomic"\(uuid, uuid\) from anon/)
  assert.match(migration, /revoke all on function public\."reset_demo_account_atomic"\(uuid, uuid\) from authenticated/)
  assert.match(migration, /grant execute on function public\."reset_demo_account_atomic"\(uuid, uuid\) to service_role/)
  assert.doesNotMatch(migration, /auth\.users\s+(?:set|delete|insert|update)/i)
  assert.doesNotMatch(migration, /insert into public\.(?:scheduled_email_queue|calendar_event_notification_commands|calendar_event_notification_events|match_day_notification_events|communication_logs)/i)
  assert.doesNotMatch(JSON.stringify(DEMO_RESET_MANIFEST), /Demo123|password|service.role.key/i)
})

test('the retired parallel reset pattern still demonstrates why atomic recovery is preserved', async () => {
  const state = {
    teams: new Set(['U12 Tigers', 'U14 Falcons', 'U16 Lions']),
    teamStaff: 3,
    matchDays: 2,
  }

  const oldDelete = async (resource, { deadlock = false } = {}) => {
    if (resource === 'team_staff') state.teamStaff = 0
    if (resource === 'match_days') state.matchDays = 0
    if (deadlock) throw Object.assign(new Error('deadlock detected'), { code: '40P01' })
    if (resource === 'teams') state.teams.clear()
  }
  const swallow = (promise) => promise.catch(() => undefined)

  await Promise.all([
    swallow(oldDelete('team_staff')),
    swallow(oldDelete('match_days')),
    swallow(oldDelete('teams', { deadlock: true })),
  ])

  assert.throws(() => {
    for (const name of DEMO_RESET_MANIFEST.teams) {
      if (state.teams.has(name)) throw Object.assign(new Error('duplicate team'), { code: '23505' })
      state.teams.add(name)
    }
  }, /duplicate team/)
  assert.equal(state.teamStaff, 0)
  assert.equal(state.matchDays, 0)
  assert.equal(state.teams.size, 3)
})
