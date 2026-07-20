import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260719092052_p0_demo_reset_atomic_recovery.sql', import.meta.url)
const backupContainmentMigrationUrl = new URL('../supabase/migrations/20260720071943_p0_demo_recovery_backup_side_effect_containment.sql', import.meta.url)

const IDS = Object.freeze({
  demoActor: '10000000-0000-4000-8000-000000000001',
  demoClub: '20000000-0000-4000-8000-000000000001',
  demoTeamU12: '30000000-0000-4000-8000-000000000001',
  demoTeamU14: '30000000-0000-4000-8000-000000000002',
  demoTeamU16: '30000000-0000-4000-8000-000000000003',
  realActor: '10000000-0000-4000-8000-000000000002',
  realClub: '20000000-0000-4000-8000-000000000002',
  realTeam: '30000000-0000-4000-8000-000000000004',
  realMatch: '40000000-0000-4000-8000-000000000001',
  operationPartial: '50000000-0000-4000-8000-000000000001',
  operationHealthy: '50000000-0000-4000-8000-000000000002',
  operationFailure: '50000000-0000-4000-8000-000000000003',
})

const schemaSql = `
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
  create schema auth;

  create table auth.users (id uuid primary key, email text not null);
  create function auth.uid() returns uuid language sql stable set search_path = '' as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create table public.clubs (
    id uuid primary key, name text not null, status text not null default 'active',
    plan_key text not null default 'large_club', plan_status text not null default 'active',
    is_plan_comped boolean not null default true
  );
  create unique index clubs_name_key on public.clubs(lower(name));

  create table public.users (
    id uuid primary key references auth.users(id), email text not null, club_id uuid references public.clubs(id),
    role text not null, role_label text, role_rank integer not null, status text not null default 'active'
  );

  create table public.record_backups (
    id uuid primary key default gen_random_uuid(), club_id uuid, table_name text not null,
    record_id uuid, operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
    actor_id uuid references public.users(id) on delete set null, actor_role_label text,
    actor_role_rank integer not null default 0, old_data jsonb, new_data jsonb,
    created_at timestamptz not null default timezone('utc', now())
  );

  create table public.user_club_memberships (
    id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id),
    club_id uuid not null references public.clubs(id), email text not null, username text, name text,
    role text not null, role_label text not null, role_rank integer not null,
    unique (auth_user_id, club_id)
  );

  create table public.club_roles (
    id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id),
    role_key text not null, role_label text not null, role_rank integer not null, is_system boolean not null default false,
    created_by uuid, created_by_name text, created_by_email text,
    unique (club_id, role_key), unique (club_id, role_label)
  );

  create table public.teams (
    id uuid primary key, club_id uuid not null references public.clubs(id), name text not null,
    created_by uuid, created_by_name text, created_by_email text
  );
  create unique index teams_club_id_name_key on public.teams(club_id, name);

  create table public.team_staff (
    id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade, unique (team_id, user_id)
  );

  create table public.form_fields (
    id uuid primary key, club_id uuid not null references public.clubs(id), label text not null,
    type text not null, options jsonb not null default '[]', required boolean not null default false,
    order_index integer not null, is_default boolean not null default false, is_enabled boolean not null default true,
    created_by uuid, created_by_name text, created_by_email text
  );

  create table public.players (
    id uuid primary key, club_id uuid not null references public.clubs(id), player_name text not null,
    shirt_number text, section text not null, team_id uuid references public.teams(id), team text not null,
    parent_name text, parent_email text, parent_contacts jsonb not null default '[]', contact_type text not null default 'parent',
    positions text[] not null default '{}', status text not null, notes text, created_by uuid,
    created_by_name text, created_by_email text, archived_reason text, archived_at timestamptz,
    archived_by uuid, archived_previous_status text, archived_delete_at timestamptz
  );

  create table public.assessment_sessions (
    id uuid primary key, club_id uuid not null references public.clubs(id), team_id uuid references public.teams(id),
    team text not null, opponent text not null default '', session_date date not null, title text not null,
    session_type text not null, status text not null, created_by uuid, created_by_name text, created_by_email text
  );

  create table public.evaluations (
    id uuid primary key, club_id uuid not null references public.clubs(id), player_id uuid references public.players(id),
    player_name text not null, team text not null, team_id uuid references public.teams(id), coach_id uuid not null,
    coach text not null, parent_name text, parent_email text, parent_contacts jsonb not null default '[]',
    session text, date text, scores jsonb not null default '{}', average_score numeric,
    comments jsonb not null default '{}', form_responses jsonb not null default '{}', decision text not null default '',
    status text not null, section text not null, created_by_name text, created_by_email text,
    updated_by uuid, updated_by_name text, updated_by_email text, created_at timestamptz not null default now()
  );

  create table public.assessment_session_players (
    id uuid primary key, session_id uuid not null references public.assessment_sessions(id) on delete cascade,
    player_id uuid not null references public.players(id) on delete cascade, player_name text not null,
    section text not null, team text not null, parent_name text not null default '', parent_email text not null default '',
    parent_contacts jsonb not null default '[]', notes text not null default '', created_by uuid,
    created_by_name text, created_by_email text, unique (session_id, player_id)
  );

  create function public.capture_record_backup()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    row_data jsonb := coalesce(to_jsonb(NEW), to_jsonb(OLD));
    row_club_id uuid;
  begin
    row_club_id := nullif(row_data ->> 'club_id', '')::uuid;
    if row_club_id is null and TG_TABLE_NAME = 'team_staff' then
      select club_id into row_club_id from public.teams where id = (row_data ->> 'team_id')::uuid;
    end if;
    if row_club_id is null and TG_TABLE_NAME = 'assessment_session_players' then
      select club_id into row_club_id from public.assessment_sessions where id = (row_data ->> 'session_id')::uuid;
    end if;
    insert into public.record_backups(club_id, table_name, record_id, operation, old_data, new_data)
    values (
      row_club_id,
      TG_TABLE_NAME,
      nullif(row_data ->> 'id', '')::uuid,
      TG_OP,
      case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) end,
      case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) end
    );
    return coalesce(NEW, OLD);
  end;
  $$;

  create trigger backup_team_staff after insert or update or delete on public.team_staff
  for each row execute function public.capture_record_backup();
  create trigger backup_players after insert or update or delete on public.players
  for each row execute function public.capture_record_backup();
  create trigger backup_evaluations after insert or update or delete on public.evaluations
  for each row execute function public.capture_record_backup();
  create trigger backup_form_fields after insert or update or delete on public.form_fields
  for each row execute function public.capture_record_backup();
  create trigger backup_assessment_sessions after insert or update or delete on public.assessment_sessions
  for each row execute function public.capture_record_backup();
  create trigger backup_assessment_session_players after insert or update or delete on public.assessment_session_players
  for each row execute function public.capture_record_backup();

  create table public.parent_player_links (
    id uuid primary key, club_id uuid not null references public.clubs(id), team_id uuid not null references public.teams(id),
    player_id uuid not null references public.players(id) on delete cascade, link_type text not null, email text,
    status text not null, invited_by uuid, invited_by_name text, accepted_at timestamptz,
    auth_user_id uuid references auth.users(id), guardian_id uuid, invite_sent_at timestamptz,
    invite_token uuid not null default gen_random_uuid()
  );

  create table public.player_staff_notes (
    id uuid primary key, club_id uuid not null references public.clubs(id), player_id uuid references public.players(id) on delete cascade,
    user_id uuid, user_name text, user_email text, note text not null, created_at timestamptz not null default now()
  );

  create table public.communication_logs (id uuid primary key default gen_random_uuid(), club_id uuid not null);
  create table public.club_user_invites (id uuid primary key default gen_random_uuid(), club_id uuid not null);

  create table public.polls (
    id uuid primary key, club_id uuid not null references public.clubs(id), team_id uuid references public.teams(id),
    title text not null, description text not null default '', audience text not null, poll_type text not null,
    options jsonb not null default '[]', status text not null, closes_at timestamptz, allow_multiple boolean not null default false,
    allow_own_child_votes boolean not null default true, allow_vote_changes boolean not null default true,
    hide_votes boolean not null default false, allow_comments boolean not null default false,
    created_by uuid, created_by_name text
  );

  create table public.poll_votes (
    id uuid primary key, poll_id uuid not null references public.polls(id) on delete cascade,
    club_id uuid not null references public.clubs(id), team_id uuid references public.teams(id),
    voter_email text not null, voter_name text, option_id text not null,
    parent_link_id uuid references public.parent_player_links(id), auth_user_id uuid references auth.users(id)
  );

  create table public.match_locations (
    id uuid primary key, club_id uuid not null references public.clubs(id), name text not null,
    address text not null, notes text not null default '', created_by uuid
  );
  create unique index match_locations_club_name_address_key on public.match_locations(club_id, lower(name), lower(address));

  create table public.match_days (
    id uuid primary key, club_id uuid not null references public.clubs(id), team_id uuid references public.teams(id),
    location_id uuid references public.match_locations(id), opponent text not null, match_date date not null,
    kickoff_time time, home_away text not null, venue_name text not null default '', venue_address text not null default '',
    notes text not null default '', scorer_request_message text not null default '', status text not null,
    home_score integer not null default 0, away_score integer not null default 0, created_by uuid,
    created_by_name text, enable_motm_poll boolean not null default true, motm_poll_id uuid references public.polls(id),
    previous_hidden_at timestamptz, previous_hidden_by uuid
  );

  create table public.match_day_events (
    id uuid primary key, match_day_id uuid not null references public.match_days(id) on delete cascade,
    club_id uuid not null references public.clubs(id), team_id uuid references public.teams(id), event_type text not null,
    team_side text not null, minute integer, scorer_name text, scorer_initials text, scorer_shirt_number text,
    assist_name text, assist_initials text, assist_shirt_number text, home_score integer not null,
    away_score integer not null, notes text, created_by uuid, created_by_name text
  );

  create table public.match_day_scorer_interest (
    id uuid primary key, match_day_id uuid not null references public.match_days(id) on delete cascade,
    club_id uuid not null references public.clubs(id), team_id uuid references public.teams(id),
    parent_link_id uuid not null references public.parent_player_links(id), parent_name text, parent_email text,
    message text, status text not null, auth_user_id uuid references auth.users(id)
  );

  create table public.match_day_availability_requests (
    id uuid primary key, match_day_id uuid not null references public.match_days(id) on delete cascade,
    club_id uuid not null references public.clubs(id), team_id uuid references public.teams(id),
    player_id uuid not null references public.players(id), player_name text not null, recipient_email text not null,
    recipient_name text, recipient_type text not null, channel text not null, token_hash text not null unique,
    status text not null, responded_at timestamptz, expires_at timestamptz, sent_at timestamptz,
    created_by uuid, created_by_name text
  );

  create table public.calendar_events (id uuid primary key default gen_random_uuid(), club_id uuid not null);
  create table public.scheduled_email_queue (id uuid primary key default gen_random_uuid(), club_id uuid not null);
  create table public.calendar_event_notification_commands (id uuid primary key default gen_random_uuid(), club_id uuid not null);
  create table public.calendar_event_notification_events (id uuid primary key default gen_random_uuid(), club_id uuid not null);
  create table public.match_day_notification_events (id uuid primary key default gen_random_uuid(), club_id uuid not null);

  create table public.parent_chat_rooms (
    id uuid primary key default gen_random_uuid(), club_id uuid not null, team_id uuid,
    player_id uuid, match_day_id uuid, room_type text not null, title text not null,
    status text not null default 'active', updated_at timestamptz not null default now()
  );
  create unique index parent_chat_rooms_team_key on public.parent_chat_rooms(club_id, team_id) where room_type = 'team';
  create unique index parent_chat_rooms_parent_key on public.parent_chat_rooms(club_id, team_id, player_id) where room_type = 'parent_staff';
  create table public.parent_chat_memberships (
    id uuid primary key default gen_random_uuid(), room_id uuid not null references public.parent_chat_rooms(id),
    auth_user_id uuid not null, active boolean not null default true
  );
  create table public.parent_chat_membership_audit (
    id uuid primary key default gen_random_uuid(), room_id uuid not null references public.parent_chat_rooms(id),
    action text not null
  );
  create table public.parent_chat_messages (
    id uuid primary key default gen_random_uuid(), room_id uuid not null references public.parent_chat_rooms(id)
  );

  create table public.staff_chat_conversations (id uuid primary key default gen_random_uuid(), club_id uuid not null);
  create table public.staff_chat_members (
    id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.staff_chat_conversations(id)
  );
  create table public.staff_chat_messages (id uuid primary key default gen_random_uuid(), club_id uuid not null);

  create function public.parent_chat_reconcile_room(uuid) returns void language sql as $$ select $$;
  create function public.create_match_day_motm_poll(uuid) returns uuid language sql as $$ select null::uuid $$;
`

