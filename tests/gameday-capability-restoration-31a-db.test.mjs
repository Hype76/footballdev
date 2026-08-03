import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260803172717_fp_v1_gameday_capability_restoration_31a.sql',
  import.meta.url,
)

const ids = {
  club: '10000000-0000-4000-8000-000000000031',
  team: '20000000-0000-4000-8000-000000000031',
  staff: '30000000-0000-4000-8000-000000000031',
  denied: '30000000-0000-4000-8000-000000000032',
  playerOne: '40000000-0000-4000-8000-000000000031',
  playerTwo: '40000000-0000-4000-8000-000000000032',
  playerUnselected: '40000000-0000-4000-8000-000000000033',
  match: '60000000-0000-4000-8000-000000000031',
  yellowRequest: '70000000-0000-4000-8000-000000000031',
  redRequest: '70000000-0000-4000-8000-000000000032',
  substitutionRequest: '70000000-0000-4000-8000-000000000033',
  opponentRequest: '70000000-0000-4000-8000-000000000034',
}

const schemaSql = `
create role anon;
create role authenticated;
create role service_role;

create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.users (
  id uuid primary key,
  name text,
  email text,
  role text not null,
  status text not null default 'active'
);

create table public.match_days (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid not null,
  status text not null default 'scheduled',
  timer_status text not null default 'not_started',
  current_match_phase text not null default 'pre_match',
  home_score integer not null default 0,
  away_score integer not null default 0,
  concluded_at timestamptz,
  deleted_at timestamptz
);

create table public.players (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid not null,
  section text not null default 'Squad',
  status text not null default 'active',
  player_name text not null,
  shirt_number text
);

create table public.match_day_player_squad_decisions (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null,
  club_id uuid not null,
  team_id uuid not null,
  player_id uuid not null,
  status text not null,
  unique (match_day_id, player_id)
);

create table public.match_day_events (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null,
  club_id uuid not null,
  team_id uuid not null,
  event_type text not null,
  team_side text not null,
  minute integer,
  scorer_name text not null default '',
  scorer_initials text not null default '',
  scorer_shirt_number text not null default '',
  assist_name text not null default '',
  assist_initials text not null default '',
  assist_shirt_number text not null default '',
  home_score integer not null default 0,
  away_score integer not null default 0,
  notes text not null default '',
  created_by uuid,
  created_by_name text,
  match_phase text not null default 'pre_match',
  phase_order integer not null default 0,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (match_day_id, request_id)
);

create table public.match_day_event_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  team_id uuid not null,
  match_day_id uuid not null,
  actor_user_id uuid,
  actor_display_name text,
  actor_role text,
  event_type text,
  event_label text,
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create function public.can_manage_match_day(target_team_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users actor
    where actor.id = auth.uid()
      and actor.status = 'active'
      and actor.role = 'coach'
      and target_team_id is not null
  );
$$;

create function public.get_initials_from_full_name(value text)
returns text
language sql
immutable
as $$
  select upper(left(trim(coalesce(value, '')), 1));
$$;

create function public.match_day_phase_order(value text)
returns integer
language sql
immutable
as $$
  select case value when 'first_half' then 10 when 'second_half' then 30 else 0 end;
$$;
`

async function setActor(db, actorId) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actorId])
}

