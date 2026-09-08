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
    create table public.clubs(id uuid primary key,name text,status text,logo_url text,theme_accent text,theme_button_style text);
    create table public.teams(id uuid primary key,name text);
    create table public.players(id uuid primary key,club_id uuid,team_id uuid,player_name text,status text,archived_at timestamptz);
    create table public.match_days(id uuid primary key);
    create table public.parent_player_links(id uuid primary key,auth_user_id uuid,player_id uuid,club_id uuid,team_id uuid,link_type text,status text,parent_link_id uuid,accepted_at timestamptz,updated_at timestamptz);
    insert into auth.users(id,email,email_confirmed_at) values('${id(1)}','parent@example.test',now()),('${id(2)}','fan@example.test',now()),('${id(3)}','other@example.test',now()),('${id(4)}','admin@example.test',now());
    insert into public.users values('${id(1)}','parent_portal','active','${id(10)}'),('${id(4)}','super_admin','active',null);
    insert into public.clubs values('${id(10)}','Test club','active','https://example.test/club.png','#123abc','solid');
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
  await db.exec(await readFile(new URL('../supabase/migrations/20260907161234_fans_cancelled_invitation_delete.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/20260908060952_platform_fan_signup_stats.sql', import.meta.url), 'utf8'))
  return db
}
async function actor(db, n, email) { await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[id(n),email]) }
async function invite(db, n = 40, email = 'fan@example.test', p = permissions) {
  const result = await db.query('select (public.create_fan_invitation($1,$2,$3,$4,$5)).*', [id(30), 'Test Fan', email, JSON.stringify(p), id(n)])
  return result.rows[0]
}

test('Platform Fan signup counts track account creation, confirmation, acceptance and expiry separately', async () => {
  const db = await dbFixture()
  try {
    await actor(db,1,'parent@example.test')
    const ready = await invite(db)
    const missing = await invite(db,41,'missing@example.test')
    await invite(db,42,'other@example.test')
    await db.query('update auth.users set email_confirmed_at=null where id=$1',[id(3)])
    const expired = await invite(db,43,'expired@example.test')
    await db.query("update fan_connections set expires_at=now()-interval '1 second' where id=$1",[expired.id])
    const cancelled = await invite(db,44,'cancelled@example.test')
    await db.query("select manage_fan_connection($1,'revoke')",[cancelled.id])
    await db.query('select delete_cancelled_fan_invitation($1)',[cancelled.id])
    await actor(db,4,'admin@example.test')
    const readStats = async () => (await db.query('select get_platform_fan_stats() data')).rows[0].data
    let stats = await readStats()
    assert.deepEqual(stats.fanSignup,{noAccount:1,emailUnconfirmed:1,readyToAccept:1,unavailable:0})
    assert.equal(stats.fanInvitations.pending,3)
    assert.equal(stats.fanInvitations.total,5)
    assert.equal(stats.fanInvitations.expired,1)
    assert.equal(stats.fanInvitations.cancelled,1)
    assert.doesNotMatch(JSON.stringify(stats), /example\.test|Test child|invite_token|Test Fan/)
    await db.query('insert into auth.users(id,email) values($1,$2)',[id(5),'MISSING@example.test'])
    stats = await readStats()
    assert.equal(stats.fanSignup.noAccount,0)
    assert.equal(stats.fanSignup.emailUnconfirmed,2)
    await db.query('update auth.users set email_confirmed_at=now() where id=$1',[id(5)])
    assert.equal((await readStats()).fanSignup.readyToAccept,2)
    await actor(db,2,'fan@example.test')
    await db.query('select accept_fan_invitation($1)',[ready.invite_token])
    await actor(db,4,'admin@example.test')
    stats = await readStats()
    assert.equal(stats.fanInvitations.pending,2)
    assert.equal(stats.fanInvitations.accepted,1)
    assert.equal(stats.uniqueFans,1)
    await db.query('insert into public.users values($1,$2,$3,$4)',[id(5),'parent_portal','suspended',id(10)])
    stats = await readStats()
    assert.deepEqual(stats.fanSignup,{noAccount:0,emailUnconfirmed:1,readyToAccept:0,unavailable:1})
    await db.query("update fan_connections set expires_at=now()-interval '1 second' where id=$1",[missing.id])
    assert.equal((await readStats()).fanSignup.unavailable,0)
    await db.query("update parent_player_links set status='revoked' where id=$1",[id(30)])
    stats = await readStats()
    assert.equal(stats.fanSignup.unavailable,1)
    assert.equal(stats.uniqueFans,0)
    assert.equal(stats.fanInvitations.accepted,1)
  } finally { await db.close() }
})

