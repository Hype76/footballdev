import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260825145000_motm_vote_result_delivery_101.sql',
  import.meta.url,
)

const ids = {
  club: '10000000-0000-4000-8000-000000000101',
  team: '20000000-0000-4000-8000-000000000101',
  match: '30000000-0000-4000-8000-000000000101',
  player: '40000000-0000-4000-8000-000000000101',
}

const schemaSql = `
create role anon;
create role authenticated;
create role service_role;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  team_id uuid,
  title text not null,
  description text,
  audience text,
  poll_type text,
  options jsonb not null default '[]'::jsonb,
  status text,
  closes_at timestamptz,
  allow_multiple boolean,
  max_choices integer,
  allow_own_child_votes boolean,
  allow_vote_changes boolean,
  hide_votes boolean,
  allow_comments boolean,
  notify_results_on_close boolean not null default false,
  created_by uuid,
  created_by_name text,
  updated_at timestamptz not null default now()
);

create table public.match_days (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  status text not null,
  enable_motm_poll boolean not null default true,
  motm_poll_id uuid,
  motm_poll_expiry_hours integer not null default 2,
  opponent text,
  created_by uuid,
  created_by_name text,
  updated_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  player_name text not null,
  shirt_number text,
  section text not null default 'Squad',
  status text not null default 'active',
  archived_at timestamptz
);

create table public.match_day_player_squad_decisions (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null,
  club_id uuid not null,
  team_id uuid not null,
  player_id uuid not null,
  status text not null
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb
);
`

test('fixture result setting is copied to the generated Player of the Match poll', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.exec(migration)
    await db.exec(migration)

    await db.query(
      `insert into public.match_days(
         id, club_id, team_id, status, opponent, motm_notify_results_on_close
       ) values ($1, $2, $3, 'full_time', 'FP TEST Opponent', true)`,
      [ids.match, ids.club, ids.team],
    )
    await db.query(
      `insert into public.players(id, club_id, team_id, player_name, shirt_number)
       values ($1, $2, $3, 'FP TEST Player', '10')`,
      [ids.player, ids.club, ids.team],
    )
    await db.query(
      `insert into public.match_day_player_squad_decisions(
         match_day_id, club_id, team_id, player_id, status
       ) values ($1, $2, $3, $4, 'selected')`,
      [ids.match, ids.club, ids.team, ids.player],
    )

    const created = await db.query(
      'select public.create_match_day_motm_poll($1) as poll_id',
      [ids.match],
    )
    const poll = await db.query(
      `select notify_results_on_close
       from public.polls
       where id = $1`,
      [created.rows[0].poll_id],
    )
    const audit = await db.query(
      `select metadata ->> 'notifyResultsOnClose' as notify_results
       from public.audit_logs
       where action = 'match_day_poll_created'`,
    )

    assert.equal(poll.rows[0].notify_results_on_close, true)
    assert.equal(audit.rows[0].notify_results, 'true')
  } finally {
    await db.close()
  }
})
