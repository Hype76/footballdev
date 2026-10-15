import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { parse } from '@babel/parser'
import { isReturningCoachSignupActor } from '../netlify/functions/lib/_fresh-coach-billing.js'
import { buildFreshSignupEmail, createFreshSignupHandler, createFreshSignupWorker, freshSignupDigest } from '../netlify/functions/lib/_fresh-coach-signup.js'

const actor = '10000000-0000-4000-8000-000000000001', requestId = '20000000-0000-4000-8000-000000000001'
const email = 'returning@example.test', code = '12345678', password = 'Safer!Demo9372', secret = 'synthetic-only-secret'
const event = body => ({ httpMethod: 'POST', body: JSON.stringify(body), headers: {} })
function fixture(options = {}) {
  const calls = [], request = { id: requestId, user_id: actor, email }
  const db = { rpc: async (name, body) => {
    calls.push([name, body])
    return { data: name === 'consume_password_recovery_rate_limit' ? { allowed: options.allowed !== false } : name === 'claim_fresh_coach_signup_code' ? options.invalid ? null : request : name === 'get_fresh_coach_signup_candidate' ? options.ineligible ? null : { id: options.wrongActor ? 'other' : actor, email: options.wrongEmail ? 'other@example.test' : email } : true }
  }, auth: { admin: {
    updateUserById: async (id, body) => { calls.push(['updatePassword', { id, ...body }]); return {} },
  } } }
  const handler = createFreshSignupHandler({ createAdminClient: () => db,
    triggerWorker: async (...args) => calls.push(['worker', args]), secret: () => secret, newId: () => requestId })
  return { handler, calls, db }
}

test('begin queues an opaque request without an Auth lookup or password change', async () => {
  const f = fixture(), response = await f.handler(event({ action: 'request', email, name: 'New Coach', teamName: 'Fresh Team' }))
  assert.deepEqual(JSON.parse(response.body), { success: true, requestId, message: 'If a fresh signup is available for this email, a verification code has been requested. Check your newest email.' })
  assert.deepEqual(f.calls.map(([name]) => name), ['consume_password_recovery_rate_limit', 'queue_fresh_coach_signup', 'worker'])
  const limited = fixture({ allowed: false })
  assert.equal((await limited.handler(event({ action: 'request', email, name: 'New Coach', teamName: 'Fresh Team' }))).body, response.body)
  assert.equal(limited.calls.length, 1)
})

test('wrong, expired, limited and wrong-identity codes cannot change a password or provision', async () => {
  for (const options of [{ invalid: true }, { allowed: false }, { wrongActor: true }, { wrongEmail: true }, { ineligible: true }]) {
    const f = fixture(options), response = await f.handler(event({ action: 'verify', requestId, code, password }))
    assert.equal(response.statusCode, 400)
    assert.match(response.body, /could not be verified/)
    assert.equal(f.calls.some(([name]) => ['updatePassword', 'complete_fresh_coach_signup'].includes(name)), false)
  }
})

test('ownership verification precedes password/provisioning and no session or secret is returned', async () => {
  const f = fixture(), response = await f.handler(event({ action: 'verify', requestId, code, password }))
  assert.deepEqual(JSON.parse(response.body), { success: true })
  assert.deepEqual(f.calls.map(([name]) => name), ['consume_password_recovery_rate_limit', 'claim_fresh_coach_signup_code', 'get_fresh_coach_signup_candidate', 'updatePassword', 'complete_fresh_coach_signup'])
  const update = f.calls.find(([name]) => name === 'updatePassword')[1]
  assert.deepEqual(Object.keys(update).sort(), ['id', 'password', 'user_metadata'])
  assert.equal(update.id, actor)
  assert.doesNotMatch(JSON.stringify(update), /factors|email_confirm|app_metadata|ban_duration/)
  assert.equal(f.calls[1][1].p_digest, freshSignupDigest(secret, 'fresh-signup-code', `${requestId}:${code}`))
  assert.doesNotMatch(response.body, /access_token|refresh_token|password|12345678/)
})

