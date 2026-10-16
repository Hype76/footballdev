import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { COACH_CLUB_COUPON_ID, assertCoachClubPromotionSelection, ensureCoachClubCoupon, startCoachClubPromotionCheckout } from '../netlify/functions/lib/_coach-club-promotion.js'
import { coachClubShareLink, normalizeCoachClubCode } from '../src/lib/coach-club-promotion.js'
import { getCoachBackTarget, getCoachNavigationModel, resolveCoachRoute } from '../apps/coach-mobile/src/coachNavigationCore.js'
import sharp from 'sharp'
import jsQR from 'jsqr'

const code = 'FP-0123456789ABCDEF'
const selection = { planKey: 'club', billingCycle: 'monthly', teamCapacity: 20, lineItems: [{ price: 'price_club_20', quantity: 1 }], offerKey: 'club_20', clubSignup: true }
const coupon = { id: COACH_CLUB_COUPON_ID, valid: true, percent_off: 50, duration: 'repeating', duration_in_months: 3, metadata: { purpose: 'coach_club_referral' } }

test('authenticated Coach QR decodes to the exact signup link and preserves access checks', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://fixture.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-key'
  const { getCoachClubPromotion, handler } = await import('../netlify/functions/coach-club-promotion.js')
  let role = 'coach', rpcCalls = 0
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'coach', email_confirmed_at: '2026-01-01' } } }) },
    from: table => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: table === 'users'
      ? { id: 'coach', club_id: 'club', role, role_rank: role === 'coach' ? 20 : 10, status: 'active' }
      : table === 'clubs' ? { id: 'club', status: 'active' } : { auth_user_id: 'coach' } }) }),
    rpc: async () => { rpcCalls++; return { data: code } },
  }
  const event = { headers: { authorization: 'Bearer fixture-token' } }
  await assert.rejects(getCoachClubPromotion(db, { headers: {} }), /Sign in again/)
  const result = await getCoachClubPromotion(db, event)
  assert.equal(result.shareUrl, coachClubShareLink(code))
  assert.match(result.qr, /^data:image\/png;base64,/)
  const { data, info } = await sharp(Buffer.from(result.qr.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, result.shareUrl)
  role = 'parent'
  await assert.rejects(getCoachClubPromotion(db, event), /Active Coach access/)
  assert.equal(rpcCalls, 1, 'unauthorised users do not receive a code or QR')
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405)
})

test('Coach More resolves the promotion for staff on free and paid plans', () => {
  for (const planKey of ['matchday', 'team', 'club']) {
    const context = { id: 'coach', role: 'coach', roleRank: 20, planKey }
    assert.ok(getCoachNavigationModel(context).more.some(route => route.key === 'club-promotion'))
    assert.equal(resolveCoachRoute('club-promotion', context), 'club-promotion')
  }
  assert.equal(normalizeCoachClubCode(`  ${code.toLowerCase()} `), code)
  const link = new URL(coachClubShareLink(code))
  assert.equal(link.origin, 'https://footballplayer.online')
  assert.equal(link.pathname, '/club-signup')
  assert.equal(link.searchParams.get('ref'), code)
  assert.deepEqual(getCoachBackTarget({ activeRoute: 'more', moreRoute: 'club-promotion' }), { activeRoute: 'more', moreRoute: 'partners' })
})

test('Coach referral offer is placed in Partners and represented in Platform Partners', async () => {
  const [coachApp, platformPartners] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/platform/PlatformPartnersSection.jsx', import.meta.url), 'utf8'),
  ])
  const moreScreen = coachApp.slice(coachApp.indexOf('function MoreScreen'), coachApp.indexOf('function SettingsScreen'))
  const coachPartnersRoute = coachApp.slice(coachApp.indexOf("if (moreRoute === 'partners')"), coachApp.indexOf("if (moreRoute === 'sessions')"))

  assert.match(moreScreen, /!\['club-promotion', 'partners'\]\.includes\(route\.key\)/)
  assert.match(coachPartnersRoute, /CoachPartnerPromotionAction/)
  assert.match(coachPartnersRoute, /Back to Partners/)
  assert.match(coachApp, /iconKey="more\.club-promotion"/)
  assert.match(coachApp, />50%<\/Text>/)
  assert.match(platformPartners, /COACH_CLUB_PROMOTION_TERMS/)
  assert.match(platformPartners, /CoachReferralOfferSummary/)
  assert.match(platformPartners, /Fixed product offer\. It is not part of the editable partner grid or partner analytics\./)
})