async function createDatabase() {
  const db = new PGlite()
  await db.exec(schemaSql)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(await readFile(backupContainmentMigrationUrl, 'utf8'))
  await db.exec(`
    create trigger parent_chat_team_staff_sync
    after insert or update of team_id, user_id or delete on public.team_staff
    for each row execute function public.parent_chat_sync_team_staff();

    create trigger parent_chat_parent_link_sync
    after insert or update of status, auth_user_id, team_id, player_id or delete on public.parent_player_links
    for each row execute function public.parent_chat_sync_parent_link();

    insert into public.clubs(id, name) values
      ('${IDS.demoClub}', 'Cambourne Town Academy FC'),
      ('${IDS.realClub}', 'Real Club FC');

    insert into auth.users(id, email) values
      ('${IDS.demoActor}', 'demo@playerfeedback.online'),
      ('${IDS.realActor}', 'real@example.test');

    insert into public.users(id, email, club_id, role, role_rank) values
      ('${IDS.demoActor}', 'demo@playerfeedback.online', '${IDS.demoClub}', 'head_manager', 70),
      ('${IDS.realActor}', 'real@example.test', '${IDS.realClub}', 'admin', 90);

    insert into public.user_club_memberships(auth_user_id, club_id, email, role, role_label, role_rank) values
      ('${IDS.demoActor}', '${IDS.demoClub}', 'demo@playerfeedback.online', 'head_manager', 'Team Admin', 70),
      ('${IDS.realActor}', '${IDS.realClub}', 'real@example.test', 'admin', 'Club Admin', 90);

    insert into public.teams(id, club_id, name, created_by) values
      ('${IDS.demoTeamU12}', '${IDS.demoClub}', 'U12 Tigers', '${IDS.demoActor}'),
      ('${IDS.demoTeamU14}', '${IDS.demoClub}', 'U14 Falcons', '${IDS.demoActor}'),
      ('${IDS.demoTeamU16}', '${IDS.demoClub}', 'U16 Lions', '${IDS.demoActor}'),
      ('${IDS.realTeam}', '${IDS.realClub}', 'Real Team', '${IDS.realActor}');

    insert into public.team_staff(team_id, user_id) values ('${IDS.realTeam}', '${IDS.realActor}');
    insert into public.match_days(
      id, club_id, team_id, opponent, match_date, kickoff_time, home_away,
      status, created_by, created_by_name
    ) values (
      '${IDS.realMatch}', '${IDS.realClub}', '${IDS.realTeam}', 'Real Opponent', current_date,
      '12:00', 'home', 'scheduled', '${IDS.realActor}', 'Real Manager'
    );

    insert into public.parent_chat_rooms(club_id, team_id, room_type, title)
    values
      ('${IDS.demoClub}', '${IDS.demoTeamU12}', 'team', 'U12 Team Chat'),
      ('${IDS.demoClub}', '${IDS.demoTeamU14}', 'team', 'U14 Team Chat'),
      ('${IDS.demoClub}', '${IDS.demoTeamU16}', 'team', 'U16 Team Chat');
    insert into public.parent_chat_memberships(room_id, auth_user_id)
    select id, '${IDS.demoActor}' from public.parent_chat_rooms where club_id = '${IDS.demoClub}';
    insert into public.parent_chat_membership_audit(room_id, action)
    select id, 'joined' from public.parent_chat_rooms where club_id = '${IDS.demoClub}';

    truncate table public.record_backups;
    insert into public.record_backups(
      id, club_id, table_name, record_id, operation, old_data, new_data
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '${IDS.realClub}',
      'players',
      '60000000-0000-4000-8000-000000000002',
      'UPDATE',
      '{"evidence":"preserved"}'::jsonb,
      '{"evidence":"preserved"}'::jsonb
    );

    grant usage on schema public to authenticated;
    grant select, insert, update, delete on public.form_fields to authenticated;
  `)
  return db
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params)
  return Object.values(result.rows[0])[0]
}

