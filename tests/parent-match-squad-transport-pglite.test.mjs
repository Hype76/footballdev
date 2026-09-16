import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260916143812_parent_match_squad_transport.sql', import.meta.url), 'utf8')
const id = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('Parent squad transport uses selected player IDs, current consent and scoped authority', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema app_private;
    grant usage on schema app_private, auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table parent_player_links(id uuid primary key,auth_user_id uuid,club_id uuid,team_id uuid,player_id uuid,status text,link_type text);
    create table players(id uuid primary key,club_id uuid,team_id uuid,player_name text,status text);
    create table users(id uuid primary key,status text);
    create function public.current_user_can_access_parent_link(link_id uuid, child_id uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.parent_player_links l join public.players p on p.id=l.player_id join public.users u on u.id=l.auth_user_id
      where l.id=link_id and p.id=child_id and l.auth_user_id=auth.uid() and p.status='active' and u.status='active') $$;
    create table match_days(id uuid primary key,club_id uuid,team_id uuid,parent_visible boolean,carpool_enabled boolean,status text,deleted_at timestamptz,previous_hidden_at timestamptz,concluded_at timestamptz);
    create table test_visible(id uuid primary key);
    create function public.get_parent_portal_match_days(parent_link_id_value uuid) returns table(id uuid) language sql stable as $$ select id from public.test_visible $$;
    create table match_day_player_squad_decisions(match_day_id uuid,club_id uuid,team_id uuid,player_id uuid,status text);
    create table match_day_availability_requests(id uuid primary key,match_day_id uuid,club_id uuid,team_id uuid,player_id uuid,token_hash text,transport_needs_lift boolean,transport_can_offer_lift boolean,transport_responded_at timestamptz,updated_at timestamptz);
    create table test_current_tokens(token_hash text primary key);
    create function public.is_match_day_action_token_current_internal(token_hash_value text) returns boolean language sql stable as $$ select exists(select 1 from public.test_current_tokens where token_hash=token_hash_value) $$;
    insert into users values('${id(1)}','active');
    insert into players values('${id(10)}','${id(2)}','${id(3)}','Own child','active');
    insert into parent_player_links values('${id(4)}','${id(1)}','${id(2)}','${id(3)}','${id(10)}','active','parent');
    select set_config('request.jwt.claim.sub','${id(1)}',false);
  `)
  for (const [n, name, status] of [[11,'Same name','selected'],[12,'Same name','selected'],[13,'Not selected','not_selected'],[14,'Archived','selected']]) {
    await db.query('insert into players values($1,$2,$3,$4,$5)', [id(n),id(2),id(3),name,n===14?'archived':'active'])
    await db.query('insert into match_day_player_squad_decisions values($1,$2,$3,$4,$5)', [id(20),id(2),id(3),id(n),status])
  }
  await db.exec(`insert into match_days values('${id(20)}','${id(2)}','${id(3)}',true,true,'scheduled',null,null,null);insert into test_visible values('${id(20)}');`)
  async function request(n, player, token, needs, offer, responded, updated='2099-10-10') {
    await db.query('insert into match_day_availability_requests values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id(n),id(20),id(2),id(3),id(player),token,needs,offer,responded,updated])
    if (!token.startsWith('revoked')) await db.query('insert into test_current_tokens values($1)',[token])
  }
  await request(30,11,'old',true,false,'2099-09-01')
  await request(31,11,'new',false,true,'2099-09-02','2099-09-02')
  await request(32,11,'revoked-newer',true,false,'2099-09-03')
  await request(33,12,'other-player',true,false,'2099-09-02')
  await request(34,13,'unselected',true,false,'2099-09-02')
  await db.exec(migration)
  const rows = async () => (await db.query('select match_day_id, player.* from get_parent_portal_match_squad_transport($1) fixture cross join lateral jsonb_to_recordset(fixture.squad_players) as player(player_id uuid, player_name text, needs_lift boolean, can_offer_lift boolean)',[id(4)])).rows
  await t.test('latest actual transport reply wins across contacts, duplicate names remain distinct and no private data escapes', async () => {
    assert.deepEqual(await rows(), [
      {match_day_id:id(20),player_id:id(11),player_name:'Same name',needs_lift:false,can_offer_lift:true},
      {match_day_id:id(20),player_id:id(12),player_name:'Same name',needs_lift:true,can_offer_lift:false},
    ])
    await db.exec("delete from test_current_tokens where token_hash='other-player'")
    assert.equal((await rows())[1].needs_lift,false)
    await db.exec("insert into test_current_tokens values('other-player')")
  })
  await t.test('unowned, revoked, Fan, Player, suspended and archived child links return no private data', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(999)])
    assert.deepEqual(await rows(),[])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(1)])
    for (const kind of ['fan','player','family']) { await db.query('update parent_player_links set link_type=$1',[kind]);assert.deepEqual(await rows(),[]) }
    await db.exec("update parent_player_links set link_type='parent',status='revoked'")
    assert.deepEqual(await rows(),[])
    await db.exec("update parent_player_links set status='active';update users set status='suspended'")
    assert.deepEqual(await rows(),[])
    await db.exec(`update users set status='active';update players set status='archived' where id='${id(10)}'`)
    assert.deepEqual(await rows(),[])
    await db.exec(`update players set status='active' where id='${id(10)}'`)
  })
  await t.test('large selected squads stay in one fixture row instead of truncating player rows', async () => {
    await db.exec(`begin;
      insert into players select ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(2)}','${id(3)}','Player '||n,'active' from generate_series(1000,2000) n;
      insert into match_day_player_squad_decisions select '${id(20)}','${id(2)}','${id(3)}',id,'selected' from players where player_name like 'Player %';`)
    const fixtureRows = (await db.query('select * from get_parent_portal_match_squad_transport($1)',[id(4)])).rows
    assert.equal(fixtureRows.length,1)
    assert.equal(fixtureRows[0].squad_players.length,1003)
    await db.exec('rollback')
  })
  await t.test('cross club/team, hidden, disabled, cancelled, concluded and nonvisible fixtures are denied', async () => {
    const changes = ["carpool_enabled=false","parent_visible=false","deleted_at=now()","previous_hidden_at=now()","status='cancelled'","status='postponed'","status='full_time'","concluded_at=now()",`club_id='${id(999)}'`,`team_id='${id(999)}'`]
    for (const change of changes) {
      await db.exec(`begin;update match_days set ${change}`)
      assert.deepEqual(await rows(),[],change)
      await db.exec('rollback')
    }
    await db.exec('delete from test_visible')
    assert.deepEqual(await rows(),[])
  })
  await t.test('public RPC is invoker only and anonymous execution is denied', async () => {
    assert.equal((await db.query("select prosecdef from pg_proc where proname='get_parent_portal_match_squad_transport'")).rows[0].prosecdef,false)
    await db.exec('set role anon')
    await assert.rejects(rows(),/permission denied/)
    await db.exec('reset role;set role authenticated')
    assert.deepEqual(await rows(),[])
    await db.exec('reset role')
  })
})