test('monthly Club only, valid code and no stacked discounts are enforced before reservation', () => {
  assert.equal(assertCoachClubPromotionSelection({ referralCode: code.toLowerCase() }, 'club', 'monthly'), code)
  for (const [body, plan, cycle] of [[{ referralCode: 'bad' }, 'club', 'monthly'], [{ referralCode: code }, 'team', 'monthly'], [{ referralCode: code }, 'club', 'annual'],
    ...['livePromotionCodeId', 'promotionCode', 'discounts', 'coupon'].map(key => [{ referralCode: code, [key]: 'other' }, 'club', 'monthly'])]) {
    assert.throws(() => assertCoachClubPromotionSelection(body, plan, cycle))
  }
})

test('fixed provider coupon is 50 percent for three months, validated and created idempotently', async () => {
  let request, options
  assert.equal(await ensureCoachClubCoupon({ coupons: { retrieve: async () => coupon } }), coupon.id)
  const stripe = { coupons: { retrieve: async () => { throw { code: 'resource_missing' } }, create: async (value, opts) => { request = value; options = opts; return coupon } } }
  assert.equal(await ensureCoachClubCoupon(stripe), coupon.id)
  assert.equal(request.percent_off, 50)
  assert.equal(request.duration_in_months, 3)
  assert.ok(request.name.length <= 40, 'Stripe coupon names must fit the provider 40-character limit')
  assert.equal(options.idempotencyKey, coupon.id)
  for (const change of [{ percent_off: 25 }, { duration_in_months: 4 }, { duration: 'forever' }, { valid: false }, { applies_to: { products: ['other_product'] } }]) {
    await assert.rejects(ensureCoachClubCoupon({ coupons: { retrieve: async () => ({ ...coupon, ...change }) } }), /temporarily unavailable/)
  }
  await assert.rejects(ensureCoachClubCoupon({ coupons: { retrieve: async () => { throw new Error('Network unavailable') } } }), /Network unavailable/)
})

function checkoutFixture(overrides = {}) {
  const calls = { creates: 0, reserves: [], updates: [] }
  let reservation = { club_id: 'club', reservation_id: 'reservation', code, selection: { ...selection }, checkout_session_id: null,
    created_at: new Date().toISOString(), checkout_expires_at: new Date(Date.now() + 3600000).toISOString() }
  const db = {
    rpc: async (name, params) => { calls.reserves.push({ name, params }); if (params.p_previous) reservation = { ...reservation, code: params.p_code, selection: params.p_selection, reservation_id: 'new-reservation', checkout_session_id: null, created_at: new Date().toISOString(), checkout_expires_at: new Date(Date.now() + 3600000).toISOString() }; return { data: reservation } },
    from: name => { assert.equal(name, 'coach_club_promotion_redemptions'); return { update(value) { calls.updates.push(value); return this }, eq() { return this }, select() { return this }, single: async () => ({ data: { reservation_id: reservation.reservation_id } }) } },
  }
  const stripe = { coupons: { retrieve: async () => coupon }, checkout: { sessions: { retrieve: async () => ({ id: 'cs_open', status: 'open', url: 'https://checkout.stripe.com/session' }) } } }
  const createSession = async value => { calls.creates++; calls.createParams = value; return { id: 'cs_test', url: 'https://checkout.stripe.com/session', expires_at: 1800000000 } }
  return { input: { db, stripe, caller: { id: 'owner' }, workspace: { id: 'club' }, code, selection, createSession, ...overrides }, calls, setReservation(value) { reservation = value } }
}

test('checkout is persisted and retries reuse the same club reservation and provider idempotency key', async () => {
  const f = checkoutFixture()
  await startCoachClubPromotionCheckout(f.input)
  await startCoachClubPromotionCheckout(f.input)
  assert.equal(f.calls.createParams.idempotencyKey, 'coach-club-reservation')
  assert.equal(f.calls.updates[0].checkout_session_id, 'cs_test')
  assert.equal(f.calls.reserves[0].params.p_actor, 'owner')
  f.setReservation({ reservation_id: 'reservation', code, selection: Object.fromEntries(Object.entries(selection).reverse()), checkout_session_id: 'cs_open' })
  await startCoachClubPromotionCheckout(f.input)
  assert.equal(f.calls.creates, 2, 'open checkout must be reused without creating another subscription')
})

test('expired checkout can restart; complete or conflicting checkout cannot redeem a second time', async () => {
  const f = checkoutFixture()
  f.setReservation({ reservation_id: 'reservation', code, selection, checkout_session_id: 'cs_old' })
  f.input.stripe.checkout.sessions.retrieve = async () => ({ status: 'expired' })
  await startCoachClubPromotionCheckout(f.input)
  assert.equal(f.calls.createParams.idempotencyKey, 'coach-club-new-reservation')
  for (const status of ['complete', 'open']) {
    f.setReservation({ reservation_id: 'reservation', code: 'FP-FFFFFFFFFFFFFFFF', selection, checkout_session_id: 'cs_old' })
    f.input.stripe.checkout.sessions.retrieve = async () => ({ status })
    await assert.rejects(startCoachClubPromotionCheckout(f.input), /already|expire/)
  }
})

