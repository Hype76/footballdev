import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261117123700_v1_discover_linked_staff_workspaces.sql', import.meta.url), 'utf8')
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = id(1)
const admin = id(2)
const other = id(3)
const suspended = id(4)
const home = id(11)
const away = id(12)
const unrelated = id(13)
const homeTeam = id(21)
const awayTeam = id(22)
const anotherTeam = id(23)
const archivedTeam = id(24)

test('linked staff discover their secondary workspaces without reading the roster or private data before switching', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.users (id uuid primary key, status text, active_club uuid);
      create table public.clubs (id uuid primary key, name text, status text, archived_at timestamptz);
      create table public.teams (id uuid primary key, club_id uuid, name text, status text, archived_at timestamptz);
      create table public.user_club_memberships (auth_user_id uuid, club_id uuid, role text, role_rank integer);
      create table public.team_staff (user_id uuid, team_id uuid);
      create table public.private_roster (team_id uuid);
      grant select on public.clubs, public.teams, public.team_staff, public.private_roster to authenticated;
      alter table public.clubs enable row level security;
      alter table public.teams enable row level security;
      alter table public.team_staff enable row level security;
      alter table public.private_roster enable row level security;
      create function public.test_active_club() returns uuid language sql stable security definer as $$
        select active_club from public.users where id = auth.uid() and status = 'active'
      $$;
      create policy club_current on public.clubs for select to authenticated using (id = public.test_active_club());
      create policy team_current on public.teams for select to authenticated using (club_id = public.test_active_club());
      create policy staff_current on public.team_staff for select to authenticated using (
        team_id in (select id from public.teams where club_id = public.test_active_club())
      );
      create policy roster_current on public.private_roster for select to authenticated using (
        team_id in (select id from public.teams where club_id = public.test_active_club())
      );

      insert into public.users values ('${actor}','active','${home}'), ('${admin}','active','${home}'),
        ('${other}','active','${unrelated}'), ('${suspended}','suspended','${home}');
      insert into public.clubs values ('${home}','Home','active',null), ('${away}','Secondary','active',null),
        ('${unrelated}','Unrelated','active',null);
      insert into public.teams values ('${homeTeam}','${home}','Home team','active',null),
        ('${awayTeam}','${away}','Secondary team','active',null), ('${anotherTeam}','${away}','Unassigned team','active',null),
        ('${archivedTeam}','${away}','Archived team','active',now());
      insert into public.user_club_memberships values
        ('${actor}','${home}','head_manager',70), ('${actor}','${away}','head_manager',70),
        ('${admin}','${home}','coach',30), ('${admin}','${away}','admin',90),
        ('${suspended}','${away}','head_manager',70);
      insert into public.team_staff values ('${actor}','${homeTeam}'), ('${actor}','${awayTeam}'),
        ('${actor}','${archivedTeam}'), ('${other}','${awayTeam}'), ('${suspended}','${awayTeam}');
      insert into public.private_roster values ('${awayTeam}');
    `)
    await db.exec(migration)
    const selectAs = async (account, sql) => {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${account}';`)
      try { return (await db.query(sql)).rows } finally { await db.exec('reset role') }
    }
    assert.deepEqual(await selectAs(actor, 'select name from public.clubs order by name'), [{ name: 'Home' }, { name: 'Secondary' }])
    assert.deepEqual(await selectAs(actor, 'select name from public.teams order by name'), [{ name: 'Home team' }, { name: 'Secondary team' }])
    assert.deepEqual(await selectAs(actor, `select user_id from public.team_staff where team_id = '${awayTeam}'`), [{ user_id: actor }])
    assert.deepEqual(await selectAs(actor, 'select * from public.private_roster'), [])
    assert.deepEqual(await selectAs(admin, `select name from public.teams where club_id = '${away}' order by name`), [{ name: 'Secondary team' }, { name: 'Unassigned team' }])
    for (const account of [other, suspended]) {
      assert.deepEqual(await selectAs(account, `select id from public.clubs where id = '${away}'`), [])
      assert.deepEqual(await selectAs(account, `select id from public.teams where id = '${awayTeam}'`), [])
    }
    const grants = await db.query("select has_function_privilege('anon','public.current_user_can_discover_staff_team(uuid)','execute') as anon")
    assert.equal(grants.rows[0].anon, false)
    await db.query('update public.users set active_club = $1 where id = $2', [away, actor])
    assert.deepEqual(await selectAs(actor, 'select team_id from public.private_roster'), [{ team_id: awayTeam }])
  } finally {
    await db.close()
  }
})