test('Platform Fan statistics deduplicate accounts and devices, separate Players, and deny other roles', async () => {
  const db = await dbFixture()
  try {
    await actor(db,1,'parent@example.test')
    const first = await invite(db)
    await invite(db,41)
    await actor(db,2,'fan@example.test')
    await db.query('select accept_fan_invitation($1)',[first.invite_token])
    await db.exec(`
      insert into parent_player_links(id,auth_user_id,player_id,club_id,team_id,link_type,status) values('${id(31)}','${id(1)}','${id(21)}','${id(10)}','${id(11)}','parent','active');
      insert into fan_connections(parent_link_id,player_id,club_id,invited_by,auth_user_id,name,email,status,accepted_at)
      values('${id(31)}','${id(21)}','${id(10)}','${id(1)}','${id(2)}','Test Fan','fan@example.test','active',now());
      insert into fan_connections(parent_link_id,player_id,club_id,invited_by,auth_user_id,name,email,status,accepted_at,relationship_type)
      values('${id(31)}','${id(21)}','${id(10)}','${id(1)}','${id(2)}','Test Player','fan@example.test','active',now(),'player');
      insert into fan_devices(token,auth_user_id) values('ExpoPushToken[synthetic1]','${id(2)}'),('ExpoPushToken[synthetic2]','${id(2)}');
    `)
    await actor(db,4,'admin@example.test')
    await db.exec('set role authenticated')
    let stats = (await db.query('select get_platform_fan_stats() data')).rows[0].data
    assert.equal(stats.uniqueFans,1)
    assert.equal(stats.fanConnections,2)
    assert.equal(stats.uniquePlayers,1)
    assert.equal(stats.uniqueAccounts,1)
    assert.equal(stats.fanInvitations.total,3)
    assert.equal(stats.fanInvitations.accepted,2)
    assert.equal(stats.fanSignup.unavailable,1)
    assert.deepEqual(stats.fanNotifications,{enabledAccounts:1,registeredAccounts:1})
    await db.exec('reset role')
    await db.exec("update fan_connections set notifications_enabled=false where relationship_type='fan'")
    stats = (await db.query('select get_platform_fan_stats() data')).rows[0].data
    assert.deepEqual(stats.fanNotifications,{enabledAccounts:0,registeredAccounts:0})
    for (const role of ['parent_portal','coach','super_admin']) {
      await db.query('update public.users set role=$1,status=$2 where id=$3',[role,role==='super_admin'?'suspended':'active',id(4)])
      await assert.rejects(db.query('select get_platform_fan_stats()'),/Platform Admin/)
    }
    await db.query("select set_config('request.jwt.claim.sub','',false)")
    await assert.rejects(db.query('select get_platform_fan_stats()'),/Platform Admin/)
    const grants = (await db.query("select has_function_privilege('anon','public.get_platform_fan_stats()','execute') anon,has_table_privilege('authenticated','auth.users','select') auth_read")).rows[0]
    assert.deepEqual(grants,{anon:false,auth_read:false})
  } finally { await db.close() }
})
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
    await db.query('update parent_player_links set player_id=$1 where id=$2',[id(21),id(30)])
    await actor(db,2,'fan@example.test')
    assert.deepEqual((await db.query('select list_fan_connections() data')).rows[0].data,[])
    await assert.rejects(db.query('select get_fan_invitation($1)',[first.invite_token]),/not available/)
    await db.query('update parent_player_links set player_id=$1 where id=$2',[id(20),id(30)])
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
test('Pre-sign-in branding is token-bound and never reveals the child or recipient', async () => {
  const db=await dbFixture()
  try {
    await actor(db,1,'parent@example.test')
    const first=await invite(db)
    await db.exec('set role anon')
    const brand=(await db.query('select get_fan_invitation_branding($1) data',[first.invite_token])).rows[0].data
    assert.deepEqual(Object.keys(brand).sort(),['club_id','club_logo_url','club_name','theme_accent','theme_button_style'].sort())
    assert.equal(brand.club_name,'Test club')
    assert.equal(brand.theme_accent,'#123abc')
    assert.equal((await db.query('select get_fan_invitation_branding($1) data',[id(90)])).rows[0].data,null)
    await db.exec('reset role')
    await db.query("update fan_connections set expires_at=now()-interval '1 minute' where id=$1",[first.id])
    assert.equal((await db.query('select get_fan_invitation_branding($1) data',[first.invite_token])).rows[0].data,null)
  } finally { await db.close() }
})