async function resetDemo(db, actorId, operationId) {
  await db.exec('set role service_role')
  try {
    return await scalar(db, 'select public.reset_demo_account_atomic($1, $2)', [actorId, operationId])
  } finally {
    await db.exec('reset role')
  }
}

test('partial demo state is recovered atomically while stable and real records remain unchanged', async () => {
  const db = await createDatabase()
  try {
    const stableTeamsBefore = await db.query(`
      select id, name from public.teams where club_id = $1 order by name
    `, [IDS.demoClub])
    const realBefore = await scalar(db, `
      select md5(jsonb_build_object(
        'club', (select row_to_json(club) from public.clubs club where id = $1),
        'team', (select row_to_json(team) from public.teams team where id = $2),
        'match', (select row_to_json(match_day) from public.match_days match_day where id = $3)
      )::text)
    `, [IDS.realClub, IDS.realTeam, IDS.realMatch])
    const communicationBefore = await scalar(db, 'select public.demo_reset_communication_fingerprint($1)', [IDS.demoClub])
    const backupsBefore = await scalar(db, `
      select md5(string_agg(md5(row_to_json(backup)::text), '' order by backup.id))
      from public.record_backups backup
    `)

    const result = await resetDemo(db, IDS.demoActor, IDS.operationPartial)

    assert.equal(result.success, true)
    assert.equal(result.cached, false)
    assert.equal(result.lock_result, 'acquired')
    assert.deepEqual(result.expected_counts, {
      clubs: 1,
      application_users: 1,
      memberships: 1,
      roles: 5,
      teams: 3,
      team_staff: 3,
      form_fields: 8,
      players: 10,
      evaluations: 6,
      assessment_sessions: 4,
      assessment_session_players: 14,
      parent_links: 7,
      staff_notes: 3,
      polls: 2,
      poll_votes: 7,
      match_locations: 2,
      match_days: 2,
      match_day_events: 2,
      scorer_interest: 1,
      availability_requests: 3,
      calendar_events: 0,
    })

    const stableTeamsAfter = await db.query('select id, name from public.teams where club_id = $1 order by name', [IDS.demoClub])
    assert.deepEqual(stableTeamsAfter.rows, stableTeamsBefore.rows)
    assert.equal(new Set(stableTeamsAfter.rows.map((team) => team.name)).size, 3)

    const realAfter = await scalar(db, `
      select md5(jsonb_build_object(
        'club', (select row_to_json(club) from public.clubs club where id = $1),
        'team', (select row_to_json(team) from public.teams team where id = $2),
        'match', (select row_to_json(match_day) from public.match_days match_day where id = $3)
      )::text)
    `, [IDS.realClub, IDS.realTeam, IDS.realMatch])
    const communicationAfter = await scalar(db, 'select public.demo_reset_communication_fingerprint($1)', [IDS.demoClub])
    assert.equal(realAfter, realBefore)
    assert.equal(communicationAfter, communicationBefore)
    assert.equal(await scalar(db, 'select count(*) from public.demo_reset_operations where outcome = $1', ['completed']), 1)
    assert.equal(await scalar(db, 'select count(*) from public.record_backups'), 1)
    assert.equal(
      await scalar(db, `
        select md5(string_agg(md5(row_to_json(backup)::text), '' order by backup.id))
        from public.record_backups backup
      `),
      backupsBefore,
    )
    assert.equal(await scalar(db, "select current_setting('app.demo_reset_backup_context_nonce', true)"), '')
    assert.equal(await scalar(db, 'select count(*) from app_private.demo_reset_backup_context'), 0)
    assert.equal(await scalar(db, "select current_setting('app.demo_reset_operation_id', true)"), '')
  } finally {
    await db.close()
  }
})

