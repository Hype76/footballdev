import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const readMigration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const migration = await readMigration('20260915145208_parent_self_access_revocation.sql')
const authority = await readMigration('20260825133414_cross_club_parent_link_authority_100.sql')
const fans = await readMigration('20260907121942_fans_controlled_access.sql')
const chat = await readMigration('20260714120000_parent_portal_chat_v1.sql')
const id = (value) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`
let db

function functionDefinition(source, name) {
  const start = source.indexOf(`create or replace function ${name}(`)
  assert.ok(start >= 0, name)
  const end = source.indexOf('$$;', start)
  assert.ok(end > start, name)
  return source.slice(start, end + 3)
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',current_setting('test.email',true)) $$;
    grant usage on schema auth,public to authenticated,anon;
    grant usage on schema app_private to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table public.users(id uuid primary key,club_id uuid,role text,status text);
    create table public.clubs(id uuid primary key,status text);
    create table public.teams(id uuid primary key,club_id uuid,name text);
    create table public.players(id uuid primary key,club_id uuid,team_id uuid,status text,section text,archived_at timestamptz,parent_contacts jsonb default '[]');
    create table public.parent_player_links(
      id uuid primary key,club_id uuid,team_id uuid,player_id uuid,parent_link_id uuid,link_type text,
      email text,auth_user_id uuid,invite_token uuid not null unique default gen_random_uuid(),status text,
      invited_by uuid,invited_by_name text,accepted_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),expires_at timestamptz default now()+interval '1 day'
    );
    alter table public.parent_player_links enable row level security;
    grant select on public.parent_player_links to authenticated;
    create policy own_active_links on public.parent_player_links for select to authenticated
      using(auth_user_id=auth.uid() and status='active');
    create table public.fan_connections(id uuid primary key,parent_link_id uuid,player_id uuid,club_id uuid,invited_by uuid,auth_user_id uuid,status text);
    create table public.parent_chat_rooms(id uuid primary key default gen_random_uuid(),club_id uuid,team_id uuid,player_id uuid,room_type text,title text);
    create unique index parent_chat_player on public.parent_chat_rooms(club_id,team_id,player_id) where room_type='parent_staff';
    create unique index parent_chat_team on public.parent_chat_rooms(club_id,team_id) where room_type='team';
    create table public.test_chat_reconciliations(room_id uuid);
    create function public.parent_chat_reconcile_room(target uuid) returns void language sql as $$insert into public.test_chat_reconciliations values(target)$$;
    insert into auth.users values('${id(1)}','owner@synthetic.test',now()),('${id(2)}','other@synthetic.test',now()),('${id(3)}','fan@synthetic.test',now()),('${id(4)}','legacy@synthetic.test',now());
    insert into public.clubs values('${id(10)}','active'),('${id(14)}','active');
    insert into public.teams values('${id(11)}','${id(10)}','Team one'),('${id(12)}','${id(10)}','Old team'),('${id(13)}','${id(14)}','Other club team');
    insert into public.players(id,club_id,team_id,status,section) values('${id(20)}','${id(10)}','${id(11)}','active','Squad'),('${id(21)}','${id(14)}','${id(13)}','active','Squad');
    insert into public.parent_player_links(id,club_id,team_id,player_id,auth_user_id,email,link_type,status,parent_link_id,accepted_at) values
      ('${id(30)}','${id(10)}','${id(11)}','${id(20)}','${id(1)}','owner@synthetic.test','parent','active',null,now()),
      ('${id(31)}','${id(10)}','${id(12)}','${id(20)}','${id(1)}','old-owner@synthetic.test','parent','active',null,now()),
      ('${id(32)}','${id(10)}','${id(11)}','${id(20)}','${id(1)}','pending-owner@synthetic.test','parent','pending',null,null),
      ('${id(33)}','${id(10)}','${id(11)}','${id(20)}','${id(1)}','family-owner@synthetic.test','family','active','${id(40)}',now()),
      ('${id(34)}','${id(14)}','${id(13)}','${id(21)}','${id(1)}','owner@synthetic.test','parent','active',null,now()),
      ('${id(40)}','${id(10)}','${id(11)}','${id(20)}','${id(2)}','other@synthetic.test','parent','active',null,now()),
      ('${id(41)}','${id(10)}','${id(11)}','${id(20)}',null,'owner@synthetic.test','parent','pending',null,null),
      ('${id(50)}','${id(10)}','${id(11)}','${id(20)}','${id(4)}','legacy@synthetic.test','family','active','${id(30)}',now()),
      ('${id(51)}','${id(10)}','${id(11)}','${id(20)}',null,'nested@synthetic.test','family','pending','${id(50)}',null),
      ('${id(52)}','${id(10)}','${id(11)}','${id(20)}','${id(4)}','independent@synthetic.test','family','active','${id(40)}',now());
    insert into public.fan_connections values
      ('${id(60)}','${id(30)}','${id(20)}','${id(10)}','${id(1)}','${id(3)}','active'),
      ('${id(61)}','${id(40)}','${id(20)}','${id(10)}','${id(2)}','${id(3)}','active');
    insert into public.parent_chat_rooms(club_id,team_id,player_id,room_type,title) values
      ('${id(10)}','${id(11)}','${id(20)}','parent_staff','Player chat'),
      ('${id(10)}','${id(12)}',null,'team','Old team chat');
  `)
  await db.exec(authority)
  await db.exec(functionDefinition(fans, 'app_private.fan_parent_active'))
  await db.exec(functionDefinition(fans, 'app_private.fan_scope_active'))
  await db.exec(functionDefinition(fans, 'app_private.reject_legacy_family_access'))
  await db.exec(functionDefinition(chat, 'public.parent_chat_sync_parent_link'))
  await db.exec(`
    create trigger reject_legacy_family_access before insert or update on public.parent_player_links for each row execute function app_private.reject_legacy_family_access();
    create trigger parent_chat_parent_link_sync after insert or update of status,auth_user_id,team_id,player_id or delete on public.parent_player_links for each row execute function public.parent_chat_sync_parent_link();
  `)
  await db.exec(migration)
})
after(async () => db?.close())