test('untrusted purpose, extra privilege fields and weak passwords fail before provisioning', async () => {
  for (const body of [{ action: 'verify', requestId, code, password, planKey: 'club' }, { action: 'verify', requestId, code, password: 'weak' }, { action: 'revive', requestId, code, password }]) {
    const f = fixture(); assert.equal((await f.handler(event(body))).statusCode, 400); assert.equal(f.calls.length, 0)
  }
})

test('worker resolves retained eligibility before OTP generation and stores only a purpose-bound digest', async () => {
  for (const eligible of [false, true]) {
    const calls = [], delivered = []
    const db = { rpc: async (name, body) => {
      calls.push([name, body]); return { data: name === 'claim_fresh_coach_signup_delivery' ? { email, team_name: '<New Team>' } : name === 'get_fresh_coach_signup_candidate' ? eligible ? { id: actor, email } : null : true }
    } }
    const worker = createFreshSignupWorker({ createAdminClient: () => db, secret: () => secret, newCode: () => { calls.push(['generate']); return code }, deliver: async (...args) => delivered.push(args) })
    await worker({ ...event({ requestId }), headers: { authorization: `Bearer ${freshSignupDigest(secret, 'fresh-signup-worker', requestId)}` } })
    assert.equal(delivered.length, Number(eligible))
    assert.equal(calls.some(([name]) => name === 'generate'), eligible)
    if (eligible) {
      assert.ok(calls.findIndex(([name]) => name === 'get_fresh_coach_signup_candidate') < calls.findIndex(([name]) => name === 'generate'))
      assert.equal(calls.find(([name, body]) => name === 'mark_fresh_coach_signup_delivery' && body.p_state === 'sent')[1].p_digest, freshSignupDigest(secret, 'fresh-signup-code', `${requestId}:${code}`))
      assert.match(delivered[0][0].html, /&lt;New Team&gt;/)
    }
  }
})

test('forged worker requests do not access the database; email contains purpose and no sign-in link', async () => {
  const worker = createFreshSignupWorker({ createAdminClient() { assert.fail('No unauthorised database access') }, secret: () => secret })
  await worker(event({ requestId }))
  const html = buildFreshSignupEmail({ code, teamName: 'Fresh Team' })
  assert.match(html, /old workspace stays deleted/); assert.match(html, /10 minutes/); assert.doesNotMatch(html, /token_hash|ConfirmationURL/)
})

