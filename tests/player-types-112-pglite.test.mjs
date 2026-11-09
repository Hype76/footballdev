import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20261109155100_player_participation_and_chat_communities.sql', import.meta.url)
const clubId = '10000000-0000-4000-8000-000000000001'
const teamId = '20000000-0000-4000-8000-000000000001'

test('player type migration seeds defaults, accepts custom types and protects assigned types', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      set check_function_bodies = off;
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema private;
      create schema app_private;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid', true), '')::uuid
      $$;
      create function public.current_user_club_id() returns uuid language sql stable security definer as $$
        select club_id from public.users where id = auth.uid()
      $$;
      create table public.clubs (id uuid primary key);
      create table public.users (id uuid primary key, club_id uuid, role text, status text);
      grant select on public.users to authenticated;
      create table public.teams (id uuid primary key, club_id uuid, name text);
      create table public.players (
        id uuid primary key, club_id uuid not null, team_id uuid, section text not null,
        status text default 'active', archived_at timestamptz,
        constraint players_section_check check (section in ('Trial', 'Squad'))
      );
      create table public.evaluations (
        id uuid primary key, section text not null,
        constraint evaluations_section_check check (section in ('Trial', 'Squad'))
      );
      create table public.assessment_session_players (session_id uuid, player_id uuid);
      create table public.match_day_player_squad_decisions (
        match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text
      );
      create table public.match_days (id uuid primary key, club_id uuid, team_id uuid, fixture_type text);
      create table public.assessment_sessions (id uuid primary key, club_id uuid, team_id uuid, session_type text);
      create table public.calendar_events (id uuid primary key, club_id uuid, team_id uuid, event_type text);
      create table public.parent_player_links (
        id uuid primary key, club_id uuid, team_id uuid, player_id uuid,
        auth_user_id uuid, status text
      );
      create table public.parent_chat_rooms (
        id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid,
        player_id uuid, match_day_id uuid, room_type text, title text, status text,
        updated_at timestamptz default now(), created_at timestamptz default now(),
        constraint parent_chat_rooms_type_check check (room_type in ('parent_staff', 'team', 'match_squad')),
        constraint parent_chat_rooms_scope_check check (
          (room_type = 'parent_staff' and player_id is not null and match_day_id is null)
          or (room_type = 'team' and player_id is null and match_day_id is null)
          or (room_type = 'match_squad' and player_id is null and match_day_id is not null)
        )
      );
      create function public.accept_parent_player_link(invite_token_value uuid)
      returns uuid language plpgsql as $body$
      begin
        -- lower(btrim(coalesce(player.section, ''))) in ('trial', 'squad')
        raise exception 'active Trial or Squad player';
      end;
      $body$;
      create function public.apply_event_player_changes(
        source_type_value text, event_id_value uuid,
        selected_player_ids_value uuid[] default '{}'::uuid[],
        communication_mode_value text default 'none', request_token_value uuid default null,
        confirm_selected_removals_value boolean default false,
        confirm_resend_all_value boolean default false
      ) returns jsonb language sql as $$ select '{}'::jsonb $$;
      create function public.preview_event_player_changes(text, uuid, uuid[])
      returns jsonb language sql as $$ select '{"addedPlayerIds":[]}'::jsonb $$;
      create function public.can_use_plan_feature(uuid, text)
      returns boolean language sql as $$ select true $$;
      create function public.create_match_day_motm_poll(target_match_day_id uuid)
      returns uuid language plpgsql as $body$
      declare match_row public.match_days%rowtype;
      begin
        perform 1 from public.players player where player.archived_at is null
          and player.section = 'Squad';
        return null;
      end;
      $body$;
      create function public.get_end_season_stats(uuid)
      returns boolean language sql as $$
        select exists(select 1 from public.players player
          where (player.section='Squad' or (player.section='Trial' and public.can_use_plan_feature(player.club_id,'trialPlayers'))))
      $$;
      create function app_private.end_season_stats_range(uuid, date, date)
      returns boolean language sql as $$
        select exists(select 1 from public.players player
          where (player.section='Squad' or (player.section='Trial' and public.can_use_plan_feature(player.club_id,'trialPlayers'))))
      $$;
      insert into public.clubs values ('${clubId}');
      insert into public.teams values ('${teamId}', '${clubId}', 'U17');
    `)
    await db.exec(await readFile(migrationUrl, 'utf8'))

    const defaults = await db.query('select name, can_training, can_friendly, can_cup, can_league, chat_group from public.club_player_types order by name')
    assert.deepEqual(defaults.rows, [
      { name: 'Match-only', can_training: false, can_friendly: true, can_cup: true, can_league: true, chat_group: 'match' },
      { name: 'Squad', can_training: true, can_friendly: true, can_cup: true, can_league: true, chat_group: 'team' },
      { name: 'Training-only', can_training: true, can_friendly: true, can_cup: false, can_league: false, chat_group: 'training' },
      { name: 'Trial', can_training: true, can_friendly: true, can_cup: true, can_league: true, chat_group: 'team' },
    ])
    await db.query('insert into public.club_player_types (club_id, name, can_training, can_friendly, chat_group) values ($1, $2, true, true, $3)', [clubId, 'Development', 'training'])
    await db.query('insert into public.players (id, club_id, team_id, section) values ($1, $2, $3, $4)', [
      '30000000-0000-4000-8000-000000000001', clubId, teamId, 'Development',
    ])
    const seasonScope = await db.query('select public.get_end_season_stats($1) as included, app_private.end_season_stats_range($1, current_date, current_date) as ranged', [teamId])
    assert.deepEqual(seasonScope.rows[0], { included: true, ranged: true })
    await assert.rejects(
      db.query('delete from public.club_player_types where club_id = $1 and name = $2', [clubId, 'Development']),
      /foreign key|violates/i,
    )
    await assert.rejects(
      db.query('update public.club_player_types set can_training = false where club_id = $1 and name = $2', [clubId, 'Trial']),
      /Default player types cannot be changed/,
    )

    const trainingPlayer = '30000000-0000-4000-8000-000000000002'
    const matchPlayer = '30000000-0000-4000-8000-000000000003'
    const fixture = '40000000-0000-4000-8000-000000000001'
    const session = '50000000-0000-4000-8000-000000000001'
    await db.query('insert into public.players (id, club_id, team_id, section) values ($1, $2, $3, $4), ($5, $2, $3, $6)', [
      trainingPlayer, clubId, teamId, 'Training-only', matchPlayer, 'Match-only',
    ])
    await db.query('insert into public.match_days values ($1, $2, $3, $4)', [fixture, clubId, teamId, 'league'])
    await db.query('insert into public.assessment_sessions values ($1, $2, $3, $4)', [session, clubId, teamId, 'training'])
    const allowed = await db.query('select private.player_type_allows_event($1, $2, $3) as allowed', [matchPlayer, 'match-day', fixture])
    assert.equal(allowed.rows[0].allowed, true)
    const denied = await db.query('select private.player_type_allows_event($1, $2, $3) as allowed', [trainingPlayer, 'match-day', fixture])
    assert.equal(denied.rows[0].allowed, false)
    await assert.rejects(
      db.query('insert into public.match_day_player_squad_decisions (match_day_id, player_id, status) values ($1, $2, $3)', [fixture, trainingPlayer, 'selected']),
      /not eligible for the fixture/,
    )
    await db.query('insert into public.match_day_player_squad_decisions (match_day_id, player_id, status) values ($1, $2, $3)', [fixture, matchPlayer, 'selected'])
    await assert.rejects(
      db.query('insert into public.assessment_session_players values ($1, $2)', [session, matchPlayer]),
      /not eligible for the session/,
    )
    await db.query('insert into public.assessment_session_players values ($1, $2)', [session, trainingPlayer])

    const adminId = '60000000-0000-4000-8000-000000000011'
    const coachId = '60000000-0000-4000-8000-000000000012'
    await db.query('insert into public.users values ($1, $3, $4, $5), ($2, $3, $6, $5)', [
      adminId, coachId, clubId, 'admin', 'active', 'coach',
    ])
    await db.query("select set_config('test.uid', $1, false)", [coachId])
    await db.exec('set role authenticated')
    const coachTypes = await db.query('select name from public.club_player_types where club_id = $1', [clubId])
    assert.equal(coachTypes.rows.length, 5)
    await assert.rejects(
      db.query('insert into public.club_player_types (club_id, name) values ($1, $2)', [clubId, 'Coach type']),
      /row-level security|permission denied/i,
    )
    await db.exec('reset role')
    await db.query("select set_config('test.uid', $1, false)", [adminId])
    await db.exec('set role authenticated')
    await db.query('insert into public.club_player_types (club_id, name, can_training) values ($1, $2, true)', [clubId, 'Admin type'])
    await db.exec('reset role')

    const trainingParent = '60000000-0000-4000-8000-000000000001'
    const matchParent = '60000000-0000-4000-8000-000000000002'
    const trainingRoom = '70000000-0000-4000-8000-000000000001'
    const matchRoom = '70000000-0000-4000-8000-000000000002'
    const teamRoom = '70000000-0000-4000-8000-000000000003'
    await db.query('insert into public.parent_player_links values ($1, $2, $3, $4, $5, $6), ($7, $2, $3, $8, $9, $6)', [
      '80000000-0000-4000-8000-000000000001', clubId, teamId, trainingPlayer, trainingParent, 'active',
      '80000000-0000-4000-8000-000000000002', matchPlayer, matchParent,
    ])
    await db.query('insert into public.parent_chat_rooms (id, club_id, team_id, room_type, title, status) values ($1, $4, $5, $6, $7, $8), ($2, $4, $5, $9, $10, $8), ($3, $4, $5, $11, $12, $8)', [
      trainingRoom, matchRoom, teamRoom, clubId, teamId,
      'team_training', 'Training', 'active', 'team_match', 'Match', 'team', 'Team',
    ])
    for (const [parent, expected] of [[trainingParent, [true, false, false]], [matchParent, [false, true, false]]]) {
      const access = await db.query('select public.parent_chat_parent_can_access_room($1, $2) as training, public.parent_chat_parent_can_access_room($3, $2) as match, public.parent_chat_parent_can_access_room($4, $2) as team', [
        trainingRoom, parent, matchRoom, teamRoom,
      ])
      assert.deepEqual(Object.values(access.rows[0]), expected)
    }
  } finally {
    await db.close()
  }
})