async function transaction(action) {
  await db.exec('begin')
  try { await action() } finally { await db.exec('reset role; rollback') }
}
async function asActor(value = 1, email = 'owner@synthetic.test') {
  await db.query("select set_config('test.uid',$1,true),set_config('test.email',$2,true)", [value ? id(value) : '', email])
  await db.exec('set role authenticated')
}
async function revoke(player = 20) {
  return (await db.query('select public.revoke_own_parent_player_access($1) result', [player === null ? null : id(player)])).rows[0].result
}

test('self removal revokes all own duplicate grants and dependent legacy family access atomically', async () => transaction(async () => {
  await asActor()
  assert.equal((await db.query('select public.current_user_can_access_parent_player($1) allowed', [id(20)])).rows[0].allowed, true)
  assert.deepEqual(await revoke(), { player_id: id(20), revoked_count: 6 })
  assert.equal((await db.query('select public.current_user_can_access_parent_player($1) allowed', [id(20)])).rows[0].allowed, false)
  assert.equal((await db.query('select public.current_user_can_access_parent_player($1) allowed', [id(21)])).rows[0].allowed, true)
  await db.exec('reset role')
  const changed = (await db.query("select id,auth_user_id,status,expires_at<=now() expired from parent_player_links where status='revoked' order by id")).rows
  assert.deepEqual(changed.map(row => row.id), [30,31,32,33,50,51].map(id))
  assert.ok(changed.every(row => row.expired))
  assert.equal(changed[0].auth_user_id, id(1))
  assert.equal((await db.query('select count(*)::int count from auth.users')).rows[0].count, 4)
  assert.equal((await db.query('select parent_contacts from players where id=$1', [id(20)])).rows[0].parent_contacts.length, 0)
  assert.ok((await db.query('select count(*)::int count from test_chat_reconciliations')).rows[0].count >= 1)
}))

test('other parent grants, another player and unaccepted email-only invites are preserved byte for byte', async () => transaction(async () => {
  const before = (await db.query('select * from parent_player_links where id=any($1::uuid[]) order by id', [[34,40,41,52].map(id)])).rows
  await asActor()
  await revoke()
  await db.exec('reset role')
  const afterRows = (await db.query('select * from parent_player_links where id=any($1::uuid[]) order by id', [[34,40,41,52].map(id)])).rows
  assert.deepEqual(afterRows, before)
}))

test('dependent modern Fan access ends through existing scope checks without modifying another account grants', async () => transaction(async () => {
  const query = 'select id,app_private.fan_scope_active(parent_link_id,player_id,club_id,invited_by) allowed from fan_connections order by id'
  const before = (await db.query('select * from fan_connections order by id')).rows
  assert.deepEqual((await db.query(query)).rows.map(row => row.allowed), [true,true])
  await asActor()
  await revoke()
  await db.exec('reset role')
  assert.deepEqual((await db.query(query)).rows.map(row => row.allowed), [false,true])
  assert.deepEqual((await db.query('select * from fan_connections order by id')).rows, before)
}))

test('old accepted invite tokens cannot restore self-revoked links; repeat revocation is harmless', async () => transaction(async () => {
  const token = (await db.query('select invite_token from parent_player_links where id=$1', [id(30)])).rows[0].invite_token
  await asActor()
  assert.equal((await db.query('select id from accept_parent_player_link($1)', [token])).rows[0].id, id(30))
  await revoke()
  assert.deepEqual(await revoke(), { player_id: id(20), revoked_count: 0 })
  await db.exec('savepoint rejected_token')
  await assert.rejects(db.query('select * from accept_parent_player_link($1)', [token]), /only available/)
  await db.exec('rollback to rejected_token; reset role')
  const current = (await db.query('select invite_token,status from parent_player_links where id=$1', [id(30)])).rows[0]
  assert.notEqual(current.invite_token, token)
  assert.equal(current.status, 'revoked')
}))