async function database() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema app_private;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create table public.clubs(id uuid primary key default gen_random_uuid(), name text unique, status text default 'active', archived_at timestamptz,
      plan_key text, plan_status text, is_plan_comped boolean, matchday_free_forever boolean, plan_updated_at timestamptz, workspace_owner_user_id uuid, stripe_subscription_id text);
    create table public.users(id uuid primary key, email text, username text, name text, display_name text, club_name text, reply_to_email text, role text,
      role_label text, role_rank integer, club_id uuid references clubs(id) on delete cascade, status text default 'active', force_password_change boolean);
    create table public.user_club_memberships(auth_user_id uuid, email text, username text, name text, role text, role_label text, role_rank integer,
      club_id uuid references clubs(id) on delete cascade, updated_at timestamptz);
    create table public.teams(id uuid primary key default gen_random_uuid(), club_id uuid references clubs(id) on delete cascade, name text,
      created_by uuid, created_by_email text, created_by_name text, updated_by uuid, updated_by_email text, updated_by_name text);
    create table public.team_staff(team_id uuid references teams(id) on delete cascade, user_id uuid, role_key text, updated_by uuid);
    create table public.stripe_checkout_records(club_id uuid references clubs(id) on delete set null, customer_email text);
    create function public.seed_default_club_roles_for_actor(uuid,uuid,text) returns void language sql as 'select null::void';`)
  for (const file of ['20261015072209_deleted_workspace_signup_guard.sql', '20261015082456_coach_club_promotion_codes.sql', '20261015144838_verified_fresh_coach_signup.sql']) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
  await db.query('insert into auth.users values ($1,$2,now())', [actor, email])
  await db.query('insert into app_private.deleted_workspace_access(user_id,club_id) values ($1,gen_random_uuid())', [actor])
  return db
}

async function ready(db, id = requestId) {
  await db.query('select public.queue_fresh_coach_signup($1,$2,$3,$4)', [id, email, 'New Coach', 'Fresh Team'])
  await db.query('select public.claim_fresh_coach_signup_delivery($1)', [id])
  await db.query("select public.mark_fresh_coach_signup_delivery($1,'sent',$2,$3)", [id, actor, 'a'.repeat(64)])
}

test('real SQL creates exactly one new free team, preserves deletion history and never claims old paid data', async () => {
  const db = await database()
  try {
    await db.query("insert into stripe_checkout_records values (null,$1)", [email])
    await ready(db)
    await db.query('select public.claim_fresh_coach_signup_code($1,$2)', [requestId, 'a'.repeat(64)])
    const first = (await db.query('select public.complete_fresh_coach_signup($1,$2) as id', [requestId, actor])).rows[0].id
    const second = (await db.query('select public.complete_fresh_coach_signup($1,$2) as id', [requestId, actor])).rows[0].id
    assert.equal(first, second)
    assert.deepEqual((await db.query('select plan_key,is_plan_comped,stripe_subscription_id from clubs')).rows, [{ plan_key: 'matchday', is_plan_comped: false, stripe_subscription_id: null }])
    assert.equal((await db.query('select count(*)::int as n from teams')).rows[0].n, 1)
    assert.equal((await db.query('select user_id from team_staff')).rows[0].user_id, actor)
    assert.equal((await db.query('select count(*)::int as n from app_private.deleted_workspace_access')).rows[0].n, 1)
    assert.equal((await db.query('select club_id from stripe_checkout_records')).rows[0].club_id, null)
    await assert.rejects(db.query('select public.reserve_coach_club_promotion($1,$2,$3,$4)', [actor, first, 'FP-0123456789ABCDEF', { planKey: 'club', billingCycle: 'monthly' }]), /cannot be used again/)
    const cleanAdmin='10000000-0000-4000-8000-000000000009'
    await db.query("insert into public.users(id,email,role,role_rank,club_id) values ($1,'clean-admin@example.test','head_manager',70,$2)",[cleanAdmin,first])
    await db.query('update clubs set workspace_owner_user_id=$1 where id=$2',[cleanAdmin,first])
    await assert.rejects(db.query('select public.reserve_coach_club_promotion($1,$2,$3,$4)', [cleanAdmin, first, 'FP-0123456789ABCDEF', { planKey: 'club', billingCycle: 'monthly' }]), /cannot be used again/)
    await db.query('delete from clubs where id=$1', [first])
    assert.equal((await db.query('select count(*)::int as n from app_private.coach_club_promotion_returners where user_id=$1',[actor])).rows[0].n, 1)
    assert.equal((await db.query('select count(*)::int as n from app_private.coach_club_promotion_returning_clubs')).rows[0].n, 1)
  } finally { await db.close() }
})

test('real SQL bounds attempts, supersedes old codes, rejects expired requests and limits service-only authority', async () => {
  const db = await database()
  try {
    await ready(db)
    for (let i = 0; i < 5; i++) assert.equal((await db.query('select public.claim_fresh_coach_signup_code($1,$2) as r', [requestId, 'b'.repeat(64)])).rows[0].r, null)
    assert.equal((await db.query('select public.claim_fresh_coach_signup_code($1,$2) as r', [requestId, 'a'.repeat(64)])).rows[0].r, null)
    await ready(db, '20000000-0000-4000-8000-000000000002')
    assert.equal((await db.query('select public.claim_fresh_coach_signup_code($1,$2) as r', [requestId, 'a'.repeat(64)])).rows[0].r, null)
    await db.exec("update app_private.fresh_coach_signup_requests set expires_at=now()-interval '1 second'")
    await assert.rejects(db.query('select public.complete_fresh_coach_signup($1,$2)', [requestId, actor]), /new verification/)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select public.get_fresh_coach_signup_candidate($1)', [email]), /permission denied/)
      await assert.rejects(db.query('select public.complete_fresh_coach_signup($1,$2)', [requestId, actor]), /permission denied/)
      await assert.rejects(db.query('select * from app_private.fresh_coach_signup_requests'), /permission denied/)
      await db.exec('reset role')
    }
  } finally { await db.close() }
})

test('delayed older delivery cannot invalidate the newest request and claims are single use', async () => {
  for (const pauseAt of ['candidate', 'delivery']) {
    const db = await database(), newer = '20000000-0000-4000-8000-000000000002'
    let release, reached
    const held = new Promise(resolve => { release = resolve }), paused = new Promise(resolve => { reached = resolve })
    const delivered = [], dbClient = id => ({ rpc: async (name, args) => {
      if (id === requestId && pauseAt === 'candidate' && name === 'get_fresh_coach_signup_candidate') { reached(); await held }
      const parameters = Object.values(args), placeholders = parameters.map((_, index) => '$'+(index+1)).join(',')
      try { return { data: (await db.query(`select public.${name}(${placeholders}) as r`, parameters)).rows[0].r } } catch (error) { return { error } }
    } })
    const worker = id => createFreshSignupWorker({ createAdminClient: () => dbClient(id), secret: () => secret, newCode: () => id === requestId ? '11111111' : '22222222', deliver: async message => {
      if (id === requestId && pauseAt === 'delivery') { reached(); await held }
      delivered.push(message.html)
    } })({ ...event({ requestId: id }), headers: { authorization: `Bearer ${freshSignupDigest(secret, 'fresh-signup-worker', id)}` } })
    try {
      await db.query('select public.queue_fresh_coach_signup($1,$2,$3,$4)', [requestId, email, 'Coach', 'Team'])
      const olderWorker = worker(requestId)
      await paused
      await db.query('select public.queue_fresh_coach_signup($1,$2,$3,$4)', [newer, email, 'Coach', 'Team'])
      await worker(newer); release(); await olderWorker
      assert.ok(delivered.some(html => html.includes('22222222')))
      assert.equal((await db.query('select public.claim_fresh_coach_signup_code($1,$2) as r', [requestId, freshSignupDigest(secret, 'fresh-signup-code', `${requestId}:11111111`)])).rows[0].r, null)
      const claims = await Promise.all([1,2].map(() => db.query('select public.claim_fresh_coach_signup_code($1,$2) as r', [newer, freshSignupDigest(secret, 'fresh-signup-code', `${newer}:22222222`)])))
      assert.equal(claims.filter(result => result.rows[0].r?.user_id === actor).length, 1)
    } finally { release(); await db.close() }
  }
})

test('email delivery failure clears the usable digest and active or unconfirmed accounts are ineligible', async () => {
  const db = await database()
  try {
    await db.query('update auth.users set email_confirmed_at=null where id=$1', [actor])
    assert.equal((await db.query('select public.get_fresh_coach_signup_candidate($1) as r', [email])).rows[0].r, null)
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [actor])
    await ready(db)
    await db.query("select public.mark_fresh_coach_signup_delivery($1,'failed')", [requestId])
    assert.deepEqual((await db.query('select state,code_digest from app_private.fresh_coach_signup_requests')).rows, [{ state: 'failed', code_digest: null }])
    await db.query('insert into users(id,email) values ($1,$2)', [actor,email])
    assert.equal((await db.query('select public.get_fresh_coach_signup_candidate($1) as r', [email])).rows[0].r, null)
    const replacement = '10000000-0000-4000-8000-000000000002'
    await db.query('insert into app_private.coach_club_promotion_returners(user_id,email_sha256) values ($1,encode(sha256(convert_to($2,\'UTF8\')),\'hex\'))', [actor,email])
    await db.query('delete from users where id=$1', [actor]); await db.query('delete from auth.users where id=$1', [actor])
    await db.query('insert into auth.users values ($1,$2,now())', [replacement,email])
    assert.equal((await db.query('select public.is_returning_coach_signup_actor($1) as r', [replacement])).rows[0].r, true)
  } finally { await db.close() }
})

test('provider failure invalidates the issued code and provisioning failure rolls back the whole new workspace', async () => {
  const marks=[]
  const worker=createFreshSignupWorker({secret:()=>secret,newCode:()=>code,createAdminClient:()=>({rpc:async(name,body)=>{
    if(name==='mark_fresh_coach_signup_delivery')marks.push(body.p_state)
    return {data:name==='claim_fresh_coach_signup_delivery'?{email,team_name:'Team'}:name==='get_fresh_coach_signup_candidate'?{id:actor,email}:true}
  }}),deliver:async()=>{throw new Error('provider unavailable')}})
  await worker({...event({requestId}),headers:{authorization:`Bearer ${freshSignupDigest(secret,'fresh-signup-worker',requestId)}`}})
  assert.deepEqual(marks,['sent','failed'])
  const db=await database()
  try{
    await ready(db);await db.query('select public.claim_fresh_coach_signup_code($1,$2)',[requestId,'a'.repeat(64)])
    await db.exec("create or replace function public.seed_default_club_roles_for_actor(uuid,uuid,text) returns void language plpgsql as $$ begin raise exception 'fixture seed failed'; end $$;")
    await assert.rejects(db.query('select public.complete_fresh_coach_signup($1,$2)',[requestId,actor]),/fixture seed failed/)
    for(const table of ['clubs','users','teams','team_staff'])assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n,0)
    assert.equal((await db.query('select state from app_private.fresh_coach_signup_requests')).rows[0].state,'claimed')
  }finally{await db.close()}
})

async function actualFunction(file, name, dependencies) {
  const source = await readFile(file, 'utf8'), nodes = parse(source, { sourceType: 'module' }).program.body
  const node = nodes.map(node => node.declaration || node).find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node)
  return new Function(...Object.keys(dependencies), source.slice(node.start,node.end)+`;return ${name}`)(...Object.values(dependencies))
}

test('both billing entry points reject old unbound paid records for returners and accept new explicitly bound payments', async () => {
  for (const name of ['getLatestCheckoutRecord','claimLatestCheckout']) {
    for (const returning of [true,false]) for (const bound of [true,false]) {
      const clubId='30000000-0000-4000-8000-000000000003', writes=[]
      const record={id:'payment',club_id:bound?clubId:null,claimed_at:null,plan_key:'club',customer_email:email}
      const db={rpc:async()=>({data:returning}),from:table=>{
        const filters=[],q={select:()=>q,ilike:()=>q,in:()=>q,order:()=>q,limit:()=>q,
          eq:(key,value)=>{filters.push(row=>row[key]===value);return q},is:(key,value)=>{filters.push(row=>row[key]===value);return q},
          or:()=>{filters.push(row=>(row.club_id===null&&row.claimed_at===null)||row.club_id===clubId);return q},
          update:body=>{writes.push([table,body]);return q},
          maybeSingle:async()=>({data:table==='stripe_checkout_records'?(filters.every(filter=>filter(record))?record:null):{plan_key:'club'}}),
          single:async()=>({data:record}),then:resolve=>resolve({data:null})};return q}}
      const fn=await actualFunction(`netlify/functions/${name==='getLatestCheckoutRecord'?'ensure-signup-club-profile':'claim-stripe-checkout'}.js`,name,{supabaseAdmin:db,isReturningCoachSignupActor,normalizeEmail:value=>value.trim().toLowerCase(),shouldPromoteBillPayer:()=>false,promoteClubBillPayerToAdmin:()=>assert.fail('No unrelated promotion')})
      const result=await fn({id:actor,email,club_id:clubId},clubId)
      assert.equal(Boolean(result),bound||!returning,`${name}, returning ${returning}, bound ${bound}`)
      if(returning&&!bound)assert.equal(writes.length,0)
    }
  }
  await assert.rejects(isReturningCoachSignupActor({rpc:async()=>({data:null})},actor),/safely/)
})

test('mobile profile errors retain authoritative removed-access codes and HTTP status', async () => {
  const fn=await actualFunction('apps/mobile-core/src/mobileSignup.js','mobileAccountRequest',{
    supabase:{},getAccessToken:async()=> 'test-token',getMobileRuntimeConfig:()=>({apiBaseUrl:'https://test.invalid'}),
    fetchJsonWithTimeout:async()=>({ok:false,response:{status:403},result:{success:false,code:'workspace_access_removed',message:'Access removed.'}}),
  })
  await assert.rejects(fn('coach','ensure-signup-club-profile',{}),error=>error.code==='workspace_access_removed'&&error.status===403)
})