test('healthy state is idempotent and a network retry returns the completed operation', async () => {
  const db = await createDatabase()
  try {
    const first = await resetDemo(db, IDS.demoActor, IDS.operationPartial)
    const firstFingerprint = first.final_state_fingerprint

    const cached = await resetDemo(db, IDS.demoActor, IDS.operationPartial)
    assert.equal(cached.cached, true)
    assert.equal(cached.lock_result, 'already_completed')
    assert.equal(cached.final_state_fingerprint, firstFingerprint)

    const healthy = await resetDemo(db, IDS.demoActor, IDS.operationHealthy)
    assert.equal(healthy.cached, false)
    assert.equal(healthy.initial_state_fingerprint, healthy.final_state_fingerprint)
    assert.equal(healthy.final_state_fingerprint, firstFingerprint)
    assert.equal(await scalar(db, 'select count(*) from public.teams where club_id = $1', [IDS.demoClub]), 3)
    assert.equal(await scalar(db, 'select count(*) from public.team_staff staff join public.teams team on team.id = staff.team_id where team.club_id = $1', [IDS.demoClub]), 3)
    assert.equal(await scalar(db, 'select count(*) from public.match_days where club_id = $1', [IDS.demoClub]), 2)
    assert.equal(await scalar(db, 'select count(*) from public.record_backups'), 1)
  } finally {
    await db.close()
  }
})

