import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { buildCoachReferral, coachReferral } from '../netlify/functions/lib/_coach-referral.js'
import { scanMobileAuthSource } from '../apps/scripts/mobile-auth-boundary-check.mjs'

const user = { id: '10000000-0000-4000-8000-000000000001', email: 'parent@example.test', email_confirmed_at: '2026-09-29T10:00:00Z' }
const body = { action: 'send', name: 'Test Parent', email: 'coach@example.test', message: 'Please take a look.' }
test('Coach referral preview is branded, escaped and cannot send or grant access', async () => {
  let called = false
  const result = await coachReferral({ user, body: { ...body, action: 'preview' }, db: { rpc() { called = true } }, send() { called = true }, from: 'Football Player <test@example.test>' })
  assert.equal(called, false)
  assert.match(result.text, /free Match Day/)
  assert.match(result.text, /does not give anyone access/)
  const email = buildCoachReferral({ name: '<script>attack</script>', senderEmail: user.email, message: '<img src=x onerror=attack>' })
  assert.doesNotMatch(email.html, /<script>|<img src=x/)
  assert.match(email.html, /app-store-badge.png/)
  assert.match(email.html, /google-play-badge.png/)
})
test('unverified accounts and invalid recipient details fail before database or email access', async () => {
  for (const input of [{ user: null, body }, { user: { ...user, email_confirmed_at: null }, body }, { user, body: { ...body, email: user.email } }, { user, body: { ...body, name: 'Header\ninjection' } }, { user, body: { ...body, message: 'x'.repeat(1001) } }]) {
    await assert.rejects(coachReferral({ ...input, db: {}, send() { assert.fail('must not send') } }), /Confirm|email address|your name/)
  }
})
test('delivery retries use the stored payload and key, while completed sends are deduplicated', async () => {
  const sent = []
  let update
  const row = { id: 'referral-id', payload: { subject: 'Original preview', to: ['coach@example.test'] } }
  const db = { rpc: async () => ({ data: row }), from(table) { assert.equal(table, 'parent_coach_referrals'); return { update(value) { update = value; return { eq: async () => ({ error: null }) } } } } }
  const send = async (...args) => { sent.push(args); return { data: { id: 'provider-id' } } }
  await coachReferral({ db, user, body, send })
  assert.equal(update.provider_id, 'provider-id')
  assert.deepEqual(sent[0][0], row.payload)
  assert.equal(sent[0][1].idempotencyKey, 'coach-referral-referral-id')
  row.sent_at = update.sent_at
  const result = await coachReferral({ db, user, body, send })
  assert.equal(result.alreadySent, true)
  assert.equal(sent.length, 1)
})
test('email failures remain retryable and database errors fail closed', async () => {
  const db = { rpc: async () => ({ data: { id: 'retry', payload: {} } }), from() { assert.fail('must not mark sent') } }
  await assert.rejects(coachReferral({ db, user, body, send: async () => { throw new Error('Provider unavailable') } }), /Provider unavailable/)
  await assert.rejects(coachReferral({ db: { rpc: async () => ({ error: { code: 'P0001', message: 'Please wait 24 hours' } }) }, user, body }), error => error.statusCode === 429)
})
test('signup exception allows fixed website confirmation only, with no link session authority', async () => {
  const file = 'apps/mobile-core/src/mobileSignup.js'
  const content = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.deepEqual(scanMobileAuthSource({ file, content }), [])
  assert.ok(scanMobileAuthSource({ file, content: content.replace('https://footballplayer.online/sign-in', 'https://attacker.test') }).length)
  assert.ok(scanMobileAuthSource({ file, content: content + '\nsupabase.auth.setSession({access_token: token})' }).length)
  assert.ok(scanMobileAuthSource({ file: 'apps/coach-mobile/other.js', content }).length)
})
test('referral reservation enforces limits, stable retries and service-only access in Postgres', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${user.id}'),('20000000-0000-4000-8000-000000000002');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20260929120106_parent_coach_referrals.sql', import.meta.url), 'utf8'))
    const reserve = (digest, actor = user.id) => db.query('select * from public.reserve_parent_coach_referral($1,$2,$3)', [actor, digest, { sample: true }])
    const first = await reserve('recipient-one')
    assert.equal((await reserve('recipient-one')).rows[0].id, first.rows[0].id)
    await assert.rejects(reserve('recipient-one', '20000000-0000-4000-8000-000000000002'), /24 hours/)
    await reserve('recipient-two'); await reserve('recipient-three')
    await assert.rejects(reserve('recipient-four'), /24 hours/)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select * from parent_coach_referrals'), /permission denied/)
      await assert.rejects(reserve('bypass'), /permission denied/)
      await db.exec('reset role')
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='parent_coach_referrals'")).rows[0].relrowsecurity, true)
  } finally { await db.close() }
})


test('new Coach provisions once after confirmation; existing inactive staff cannot use signup to bypass access', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/profile.js', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('async function fetchStaffProfile('), source.indexOf('async function fetchParentProfile('))
  const authUser = { ...user, user_metadata: { signup_plan_key: 'matchday', club_name: 'FP TEST Team' } }
  let row = null; let provisions = 0
  const query = { select() { return this }, or() { return this }, async maybeSingle() { return { data: row } } }
  const deps = [{ from: () => query }, value => value, async () => [], value => value,
    ({ profile }) => ({ allowed: row?.status !== 'inactive', code: 'staff_account_inactive', contexts: [], context: profile }),
    value => value, async (role, endpoint, body) => { assert.equal(role, 'coach'); assert.equal(endpoint, 'ensure-signup-club-profile'); assert.deepEqual(body, {}); provisions++; row = { id: user.id, status: 'active' } }]
  const fetchProfile = new Function('supabase','normalizeEmail','fetchStaffContexts','normalizeStaffProfile','resolveCoachStaffContext','applyCoachContext','mobileAccountRequest', `${fn};return fetchStaffProfile`)(...deps)
  await assert.rejects(fetchProfile({ ...authUser, email_confirmed_at: null }), /not linked/)
  assert.equal(provisions, 0)
  assert.equal((await fetchProfile(authUser)).id, user.id)
  assert.equal(provisions, 1)
  row = { id: user.id, status: 'inactive' }
  await assert.rejects(fetchProfile(authUser), /staff_account_inactive/)
  assert.equal(provisions, 1)
})
