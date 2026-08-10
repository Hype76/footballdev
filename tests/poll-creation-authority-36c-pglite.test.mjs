import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260810111711_poll_creation_authority_36c.sql',
  import.meta.url,
)
const permissionsUrl = new URL('../src/lib/auth-permissions.js', import.meta.url)
const pollsDomainUrl = new URL('../src/lib/domain/polls.js', import.meta.url)
const pollsPageUrl = new URL('../src/pages/PollsPage.jsx', import.meta.url)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  otherClub: '10000000-0000-4000-8000-000000000002',
  teamA: '20000000-0000-4000-8000-000000000001',
  teamB: '20000000-0000-4000-8000-000000000002',
  archivedTeam: '20000000-0000-4000-8000-000000000003',
  otherTeam: '20000000-0000-4000-8000-000000000004',
  clubAdmin: '30000000-0000-4000-8000-000000000001',
  teamAdmin: '30000000-0000-4000-8000-000000000002',
  manager: '30000000-0000-4000-8000-000000000003',
  coach: '30000000-0000-4000-8000-000000000004',
  parent: '30000000-0000-4000-8000-000000000005',
  player: '30000000-0000-4000-8000-000000000006',
  platform: '30000000-0000-4000-8000-000000000007',
  highRankUnknown: '30000000-0000-4000-8000-000000000008',
}

let requestCounter = 1

async function setActor(db, actorId) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: actorId }),
  ])
}

async function createPoll(db, { activeTeamId = null, teamId = null, title = 'Authority poll' } = {}) {
  const requestId = `40000000-0000-4000-8000-${String(requestCounter).padStart(12, '0')}`
  requestCounter += 1

  return db.query(
    `select (public.create_team_poll(
      $1, $2, $3, '', 'parents', 'text',
      '[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]'::jsonb,
      null, false, null, true, true, false, false, $4
    )).id as id`,
    [activeTeamId, teamId, title, requestId],
  )
}