test('a controlled restoration failure rolls back the complete business transaction and retry succeeds', async () => {
  const db = await createDatabase()
  try {
    await resetDemo(db, IDS.demoActor, IDS.operationPartial)
    await db.exec(`
      select set_config('app.demo_reset_skip_communication_sync', 'on', false);
      delete from public.team_staff where team_id = '${IDS.demoTeamU12}' and user_id = '${IDS.demoActor}';
      delete from public.polls where id = public.demo_reset_uuid('poll:availability');

      create function public.fail_demo_poll_insert() returns trigger language plpgsql as $$
      begin
        if current_setting('test.demo_reset_fail', true) = 'on' then
          raise exception 'CONTROLLED_DEMO_RESET_FAILURE';
        end if;
        return new;
      end;
      $$;
      create trigger fail_demo_poll_insert before insert on public.polls
      for each row execute function public.fail_demo_poll_insert();
      select set_config('test.demo_reset_fail', 'on', false);
    `)

    const partialFingerprint = await scalar(db, 'select public.demo_reset_state_fingerprint($1, $2)', [IDS.demoClub, IDS.demoActor])
    const backupsBeforeFailure = await scalar(db, 'select count(*) from public.record_backups')

    await assert.rejects(
      resetDemo(db, IDS.demoActor, IDS.operationFailure),
      /CONTROLLED_DEMO_RESET_FAILURE/,
    )

    assert.equal(
      await scalar(db, 'select public.demo_reset_state_fingerprint($1, $2)', [IDS.demoClub, IDS.demoActor]),
      partialFingerprint,
    )
    assert.equal(await scalar(db, 'select count(*) from public.team_staff where team_id = $1 and user_id = $2', [IDS.demoTeamU12, IDS.demoActor]), 0)
    assert.equal(await scalar(db, 'select count(*) from public.demo_reset_operations where operation_id = $1', [IDS.operationFailure]), 0)
    assert.equal(await scalar(db, 'select count(*) from public.record_backups'), backupsBeforeFailure)
    assert.equal(await scalar(db, "select current_setting('app.demo_reset_backup_context_nonce', true)"), '')
    assert.equal(await scalar(db, 'select count(*) from app_private.demo_reset_backup_context'), 0)

    await db.exec(`
      select set_config('test.demo_reset_fail', 'off', false);
      drop trigger fail_demo_poll_insert on public.polls;
      drop function public.fail_demo_poll_insert();
    `)

    const retry = await resetDemo(db, IDS.demoActor, IDS.operationFailure)
    assert.equal(retry.success, true)
    assert.equal(await scalar(db, 'select count(*) from public.team_staff where team_id = $1 and user_id = $2', [IDS.demoTeamU12, IDS.demoActor]), 1)
    assert.equal(await scalar(db, 'select count(*) from public.polls where club_id = $1', [IDS.demoClub]), 2)
    assert.equal(await scalar(db, 'select count(*) from public.record_backups'), backupsBeforeFailure)

    await db.query(`
      update public.form_fields set label = label || ' ordinary'
      where id = public.demo_reset_uuid('form-field:technical')
    `)
    assert.equal(await scalar(db, 'select count(*) from public.record_backups'), backupsBeforeFailure + 1)
  } finally {
    await db.close()
  }
})

