import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const { PGlite } = require('@electric-sql/pglite')
const migration = await readFile(new URL('../supabase/migrations/20261004152308_atomic_match_day_participation_renewal.sql', import.meta.url), 'utf8')
const deliveryHelperSource = await readFile(new URL('../netlify/functions/lib/_scheduled-email-payload.js', import.meta.url), 'utf8')
const trustedSender = 'Football Player <trusted-sender@example.invalid>'
// Execute the unchanged downstream helper. Only configured sender resolution is
// stubbed; no provider, network client, credentials or actual send is imported.
const buildPreparedScheduledEmail = new Function('createFromAddress',
  deliveryHelperSource.replace(/^import\s[\s\S]*?from\s+['"][^'"\n]+['"]\s*\r?\n/gm, '').replace(/^export /gm, '')
  + '\nreturn buildPreparedScheduledEmail;')(() => trustedSender)
// Synthetic schema contracts only. No live schema/data, credentials or network.
// Existing authority/plan helpers are controlled seams, not claimed as integration-tested.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const digest = value => createHash('sha256').update(value).digest('hex')
const schema = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
create table auth.users(id uuid primary key, deleted_at timestamptz, email_confirmed_at timestamptz default now(), banned_until timestamptz);
create table public.users(id uuid primary key, status text, role text, role_rank integer, club_id uuid, email text);
create table public.clubs(id uuid primary key, status text, timezone_name text);
create table public.user_club_memberships(auth_user_id uuid, club_id uuid, role text, role_rank integer);
create table public.match_days(id uuid primary key, club_id uuid, team_id uuid, deleted_at timestamptz, status text, concluded_at timestamptz, match_date date);
create table public.players(id uuid primary key, club_id uuid, status text, archived_at timestamptz);
create table public.player_team_memberships(id uuid primary key default gen_random_uuid(), player_id uuid, club_id uuid, team_id uuid, status text, ended_at timestamptz);
create table public.calendar_event_invites(id uuid primary key default gen_random_uuid(), match_day_id uuid, player_id uuid, club_id uuid, team_id uuid, invite_status text, cancelled_at timestamptz);
create table public.parent_player_links(id uuid primary key, player_id uuid, club_id uuid, team_id uuid, auth_user_id uuid, email text, status text);
create table public.adult_player_account_links(id uuid primary key, player_id uuid, club_id uuid, team_id uuid, user_id uuid);
create table public.synthetic_eligible(player_id uuid, recipient_email text, recipient_type text, parent_link_id uuid);
create function public.event_player_eligible_recipients(uuid, uuid, uuid[]) returns setof public.synthetic_eligible language sql stable as $$ select * from public.synthetic_eligible where player_id = any($3) $$;
create function public.can_manage_match_day(uuid) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.manage', true), '')::boolean, true) $$;
create function public.current_user_billing_staff_mutation_allowed(uuid) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.billing', true), '')::boolean, true) $$;
create function public.can_use_plan_feature(uuid, text) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.plan', true), '')::boolean, true) $$;
create table public.match_day_availability_requests(id uuid primary key, match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, channel text, recipient_email text, recipient_type text, parent_link_id uuid, token_hash text, token_version integer, token_revoked_at timestamptz, token_revoked_reason text, token_revoked_by uuid, token_revoked_source text, expires_at timestamptz, updated_at timestamptz, status text, responded_at timestamptz, volunteer_scorer_response text);
create table public.event_player_invitation_actions(id uuid primary key default gen_random_uuid(), idempotency_key uuid not null unique, club_id uuid, team_id uuid, source_type text, event_id uuid, player_id uuid, action text, actor_id uuid, status text default 'processing', result jsonb default '{}', completed_at timestamptz, failure_detail text);
create table public.scheduled_email_queue(id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid, created_by uuid, created_by_email text, to_email text, subject text, status text, scheduled_at timestamptz, payload jsonb);
create table public.match_day_event_log(id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid, match_day_id uuid, player_id uuid, actor_user_id uuid, actor_role text, event_type text, event_label text, metadata jsonb);
create table public.synthetic_answers(id uuid primary key, value jsonb);
`;
async function setup(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(schema)
  await db.exec(migration)
  await db.exec(`select set_config('test.actor','${id(1)}', false);
    insert into auth.users(id) values ('${id(1)}');
    insert into public.users values ('${id(1)}','active','coach',50,'${id(2)}','coach@example.invalid');
    insert into public.clubs values ('${id(2)}','active','Europe/London');
    insert into public.user_club_memberships values ('${id(1)}','${id(2)}','coach',50);
    insert into public.match_days values ('${id(4)}','${id(2)}','${id(3)}',null,'scheduled',null,'2099-10-10');
    insert into public.players values ('${id(5)}','${id(2)}','active',null);
    insert into public.player_team_memberships(player_id,club_id,team_id,status) values ('${id(5)}','${id(2)}','${id(3)}','active');
    insert into public.calendar_event_invites(match_day_id,player_id,club_id,team_id,invite_status) values ('${id(4)}','${id(5)}','${id(2)}','${id(3)}','active');
    insert into public.synthetic_answers values ('${id(6)}','{"source":"staff_on_behalf","status":"available","history":["available"]}');`)
  const units = []
  for (let n = 0; n < 2; n++) {
    const requestId = id(10 + n), link = id(20 + n), rawToken = String(n + 1).repeat(64), tokenHash = digest(rawToken)
    await db.query(`insert into public.parent_player_links values ($1,$2,$3,$4,null,$5,'active')`, [link,id(5),id(2),id(3),`guardian${n}@example.invalid`])
    await db.query(`insert into public.synthetic_eligible values ($1,$2,'parent_guardian',$3)`,[id(5),`guardian${n}@example.invalid`,link])
    await db.query(`insert into public.match_day_availability_requests(id,match_day_id,club_id,team_id,player_id,channel,recipient_email,recipient_type,parent_link_id,token_hash,token_version,token_revoked_at,token_revoked_reason,status,volunteer_scorer_response)
      values ($1,$2,$3,$4,$5,'email',$6,'parent',$7,$8,1,'2099-08-31','event_participation_removed','available','yes')`,[requestId,id(4),id(2),id(3),id(5),`guardian${n}@example.invalid`,link,digest('a'.repeat(64))])
    units.push({requestId, parentLinkId: link, expectedTokenVersion: 1, rawToken, tokenHash,
      payload: {resendPayload:{to:[`guardian${n}@example.invalid`],subject:'Synthetic invitation',html:'',text:''},
        matchDayAvailability:{requestId,matchDayId:id(4),playerId:id(5),parentLinkId:link,rawToken,tokenHash,purpose:'availability_request_notification'}}})
  }
  const call = async (key = id(30), values = units, fixture = id(4), player = id(5)) => (await db.query('select public.renew_match_day_participation_invitations($1,$2,$3,$4::jsonb) as result',[key,fixture,player,JSON.stringify(values)])).rows[0].result
  const snapshot = async () => {
    const output = {}
    for (const table of ['match_day_availability_requests','scheduled_email_queue','event_player_invitation_actions','match_day_event_log','synthetic_answers']) {
      output[table] = (await db.query(`select * from public.${table} order by id`)).rows
    }
    return output
  }
  return {db,units,call,snapshot}
}
test('actual SQL commits both guardians once; answer/history and volunteer data remain intact', async t => {
  const {db,call,snapshot} = await setup(t), before = await snapshot()
  const result = await call(), after = await snapshot()
  assert.equal(result.queuedCount,2); assert.equal(result.sentCount,0)
  assert.deepEqual(after.synthetic_answers,before.synthetic_answers)
  assert.equal(after.scheduled_email_queue.length,2); assert.equal(after.event_player_invitation_actions[0].status,'completed')
  assert.equal(after.match_day_event_log.length,2)
  for (const row of after.match_day_availability_requests) {
    assert.equal(row.token_version,2); assert.equal(row.token_revoked_at,null)
    assert.equal(row.status,'available'); assert.equal(row.volunteer_scorer_response,'yes')
    assert.notEqual(row.token_hash,digest('a'.repeat(64)))
    const queue = after.scheduled_email_queue.find(q => q.to_email === row.recipient_email)
    assert.equal(digest(queue.payload.matchDayAvailability.rawToken),row.token_hash)
  }
  assert.equal((await call()).duplicate,true)
  assert.deepEqual(await snapshot(),after)
  await assert.rejects(call(id(31)),/recipients changed/)
  assert.deepEqual(await snapshot(),after)
  assert.equal((await db.query(`select has_function_privilege('anon','public.renew_match_day_participation_invitations(uuid,uuid,uuid,jsonb)','execute') as allowed`)).rows[0].allowed,false)
})
for (const position of [0,1]) test(`queue failure for guardian ${position + 1} rolls back all units, ledger and audit; same-key retry succeeds`, async t => {
  const {db,call,snapshot} = await setup(t), before = await snapshot()
  await db.exec(`create function public.synthetic_fail_queue() returns trigger language plpgsql as $$ begin if new.to_email = 'guardian${position}@example.invalid' then raise exception 'synthetic queue failure'; end if; return new; end $$;
    create trigger synthetic_fail before insert on public.scheduled_email_queue for each row execute function public.synthetic_fail_queue();`)
  await assert.rejects(call(),/synthetic queue failure/)
  assert.deepEqual(await snapshot(),before)
  await db.exec('drop trigger synthetic_fail on public.scheduled_email_queue')
  assert.equal((await call()).queuedCount,2)
  assert.equal((await call()).duplicate,true)
})
for (const [name,sql] of [
  ['genuinely revoked Parent',`update public.parent_player_links set status='revoked' where id='${id(20)}'; update public.synthetic_eligible set parent_link_id=null where parent_link_id='${id(20)}'`],
  ['changed preview version',`update public.match_day_availability_requests set token_version=2 where id='${id(10)}'`],
  ['cancelled participation',`update public.calendar_event_invites set invite_status='cancelled'`],
  ['closed fixture',`update public.match_days set concluded_at=now()`],
  ['Parent role',`update public.users set role='parent_portal',role_rank=100`],
  ['inactive actor',`update public.users set status='inactive'`],
  ['wrong team authority',`select set_config('test.manage','false',false)`],
  ['banned Coach account',`update auth.users set banned_until='2099-12-31' where id='${id(1)}'`],
  ['payment required',`select set_config('test.billing','false',false)`],
  ['disabled plan',`select set_config('test.plan','false',false)`],
  ['real account revocation reason',`update public.match_day_availability_requests set token_revoked_reason='parent_link_revoked' where id='${id(10)}'`],
]) test(`${name} rejects with zero transaction changes`, async t => {
  const {db,call,snapshot} = await setup(t)
  await db.exec(sql); const before = await snapshot()
  await assert.rejects(call()); assert.deepEqual(await snapshot(),before)
})
test('preview set and payload address cannot silently broaden recipient scope', async t => {
  const {call,units,snapshot} = await setup(t), before = await snapshot()
  await assert.rejects(call(id(30),units.slice(0,1)),/recipients changed/)
  const changed = structuredClone(units); changed[0].payload.resendPayload.to = ['other@example.invalid']
  await assert.rejects(call(id(30),changed),/queue payload/)
  await assert.rejects(call(id(30),[units[0],units[0]]),/Duplicate/)
  const reused = structuredClone(units); reused[1].tokenHash = reused[0].tokenHash
  await assert.rejects(call(id(30),reused),/distinct replacement token/)
  await assert.rejects(call(id(30),units,id(999)),/authority/)
  assert.deepEqual(await snapshot(),before)
})
test('concurrent same-key and different-key calls do not double-rotate or double-queue', async t => {
  const {call,snapshot} = await setup(t)
  const same = await Promise.all([call(),call()])
  assert.deepEqual(same.map(result => result.duplicate).sort(),[false,true])
  const other = await Promise.allSettled([call(id(31)),call(id(32))])
  assert.equal(other.filter(result => result.status==='fulfilled').length,0)
  const after = await snapshot()
  assert.equal(after.scheduled_email_queue.length,2)
  assert.ok(after.match_day_availability_requests.every(row => row.token_version===2))
  // PGlite serialises execution on one connection; cross-session lock scheduling remains unrun.
})
test('completed replay cannot cross actor or Player scope', async t => {
  const {db,call,snapshot} = await setup(t)
  await call(); const before = await snapshot()
  await assert.rejects(call(id(30),[],id(4),id(999)),/another action/)
  await db.exec(`insert into auth.users(id) values ('${id(100)}'); insert into public.users select '${id(100)}',status,role,role_rank,club_id,'other@example.invalid' from public.users;
    insert into public.user_club_memberships select '${id(100)}',club_id,role,role_rank from public.user_club_memberships;
    select set_config('test.actor','${id(100)}',false)`)
  await assert.rejects(call(),/another action/)
  assert.deepEqual(await snapshot(),before)
})

async function installSourceRecipientResolver(db) {
  const recipientSource = await readFile(new URL('../supabase/migrations/20260819160000_public_release_contact_authority_74.sql', import.meta.url),'utf8')
  const canonicalSource = await readFile(new URL('../supabase/migrations/20260804120936_fp_v1_calendar_invite_recipient_integrity_34.sql', import.meta.url),'utf8')
  const functionBody = (source,name) => {
    const start = source.indexOf(`create or replace function public.${name}(`)
    const first = source.indexOf('$$',start), end = source.indexOf('$$;',first+2)+3
    assert.ok(start>=0 && first>start && end>first)
    return source.slice(start,end)
  }
  await db.exec(`drop function public.event_player_eligible_recipients(uuid,uuid,uuid[]);
    alter table public.players add column player_name text, add column parent_email text, add column parent_name text, add column parent_contacts jsonb, add column contact_type text;
    alter table auth.users add column email text, add column raw_user_meta_data jsonb default '{}';
    alter table public.adult_player_account_links add column status text, add column verified_at timestamptz, add column revoked_at timestamptz;
    update public.players set player_name='Synthetic Player',contact_type='parent',parent_email='guardian0@example.invalid',parent_contacts='[{"email":"guardian0@example.invalid"},{"email":"guardian1@example.invalid"}]';`)
  for (let n=0;n<2;n++) {
    await db.query('insert into auth.users(id,email) values ($1,$2)',[id(40+n),`guardian${n}@example.invalid`])
    await db.query('update public.parent_player_links set auth_user_id=$1 where id=$2',[id(40+n),id(20+n)])
  }
  await db.exec(functionBody(canonicalSource,'canonical_calendar_invite_recipient_type'))
  await db.exec(functionBody(recipientSource,'event_player_eligible_recipients'))
}
test('source recipient resolver plus new SQL restores current verified guardians and preserves old-token invalidation',async t=>{
  const {db,call,snapshot}=await setup(t);await installSourceRecipientResolver(db)
  const currentTokenSource=await readFile(new URL('../supabase/migrations/20260802214626_team_removal_event_scope_26c.sql', import.meta.url),'utf8')
  const start=currentTokenSource.indexOf('create or replace function public.is_match_day_action_token_current_internal(')
  const first=currentTokenSource.indexOf('$$',start),end=currentTokenSource.indexOf('$$;',first+2)+3
  await db.exec(currentTokenSource.slice(start,end))
  const tokenCurrent=async hash=>(await db.query('select public.is_match_day_action_token_current_internal($1) as current',[hash])).rows[0].current
  assert.equal(await tokenCurrent(digest('a'.repeat(64))),false)
  assert.equal((await call()).queuedCount,2)
  const after=await snapshot()
  assert.ok(after.match_day_availability_requests.every(row=>row.token_hash!==digest('a'.repeat(64))))
  assert.equal(await tokenCurrent(digest('a'.repeat(64))),false)
  for (const row of after.match_day_availability_requests) assert.equal(await tokenCurrent(row.token_hash),true)
})
for (const [name,sql] of [
  ['Parent link revoked',`update public.parent_player_links set status='revoked' where id='${id(20)}'`],
  ['Parent account banned',`update auth.users set banned_until='2099-12-31' where id='${id(40)}'`],
  ['Parent account deleted',`update auth.users set deleted_at=now() where id='${id(40)}'`],
  ['unlinked legacy request with revoked Parent',`update public.parent_player_links set status='revoked' where id='${id(20)}';update public.match_day_availability_requests set parent_link_id=null where id='${id(10)}'`],
]) test(`source resolver: ${name} cannot regain authority by email fallback`,async t=>{
  const {db,call,units,snapshot}=await setup(t);await installSourceRecipientResolver(db);await db.exec(sql)
  const before=await snapshot(),supplied=structuredClone(units)
  if(name.startsWith('unlinked')) supplied[0].parentLinkId=null
  await assert.rejects(call(id(30),supplied));assert.deepEqual(await snapshot(),before)
})
test('dual-role account uses current staff authority; changing to Parent role cannot execute renewal',async t=>{
  const {db,call,snapshot}=await setup(t);await installSourceRecipientResolver(db)
  await db.exec(`update auth.users set email='guardian0@example.invalid' where id='${id(1)}';
    update public.parent_player_links set auth_user_id='${id(1)}' where id='${id(20)}'`)
  assert.equal((await call()).queuedCount,2)
  await db.exec(`update public.users set role='parent_portal';update public.user_club_memberships set role='parent_portal'`)
  const before=await snapshot();await assert.rejects(call());assert.deepEqual(await snapshot(),before)
})

function attackDeliveryFields(units) {
  const attack = structuredClone(units)
  for (const unit of attack) {
    Object.assign(unit.payload.resendPayload, {
      cc: ['unapproved-copy@example.invalid'], bcc: ['unapproved-hidden@example.invalid'],
      from: 'Forged sender <forged@example.invalid>', reply_to: 'unapproved-reply@example.invalid',
      headers: { 'Bcc': 'unapproved-header@example.invalid' }, attachments: [{ filename: 'foreign.txt', content: 'synthetic' }],
      emailAppRole: 'coach', emailCcAppRole: 'coach', recipient: 'unapproved-alias@example.invalid',
    })
    Object.assign(unit.payload, {
      actorId: id(900), actorEmail: 'foreign-actor@example.invalid', actorRole: 'super_admin', clubId: id(901), teamId: id(902),
      displayName: 'Forged sender', playerName: 'Forged target', parentName: 'Forged recipient',
      requiredFeature: 'foreignFeature', visibleInEmailQueue: true,
      trainingInvitation: { requestPlayerId: id(903) }, calendarNotification: { id: id(904) },
      resourceNotification: { id: id(905) }, parentPortalInvite: { id: id(906) },
      trialEventInvitation: { id: id(907) }, availabilityFollowUp: { id: id(908) },
      parentCommunication: { appNotificationSentAt: '2099-01-01T00:00:00Z', channel: 'app' },
      communicationLog: { playerId: id(909), recipientEmail: 'unapproved-log@example.invalid' },
      eventPlayerInvitationAction: { idempotencyKey: id(910), playerId: id(911), sourceType: 'calendar' },
    })
    unit.payload.matchDayAvailability.foreignControl = { playerId: id(912) }
  }
  return attack
}
function assertApprovedDelivery(row) {
  const payload = row.payload
  assert.deepEqual(Object.keys(payload).sort(), ['resendPayload','displayName','playerName','parentName','matchDayAvailability',
    'clubId','teamId','actorId','actorEmail','actorRole','requiredFeature','visibleInEmailQueue','eventPlayerInvitationAction','communicationLog'].sort())
  assert.deepEqual(Object.keys(payload.resendPayload).sort(), ['emailAppRole','to','subject','html','text'].sort())
  assert.deepEqual(Object.keys(payload.matchDayAvailability).sort(), ['matchDayId','requestId','playerId','parentLinkId','purpose','rawToken','tokenHash'].sort())
  assert.equal(payload.clubId,id(2)); assert.equal(payload.teamId,id(3)); assert.equal(payload.actorId,id(1))
  assert.equal(payload.actorEmail,'coach@example.invalid'); assert.equal(payload.actorRole,'coach')
  assert.equal(payload.requiredFeature,'parentEmails'); assert.equal(payload.visibleInEmailQueue,false)
  assert.equal(payload.displayName,'Football Player'); assert.notEqual(payload.playerName,'Forged target'); assert.notEqual(payload.parentName,'Forged recipient')
  assert.equal(payload.communicationLog.recipientEmail,row.to_email)
  assert.equal(payload.communicationLog.playerId,id(5)); assert.equal(payload.communicationLog.userId,id(1))
  assert.equal(payload.eventPlayerInvitationAction.idempotencyKey,id(30))
  assert.equal(payload.eventPlayerInvitationAction.playerId,id(5)); assert.equal(payload.eventPlayerInvitationAction.sourceType,'match-day')
  assert.deepEqual(payload.resendPayload.to,[row.to_email]); assert.equal(payload.resendPayload.emailAppRole,'parent')
  const prepared = buildPreparedScheduledEmail(row, { role: 'system', roleRank: 100 })
  assert.deepEqual(prepared.recipients,[row.to_email]); assert.deepEqual(prepared.emailPayload.to,[row.to_email]); assert.deepEqual(prepared.senderCopyEmails,[])
  for (const key of ['cc','bcc','reply_to','headers','attachments','recipient']) assert.equal(Object.hasOwn(prepared.emailPayload,key),false,key)
  assert.equal(prepared.emailPayload.from,trustedSender); assert.equal(prepared.emailPayload.emailAppRole,'parent'); assert.equal(prepared.emailPayload.emailCcAppRole,undefined)
}
test('actual SQL strips attacker delivery controls and foreign queue routes before the real helper sees them',async t=>{
  const {call,units,snapshot}=await setup(t),before=await snapshot()
  assert.equal((await call(id(30),attackDeliveryFields(units))).queuedCount,2)
  const after=await snapshot()
  assert.deepEqual(after.synthetic_answers,before.synthetic_answers)
  for (const row of after.scheduled_email_queue) assertApprovedDelivery(row)
  assert.ok(after.match_day_availability_requests.every(row=>row.volunteer_scorer_response==='yes' && row.status==='available'))
  assert.equal((await call(id(30),attackDeliveryFields(units))).duplicate,true)
  assert.deepEqual(await snapshot(),after)
})
test('sanitized two-guardian delivery still rolls back and recovers on the same key after second queue failure',async t=>{
  const {db,call,units,snapshot}=await setup(t),before=await snapshot(),attack=attackDeliveryFields(units)
  await db.exec(`create function public.synthetic_fail_payload_queue() returns trigger language plpgsql as $$ begin
    if new.to_email='guardian1@example.invalid' then raise exception 'synthetic second queue failure';end if;return new;end $$;
    create trigger synthetic_fail_payload_queue before insert on public.scheduled_email_queue for each row execute function public.synthetic_fail_payload_queue();`)
  await assert.rejects(call(id(30),attack),/synthetic second queue failure/)
  assert.deepEqual(await snapshot(),before)
  await db.exec('drop trigger synthetic_fail_payload_queue on public.scheduled_email_queue')
  assert.equal((await call(id(30),attack)).queuedCount,2)
  const after=await snapshot();for (const row of after.scheduled_email_queue) assertApprovedDelivery(row)
  assert.equal((await call(id(30),attack)).duplicate,true);assert.deepEqual(await snapshot(),after)
})
test('extra delivery fields cannot override exact to, Parent link, actor or revoked access guards',async t=>{
  for (const change of [
    env=>{env.units[0].payload.resendPayload.to.push('unapproved-direct@example.invalid')},
    env=>{env.units[0].payload.matchDayAvailability.parentLinkId=id(999)},
    async env=>{await env.db.exec(`update public.users set role='parent_portal'`)},
    async env=>{await env.db.exec(`update public.match_day_availability_requests set token_revoked_reason='parent_link_revoked' where id='${id(10)}'`)},
  ]) {
    const env=await setup(t);await change(env);const before=await env.snapshot()
    await assert.rejects(env.call(id(30),attackDeliveryFields(env.units)))
    assert.deepEqual(await env.snapshot(),before)
  }
})

for (const [zone,instant,today,yesterday] of [
 ['Europe/London','2026-10-04T23:30:00Z','2026-10-05','2026-10-04'],
 ['America/Los_Angeles','2026-10-05T00:30:00Z','2026-10-04','2026-10-03'],
 ['Asia/Tokyo','2026-10-04T15:30:00Z','2026-10-05','2026-10-04'],
]) test('actual renewal SQL uses authoritative Club date at midnight in '+zone,async t=>{
 const e=await setup(t)
 // Only the statement clock is replaced in this local SQL fixture. Production
 // comparison and Club-timezone lookup execute unchanged, including rollback.
 await e.db.exec(migration.replaceAll('pg_catalog.statement_timestamp()',"'"+instant+"'::timestamptz"))
 await e.db.query('update public.clubs set timezone_name=$1',[zone])
 await e.db.query('update public.match_days set match_date=$1',[yesterday])
 const before=await e.snapshot();await assert.rejects(e.call(),/closed for participation renewal/);assert.deepEqual(await e.snapshot(),before)
 await e.db.query('update public.match_days set match_date=$1',[today]);assert.equal((await e.call()).queuedCount,2)
})