test('provider and persistence errors never fall back to an undiscounted checkout', async () => {
  const f = checkoutFixture()
  f.input.stripe.coupons.retrieve = async () => { throw new Error('Provider failure') }
  await assert.rejects(startCoachClubPromotionCheckout(f.input), /Provider failure/)
  assert.equal(f.calls.creates, 0)
  f.input.stripe.coupons.retrieve = async () => coupon
  f.input.db.from = () => ({ update() { return this }, eq() { return this }, select() { return this }, single: async () => ({ error: { code: 'offline' } }) })
  await assert.rejects(startCoachClubPromotionCheckout(f.input), /could not be saved/)
})

test('clearing a code, changing a plan or adding a code cannot bypass an existing checkout', async () => {
  const f = checkoutFixture()
  f.setReservation({ reservation_id: 'reservation', code, selection, checkout_session_id: 'cs_open' })
  f.input.code = ''
  await assert.rejects(startCoachClubPromotionCheckout(f.input), /already open/)
  assert.equal(f.calls.creates, 0)
  f.setReservation({ reservation_id: 'reservation', code: null, selection, checkout_session_id: 'cs_open' })
  f.input.code = code
  await assert.rejects(startCoachClubPromotionCheckout(f.input), /already open/)
  f.input.code = ''
  f.input.selection = { ...selection, planKey: 'team' }
  await assert.rejects(startCoachClubPromotionCheckout(f.input), /already open/)
  assert.equal(f.calls.creates, 0)
  f.input.selection = selection
  await startCoachClubPromotionCheckout(f.input)
  assert.equal(f.calls.creates, 0, 'same ordinary checkout is reused')
})

test('stale preparation recovers only after its fixed provider expiry and remote reconciliation', async () => {
  const f = checkoutFixture()
  const stale = { reservation_id: 'reservation', code, selection, checkout_session_id: null,
    created_at: new Date(Date.now() - 7200000).toISOString(), checkout_expires_at: new Date(Date.now() - 3600000).toISOString() }
  f.setReservation(stale)
  f.input.code = ''
  f.input.stripe.checkout.sessions.list = async () => ({ data: [{ status: 'complete', metadata: { workspaceCheckoutReservation: 'reservation' } }], has_more: false })
  await assert.rejects(startCoachClubPromotionCheckout(f.input), /completed/)
  assert.equal(f.calls.creates, 0)
  f.input.stripe.checkout.sessions.list = async () => ({ data: [], has_more: false })
  await startCoachClubPromotionCheckout(f.input)
  assert.equal(f.calls.createParams.couponId, '')
  assert.equal(f.calls.createParams.idempotencyKey, 'coach-club-new-reservation')
  assert.ok(f.calls.createParams.expiresAt > Date.now() / 1000 + 3500)
  f.setReservation(stale)
  f.input.stripe.checkout.sessions.list = async () => { throw new Error('Stripe unavailable') }
  await assert.rejects(startCoachClubPromotionCheckout(f.input), /Stripe unavailable/)
})

test('existing Stripe subscriptions and customer discounts block the Coach offer', async () => {
  for (const [customer, subscriptions] of [[{}, [{}]], [{ discount: { id: 'other' } }, []], [{ discounts: [{}] }, []]]) {
    const f = checkoutFixture({ workspace: { id: 'club', stripe_customer_id: 'cus_old' } })
    f.input.stripe.customers = { retrieve: async () => customer }
    f.input.stripe.subscriptions = { list: async () => ({ data: subscriptions }) }
    await assert.rejects(startCoachClubPromotionCheckout(f.input), /new paid clubs|combined/)
    assert.equal(f.calls.reserves.length, 0)
  }
})

test('provider checkout receives one discount, club identity, referral attribution and the sign-up return link', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
  const { createExistingWorkspaceCheckout } = await import('../netlify/functions/create-workspace-checkout-session.js')
  let request, options
  await createExistingWorkspaceCheckout({ checkout: { sessions: { create: async (value, opts) => { request = value; options = opts } } } }, {
    appUrl: 'https://footballplayer.online', caller: { id: 'owner', email: 'owner@example.test' }, workspace: { id: 'club', name: 'Test Club', plan_key: 'matchday' },
    targetPlanKey: 'club', billingCycle: 'monthly', teamCapacity: 20, offerKey: 'club_20', clubSignup: true,
    lineItems: selection.lineItems, referral: { code, reservationId: 'reservation', couponId: coupon.id, idempotencyKey: 'one-club' },
  })
  assert.deepEqual(request.discounts, [{ coupon: coupon.id }])
  assert.equal('allow_promotion_codes' in request, false)
  assert.equal(request.metadata.clubId, 'club')
  assert.equal(request.subscription_data.metadata.coachReferralReservation, 'reservation')
  assert.equal(new URL(request.cancel_url).searchParams.get('ref'), code)
  assert.equal(options.idempotencyKey, 'one-club')
  assert.equal(request.subscription_data.trial_period_days, 14)
})