test('ordinary insert update and delete operations retain one complete backup per affected table', async () => {
  const db = await createDatabase()
  const ids = {
    actor: '70000000-0000-4000-8000-000000000001',
    staff: '70000000-0000-4000-8000-000000000002',
    staffUpdated: '70000000-0000-4000-8000-000000000003',
    formField: '70000000-0000-4000-8000-000000000004',
    player: '70000000-0000-4000-8000-000000000005',
    session: '70000000-0000-4000-8000-000000000006',
    evaluation: '70000000-0000-4000-8000-000000000007',
    sessionPlayer: '70000000-0000-4000-8000-000000000008',
  }

  try {
    await db.exec(`
      insert into auth.users(id, email) values ('${ids.actor}', 'ordinary@example.test');
      insert into public.users(id, email, club_id, role, role_label, role_rank)
      values ('${ids.actor}', 'ordinary@example.test', '${IDS.realClub}', 'coach', 'Coach', 30);

      insert into public.team_staff(id, team_id, user_id)
      values ('${ids.staff}', '${IDS.realTeam}', '${ids.actor}');
      insert into public.form_fields(
        id, club_id, label, type, options, required, order_index, created_by
      ) values (
        '${ids.formField}', '${IDS.realClub}', 'Ordinary field', 'textarea', '[]', false, 1, '${ids.actor}'
      );
      insert into public.players(
        id, club_id, player_name, section, team_id, team, status, created_by
      ) values (
        '${ids.player}', '${IDS.realClub}', 'Ordinary Player', 'U12', '${IDS.realTeam}', 'Real Team', 'active', '${ids.actor}'
      );
      insert into public.assessment_sessions(
        id, club_id, team_id, team, session_date, title, session_type, status, created_by
      ) values (
        '${ids.session}', '${IDS.realClub}', '${IDS.realTeam}', 'Real Team', current_date,
        'Ordinary session', 'training', 'open', '${ids.actor}'
      );
      insert into public.evaluations(
        id, club_id, player_id, player_name, team, team_id, coach_id, coach,
        date, scores, comments, form_responses, decision, status, section
      ) values (
        '${ids.evaluation}', '${IDS.realClub}', '${ids.player}', 'Ordinary Player', 'Real Team',
        '${IDS.realTeam}', '${ids.actor}', 'Ordinary Coach', current_date::text,
        '{}', '{}', '{}', '', 'draft', 'U12'
      );
      insert into public.assessment_session_players(
        id, session_id, player_id, player_name, section, team, created_by
      ) values (
        '${ids.sessionPlayer}', '${ids.session}', '${ids.player}', 'Ordinary Player', 'U12', 'Real Team', '${ids.actor}'
      );

      update public.team_staff set id = '${ids.staffUpdated}' where id = '${ids.staff}';
      update public.form_fields set label = 'Ordinary field updated' where id = '${ids.formField}';
      update public.players set notes = 'ordinary update' where id = '${ids.player}';
      update public.assessment_sessions set title = 'Ordinary session updated' where id = '${ids.session}';
      update public.evaluations set status = 'completed' where id = '${ids.evaluation}';
      update public.assessment_session_players set notes = 'ordinary update' where id = '${ids.sessionPlayer}';

      delete from public.assessment_session_players where id = '${ids.sessionPlayer}';
      delete from public.evaluations where id = '${ids.evaluation}';
      delete from public.assessment_sessions where id = '${ids.session}';
      delete from public.players where id = '${ids.player}';
      delete from public.form_fields where id = '${ids.formField}';
      delete from public.team_staff where id = '${ids.staffUpdated}';
    `)

    const backups = await db.query(`
      select
        table_name,
        operation,
        count(*)::integer as backup_count,
        bool_and(club_id = $1) as correct_scope,
        bool_and(case when operation = 'INSERT' then old_data is null and new_data is not null else true end) as valid_insert_payload,
        bool_and(case when operation = 'UPDATE' then old_data is not null and new_data is not null else true end) as valid_update_payload,
        bool_and(case when operation = 'DELETE' then old_data is not null and new_data is null else true end) as valid_delete_payload
      from public.record_backups
      where id <> '60000000-0000-4000-8000-000000000001'
      group by table_name, operation
      order by table_name, operation
    `, [IDS.realClub])

    assert.equal(backups.rows.length, 18)
    assert.equal(backups.rows.every((row) => row.backup_count === 1), true)
    assert.equal(backups.rows.every((row) => row.correct_scope), true)
    assert.equal(backups.rows.every((row) => row.valid_insert_payload), true)
    assert.equal(backups.rows.every((row) => row.valid_update_payload), true)
    assert.equal(backups.rows.every((row) => row.valid_delete_payload), true)
    assert.deepEqual(
      [...new Set(backups.rows.map((row) => row.table_name))].sort(),
      ['assessment_session_players', 'assessment_sessions', 'evaluations', 'form_fields', 'players', 'team_staff'],
    )
  } finally {
    await db.close()
  }
})

