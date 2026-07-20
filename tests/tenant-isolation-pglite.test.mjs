import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260720091524_p1_tenant_parent_player_staff_feedback_isolation.sql', import.meta.url)

const ID = Object.freeze({
  clubA: '10000000-0000-4000-8000-000000000001',
  clubB: '10000000-0000-4000-8000-000000000002',
  teamA1: '20000000-0000-4000-8000-000000000001',
  teamA2: '20000000-0000-4000-8000-000000000002',
  teamB1: '20000000-0000-4000-8000-000000000003',
  parent: '30000000-0000-4000-8000-000000000001',
  assistant: '30000000-0000-4000-8000-000000000002',
  coach: '30000000-0000-4000-8000-000000000003',
  manager: '30000000-0000-4000-8000-000000000004',
  teamAdmin: '30000000-0000-4000-8000-000000000005',
  clubAdmin: '30000000-0000-4000-8000-000000000006',
  otherCoach: '30000000-0000-4000-8000-000000000007',
  platform: '30000000-0000-4000-8000-000000000008',
  linked: '40000000-0000-4000-8000-000000000001',
  sibling: '40000000-0000-4000-8000-000000000002',
  sameTeam: '40000000-0000-4000-8000-000000000003',
  sameClub: '40000000-0000-4000-8000-000000000004',
  crossClub: '40000000-0000-4000-8000-000000000005',
  inactiveLink: '40000000-0000-4000-8000-000000000006',
  feedbackOwn: '50000000-0000-4000-8000-000000000001',
  feedbackSameClub: '50000000-0000-4000-8000-000000000002',
  feedbackCrossClub: '50000000-0000-4000-8000-000000000003',
  feedbackHidden: '50000000-0000-4000-8000-000000000004',
})

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.clubs (
      id uuid primary key,
      name text not null,
      logo_url text,
      website text,
      town_city text,
      country text,
      contact_email text,
      contact_phone text,
      status text not null default 'active'
    );

    create table public.users (
      id uuid primary key,
      email text not null,
      role text not null,
      role_rank integer not null,
      club_id uuid,
      status text not null default 'active'
    );

    create table public.user_club_memberships (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null,
      email text not null,
      role text not null,
      role_rank integer not null,
      club_id uuid not null
    );

    create table public.platform_admins (
      id uuid primary key,
      status text not null default 'active'
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null,
      name text not null,
      status text not null default 'active'
    );

    create table public.team_staff (
      id uuid primary key default gen_random_uuid(),
      team_id uuid not null,
      user_id uuid not null,
      unique (team_id, user_id)
    );

    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_name text not null,
      section text not null default 'Squad',
      status text not null default 'active'
    );

    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      parent_link_id uuid,
      link_type text not null default 'parent',
      email text,
      auth_user_id uuid,
      invite_token uuid not null default gen_random_uuid(),
      status text not null default 'pending',
      updated_at timestamptz not null default timezone('utc', now()),
      expires_at timestamptz
    );

    create table public.player_staff_notes (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      player_id uuid not null,
      user_id uuid not null,
      note text not null
    );

    create table public.match_days (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);
    create table public.match_day_events (id uuid primary key default gen_random_uuid(), match_day_id uuid, club_id uuid not null, team_id uuid not null);
    create table public.match_day_availability_requests (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);
    create table public.match_day_player_availability (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);
    create table public.match_day_player_availability_history (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);
    create table public.match_day_scorer_interest (id uuid primary key default gen_random_uuid(), match_day_id uuid, club_id uuid not null, team_id uuid not null);
    create table public.match_day_scorer_assignments (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      club_id uuid not null,
      team_id uuid not null,
      parent_link_id uuid,
      auth_user_id uuid
    );
    create table public.match_day_role_assignments (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);

    create table public.training_availability_settings (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);
    create table public.training_availability_requests (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);
    create table public.training_availability_request_players (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);
    create table public.training_availability_responses (id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid not null);

    create table public.platform_feedback (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      created_by uuid,
      created_by_name text not null default '',
      created_by_email text not null default '',
      updated_by uuid,
      updated_by_name text not null default '',
      updated_by_email text not null default '',
      message text not null,
      status text not null default 'open',
      admin_note text not null default '',
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now())
    );

    create table public.platform_feedback_comments (
      id uuid primary key default gen_random_uuid(),
      feedback_id uuid not null,
      created_by uuid,
      created_by_name text not null default '',
      created_by_email text not null default '',
      message text not null,
      created_at timestamptz not null default timezone('utc', now())
    );

    create table public.platform_feedback_votes (
      id uuid primary key default gen_random_uuid(),
      feedback_id uuid not null,
      user_id uuid not null,
      created_at timestamptz not null default timezone('utc', now()),
      unique (feedback_id, user_id)
    );

    create function public.current_user_has_active_authority()
    returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
      select exists (
        select 1 from public.users actor
        where actor.id = (select auth.uid())
          and actor.status = 'active'
          and (
            (actor.role = 'super_admin' and exists (
              select 1 from public.platform_admins admin where admin.id = actor.id and admin.status = 'active'
            ))
            or
            (actor.role <> 'super_admin' and exists (
              select 1 from public.user_club_memberships membership
              where membership.auth_user_id = actor.id
                and membership.club_id = actor.club_id
                and membership.role = actor.role
                and membership.role_rank = actor.role_rank
            ))
          )
      )
    $$;

    create function public.current_user_role()
    returns text language sql stable security definer set search_path = pg_catalog, public as $$
      select actor.role from public.users actor
      where actor.id = (select auth.uid()) and public.current_user_has_active_authority()
    $$;

    create function public.current_user_role_rank()
    returns integer language sql stable security definer set search_path = pg_catalog, public as $$
      select actor.role_rank from public.users actor
      where actor.id = (select auth.uid()) and public.current_user_has_active_authority()
    $$;

    create function public.current_user_club_id()
    returns uuid language sql stable security definer set search_path = pg_catalog, public as $$
      select actor.club_id from public.users actor
      where actor.id = (select auth.uid()) and public.current_user_has_active_authority()
    $$;

    create function public.user_belongs_to_current_club(target_user_id uuid)
    returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
      select exists (
        select 1 from public.user_club_memberships membership
        where membership.auth_user_id = target_user_id
          and membership.club_id = public.current_user_club_id()
      )
    $$;

    create function public.can_insert_team_for_plan(target_club_id uuid)
    returns boolean language sql stable as $$ select true $$;
    create function public.can_insert_player_for_plan(target_club_id uuid, target_section text, target_name text)
    returns boolean language sql stable as $$ select true $$;
    create function public.can_use_plan_feature(target_club_id uuid, feature_name text)
    returns boolean language sql stable as $$ select true $$;

    grant usage on schema public, auth to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
    grant execute on all functions in schema public, auth to anon, authenticated, service_role;

    alter table public.clubs enable row level security;
    alter table public.teams enable row level security;
    alter table public.team_staff enable row level security;
    alter table public.players enable row level security;
    alter table public.parent_player_links enable row level security;
    alter table public.player_staff_notes enable row level security;
    alter table public.match_days enable row level security;
    alter table public.match_day_events enable row level security;
    alter table public.match_day_availability_requests enable row level security;
    alter table public.match_day_player_availability enable row level security;
    alter table public.match_day_player_availability_history enable row level security;
    alter table public.match_day_scorer_interest enable row level security;
    alter table public.match_day_scorer_assignments enable row level security;
    alter table public.match_day_role_assignments enable row level security;
    alter table public.training_availability_settings enable row level security;
    alter table public.training_availability_requests enable row level security;
    alter table public.training_availability_request_players enable row level security;
    alter table public.training_availability_responses enable row level security;
    alter table public.platform_feedback enable row level security;
    alter table public.platform_feedback_comments enable row level security;
    alter table public.platform_feedback_votes enable row level security;
  `)

  await db.exec(await readFile(migrationUrl, 'utf8'))

  await db.exec(`
    insert into public.clubs(id, name, logo_url, website, town_city, country, contact_email, contact_phone) values
      ('${ID.clubA}', 'Club A', 'a.png', 'https://a.test', 'Town A', 'England', 'private-a@test.invalid', '111'),
      ('${ID.clubB}', 'Club B', 'b.png', 'https://b.test', 'Town B', 'England', 'private-b@test.invalid', '222');
    insert into public.teams(id, club_id, name) values
      ('${ID.teamA1}', '${ID.clubA}', 'A One'),
      ('${ID.teamA2}', '${ID.clubA}', 'A Two'),
      ('${ID.teamB1}', '${ID.clubB}', 'B One');

    insert into public.users(id, email, role, role_rank, club_id) values
      ('${ID.parent}', 'parent@test.invalid', 'parent_portal', 10, '${ID.clubA}'),
      ('${ID.assistant}', 'assistant@test.invalid', 'assistant_coach', 20, '${ID.clubA}'),
      ('${ID.coach}', 'coach@test.invalid', 'coach', 30, '${ID.clubA}'),
      ('${ID.manager}', 'manager@test.invalid', 'manager', 50, '${ID.clubA}'),
      ('${ID.teamAdmin}', 'team-admin@test.invalid', 'head_manager', 70, '${ID.clubA}'),
      ('${ID.clubAdmin}', 'club-admin@test.invalid', 'admin', 90, '${ID.clubA}'),
      ('${ID.otherCoach}', 'other@test.invalid', 'coach', 30, '${ID.clubB}'),
      ('${ID.platform}', 'platform@test.invalid', 'super_admin', 100, null);

    insert into public.user_club_memberships(auth_user_id, email, role, role_rank, club_id)
    select id, email, role, role_rank, club_id from public.users where club_id is not null;
    insert into public.platform_admins(id) values ('${ID.platform}');

    insert into public.team_staff(team_id, user_id) values
      ('${ID.teamA1}', '${ID.assistant}'),
      ('${ID.teamA1}', '${ID.coach}'),
      ('${ID.teamA1}', '${ID.manager}'),
      ('${ID.teamA1}', '${ID.teamAdmin}'),
      ('${ID.teamB1}', '${ID.otherCoach}');

    insert into public.players(id, club_id, team_id, player_name) values
      ('${ID.linked}', '${ID.clubA}', '${ID.teamA1}', 'Linked Child'),
      ('${ID.sibling}', '${ID.clubA}', '${ID.teamA1}', 'Linked Sibling'),
      ('${ID.sameTeam}', '${ID.clubA}', '${ID.teamA1}', 'Unrelated Same Team'),
      ('${ID.sameClub}', '${ID.clubA}', '${ID.teamA2}', 'Unrelated Same Club'),
      ('${ID.crossClub}', '${ID.clubB}', '${ID.teamB1}', 'Cross Club'),
      ('${ID.inactiveLink}', '${ID.clubA}', '${ID.teamA1}', 'Inactive Link');

    insert into public.parent_player_links(club_id, team_id, player_id, auth_user_id, email, status) values
      ('${ID.clubA}', '${ID.teamA1}', '${ID.linked}', '${ID.parent}', 'parent@test.invalid', 'active'),
      ('${ID.clubA}', '${ID.teamA1}', '${ID.sibling}', '${ID.parent}', 'parent@test.invalid', 'active'),
      ('${ID.clubA}', '${ID.teamA1}', '${ID.inactiveLink}', '${ID.parent}', 'parent@test.invalid', 'revoked');

    insert into public.player_staff_notes(club_id, player_id, user_id, note) values
      ('${ID.clubA}', '${ID.linked}', '${ID.coach}', 'A1 note'),
      ('${ID.clubA}', '${ID.sameClub}', '${ID.clubAdmin}', 'A2 note'),
      ('${ID.clubB}', '${ID.crossClub}', '${ID.otherCoach}', 'B1 note');

    insert into public.match_day_availability_requests(club_id, team_id) values
      ('${ID.clubA}', '${ID.teamA1}'), ('${ID.clubA}', '${ID.teamA2}'), ('${ID.clubB}', '${ID.teamB1}');
    insert into public.match_day_player_availability(club_id, team_id) values
      ('${ID.clubA}', '${ID.teamA1}'), ('${ID.clubA}', '${ID.teamA2}'), ('${ID.clubB}', '${ID.teamB1}');
    insert into public.match_day_player_availability_history(club_id, team_id) values
      ('${ID.clubA}', '${ID.teamA1}'), ('${ID.clubA}', '${ID.teamA2}'), ('${ID.clubB}', '${ID.teamB1}');
    insert into public.match_day_scorer_interest(club_id, team_id) values
      ('${ID.clubA}', '${ID.teamA1}'), ('${ID.clubA}', '${ID.teamA2}'), ('${ID.clubB}', '${ID.teamB1}');
    insert into public.match_day_scorer_assignments(club_id, team_id) values
      ('${ID.clubA}', '${ID.teamA1}'), ('${ID.clubA}', '${ID.teamA2}'), ('${ID.clubB}', '${ID.teamB1}');
    insert into public.match_day_role_assignments(club_id, team_id) values
      ('${ID.clubA}', '${ID.teamA1}'), ('${ID.clubA}', '${ID.teamA2}'), ('${ID.clubB}', '${ID.teamB1}');
    insert into public.match_day_events(club_id, team_id) values
      ('${ID.clubA}', '${ID.teamA1}'), ('${ID.clubA}', '${ID.teamA2}'), ('${ID.clubB}', '${ID.teamB1}');

    insert into public.platform_feedback(id, club_id, created_by, created_by_name, created_by_email, message, status) values
      ('${ID.feedbackOwn}', '${ID.clubA}', '${ID.parent}', 'Parent', 'parent@test.invalid', 'Own feedback', 'open'),
      ('${ID.feedbackSameClub}', '${ID.clubA}', '${ID.coach}', 'Coach', 'coach@test.invalid', 'Same club feedback', 'planned'),
      ('${ID.feedbackCrossClub}', '${ID.clubB}', '${ID.otherCoach}', 'Other', 'other@test.invalid', 'Cross club feedback', 'open'),
      ('${ID.feedbackHidden}', '${ID.clubA}', '${ID.parent}', 'Parent', 'parent@test.invalid', 'Hidden feedback', 'hidden');
    insert into public.platform_feedback_comments(feedback_id, created_by, created_by_name, created_by_email, message) values
      ('${ID.feedbackOwn}', '${ID.platform}', 'Platform', 'platform@test.invalid', 'Own comment'),
      ('${ID.feedbackSameClub}', '${ID.platform}', 'Platform', 'platform@test.invalid', 'Same club comment'),
      ('${ID.feedbackCrossClub}', '${ID.platform}', 'Platform', 'platform@test.invalid', 'Cross club comment');
    insert into public.platform_feedback_votes(feedback_id, user_id) values
      ('${ID.feedbackOwn}', '${ID.coach}'),
      ('${ID.feedbackSameClub}', '${ID.parent}'),
      ('${ID.feedbackSameClub}', '${ID.coach}');
  `)

  return db
}

async function setActor(db, actorId, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId || ''])
  await db.exec(`set role ${role}`)
}

async function asOwner(db) {
  await db.exec('reset role')
}

async function visibleIds(db, table) {
  const result = await db.query(`select id from public.${table} order by id`)
  return result.rows.map((row) => row.id)
}

test('parents see only active linked children and use narrow relationship actions', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, ID.parent)
    assert.deepEqual(await visibleIds(db, 'players'), [ID.linked, ID.sibling])
    assert.equal((await db.query('select count(*)::int count from public.teams')).rows[0].count, 1)

    await db.exec(`update public.players set player_name = 'Blocked' where id = '${ID.sameTeam}'`)
    await asOwner(db)
    assert.equal((await db.query(`select player_name from public.players where id = '${ID.sameTeam}'`)).rows[0].player_name, 'Unrelated Same Team')

    await setActor(db, ID.parent)
    const parentLink = await db.query(`select id from public.parent_player_links where player_id = '${ID.linked}'`)
    const familyLink = await db.query(`select (public.create_own_family_share_link($1)).*`, [parentLink.rows[0].id])
    assert.equal(familyLink.rows[0].player_id, ID.linked)
    assert.equal(familyLink.rows[0].status, 'pending')

    await db.query("select public.update_own_parent_link_email('updated-parent@test.invalid')")
    await asOwner(db)
    assert.equal((await db.query(`select count(*)::int count from public.parent_player_links where auth_user_id = '${ID.parent}' and status = 'active' and email = 'updated-parent@test.invalid'`)).rows[0].count, 2)

    await db.exec(`update public.users set status = 'suspended' where id = '${ID.parent}'`)
    await setActor(db, ID.parent)
    assert.equal((await db.query('select count(*)::int count from public.players')).rows[0].count, 0)
    await assert.rejects(db.query("select public.update_own_parent_link_email('blocked@test.invalid')"), /not[_ ]permitted/i)
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('assistant, coach, manager and Team Admin remain exact-assignment scoped', async () => {
  const db = await createDatabase()
  try {
    for (const actor of [ID.assistant, ID.coach, ID.manager, ID.teamAdmin]) {
      await setActor(db, actor)
      assert.deepEqual(await visibleIds(db, 'teams'), [ID.teamA1])
      assert.deepEqual(await visibleIds(db, 'players'), [ID.linked, ID.sibling, ID.sameTeam, ID.inactiveLink].sort())
      assert.equal((await db.query('select count(*)::int count from public.player_staff_notes')).rows[0].count, 1)
      assert.equal((await db.query('select count(*)::int count from public.match_day_availability_requests')).rows[0].count, 1)
      assert.equal((await db.query('select count(*)::int count from public.match_day_scorer_assignments')).rows[0].count, 1)
      assert.equal((await db.query('select count(*)::int count from public.match_day_events')).rows[0].count, 1)
    }

    await setActor(db, ID.assistant)
    await db.exec(`update public.teams set name = 'Blocked' where id = '${ID.teamA1}'`)
    await asOwner(db)
    assert.equal((await db.query(`select name from public.teams where id = '${ID.teamA1}'`)).rows[0].name, 'A One')

    await db.exec(`delete from public.team_staff where user_id = '${ID.coach}' and team_id = '${ID.teamA1}'`)
    await setActor(db, ID.coach)
    assert.equal((await db.query('select count(*)::int count from public.players')).rows[0].count, 0)

    await asOwner(db)
    await db.exec(`update public.users set status = 'suspended' where id = '${ID.manager}'`)
    await setActor(db, ID.manager)
    assert.equal((await db.query('select count(*)::int count from public.players')).rows[0].count, 0)
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('Club Admin is own-club scoped and active Platform Admin has deliberate global support access', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, ID.clubAdmin)
    assert.deepEqual(await visibleIds(db, 'clubs'), [ID.clubA])
    assert.deepEqual(await visibleIds(db, 'teams'), [ID.teamA1, ID.teamA2])
    assert.equal((await db.query('select count(*)::int count from public.players')).rows[0].count, 5)

    const directory = await db.query('select * from public.list_club_directory()')
    assert.equal(directory.rows.length, 2)
    assert.deepEqual(Object.keys(directory.rows[0]).sort(), ['club_name', 'country', 'logo_url', 'town_city', 'website'])
    assert.equal('contact_email' in directory.rows[0], false)
    assert.equal('id' in directory.rows[0], false)

    await setActor(db, '', 'anon')
    await assert.rejects(db.query('select * from public.clubs'), /permission denied/i)
    await assert.rejects(db.query('select * from public.list_club_directory()'), /permission denied/i)

    await setActor(db, ID.platform)
    assert.deepEqual(await visibleIds(db, 'clubs'), [ID.clubA, ID.clubB])
    assert.equal((await db.query('select count(*)::int count from public.players')).rows[0].count, 6)

    await asOwner(db)
    await db.exec(`update public.platform_admins set status = 'suspended' where id = '${ID.platform}'`)
    await setActor(db, ID.platform)
    assert.equal((await db.query('select count(*)::int count from public.clubs')).rows[0].count, 0)
  } finally {
    await asOwner(db)
    await db.close()
  }
})

test('feedback base rows are owner scoped while the safe board is same-club and metadata minimised', async () => {
  const db = await createDatabase()
  try {
    await setActor(db, ID.parent)
    assert.deepEqual(await visibleIds(db, 'platform_feedback'), [ID.feedbackOwn])

    const board = await db.query('select * from public.list_platform_feedback()')
    assert.deepEqual(board.rows.map((row) => row.id).sort(), [ID.feedbackOwn, ID.feedbackSameClub].sort())
    const sameClub = board.rows.find((row) => row.id === ID.feedbackSameClub)
    assert.equal(sameClub.created_by, null)
    assert.equal(sameClub.created_by_name, '')
    assert.equal(sameClub.created_by_email, '')
    assert.equal(Number(sameClub.vote_count), 2)
    assert.equal(sameClub.has_voted, true)
    assert.equal(sameClub.comments[0].created_by_email, '')

    assert.deepEqual(await visibleIds(db, 'platform_feedback_votes'), [
      (await db.query(`select id from public.platform_feedback_votes where feedback_id = '${ID.feedbackSameClub}' and user_id = '${ID.parent}'`)).rows[0].id,
    ])
    assert.equal((await db.query('select count(*)::int count from public.platform_feedback_comments')).rows[0].count, 1)

    await assert.rejects(
      db.exec(`insert into public.platform_feedback_votes(feedback_id, user_id) values ('${ID.feedbackCrossClub}', '${ID.parent}') on conflict do nothing`),
      /row-level security/i,
    )
    await asOwner(db)
    assert.equal((await db.query(`select count(*)::int count from public.platform_feedback_votes where feedback_id = '${ID.feedbackCrossClub}' and user_id = '${ID.parent}'`)).rows[0].count, 0)

    await setActor(db, ID.platform)
    const moderation = await db.query('select * from public.list_platform_feedback()')
    assert.equal(moderation.rows.length, 4)
    assert.equal(moderation.rows.find((row) => row.id === ID.feedbackOwn).created_by_email, 'parent@test.invalid')
    await db.exec(`update public.platform_feedback set status = 'in_progress' where id = '${ID.feedbackCrossClub}'`)

    await asOwner(db)
    await db.exec(`update public.platform_admins set status = 'suspended' where id = '${ID.platform}'`)
    await setActor(db, ID.platform)
    assert.equal((await db.query('select count(*)::int count from public.platform_feedback')).rows[0].count, 0)
    assert.equal((await db.query('select count(*)::int count from public.list_platform_feedback()')).rows[0].count, 0)
  } finally {
    await asOwner(db)
    await db.close()
  }
})
