import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260903104104_parent_selected_squad.sql', import.meta.url), 'utf8')
const id = (value) => `a0000000-0000-4000-8000-${String(value).padStart(12, '0')}`

test('Selected squad is accurate independently of attendance and preserves private access', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table public.parent_player_links(id uuid primary key, club_id uuid, team_id uuid, auth_user_id uuid, status text);
    create table public.players(id uuid primary key, club_id uuid, team_id uuid, player_name text, status text);
    create table public.match_day_player_squad_decisions(match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text, primary key(match_day_id, player_id));
    create table public.match_day_player_availability(match_day_id uuid, player_id uuid, status text);
    create table public.test_visible_fixtures(id uuid primary key, club_id uuid, team_id uuid, parent_visible boolean);
    -- The canonical fixture access function has a separate live FP TEST regression.
    create function public.get_parent_portal_match_days(parent_link_id_value uuid)
    returns table(id uuid, club_id uuid, team_id uuid) language sql stable as $$
      select f.id, f.club_id, f.team_id from public.test_visible_fixtures f where f.parent_visible;
    $$;
    insert into public.parent_player_links values('${id(1)}','${id(2)}','${id(3)}','${id(4)}','active');
    insert into public.test_visible_fixtures values
      ('${id(5)}','${id(2)}','${id(3)}',true),
      ('${id(6)}','${id(2)}','${id(3)}',false),
      ('${id(7)}','${id(2)}','${id(30)}',true),
      ('${id(8)}','${id(20)}','${id(3)}',true);
    select set_config('request.jwt.claim.sub','${id(4)}',false);
  `)
  const players = [
    [101, 'No response', 'selected', null],
    [102, 'Available', 'selected', 'available'],
    [103, 'Unavailable', 'selected', 'unavailable'],
    [104, 'Maybe', 'selected', 'maybe'],
    [105, 'Not selected', 'not_selected', 'available'],
    [106, 'Waiting', 'waiting', 'available'],
    [107, 'Undecided', 'undecided', 'available'],
    [108, 'Archived', 'selected', 'available'],
    [109, 'Other team', 'selected', 'available'],
    [110, 'Other club', 'selected', 'available'],
    [111, 'No response', 'selected', null],
  ]
  for (const [playerId, name, selection, availability] of players) {
    await db.query('insert into public.players values($1,$2,$3,$4,$5)', [id(playerId), id(playerId === 110 ? 20 : 2), id(playerId === 109 ? 30 : 3), name, playerId === 108 ? 'archived' : 'active'])
    await db.query('insert into public.match_day_player_squad_decisions values($1,$2,$3,$4,$5)', [id(5), id(2), id(3), id(playerId), selection])
    if (availability) await db.query('insert into public.match_day_player_availability values($1,$2,$3)', [id(5), id(playerId), availability])
  }
  const attendanceBefore = (await db.query('select * from public.match_day_player_availability order by player_id')).rows
  await db.exec(migration)
  const squad = async () => (await db.query('select * from public.get_parent_portal_confirmed_teams($1)', [id(1)])).rows

  await t.test('all selected players count, including no response, maybe, unavailable and identical names', async () => {
    assert.deepEqual(await squad(), [{ match_day_id: id(5), selected_player_names: ['Available', 'Maybe', 'No response', 'No response', 'Unavailable'] }])
    assert.deepEqual((await db.query('select * from public.match_day_player_availability order by player_id')).rows, attendanceBefore)
  })
  await t.test('changing the decision removes a player and clearing selections produces an empty squad', async () => {
    await db.query("update public.match_day_player_squad_decisions set status='not_selected' where player_id=$1", [id(101)])
    assert.equal((await squad())[0].selected_player_names.length, 4)
    await db.exec("update public.match_day_player_squad_decisions set status='not_selected'")
    assert.deepEqual((await squad())[0].selected_player_names, [])
  })
  await t.test('another account and revoked parent links cannot read the squad', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(99)])
    assert.deepEqual(await squad(), [])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(4)])
    await db.exec("update public.parent_player_links set status='revoked'")
    assert.deepEqual(await squad(), [])
  })
  await t.test('anonymous callers cannot execute the squad function', async () => {
    await db.exec('set role anon')
    await assert.rejects(squad(), /permission denied/)
    await db.exec('reset role')
  })
})