test('forged browser context and direct service-role implementation calls fail closed', async () => {
  const db = await createDatabase()
  try {
    await resetDemo(db, IDS.demoActor, IDS.operationPartial)
    assert.equal(await scalar(db, 'select count(*) from public.record_backups'), 1)
    assert.equal(await scalar(db, 'select count(*) from app_private.demo_reset_backup_context'), 0)
    const technicalFieldId = await scalar(db, "select public.demo_reset_uuid('form-field:technical')")

    await db.exec('set role authenticated')
    await db.exec(`
      select set_config('app.demo_reset_skip_communication_sync', 'on', false);
      select set_config('app.demo_reset_operation_id', '${IDS.operationHealthy}', false);
      select set_config('app.demo_reset_backup_context_nonce', gen_random_uuid()::text, false);
    `)
    await db.query(`
      update public.form_fields set label = label || ' authenticated' where id = $1
    `, [technicalFieldId])
    await db.exec('reset role')

    assert.equal(await scalar(db, 'select count(*) from public.record_backups'), 2)
    assert.equal(await scalar(db, 'select count(*) from app_private.demo_reset_backup_context'), 0)

    await db.exec('set role service_role')
    await assert.rejects(
      db.query('select public.reset_demo_account_atomic_impl($1, $2)', [IDS.demoActor, IDS.operationHealthy]),
      /permission denied/i,
    )
    await assert.rejects(
      db.query(`
        insert into app_private.demo_reset_backup_context(
          backend_pid, transaction_id, context_nonce, operation_id, actor_id, club_id, demo_scope
        ) values (
          pg_backend_pid(), txid_current(), gen_random_uuid(), $1, $2, $3, 'public-demo-v1'
        )
      `, [IDS.operationHealthy, IDS.demoActor, IDS.demoClub]),
      /permission denied/i,
    )
  } finally {
    await db.exec('reset role')
    await db.close()
  }
})

