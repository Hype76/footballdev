import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
const {PGlite}=createRequire(import.meta.url)('@electric-sql/pglite')
const read=path=>readFile(path,'utf8'),source=new URL('../',import.meta.url)
const originalTest=(await read(new URL('./atomic-renewal.test.mjs',import.meta.url))).replace(/\r\n/g,'\n')
const migration=await read(new URL('../supabase/migrations/20261004152308_atomic_match_day_participation_renewal.sql',import.meta.url))
const actionSource=await read(new URL('supabase/migrations/20260730151849_calendar_response_polish_10a.sql',source))
const queueSource=await read(new URL('supabase/migrations/20260520120000_scheduled_email_queue.sql',source))
const table=(text,name)=>text.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]
let schema=originalTest.match(/const schema = `([\s\S]*?)`;/)[1]
schema=schema.replace(/create table public.event_player_invitation_actions\([^;]*;/,table(actionSource,'event_player_invitation_actions'))
schema=schema.replace(/create table public.scheduled_email_queue\([^;]*;/,table(queueSource,'scheduled_email_queue'))
schema=schema.replace('create table public.synthetic_eligible',`create role service_role;create table public.teams(id uuid primary key);create table public.synthetic_eligible`)
schema+=`alter table public.scheduled_email_queue enable row level security;
alter table public.event_player_invitation_actions enable row level security;alter table public.event_player_invitation_actions force row level security;
revoke all on public.event_player_invitation_actions from public,anon,authenticated;grant select,insert,update on public.event_player_invitation_actions to service_role;
grant usage on schema public,auth to anon,authenticated;`
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,digest=value=>createHash('sha256').update(value).digest('hex')
// Run the actual preserved setup/renewal SQL with exact original queue/ledger
// table definitions. Source authority/billing/recipient seams remain explicit.
const setupStart=originalTest.indexOf('async function setup(t) {')
const setupEnd=originalTest.indexOf('\ntest(',setupStart)
assert.ok(setupStart>=0&&setupEnd>setupStart)
let setupText=originalTest.slice(setupStart,setupEnd).trimEnd()
setupText=setupText.replace("insert into public.user_club_memberships values",`insert into public.teams values ('\$\{id(3)\}');insert into public.user_club_memberships values`)
const setup=new Function('PGlite','migration','schema','id','digest',setupText+';return setup')(PGlite,migration,schema,id,digest)

test('atomic renewal executes against actual original queue and ledger constraints under authenticated role',async t=>{
 const e=await setup(t);await e.db.exec('set role authenticated')
 const result=await e.call();assert.equal(result.queuedCount,2);assert.equal(result.sentCount,0)
 await assert.rejects(e.db.query('select * from public.event_player_invitation_actions'),/permission denied/)
 await assert.rejects(e.db.query('update public.match_day_availability_requests set token_version=99'),/permission denied/)
 await e.db.exec('reset role');const snapshot=await e.snapshot();assert.equal(snapshot.scheduled_email_queue.length,2)
 assert.ok(snapshot.event_player_invitation_actions.every(row=>row.status==='completed'))
 assert.equal((await e.call()).duplicate,true)
})

test('anon cannot call renewal; authenticated Parent and foreign Club cannot cross explicit scope',async t=>{
 const e=await setup(t),before=await e.snapshot()
 await e.db.exec('set role anon');await assert.rejects(e.call(),/permission denied/);await e.db.exec('reset role')
 for(const sql of [`update public.users set role='parent_portal'`,`update public.users set role='coach',club_id='${id(99)}'`]) {
  await e.db.exec(sql);await e.db.exec('set role authenticated');await assert.rejects(e.call(),/authority/);await e.db.exec('reset role')
 }
 assert.deepEqual(await e.snapshot(),before)
})

test('actual source RLS hides queue rows from authenticated callers despite temporary SELECT privilege',async t=>{
 const e=await setup(t);await e.call()
 // Local test-only grant proves actual RLS filtering rather than ACL denial.
 await e.db.exec('grant select on public.scheduled_email_queue to authenticated;set role authenticated')
 assert.equal((await e.db.query('select * from public.scheduled_email_queue')).rows.length,0)
 await assert.rejects(e.db.query(`insert into public.event_player_invitation_actions(idempotency_key,club_id,team_id,source_type,event_id,player_id,action,actor_id) values('${id(90)}','${id(2)}','${id(3)}','match-day','${id(4)}','${id(5)}','resend','${id(1)}')`),/permission denied/)
 await e.db.exec('reset role');assert.equal((await e.snapshot()).scheduled_email_queue.length,2)
})

test('FORCE RLS remains fail-closed for non-bypass owner; release requires verified definer ownership',async t=>{
 const e=await setup(t),before=await e.snapshot()
 await e.db.exec(`create role synthetic_rpc_owner;grant usage on schema public,auth to synthetic_rpc_owner;
 grant select,insert,update on all tables in schema public to synthetic_rpc_owner;grant select,update on all tables in schema auth to synthetic_rpc_owner;
 alter function public.renew_match_day_participation_invitations(uuid,uuid,uuid,jsonb) owner to synthetic_rpc_owner;
 set role authenticated`)
 await assert.rejects(e.call(),/row-level security/)
 await e.db.exec('reset role');assert.deepEqual(await e.snapshot(),before)
})

test('synthetic database restart preserves completed renewal and queues without replay duplication',async t=>{
 const e=await setup({after:()=>{}});t.after(async()=>{if(!e.db.closed)await e.db.close()})
 assert.equal((await e.call()).queuedCount,2)
 const saved=await e.snapshot(),dump=await e.db.dumpDataDir();await e.db.close()
 const restarted=new PGlite({loadDataDir:dump});t.after(()=>restarted.close())
 await restarted.exec(`select set_config('test.actor','${id(1)}',false);set role authenticated`)
 const replay=(await restarted.query('select public.renew_match_day_participation_invitations($1,$2,$3,$4::jsonb) v',[id(30),id(4),id(5),JSON.stringify(e.units)])).rows[0].v
 assert.equal(replay.duplicate,true)
 await assert.rejects(restarted.query('select public.renew_match_day_participation_invitations($1,$2,$3,$4::jsonb)',[id(31),id(4),id(5),JSON.stringify(e.units)]),/recipients changed/)
 await restarted.exec('reset role')
 for(const table of ['scheduled_email_queue','event_player_invitation_actions','match_day_availability_requests','match_day_event_log','synthetic_answers']) {
  assert.deepEqual((await restarted.query(`select * from public.${table} order by id`)).rows,saved[table])
 }
})
