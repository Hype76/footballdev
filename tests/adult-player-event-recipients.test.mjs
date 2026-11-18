import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

process.env.VITE_SUPABASE_URL ||= 'https://fixture.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-key'
const { prepareScheduledTrainingInvitationRow } = await import('../netlify/functions/process-training-availability-requests.js')
const original = await readFile('supabase/migrations/20260823135328_promoted_player_matchday_recipient_fix_78.sql', 'utf8')
const repair = await readFile('supabase/migrations/20261118101931_adult_player_event_recipient_contact_authority.sql', 'utf8')
const identity = (await readFile('supabase/migrations/20261118101012_adult_player_calendar_rsvp_and_token_identity.sql', 'utf8')).split('-- Parent token branches remain unchanged.')[0]
const canonical = (await readFile('supabase/migrations/20260804120936_fp_v1_calendar_invite_recipient_integrity_34.sql', 'utf8')).split('create or replace function public.enforce_calendar_invite_recipient_type')[0]
const id = number => '10000000-0000-4000-8000-' + String(number).padStart(12, '0')
const ids = { player: id(3), club: id(7), team: id(8), adult: id(101), parent: id(102), link: id(103) }

async function database() {
 const db = new PGlite()
 await db.exec(`
  create schema auth; create schema app_private; create role anon; create role authenticated; create role service_role;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb,deleted_at timestamptz,email_confirmed_at timestamptz,banned_until timestamptz);
  create table public.users(id uuid primary key);
  create table public.user_club_memberships(auth_user_id uuid);
  create table public.clubs(id uuid primary key,status text,archived_at timestamptz);
  create table public.teams(id uuid primary key,club_id uuid,status text);
  create table public.players(id uuid primary key,club_id uuid,team_id uuid,player_name text,parent_name text,parent_email text,parent_contacts jsonb,contact_type text,status text,archived_at timestamptz,date_of_birth date);
  create table public.player_team_memberships(club_id uuid,team_id uuid,player_id uuid,status text,ended_at timestamptz);
  create table public.parent_player_links(id uuid primary key,club_id uuid,team_id uuid,player_id uuid,auth_user_id uuid,email text,status text);
  create table public.adult_player_account_links(id uuid primary key,club_id uuid,team_id uuid,player_id uuid,user_id uuid,status text,verified_at timestamptz,revoked_at timestamptz);
  insert into public.clubs values ('${ids.club}','active',null);
  insert into public.teams values ('${ids.team}','${ids.club}','active');
  insert into auth.users(id,email,email_confirmed_at) values ('${ids.adult}','adult@example.test',now()),('${ids.parent}','parent@example.test',now());
  insert into public.players values ('${ids.player}','${ids.club}','${ids.team}','Adult Player','Parent','parent@example.test','[{"type":"parent","email":"parent@example.test"},{"type":"self","email":"adult@example.test"}]','both','active',null,current_date-interval '20 years');
  insert into public.player_team_memberships values ('${ids.club}','${ids.team}','${ids.player}','active',null);
  insert into public.parent_player_links values ('${id(104)}','${ids.club}','${ids.team}','${ids.player}','${ids.parent}','parent@example.test','active');
  insert into public.adult_player_account_links values ('${ids.link}','${ids.club}','${ids.team}','${ids.player}','${ids.adult}','active',now(),null);
 `)
 // Apply the exact production helper and canonical recipient contract.
 await db.exec(canonical)
 await db.exec(identity)
 await db.exec(original)
 return db
}
const recipients = async db => (await db.query('select * from public.event_player_eligible_recipients($1,$2,$3)', [ids.club, ids.team, [ids.player]])).rows

test('real recipient repair adds verified self/both JSON contacts and preserves Parent recipients and service-only grants', async () => {
 const db = await database()
 try {
  const before = await recipients(db)
  assert.ok(before.every(row => row.recipient_type !== 'player'))
  await db.exec(repair)
  let after = await recipients(db)
  assert.deepEqual(after.filter(row => row.recipient_type !== 'player'), before)
  assert.equal(after.find(row => row.recipient_type === 'player').recipient_email, 'adult@example.test')
  await db.exec("update public.players set contact_type='self'")
  after = await recipients(db)
  assert.deepEqual(after.map(row => [row.recipient_type,row.recipient_email]), [['player','adult@example.test']])
  for (const [role, allowed] of [['anon',false],['authenticated',false],['service_role',true]]) {
   assert.equal((await db.query(`select has_function_privilege('${role}','public.event_player_eligible_recipients(uuid,uuid,uuid[])','execute') as allowed`)).rows[0].allowed, allowed)
  }
 } finally { await db.close() }
})