test('31A migration applies transactionally and enforces participant, authority, idempotency, and audit contracts', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()

  try {
    await db.exec(schemaSql)

    await db.exec('begin')
    await db.exec(migration)
    let installed = await db.query(
      "select to_regprocedure('public.record_match_day_staff_event_v2(uuid,text,text,integer,text,text,text,text,text,uuid)') is not null as present",
    )
    assert.equal(installed.rows[0].present, true)
    await db.exec('rollback')
    installed = await db.query(
      "select to_regprocedure('public.record_match_day_staff_event_v2(uuid,text,text,integer,text,text,text,text,text,uuid)') is not null as present",
    )
    assert.equal(installed.rows[0].present, false)
    await db.exec(migration)
    await db.exec(migration)

    await db.query(
      `insert into public.users(id, name, email, role) values
        ($1, 'FP TEST Coach', 'coach@example.test', 'coach'),
        ($2, 'FP TEST Viewer', 'viewer@example.test', 'viewer')`,
      [ids.staff, ids.denied],
    )
    await db.query(
      `insert into public.match_days(
        id, club_id, team_id, status, timer_status, current_match_phase
      ) values ($1, $2, $3, 'live', 'running', 'first_half')`,
      [ids.match, ids.club, ids.team],
    )
    await db.query(
      `insert into public.players(id, club_id, team_id, player_name, shirt_number) values
        ($1, $4, $5, 'FP TEST One', '7'),
        ($2, $4, $5, 'FP TEST Two', '8'),
        ($3, $4, $5, 'FP TEST Unselected', '9')`,
      [ids.playerOne, ids.playerTwo, ids.playerUnselected, ids.club, ids.team],
    )
    await db.query(
      `insert into public.match_day_player_squad_decisions(
        match_day_id, club_id, team_id, player_id, status
      ) values
        ($1, $2, $3, $4, 'selected'),
        ($1, $2, $3, $5, 'selected'),
        ($1, $2, $3, $6, 'available')`,
      [ids.match, ids.club, ids.team, ids.playerOne, ids.playerTwo, ids.playerUnselected],
    )

    await setActor(db, ids.denied)
    await assert.rejects(
      db.query(
        "select public.record_match_day_staff_event_v2($1, 'yellow_card', 'club', 12, 'FP TEST One', '7', '', '', '', $2)",
        [ids.match, ids.yellowRequest],
      ),
      /You cannot add events for this match/,
    )

    await setActor(db, ids.staff)
    const firstYellow = await db.query(
      "select public.record_match_day_staff_event_v2($1, 'yellow_card', 'club', 12, 'FP TEST One', '7', '', '', '', $2) as result",
      [ids.match, ids.yellowRequest],
    )
    const replayYellow = await db.query(
      "select public.record_match_day_staff_event_v2($1, 'yellow_card', 'club', 12, 'FP TEST One', '7', '', '', '', $2) as result",
      [ids.match, ids.yellowRequest],
    )
    assert.equal(firstYellow.rows[0].result.id, replayYellow.rows[0].result.id)

    await assert.rejects(
      db.query(
        "select public.record_match_day_staff_event_v2($1, 'red_card', 'club', 14, 'FP TEST Unselected', '9', '', '', '', $2)",
        [ids.match, ids.redRequest],
      ),
      /Choose one selected Match squad Player from this fixture Team/,
    )
    await assert.rejects(
      db.query(
        "select public.record_match_day_staff_event_v2($1, 'substitution', 'club', 20, 'FP TEST One', '7', 'FP TEST One', '7', '', $2)",
        [ids.match, ids.substitutionRequest],
      ),
      /Choose a different Player On/,
    )

    const substitution = await db.query(
      "select public.record_match_day_staff_event_v2($1, 'substitution', 'club', 20, 'FP TEST One', '7', 'FP TEST Two', '8', '', $2) as result",
      [ids.match, ids.substitutionRequest],
    )
    assert.equal(substitution.rows[0].result.scorer_name, 'FP TEST One')
    assert.equal(substitution.rows[0].result.assist_name, 'FP TEST Two')

    const opponentCard = await db.query(
      "select public.record_match_day_staff_event_v2($1, 'red_card', 'opponent', 24, '', '', '', '', '', $2) as result",
      [ids.match, ids.opponentRequest],
    )
    assert.equal(opponentCard.rows[0].result.team_side, 'opponent')

    const evidence = await db.query(
      `select
        (select count(*)::integer from public.match_day_events where match_day_id = $1) as event_count,
        (select count(*)::integer from public.match_day_event_log where match_day_id = $1) as audit_count,
        (select new_value ->> 'playerId' from public.match_day_event_log where metadata ->> 'requestId' = $2) as player_id,
        (select metadata ->> 'capabilityRelease' from public.match_day_event_log where metadata ->> 'requestId' = $2) as release_key`,
      [ids.match, ids.yellowRequest],
    )
    assert.deepEqual(evidence.rows[0], {
      event_count: 3,
      audit_count: 3,
      player_id: ids.playerOne,
      release_key: 'FP-V1-GAMEDAY-CAPABILITY-RESTORATION-31A',
    })

    await db.query("update public.match_days set status = 'full_time', timer_status = 'full_time' where id = $1", [ids.match])
    await assert.rejects(
      db.query(
        "select public.record_match_day_staff_event_v2($1, 'water_break', 'club', 30, '', '', '', '', '', $2)",
        [ids.match, ids.redRequest],
      ),
      /Start or resume the match before recording an event/,
    )
  } finally {
    await db.close()
  }
})
