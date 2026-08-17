import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260817162951_match_day_motm_selected_squad_only.sql',
  import.meta.url,
)

const ids = {
  club: '10000000-0000-4000-8000-000000000065',
  team: '20000000-0000-4000-8000-000000000065',
  match: '30000000-0000-4000-8000-000000000065',
  selectedOne: '40000000-0000-4000-8000-000000000065',
  selectedTwo: '40000000-0000-4000-8000-000000000066',
  unselected: '40000000-0000-4000-8000-000000000067',
  trial: '40000000-0000-4000-8000-000000000068',
  legacyMatch: '30000000-0000-4000-8000-000000000066',
  legacyPoll: '50000000-0000-4000-8000-000000000065',
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
  created_by uuid,
  created_by_name text,
  updated_at timestamptz not null default now()
);

create table public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null,
  option_id text not null
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

test('Player of the Match poll contains only selected active squad Players', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.exec(migration)
    await db.exec(migration)

    await db.query(
      `insert into public.match_days(id, club_id, team_id, status, opponent)
       values ($1, $2, $3, 'full_time', 'FP TEST Opponent')`,
      [ids.match, ids.club, ids.team],
    )
    await db.query(
      `insert into public.players(id, club_id, team_id, player_name, shirt_number, section) values
       ($1, $5, $6, 'Selected One', '7', 'Squad'),
       ($2, $5, $6, 'Selected Two', '8', 'Squad'),
       ($3, $5, $6, 'Not Selected', '9', 'Squad'),
       ($4, $5, $6, 'Trial Player', '10', 'Trial')`,
      [ids.selectedOne, ids.selectedTwo, ids.unselected, ids.trial, ids.club, ids.team],
    )
    await db.query(
      `insert into public.match_day_player_squad_decisions(match_day_id, club_id, team_id, player_id, status) values
       ($1, $2, $3, $4, 'selected'),
       ($1, $2, $3, $5, 'selected'),
       ($1, $2, $3, $6, 'available'),
       ($1, $2, $3, $7, 'selected')`,
      [ids.match, ids.club, ids.team, ids.selectedOne, ids.selectedTwo, ids.unselected, ids.trial],
    )

    const created = await db.query(
      'select public.create_match_day_motm_poll($1) as poll_id',
      [ids.match],
    )
    assert.ok(created.rows[0].poll_id)

    const result = await db.query(
      `select option ->> 'label' as label
       from public.polls poll,
       lateral jsonb_array_elements(poll.options) option
       where poll.id = $1
       order by label`,
      [created.rows[0].poll_id],
    )
    assert.deepEqual(result.rows.map((row) => row.label), ['Selected One #7', 'Selected Two #8'])

    const replay = await db.query(
      'select public.create_match_day_motm_poll($1) as poll_id',
      [ids.match],
    )
    assert.equal(replay.rows[0].poll_id, created.rows[0].poll_id)
  } finally {
    await db.close()
  }
})

test('existing open Player of the Match polls preserve votes while removing stale options', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.query(
      `insert into public.players(id, club_id, team_id, player_name, shirt_number, section) values
       ($1, $4, $5, 'Selected One', '7', 'Squad'),
       ($2, $4, $5, 'Not Selected', '9', 'Squad'),
       ($3, $4, $5, 'FP TEST RELEASE', '99', 'Squad')`,
      [ids.selectedOne, ids.unselected, ids.trial, ids.club, ids.team],
    )
    await db.query(
      `insert into public.match_days(id, club_id, team_id, status, opponent, motm_poll_id)
       values ($1, $2, $3, 'full_time', 'Legacy Opponent', $4)`,
      [ids.legacyMatch, ids.club, ids.team, ids.legacyPoll],
    )
    await db.query(
      `insert into public.match_day_player_squad_decisions(match_day_id, club_id, team_id, player_id, status)
       values ($1, $2, $3, $4, 'selected')`,
      [ids.legacyMatch, ids.club, ids.team, ids.selectedOne],
    )
    await db.query(
      `insert into public.polls(id, club_id, team_id, title, poll_type, options, status)
       values ($1, $2, $3, 'Player of the Match', 'awards', $4::jsonb, 'open')`,
      [
        ids.legacyPoll,
        ids.club,
        ids.team,
        JSON.stringify([
          { id: ids.selectedOne, playerId: ids.selectedOne, label: 'Selected One #7' },
          { id: ids.unselected, playerId: ids.unselected, label: 'Not Selected #9' },
          { id: ids.trial, playerId: ids.trial, label: 'FP TEST RELEASE #99' },
        ]),
      ],
    )
    await db.query(
      'insert into public.poll_votes(poll_id, option_id) values ($1, $2)',
      [ids.legacyPoll, ids.unselected],
    )

    await db.exec(migration)
    await db.exec(migration)

    const result = await db.query(
      `select option ->> 'label' as label
       from public.polls poll,
       lateral jsonb_array_elements(poll.options) option
       where poll.id = $1
       order by label`,
      [ids.legacyPoll],
    )
    assert.deepEqual(result.rows.map((row) => row.label), ['Not Selected #9', 'Selected One #7'])
  } finally {
    await db.close()
  }
})
