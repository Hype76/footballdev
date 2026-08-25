import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260825160000_poll_expiry_dd_hh_mm_102.sql',
  import.meta.url,
)

const ids = {
  club: '10000000-0000-4000-8000-000000000102',
  team: '20000000-0000-4000-8000-000000000102',
  match: '30000000-0000-4000-8000-000000000102',
  player: '40000000-0000-4000-8000-000000000102',
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
  created_by_name text
);

create table public.match_days (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  status text not null,
  enable_motm_poll boolean not null default true,
  motm_poll_id uuid,
  motm_poll_expiry_hours integer not null default 2,
  motm_notify_results_on_close boolean not null default false,
  opponent text,
  created_by uuid,
  created_by_name text,
  updated_at timestamptz not null default now(),
  constraint match_days_motm_poll_expiry_hours_check
    check (motm_poll_expiry_hours between 1 and 720)
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

test('DD:HH:MM expiry migration compiles and preserves minute precision', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.exec(migration)
    await db.exec(migration)

    const column = await db.query(`
      select data_type, numeric_scale
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'match_days'
        and column_name = 'motm_poll_expiry_hours'
    `)
    assert.equal(column.rows[0].data_type, 'numeric')
    assert.equal(column.rows[0].numeric_scale, 4)

    await db.query(
      `insert into public.match_days(
         id, club_id, team_id, status, opponent, motm_poll_expiry_hours,
         motm_notify_results_on_close
       ) values ($1, $2, $3, 'full_time', 'FP TEST Opponent', 0.5, true)`,
      [ids.match, ids.club, ids.team],
    )
    await assert.rejects(
      db.query(
        `insert into public.match_days(id, club_id, team_id, status, motm_poll_expiry_hours)
         values (gen_random_uuid(), $1, $2, 'scheduled', 0)`,
        [ids.club, ids.team],
      ),
      /match_days_motm_poll_expiry_hours_check/,
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
    const proof = await db.query(
      `select
         extract(epoch from (poll.closes_at - timezone('utc', now()))) as seconds_remaining,
         audit.metadata ->> 'expiryMinutes' as expiry_minutes
       from public.polls poll
       join public.audit_logs audit
         on audit.entity_id = poll.id
        and audit.action = 'match_day_poll_created'
       where poll.id = $1`,
      [created.rows[0].poll_id],
    )

    const secondsRemaining = Number(proof.rows[0].seconds_remaining)
    assert.ok(secondsRemaining > 1790 && secondsRemaining <= 1800)
    assert.equal(proof.rows[0].expiry_minutes, '30')
  } finally {
    await db.close()
  }
})