test('ownership cannot be forged with matching JWT email or a player belonging only to another account', async () => transaction(async () => {
  await asActor(3, 'owner@synthetic.test')
  assert.deepEqual(await revoke(), { player_id: id(20), revoked_count: 0 })
  await db.exec('reset role')
  assert.equal((await db.query("select count(*)::int count from parent_player_links where status='revoked'")).rows[0].count, 0)
}))

test('a valid new invitation still accepts and existing same-account invitations remain idempotent', async () => transaction(async () => {
  await db.query(`insert into parent_player_links(id,club_id,team_id,player_id,email,link_type,status)
    values($1,$2,$3,$4,'fan@synthetic.test','parent','pending')`, [id(70),id(10),id(11),id(20)])
  const freshToken = (await db.query('select invite_token from parent_player_links where id=$1', [id(70)])).rows[0].invite_token
  const duplicateToken = (await db.query('select invite_token from parent_player_links where id=$1', [id(41)])).rows[0].invite_token
  await asActor(3, 'fan@synthetic.test')
  const accepted = (await db.query('select id,auth_user_id,status from accept_parent_player_link($1)', [freshToken])).rows[0]
  assert.deepEqual(accepted, { id: id(70), auth_user_id: id(3), status: 'active' })
  await db.exec('reset role')
  await asActor()
  assert.equal((await db.query('select id from accept_parent_player_link($1)', [duplicateToken])).rows[0].id, id(30))
  await db.exec('reset role')
  assert.equal((await db.query('select status from parent_player_links where id=$1', [id(41)])).rows[0].status, 'revoked')
}))

test('anonymous execution and missing authentication are denied; null target is rejected', async () => transaction(async () => {
  await db.exec('set role anon; savepoint denied_anon')
  await assert.rejects(revoke(), /permission denied/)
  await db.exec('rollback to denied_anon; reset role')
  await asActor(null)
  await db.exec('savepoint denied_auth')
  await assert.rejects(revoke(), /Sign in/)
  await db.exec('rollback to denied_auth; reset role')
  await asActor()
  await db.exec('savepoint denied_target')
  await assert.rejects(revoke(null), /Choose a player/)
  await db.exec('rollback to denied_target')
}))

test('a dependent write failure rolls back own revocation and token changes', async () => transaction(async () => {
  await db.exec(`create function public.test_fail_revoke() returns trigger language plpgsql as $$begin if new.id='${id(50)}' then raise exception 'Synthetic dependent failure'; end if; return new; end$$;
    create trigger test_fail_revoke before update on public.parent_player_links for each row execute function public.test_fail_revoke();`)
  const before = (await db.query('select * from parent_player_links order by id')).rows
  await asActor()
  await db.exec('savepoint failed_update')
  await assert.rejects(revoke(), /Synthetic dependent failure/)
  await db.exec('rollback to failed_update; reset role')
  assert.deepEqual((await db.query('select * from parent_player_links order by id')).rows, before)
  assert.equal((await db.query('select count(*)::int count from test_chat_reconciliations')).rows[0].count, 0)
}))

test('RPC permissions are bounded and acceptance locks and rechecks the exact invite at mutation', async () => {
  const permissions = (await db.query(`select has_function_privilege('anon','public.revoke_own_parent_player_access(uuid)','execute') anon,
    has_function_privilege('authenticated','public.revoke_own_parent_player_access(uuid)','execute') authenticated,
    has_function_privilege('service_role','public.revoke_own_parent_player_access(uuid)','execute') service`)).rows[0]
  assert.deepEqual(permissions, { anon: false, authenticated: true, service: false })
  const implementations = (await db.query(`select n.nspname schema,p.prosecdef definer,
    has_function_privilege('anon',p.oid,'execute') anon,
    has_function_privilege('service_role',p.oid,'execute') service
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='revoke_own_parent_player_access' order by n.nspname`)).rows
  assert.deepEqual(implementations, [{ schema: 'app_private', definer: true, anon: false, service: false }, { schema: 'public', definer: false, anon: false, service: false }])
  const accept = functionDefinition(migration, 'public.accept_parent_player_link')
  assert.match(accept, /limit 1\s+for update of link;/)
  assert.match(accept, /accept_target as \([\s\S]*where link\.id = target_link\.id\s+and link\.invite_token = invite_token_value\s+and link\.status <> 'revoked'/)
  assert.match(migration, /set search_path = ''/)
  assert.doesNotMatch(functionDefinition(migration, 'app_private.revoke_own_parent_player_access'), /auth\.jwt|parent_email|delete from|update public\.users/i)
})