test('Only the inviting active Parent can delete cancelled Fans; history and stats survive', async () => {
  const db = await dbFixture()
  try {
    await actor(db, 1, 'parent@example.test')
    const cancelled = await invite(db)
    const pending = await invite(db, 41, 'other@example.test')
    await assert.rejects(db.query('select delete_cancelled_fan_invitation($1)', [pending.id]), /Only cancelled/)
    await db.query("select manage_fan_connection($1,'revoke')", [cancelled.id])
    await actor(db, 3, 'other@example.test')
    await assert.rejects(db.query('select delete_cancelled_fan_invitation($1)', [cancelled.id]), /Only the inviting Parent/)
    await actor(db, 1, 'parent@example.test')
    await db.query("update public.users set status='suspended' where id=$1", [id(1)])
    await assert.rejects(db.query('select delete_cancelled_fan_invitation($1)', [cancelled.id]), /Only the inviting Parent/)
    await db.query("update public.users set status='active' where id=$1", [id(1)])
    await db.exec('set role anon')
    await assert.rejects(db.query('select delete_cancelled_fan_invitation($1)', [cancelled.id]), /permission denied/)
    await db.exec('reset role; set role authenticated')
    await db.query('select delete_cancelled_fan_invitation($1)', [cancelled.id])
    await db.query('select delete_cancelled_fan_invitation($1)', [cancelled.id])
    const list = (await db.query('select list_fan_connections() data')).rows[0].data
    assert.deepEqual(list.map(row => row.id), [pending.id])
    await assert.rejects(db.query('update fan_connections set owner_deleted_at=null'), /permission denied/)
    await db.exec('reset role')
    const history = (await db.query('select status,owner_deleted_at from fan_connections where id=$1', [cancelled.id])).rows[0]
    assert.equal(history.status, 'cancelled')
    assert.ok(history.owner_deleted_at)
    await actor(db, 4, 'admin@example.test')
    assert.equal((await db.query('select get_platform_fan_stats() data')).rows[0].data.cancelled, 1)
    await actor(db, 2, 'fan@example.test')
    await assert.rejects(db.query('select accept_fan_invitation($1)', [cancelled.invite_token]), /expired or been cancelled/)
    await actor(db, 3, 'other@example.test')
    await db.query('select accept_fan_invitation($1)', [pending.invite_token])
    await actor(db, 1, 'parent@example.test')
    await assert.rejects(db.query('select delete_cancelled_fan_invitation($1)', [pending.id]), /Only cancelled/)
    await db.query("select manage_fan_connection($1,'revoke')", [pending.id])
    await assert.rejects(db.query('select delete_cancelled_fan_invitation($1)', [pending.id]), /Only cancelled/)
    await db.query("update fan_connections set relationship_type='player' where id=$1", [cancelled.id])
    await assert.rejects(db.query('select delete_cancelled_fan_invitation($1)', [cancelled.id]), /Only cancelled/)
  } finally { await db.close() }
})
