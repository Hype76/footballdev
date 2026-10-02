import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261002100424_team_coach_reminder_integration.sql', import.meta.url), 'utf8')
const repair = migration.split('-- ADULT_SELF_RESPONSE_AUTHORITY')[1]
const installed = await readFile(new URL('./helpers/adult-self-response-installed-guards.sql', import.meta.url), 'utf8')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const adult = id(1), player = id(2), club = id(3), team = id(4), event = id(5), request = id(6)
const matchToken = 'a'.repeat(64), trainingToken = 'b'.repeat(64)

async function setup(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create schema auth;
    create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    create table users(id uuid primary key,club_id uuid,status text,email text);
    create table players(id uuid primary key,club_id uuid,team_id uuid,status text,archived_at timestamptz,date_of_birth date,contact_type text,parent_email text,parent_contacts jsonb);
    create table player_team_memberships(player_id uuid,club_id uuid,team_id uuid,status text,ended_at timestamptz);
    create table adult_player_account_links(user_id uuid,player_id uuid,club_id uuid,team_id uuid,status text,verified_at timestamptz,revoked_at timestamptz);
    create table parent_player_links(id uuid primary key,player_id uuid,club_id uuid,team_id uuid,status text,email text);
    create table match_days(id uuid primary key,club_id uuid,team_id uuid,status text,deleted_at timestamptz);
    create table match_day_availability_requests(id uuid primary key,match_day_id uuid,club_id uuid,team_id uuid,player_id uuid,parent_link_id uuid,recipient_type text,recipient_email text,token_hash text,token_revoked_at timestamptz,status text,expires_at timestamptz);
    create table calendar_events(id uuid primary key,club_id uuid,team_id uuid,cancelled_at timestamptz);
    create table training_availability_requests(id uuid primary key,calendar_event_id uuid,club_id uuid,team_id uuid,status text,occurrence_starts_at timestamptz);
    create table training_availability_request_players(id uuid primary key,request_id uuid,calendar_event_id uuid,club_id uuid,team_id uuid,player_id uuid,parent_link_id uuid,recipient_type text,recipient_email text,token_hash text,token_revoked_at timestamptz,status text,response_deadline_at timestamptz);
  `)
  await db.exec(installed)
  await db.exec('revoke all on function is_match_day_action_token_current_internal(text),is_training_availability_token_current_internal(text) from public; grant execute on function is_match_day_action_token_current_internal(text),is_training_availability_token_current_internal(text) to authenticated,service_role;')
  await db.query('insert into auth.users values($1,$2,now(),null,null)', [adult, 'adult@example.test'])
  await db.query("insert into players values($1,$2,$3,'active',null,'1990-01-01','self','adult@example.test','[]')", [player, club, team])
  await db.query("insert into player_team_memberships values($1,$2,$3,'active',null)", [player, club, team])
  await db.query("insert into adult_player_account_links values($1,$2,$3,$4,'active',now(),null)", [adult, player, club, team])
  await db.query("insert into match_days values($1,$2,$3,'scheduled',null)", [event, club, team])
  await db.query("insert into match_day_availability_requests values($1,$2,$3,$4,$5,null,'player','adult@example.test',$6,null,'pending',now()+interval '3 days')", [request, event, club, team, player, matchToken])
  await db.query('insert into calendar_events values($1,$2,$3,null)', [event, club, team])
  await db.query("insert into training_availability_requests values($1,$2,$3,$4,'sent',now()+interval '3 days')", [request, event, club, team])
  await db.query("insert into training_availability_request_players values($1,$1,$2,$3,$4,$5,null,'player','adult@example.test',$6,null,'sent',null)", [request, event, club, team, player, trainingToken])
  return db
}

async function current(db) {
  return (await db.query('select is_match_day_action_token_current_internal($1) match,is_training_availability_token_current_internal($2) training', [matchToken, trainingToken])).rows[0]
}

test('confirmed profile-free adult is rejected by installed guards and accepted by repair without changing execute grants', async t => {
  const db = await setup(t)
  const acl = async () => (await db.query("select proname,proacl::text from pg_proc where proname in ('is_match_day_action_token_current_internal','is_training_availability_token_current_internal') order by proname")).rows
  assert.deepEqual(await current(db), { match: false, training: false })
  const before = await acl()
  await db.exec(repair)
  assert.deepEqual(await current(db), { match: true, training: true })
  assert.deepEqual(await acl(), before)
  assert.equal((await db.query('select count(*)::int n from users')).rows[0].n, 0)
})

const deniedChanges = [
  ['unconfirmed Auth account', 'update auth.users set email_confirmed_at=null'],
  ['deleted Auth account', 'update auth.users set deleted_at=now()'],
  ['banned Auth account', "update auth.users set banned_until=now()+interval '1 day'"],
  ['changed Auth email', "update auth.users set email='other@example.test'"],
  ['revoked adult link', "update adult_player_account_links set status='revoked',revoked_at=now()"],
  ['unverified adult link', 'update adult_player_account_links set verified_at=null'],
  ['wrong team link', `update adult_player_account_links set team_id='${id(40)}'`],
  ['wrong club link', `update adult_player_account_links set club_id='${id(30)}'`],
  ['removed team membership', "update player_team_memberships set status='ended',ended_at=now()"],
  ['archived player', "update players set status='archived',archived_at=now()"],
  ['underage player', "update players set date_of_birth=current_date-interval '17 years'"],
  ['removed self-contact email', "update players set parent_email='other@example.test'"],
  ['Parent-only contact', "update players set contact_type='parent'"],
  ['revoked tokens', 'update match_day_availability_requests set token_revoked_at=now();update training_availability_request_players set token_revoked_at=now()'],
  ['expired invitations', "update match_day_availability_requests set expires_at=now()-interval '1 day';update training_availability_requests set occurrence_starts_at=now()-interval '1 day'"],
  ['cancelled events', "update match_days set status='cancelled';update calendar_events set cancelled_at=now()"],
]

test('both adult guards fail closed for invalid current authority, contact, membership and event windows', async t => {
  const db = await setup(t)
  await db.exec(repair)
  for (const [label, change] of deniedChanges) {
    await db.exec('begin')
    try {
      await db.exec(change)
      assert.deepEqual(await current(db), { match: false, training: false }, label)
    } finally { await db.exec('rollback') }
  }
  assert.deepEqual(await current(db), { match: true, training: true })
})

test('Parent and bearer-token branches preserve existing semantics independently of adult correction', async t => {
  const db = await setup(t)
  await db.query("insert into parent_player_links values($1,$2,$3,$4,'active','parent@example.test')", [id(7), player, club, team])
  await db.query("update match_day_availability_requests set parent_link_id=$1,recipient_type='parent',recipient_email='parent@example.test'", [id(7)])
  await db.query("update training_availability_request_players set parent_link_id=$1,recipient_type='parent',recipient_email='parent@example.test'", [id(7)])
  const before = await current(db)
  await db.exec(repair)
  assert.deepEqual(before, { match: true, training: true })
  assert.deepEqual(await current(db), before)
  await db.exec("update parent_player_links set status='revoked'")
  assert.deepEqual(await current(db), { match: false, training: false })
  const invalid = await db.query("select is_match_day_action_token_current_internal('invalid') match,is_training_availability_token_current_internal('invalid') training")
  assert.deepEqual(invalid.rows[0], { match: false, training: false })
})