test('real recipient authority denies unverified, revoked, banned, deleted, changed contacts and wrong scope', async () => {
 const db = await database()
 try {
  await db.exec(repair)
  const changes = [
   "update auth.users set email_confirmed_at=null where id='"+ids.adult+"'",
   "update auth.users set banned_until=now()+interval '1 day' where id='"+ids.adult+"'",
   "update auth.users set deleted_at=now() where id='"+ids.adult+"'",
   "update auth.users set email='changed@example.test' where id='"+ids.adult+"'",
   "update public.adult_player_account_links set status='revoked',revoked_at=now()",
   'update public.adult_player_account_links set verified_at=null',
   "update public.players set parent_contacts='[{\"type\":\"self\",\"email\":\"changed@example.test\"}]'",
   "update public.players set contact_type='parent'",
   "update public.players set date_of_birth=current_date-interval '17 years'",
   "update public.players set team_id='"+id(999)+"'",
   "update public.players set status='archived'",
   "update public.player_team_memberships set status='inactive'",
   'update public.player_team_memberships set ended_at=now()',
   "update public.teams set status='archived'", 'update public.clubs set archived_at=now()',
   "insert into public.users values ('"+ids.adult+"')",
  ]
  for (const change of changes) {
   await db.exec('begin'); await db.exec(change)
   assert.equal((await recipients(db)).some(row => row.recipient_type === 'player'), false, change)
   await db.exec('rollback')
  }
 } finally { await db.close() }
})

// Reuse the existing queue fixture, while executing the real delivery refresh and real SQL resolver.
const fixtureSource = await readFile('tests/training-queue-unification-12b.test.mjs', 'utf8')
const fixtureStart = fixtureSource.indexOf('function createReadClient('), fixtureEnd = fixtureSource.indexOf("test('automatic Training", fixtureStart)
const { createReadClient, buildCurrentFixture } = new Function('hashToken', fixtureSource.slice(fixtureStart, fixtureEnd) + '; return {createReadClient,buildCurrentFixture}')(
 token => createHash('sha256').update(token).digest('hex'))

test('actual Training delivery refresh accepts verified self/both JSON email and rejects changed or revoked authority', async () => {
 const db = await database()
 try {
  await db.exec(repair)
  for (const contactType of ['self','both']) {
   await db.query('update public.players set contact_type=$1',[contactType])
   const fixture = buildCurrentFixture()
   Object.assign(fixture.rows.players, { contact_type: contactType, parent_email: 'parent@example.test', parent_contacts: [{type:'self',email:'adult@example.test'}] })
   Object.assign(fixture.rows.training_availability_request_players, { recipient_type:'player', recipient_email:'adult@example.test', parent_link_id:null })
   Object.assign(fixture.row.payload.trainingInvitation, { recipientType:'player', recipientEmail:'adult@example.test', parentLinkId:null })
   const client = { ...createReadClient(fixture.rows), rpc: async (name,args) => {
    assert.equal(name,'event_player_eligible_recipients')
    return { data:(await db.query('select * from public.event_player_eligible_recipients($1,$2,$3)',[args.club_id_value,args.team_id_value,args.player_ids_value])).rows,error:null }
   } }
   const refresh = () => prepareScheduledTrainingInvitationRow(fixture.row,{supabaseClient:client})
   assert.equal((await refresh()).skipped,false)
   for (const change of ['update public.adult_player_account_links set verified_at=null', "update public.adult_player_account_links set status='revoked'", "update auth.users set email='changed@example.test' where id='"+ids.adult+"'"]) {
    await db.exec('begin'); await db.exec(change)
    const result=await refresh();assert.equal(result.skipped,true);assert.match(result.skipReason,/recipient authority changed/)
    await db.exec('rollback')
   }
  }
 } finally { await db.close() }
})