async function createDatabase() {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;
    revoke all on schema app_private from public, anon, authenticated, service_role;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.clubs (
      id uuid primary key,
      status text not null default 'active',
      archived_at timestamptz,
      payment_required boolean not null default false
    );

    create table public.users (
      id uuid primary key,
      club_id uuid,
      email text,
      name text,
      display_name text,
      username text,
      status text not null default 'active',
      role text not null,
      role_rank integer not null
    );

    create table public.user_club_memberships (
      auth_user_id uuid not null,
      club_id uuid not null,
      role text not null,
      role_rank integer not null
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null,
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.team_staff (
      user_id uuid not null,
      team_id uuid not null
    );

    create table public.polls (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid,
      title text not null,
      description text not null default '',
      audience text not null,
      poll_type text not null,
      options jsonb not null,
      status text not null,
      closes_at timestamptz,
      allow_multiple boolean not null default false,
      max_choices integer,
      allow_own_child_votes boolean not null default true,
      allow_vote_changes boolean not null default true,
      hide_votes boolean not null default false,
      allow_comments boolean not null default false,
      created_by uuid not null,
      created_by_name text,
      privileged_request_id uuid,
      created_at timestamptz not null default statement_timestamp(),
      updated_at timestamptz not null default statement_timestamp()
    );

    create unique index polls_creator_privileged_request_id_uidx
      on public.polls (created_by, privileged_request_id)
      where privileged_request_id is not null;

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid,
      action text,
      entity_type text,
      entity_id uuid,
      metadata jsonb
    );

    create function public.create_team_poll(
      p_team_id uuid, p_title text, p_description text, p_audience text,
      p_poll_type text, p_options jsonb, p_closes_at timestamptz,
      p_allow_multiple boolean, p_max_choices integer,
      p_allow_own_child_votes boolean, p_allow_vote_changes boolean,
      p_hide_votes boolean, p_allow_comments boolean, p_request_id uuid
    )
    returns public.polls
    language plpgsql
    security definer
    as $$
    declare result_poll public.polls%rowtype;
    begin
      insert into public.polls (
        club_id, team_id, title, audience, poll_type, options, status,
        created_by, privileged_request_id
      ) values (
        '${ids.club}', p_team_id, p_title, p_audience, p_poll_type, p_options,
        'open', auth.uid(), p_request_id
      ) returning * into result_poll;
      return result_poll;
    end
    $$;

    revoke all on function public.create_team_poll(
      uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
      boolean, boolean, boolean, boolean, uuid
    ) from public, anon, service_role;
    grant execute on function public.create_team_poll(
      uuid, text, text, text, text, jsonb, timestamptz, boolean, integer,
      boolean, boolean, boolean, boolean, uuid
    ) to authenticated;

    create function app_private.enforce_poll_billing()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      if exists (
        select 1 from public.clubs club
        where club.id = new.club_id and club.payment_required
      ) then
        raise exception 'payment_required';
      end if;
      return new;
    end
    $$;

    create trigger enforce_poll_billing
    before insert on public.polls
    for each row execute function app_private.enforce_poll_billing();

    insert into public.clubs (id) values
      ('${ids.club}'),
      ('${ids.otherClub}');

    insert into public.teams (id, club_id, status, archived_at) values
      ('${ids.teamA}', '${ids.club}', 'active', null),
      ('${ids.teamB}', '${ids.club}', 'active', null),
      ('${ids.archivedTeam}', '${ids.club}', 'archived', statement_timestamp()),
      ('${ids.otherTeam}', '${ids.otherClub}', 'active', null);

    insert into public.users (id, club_id, email, name, role, role_rank) values
      ('${ids.clubAdmin}', '${ids.club}', 'admin@example.test', 'Club Admin', 'admin', 90),
      ('${ids.teamAdmin}', '${ids.club}', 'team-admin@example.test', 'Team Admin', 'head_manager', 70),
      ('${ids.manager}', '${ids.club}', 'manager@example.test', 'Manager', 'manager', 50),
      ('${ids.coach}', '${ids.club}', 'coach@example.test', 'Coach', 'coach', 30),
      ('${ids.parent}', '${ids.club}', 'parent@example.test', 'Parent', 'parent_portal', 0),
      ('${ids.player}', '${ids.club}', 'player@example.test', 'Player', 'adult_player', 0),
      ('${ids.platform}', null, 'platform@example.test', 'Platform', 'super_admin', 100),
      ('${ids.highRankUnknown}', '${ids.club}', 'unknown@example.test', 'Unknown', 'custom_operator', 99);

    insert into public.user_club_memberships (auth_user_id, club_id, role, role_rank)
    select id, club_id, role, role_rank
    from public.users
    where club_id is not null;

    insert into public.team_staff (user_id, team_id) values
      ('${ids.teamAdmin}', '${ids.teamA}'),
      ('${ids.teamAdmin}', '${ids.teamB}'),
      ('${ids.manager}', '${ids.teamA}'),
      ('${ids.coach}', '${ids.teamA}'),
      ('${ids.coach}', '${ids.archivedTeam}'),
      ('${ids.highRankUnknown}', '${ids.teamA}');
  `)

  await db.exec(migration)
  return db
}

test('Poll creation uses Club Admin or exact active assigned-Team authority', async () => {
  const db = await createDatabase()

  await setActor(db, ids.clubAdmin)
  assert.equal((await createPoll(db, { title: 'Club-wide' })).rows.length, 1)
  assert.equal((await createPoll(db, { teamId: ids.teamB, title: 'Club Admin Team' })).rows.length, 1)

  await setActor(db, ids.teamAdmin)
  assert.equal((await createPoll(db, { activeTeamId: ids.teamA, teamId: ids.teamA, title: 'Team Admin A' })).rows.length, 1)
  assert.equal((await createPoll(db, { activeTeamId: ids.teamB, teamId: ids.teamB, title: 'Team Admin B' })).rows.length, 1)
  await assert.rejects(
    () => createPoll(db, { activeTeamId: ids.teamA, title: 'Forged Club-wide' }),
    /poll_change_not_permitted/,
  )
  await assert.rejects(
    () => createPoll(db, { activeTeamId: ids.teamA, teamId: ids.teamB, title: 'Wrong assigned Team' }),
    /poll_change_not_permitted/,
  )

  await setActor(db, ids.manager)
  assert.equal((await createPoll(db, { activeTeamId: ids.teamA, teamId: ids.teamA, title: 'Manager Team' })).rows.length, 1)

  await setActor(db, ids.coach)
  assert.equal((await createPoll(db, { activeTeamId: ids.teamA, teamId: ids.teamA, title: 'Coach Team' })).rows.length, 1)
  await assert.rejects(
    () => createPoll(db, { activeTeamId: ids.archivedTeam, teamId: ids.archivedTeam, title: 'Archived Team' }),
    /poll_change_not_permitted/,
  )
  await assert.rejects(
    () => createPoll(db, { activeTeamId: ids.otherTeam, teamId: ids.otherTeam, title: 'Forged Club' }),
    /poll_change_not_permitted/,
  )

  for (const deniedActor of [ids.parent, ids.player, ids.platform, ids.highRankUnknown]) {
    await setActor(db, deniedActor)
    await assert.rejects(
      () => createPoll(db, { activeTeamId: ids.teamA, teamId: ids.teamA, title: 'Denied role' }),
      /poll_change_not_permitted/,
    )
  }

  await db.query('update public.clubs set payment_required = true where id = $1', [ids.club])
  await setActor(db, ids.clubAdmin)
  await assert.rejects(() => createPoll(db, { title: 'Payment blocked' }), /payment_required/)

  const privilegeRows = await db.query(`
    select
      has_function_privilege('authenticated', 'public.create_team_poll(uuid,text,text,text,text,jsonb,timestamp with time zone,boolean,integer,boolean,boolean,boolean,boolean,uuid)', 'execute') as old_authenticated,
      has_function_privilege('authenticated', 'public.create_team_poll(uuid,uuid,text,text,text,text,jsonb,timestamp with time zone,boolean,integer,boolean,boolean,boolean,boolean,uuid)', 'execute') as new_authenticated,
      has_function_privilege('anon', 'public.create_team_poll(uuid,uuid,text,text,text,text,jsonb,timestamp with time zone,boolean,integer,boolean,boolean,boolean,boolean,uuid)', 'execute') as new_anon
  `)
  assert.deepEqual(privilegeRows.rows[0], {
    old_authenticated: false,
    new_authenticated: true,
    new_anon: false,
  })

  await db.close()
})

test('Poll clients expose Club-wide scope only to canonical Club Admin and submit active context', async () => {
  const [permissions, domain, page] = await Promise.all([
    readFile(permissionsUrl, 'utf8'),
    readFile(pollsDomainUrl, 'utf8'),
    readFile(pollsPageUrl, 'utf8'),
  ])

  assert.match(permissions, /\['head_manager', 'manager', 'coach', 'assistant_coach'\]\.includes\(user\.role\)/)
  assert.doesNotMatch(permissions.match(/export function canManagePolls[\s\S]*?\n}/)?.[0] ?? '', /roleRank/)
  assert.match(domain, /p_active_team_id: String\(user\.activeTeamId \?\? ''\)\.trim\(\) \|\| null/)
  assert.match(domain, /!isClubAdmin\(user\) && teamId !== String\(user\.activeTeamId/)
  assert.match(page, /isClubAdminUser \? <option value="">All teams in this club<\/option> : null/)
  assert.match(page, /teams\.filter\(\(team\) => String\(team\.id\) === String\(user\?\.activeTeamId/)
})
