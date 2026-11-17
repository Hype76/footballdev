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
      create function public.current_user_club_id() returns uuid language sql stable security definer as $$
        select active_club from public.users where id = auth.uid() and status = 'active'
      $$;
      create policy club_current on public.clubs for select to authenticated using (id = public.current_user_club_id());
      create policy team_current on public.teams for select to authenticated using (club_id = public.current_user_club_id());
      create policy staff_current on public.team_staff for select to authenticated using (
        team_id in (select id from public.teams where club_id = public.current_user_club_id())
      );
      create policy roster_current on public.private_roster for select to authenticated using (
        team_id in (select id from public.teams where club_id = public.current_user_club_id())
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
      alter table public.clubs add logo_url text, add plan_key text, add plan_status text,
        add is_plan_comped boolean, add tester_access_expires_at timestamptz, add theme_accent text,
        add theme_button_style text, add tester_access_code text default 'SECRET';
      alter table public.teams add theme_accent text, add theme_button_style text,
        add created_by_email text default 'private@example.test';
      alter table public.team_staff add id uuid default gen_random_uuid(),
        add role_key text default 'head_manager', add role_label text default 'Team Admin', add role_rank integer default 70;

    `)
    await db.exec(migration)
    const selectAs = async (account, sql) => {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${account}';`)
      try { return (await db.query(sql)).rows } finally { await db.exec('reset role') }
    }
    const list = async account => (await selectAs(account, 'select public.list_own_staff_workspace_options() as options'))[0].options
    const options = await list(actor)
    assert.deepEqual(options.clubs.map(club => club.name), ['Secondary'])
    assert.deepEqual(options.assignments.map(assignment => assignment.teams.name), ['Secondary team'])
    assert.deepEqual(options.adminTeams, [])
    assert.doesNotMatch(JSON.stringify(options), /SECRET|tester_access_code|private@example.test|created_by_email/)
    assert.deepEqual(await selectAs(actor, 'select name from public.clubs order by name'), [{ name: 'Home' }])
    assert.deepEqual(await selectAs(actor, 'select name from public.teams order by name'), [{ name: 'Home team' }])
    assert.deepEqual(await selectAs(actor, `select user_id from public.team_staff where team_id = '${awayTeam}'`), [])
    assert.deepEqual(await selectAs(actor, 'select * from public.private_roster'), [])
    assert.deepEqual((await list(admin)).adminTeams.map(team => team.name), ['Secondary team', 'Unassigned team'])
    for (const account of [other, suspended]) {
      assert.deepEqual(await list(account), { clubs: [], assignments: [], adminTeams: [] })
    }
    const grants = await db.query("select has_function_privilege('anon','public.list_own_staff_workspace_options()','execute') as anon")
    assert.equal(grants.rows[0].anon, false)
    await db.query('update public.users set active_club = $1 where id = $2', [away, actor])
    assert.deepEqual(await selectAs(actor, 'select team_id from public.private_roster'), [{ team_id: awayTeam }])
  } finally {
    await db.close()
  }
})

test('Web and Coach pickers add only the projected secondary options', async () => {
  const [webSource, coachSource] = await Promise.all([
    readFile(new URL('../src/lib/domain/core.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/profile.js', import.meta.url), 'utf8'),
  ])
  const extract = (source, name, next) => source.slice(
    source.indexOf(`async function ${name}(`), source.indexOf(`\n${next}`),
  )
  const membershipRows = [
    { id: 'membership-home', club_id: home, role: 'head_manager', clubs: { id: home } },
    { id: 'membership-away', club_id: away, role: 'head_manager', clubs: null },
    { id: 'membership-admin', club_id: unrelated, role: 'admin', clubs: null },
    { id: 'hidden', club_id: id(999), role: 'head_manager', clubs: null },
  ]
  const ownAssignment = { id: 'assignment', team_id: awayTeam, teams: { id: awayTeam, club_id: away, name: 'Secondary team' } }
  const discovery = { clubs: [{ id: away }, { id: unrelated }], assignments: [ownAssignment],
    adminTeams: [{ id: anotherTeam, club_id: unrelated }] }
  const supabase = {
    from(table) {
      return { select() { return this }, eq() { return this }, order() {
        if (table === 'user_club_memberships') return { data: membershipRows }
        assert.equal(table, 'team_staff', 'secondary admin teams must come from the restricted projection')
        return { data: [] }
      } }
    },
    async rpc(name) { assert.equal(name, 'list_own_staff_workspace_options'); return { data: discovery } },
  }
  const web = new Function('supabase', 'MEMBERSHIP_CLUB_SELECT', 'normalizeClubMembershipRow',
    extract(webSource, 'getUserClubMemberships', 'async function getParentPortalMemberships') + '\nreturn getUserClubMemberships')(
      supabase, 'test', row => row,
    )
  assert.deepEqual((await web({ id: actor })).map(row => row.clubs.id), [home, away, unrelated])
  const coach = new Function('supabase', 'getRelatedRow', 'normalizeText', 'normalizeAssignmentContext',
    'normalizeMembershipContext', 'normalizeAdminTeamContext', 'loadTeamBrandingDisplay',
    extract(coachSource, 'fetchStaffContexts', 'function normalizeParentLink') + '\nreturn fetchStaffContexts')(
      supabase, (row, key) => row[key], value => String(value || ''), row => ({ id: row.team_id }),
      row => ({ id: row.club_id }), row => ({ id: row.id }), (_client, context) => context,
    )
  assert.deepEqual((await coach(actor)).map(context => context.id), [awayTeam, unrelated, anotherTeam])
})