test('scope drift fails closed before any unrelated membership or team is changed', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`
      insert into public.user_club_memberships(auth_user_id, club_id, email, role, role_label, role_rank)
      values ('${IDS.realActor}', '${IDS.demoClub}', 'real@example.test', 'coach', 'Coach', 30);
    `)
    const before = await scalar(db, `
      select md5(jsonb_build_object(
        'memberships', (select jsonb_agg(row_to_json(membership) order by id) from public.user_club_memberships membership),
        'teams', (select jsonb_agg(row_to_json(team) order by id) from public.teams team)
      )::text)
    `)

    await assert.rejects(
      resetDemo(db, IDS.demoActor, '50000000-0000-4000-8000-000000000004'),
      /DEMO_SCOPE_ISOLATION_DRIFT/,
    )

    const after = await scalar(db, `
      select md5(jsonb_build_object(
        'memberships', (select jsonb_agg(row_to_json(membership) order by id) from public.user_club_memberships membership),
        'teams', (select jsonb_agg(row_to_json(team) order by id) from public.teams team)
      )::text)
    `)
    assert.equal(after, before)
  } finally {
    await db.close()
  }
})

test('database execution and audit visibility are denied to browser roles and allowed only to service role', async () => {
  const db = await createDatabase()
  try {
    const privileges = await db.query(`
      select
        has_function_privilege('anon', 'public.reset_demo_account_atomic(uuid,uuid)', 'execute') as anon_execute,
        has_function_privilege('authenticated', 'public.reset_demo_account_atomic(uuid,uuid)', 'execute') as authenticated_execute,
        has_function_privilege('service_role', 'public.reset_demo_account_atomic(uuid,uuid)', 'execute') as service_execute,
        has_function_privilege('service_role', 'public.reset_demo_account_atomic_impl(uuid,uuid)', 'execute') as service_impl_execute,
        has_table_privilege('anon', 'public.demo_reset_operations', 'select') as anon_audit_select,
        has_table_privilege('authenticated', 'public.demo_reset_operations', 'select') as authenticated_audit_select,
        has_table_privilege('service_role', 'public.demo_reset_operations', 'select') as service_audit_select,
        has_schema_privilege('authenticated', 'app_private', 'usage') as authenticated_context_usage,
        has_schema_privilege('service_role', 'app_private', 'usage') as service_context_usage
    `)
    assert.deepEqual(privileges.rows[0], {
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
      service_impl_execute: false,
      anon_audit_select: false,
      authenticated_audit_select: false,
      service_audit_select: true,
      authenticated_context_usage: false,
      service_context_usage: false,
    })

    await db.exec('set role authenticated')
    await assert.rejects(
      db.query('select public.reset_demo_account_atomic($1, gen_random_uuid())', [IDS.demoActor]),
      /permission denied/i,
    )
    await db.exec('reset role')

    await db.exec('set role service_role')
    const serviceResult = await scalar(db, 'select public.reset_demo_account_atomic($1, gen_random_uuid())', [IDS.demoActor])
    assert.equal(serviceResult.success, true)
  } finally {
    await db.exec('reset role')
    await db.close()
  }
})
