import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260829160252_parent_carpool_and_active_team_selection_124.sql', import.meta.url)

test('carpool and active-team selection migration compiles without changing table data', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

      create table public.users (
        id uuid primary key, club_id uuid, role text, role_rank integer, status text,
        display_name text, name text, email text, role_label text
      );
      create table public.match_days (
        id uuid primary key, club_id uuid, team_id uuid, status text,
        previous_hidden_at timestamptz, deleted_at timestamptz, concluded_at timestamptz
      );
      create table public.players (
        id uuid primary key, club_id uuid, team_id uuid, status text, section text
      );
      create table public.match_day_player_squad_decisions (
        id uuid primary key default gen_random_uuid(), match_day_id uuid, club_id uuid, team_id uuid,
        player_id uuid, status text, decided_by uuid, decided_by_name text, decided_at timestamptz,
        created_at timestamptz default now(), updated_at timestamptz default now(),
        constraint match_day_player_squad_decisions_match_player_key unique (match_day_id, player_id)
      );
      create table public.match_day_event_log (
        club_id uuid, team_id uuid, match_day_id uuid, player_id uuid, actor_user_id uuid,
        actor_display_name text, actor_role text, event_type text, event_label text,
        previous_value jsonb, new_value jsonb, metadata jsonb
      );
      create table public.parent_player_links (
        id uuid primary key, auth_user_id uuid, status text, club_id uuid, team_id uuid,
        player_id uuid, email text
      );
      create table public.match_day_availability_requests (
        id uuid primary key, match_day_id uuid, club_id uuid, team_id uuid, player_id uuid,
        parent_link_id uuid, recipient_email text, status text, token_hash text, expires_at timestamptz,
        transport_needs_lift boolean, transport_can_offer_lift boolean, transport_seats_offered integer,
        transport_responded_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
      );
      create function public.can_manage_match_day(uuid) returns boolean language sql stable as $$ select true $$;
      create function public.submit_match_day_availability_response(
        text, text, text default null, text default null, text default null,
        boolean default null, boolean default null, integer default null
      ) returns table (
        request_id uuid, player_name text, response_status text, responded_at timestamptz,
        volunteer_scorer_response text, volunteer_linesman_response text, volunteer_referee_response text,
        volunteer_responded_at timestamptz, transport_needs_lift boolean,
        transport_can_offer_lift boolean, transport_seats_offered integer,
        transport_responded_at timestamptz
      ) language sql as $$
        select null::uuid, null::text, null::text, null::timestamptz,
          null::text, null::text, null::text, null::timestamptz,
          false, false, 0, null::timestamptz
      $$;
    `)
    const migration = await readFile(migrationUrl, 'utf8')
    await db.exec(migration)
    const result = await db.query(`
      select
        to_regprocedure('public.set_match_day_player_squad_decision(uuid,uuid,text)') is not null as squad,
        to_regprocedure('public.get_parent_portal_match_transport_states(uuid)') is not null as transport_read,
        to_regprocedure('public.set_parent_portal_match_transport(uuid,uuid,text,integer)') is not null as transport_write,
        (select count(*)::integer from public.players) as player_count,
        (select count(*)::integer from public.match_day_availability_requests) as request_count
    `)
    assert.deepEqual(result.rows[0], {
      player_count: 0,
      request_count: 0,
      squad: true,
      transport_read: true,
      transport_write: true,
    })
  } finally {
    await db.close()
  }
})