test('Postgres enforces unique coach codes, new paid club eligibility, lifetime use, stable retries and service-only access', async () => {
  const db = new PGlite()
  const coach = '10000000-0000-4000-8000-000000000001', owner = '10000000-0000-4000-8000-000000000002', club = '20000000-0000-4000-8000-000000000001', coachClub = '20000000-0000-4000-8000-000000000002'
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${coach}'),('${owner}');
      create table clubs(id uuid primary key, name text, status text, archived_at timestamptz, stripe_subscription_id text);
      create table users(id uuid primary key, email text, club_id uuid, role text, role_rank int, status text);
      create table user_club_memberships(auth_user_id uuid, club_id uuid, role text, role_rank int);
      create table stripe_checkout_records(id uuid default gen_random_uuid(), club_id uuid, customer_email text);
      insert into clubs(id,status) values ('${club}','active'),('${coachClub}','active');
      insert into users values ('${coach}','coach@example.test','${coachClub}','coach',20,'active'),('${owner}','owner@example.test','${club}','head_manager',70,'active');
      insert into user_club_memberships select id,club_id,role,role_rank from users;
      grant usage on schema public,auth to service_role;
      grant select,update on clubs,users,user_club_memberships,stripe_checkout_records to service_role;`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261015082456_coach_club_promotion_codes.sql', import.meta.url), 'utf8'))
    await db.exec('set role service_role')
    const ensure = actor => db.query('select public.ensure_coach_club_promotion_code($1) code', [actor])
    const firstCode = (await ensure(coach)).rows[0].code
    assert.match(firstCode, /^FP-[A-F0-9]{16}$/)
    assert.equal((await ensure(coach)).rows[0].code, firstCode)
    assert.notEqual((await ensure(owner)).rows[0].code, firstCode)
    const reserve = (sel = selection, value = firstCode, actor = owner) => db.query('select (public.reserve_coach_club_promotion($1,$2,$3,$4)).*', [actor, club, value, sel])
    await assert.rejects(reserve({ ...selection, billingCycle: 'annual' }), /monthly Club/)
    await assert.rejects(reserve(selection, 'FP-FFFFFFFFFFFFFFFF'), /invalid/)
    await assert.rejects(reserve(selection, firstCode, coach), /Active club access/)
    const reserved = (await reserve()).rows[0]
    assert.equal((await reserve()).rows[0].reservation_id, reserved.reservation_id)
    const competing = await db.query('select (public.reserve_coach_club_promotion($1,$2,null,$3)).*', [owner, club, { ...selection, planKey: 'team' }])
    assert.equal(competing.rows[0].reservation_id, reserved.reservation_id)
    assert.equal(competing.rows[0].code, firstCode, 'codeless reservation cannot replace an existing Coach checkout')
    await db.query('select public.complete_coach_club_promotion($1,$2,$3)', [club, reserved.reservation_id, 'cs_test'])
    await db.query('select public.complete_coach_club_promotion($1,$2,$3)', [club, reserved.reservation_id, 'cs_test'])
    await assert.rejects(db.query('select public.complete_coach_club_promotion($1,$2,$3)', [club, reserved.reservation_id, 'cs_other']), /does not match/)
    await assert.rejects(reserve(), /already used/)
    await db.exec('reset role')
    await db.query('insert into stripe_checkout_records(club_id,customer_email) values ($1,$2)', [club, 'owner@example.test'])
    await assert.rejects(reserve(), /new paid clubs/)
    await db.query("update users set status='inactive' where id=$1", [coach])
    await assert.rejects(ensure(coach), /Active Coach/)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(ensure(owner), /permission denied/)
      await assert.rejects(reserve(), /permission denied/)
      await assert.rejects(db.query('select * from coach_club_promotion_codes'), /permission denied/)
      await assert.rejects(db.query('select * from coach_club_promotion_redemptions'), /permission denied/)
      await db.exec('reset role')
    }
    assert.deepEqual((await db.query("select relrowsecurity from pg_class where relname in ('coach_club_promotion_codes','coach_club_promotion_redemptions')")).rows.map(value => value.relrowsecurity), [true, true])
    await db.query('delete from auth.users where id=$1', [coach])
    assert.equal((await db.query('select coach_user_id from coach_club_promotion_codes where code=$1', [firstCode])).rows[0].coach_user_id, null, 'account deletion must remain possible without losing the redemption ledger')
  } finally { await db.close() }
})
