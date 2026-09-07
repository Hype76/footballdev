import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const migration = await readFile(new URL('../supabase/migrations/20260907121942_fans_controlled_access.sql', import.meta.url), 'utf8')
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const permissions = { schedule: false, game_day: true, development: false, resources: false }
async function dbFixture({ legacy = false } = {}) {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',current_setting('request.jwt.claim.email',true)) $$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create table public.users(id uuid primary key,role text,status text,club_id uuid);
    create table public.clubs(id uuid primary key,name text,status text);
    create table public.teams(id uuid primary key,name text);
    create table public.players(id uuid primary key,club_id uuid,team_id uuid,player_name text,status text,archived_at timestamptz);
    create table public.match_days(id uuid primary key);
    create table public.parent_player_links(id uuid primary key,auth_user_id uuid,player_id uuid,club_id uuid,team_id uuid,link_type text,status text,parent_link_id uuid,accepted_at timestamptz,updated_at timestamptz);
    insert into auth.users(id,email,email_confirmed_at) values('${id(1)}','parent@example.test',now()),('${id(2)}','fan@example.test',now()),('${id(3)}','other@example.test',now()),('${id(4)}','admin@example.test',now());
    insert into public.users values('${id(1)}','parent_portal','active','${id(10)}'),('${id(4)}','super_admin','active',null);
    insert into public.clubs values('${id(10)}','Test club','active');
    insert into public.teams values('${id(11)}','Test team');
    insert into public.players values('${id(20)}','${id(10)}','${id(11)}','Test child','active',null),('${id(21)}','${id(10)}','${id(11)}','Other child','active',null);
    insert into public.parent_player_links(id,auth_user_id,player_id,club_id,team_id,link_type,status) values('${id(30)}','${id(1)}','${id(20)}','${id(10)}','${id(11)}','parent','active');
    grant usage on schema public,auth to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
  `)
  if (legacy) await db.exec(`insert into parent_player_links(id,auth_user_id,player_id,club_id,team_id,link_type,status,parent_link_id,accepted_at) values
    ('${id(60)}','${id(2)}','${id(20)}','${id(10)}','${id(11)}','family','active','${id(30)}',now()-interval '1 day'),
    ('${id(61)}','${id(2)}','${id(20)}','${id(10)}','${id(11)}','family','active','${id(30)}',now()),
    ('${id(62)}',null,'${id(20)}','${id(10)}','${id(11)}','family','pending','${id(30)}',null);`)
  await db.exec(migration)
  return db
}
async function actor(db, n, email) { await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[id(n),email]) }
async function invite(db, n = 40, email = 'fan@example.test', p = permissions) {
  const result = await db.query('select (public.create_fan_invitation($1,$2,$3,$4,$5)).*', [id(30), 'Test Fan', email, JSON.stringify(p), id(n)])
  return result.rows[0]
}
test('Fans have independent expiry, exact permissions and idempotent requests', async () => {
  const db = await dbFixture()
  try {
    await actor(db,1,'parent@example.test')
    const first = await invite(db)
    const second = await invite(db,41,'other@example.test')
    assert.equal((await db.query('select status from fan_connections where id=$1',[first.id])).rows[0].status,'pending')
    assert.equal((await invite(db)).id,first.id)
    assert.notEqual(first.id,second.id)
    assert.deepEqual(first.permissions,permissions)
    assert.equal(new Date(first.expires_at)-new Date(first.created_at),86400000)
    await assert.rejects(invite(db,42,'bad'),/check constraint/)
    await assert.rejects(invite(db,43,'resources@example.test',{ ...permissions,resources:true }),/check constraint/)
    await actor(db,3,'other@example.test')
    await assert.rejects(invite(db,44),/Only an active Parent/)
    await assert.rejects(db.query('select accept_fan_invitation($1)',[first.invite_token]),/verified email/)
    await actor(db,2,'fan@example.test')
    await db.query('select accept_fan_invitation($1)',[first.invite_token])
    await db.query("update fan_connections set expires_at=now()-interval '1 day' where id=$1",[first.id])
    assert.equal((await db.query('select accept_fan_invitation($1) id',[first.invite_token])).rows[0].id,first.id)
    const links = (await db.query('select list_fan_connections() data')).rows[0].data
    assert.equal(links.length,1)
    assert.equal(links[0].invite_token,null)
    await assert.rejects(db.query("select manage_fan_connection($1,'permissions',$2)",[first.id,JSON.stringify({...permissions,development:true})]),/Only the inviting Parent/)
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select * from fan_connections'),/permission denied/)
    await assert.rejects(db.query("update fan_connections set relationship_type='player'"),/permission denied/)
    await db.exec('reset role')
    await db.query("select manage_fan_connection($1,'remove')",[first.id])
    assert.deepEqual((await db.query('select list_fan_connections() data')).rows[0].data,[])
    await assert.rejects(db.query('select accept_fan_invitation($1)',[first.invite_token]),/expired or been cancelled/)
  } finally { await db.close() }
})
test('Parent revocation, expiry and ancestor removal end Fan access; stats separate identities', async () => {
  const db=await dbFixture()
  try {
    await actor(db,1,'parent@example.test')
    const first=await invite(db)
    const expired=await invite(db,41,'other@example.test')
    await db.query("update fan_connections set expires_at=now()-interval '1 minute' where id=$1",[expired.id])
    await actor(db,3,'other@example.test')
    await assert.rejects(db.query('select accept_fan_invitation($1)',[expired.invite_token]),/expired/)
    await actor(db,2,'fan@example.test')
    await db.query('select accept_fan_invitation($1)',[first.invite_token])
    await assert.rejects(db.query('select get_platform_fan_stats()'),/Platform Admin/)
    await actor(db,4,'admin@example.test')
    let stats=(await db.query('select get_platform_fan_stats() data')).rows[0].data
    assert.equal(stats.uniqueFans,1); assert.equal(stats.uniquePlayers,0); assert.equal(stats.expired,1)
    await db.query("update fan_connections set relationship_type='player' where id=$1",[first.id])
    stats=(await db.query('select get_platform_fan_stats() data')).rows[0].data
    assert.equal(stats.uniqueFans,0); assert.equal(stats.uniquePlayers,1); assert.equal(stats.uniqueAccounts,1)
    await db.query("update fan_connections set relationship_type='fan' where id=$1",[first.id])
    await db.query("update parent_player_links set status='revoked' where id=$1",[id(30)])
    await actor(db,2,'fan@example.test')
    assert.deepEqual((await db.query('select list_fan_connections() data')).rows[0].data,[])
  } finally { await db.close() }
})
test('Suspension, hidden Player type and legacy authority cannot bypass Fan permissions', async () => {
  const db = await dbFixture()
  try {
    await actor(db,1,'parent@example.test')
    const first = await invite(db,40,'fan@example.test',{ ...permissions, game_day:false,schedule:true })
    const duplicate = await invite(db,41)
    await assert.rejects(invite(db,42,'other@example.test',{...permissions,chat:true}),/check constraint/)
    await assert.rejects(db.query("insert into parent_player_links(id,link_type,status) values($1,'family','active')",[id(99)]),/Use Fans/)
    await db.query("insert into public.users values($1,'parent_portal','suspended',$2)",[id(2),id(10)])
    await actor(db,2,'fan@example.test')
    await assert.rejects(db.query('select accept_fan_invitation($1)',[first.invite_token]),/verified email/)
    await db.query("update public.users set status='active' where id=$1",[id(2)])
    await db.query('select accept_fan_invitation($1)',[first.invite_token])
    await assert.rejects(db.query('select accept_fan_invitation($1)',[duplicate.invite_token]),/already follow/)
    await db.query("select manage_fan_connection($1,'notifications_off')",[first.id])
    assert.equal((await db.query('select list_fan_connections() data')).rows[0].data[0].notifications_enabled,false)
    await db.query("update public.users set status='suspended' where id=$1",[id(2)])
    await actor(db,4,'admin@example.test')
    assert.equal((await db.query('select get_platform_fan_stats() data')).rows[0].data.uniqueFans,0)
    await actor(db,1,'parent@example.test')
    await db.query("select manage_fan_connection($1,'revoke')",[first.id])
    await actor(db,2,'fan@example.test')
    assert.deepEqual((await db.query('select list_fan_connections() data')).rows[0].data,[])
  } finally { await db.close() }
})
test('Legacy migration preserves one verified Fan per child and retires unaccepted broad links', async () => {
  const db = await dbFixture({legacy:true})
  try {
    const rows=(await db.query('select id,status,permissions from fan_connections')).rows
    assert.equal(rows.length,1)
    assert.equal(rows[0].id,id(61))
    assert.deepEqual(rows[0].permissions,{schedule:true,game_day:true,development:true,resources:true})
    assert.equal((await db.query("select count(*)::int n from parent_player_links where link_type='family' and status='revoked'")).rows[0].n,3)
    await actor(db,1,'parent@example.test')
    await assert.rejects(db.query('select create_own_family_share_link($1)',[id(30)]),/use Fans/)
  } finally { await db.close() }
})
