import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = new URL(
  "../supabase/migrations/20260722084618_fp_v1_gameday_prematch_parity_harden_03.sql",
  import.meta.url,
);

const IDS = {
  clubA: "10000000-0000-4000-8000-000000000001",
  clubB: "10000000-0000-4000-8000-000000000002",
  teamA: "20000000-0000-4000-8000-000000000001",
  teamB: "20000000-0000-4000-8000-000000000002",
  scorerA: "30000000-0000-4000-8000-000000000001",
  scorerB: "30000000-0000-4000-8000-000000000002",
  ordinaryParent: "30000000-0000-4000-8000-000000000003",
  staff: "30000000-0000-4000-8000-000000000004",
  pendingParent: "30000000-0000-4000-8000-000000000005",
  rejectedParent: "30000000-0000-4000-8000-000000000006",
  linesmanParent: "30000000-0000-4000-8000-000000000007",
  refereeParent: "30000000-0000-4000-8000-000000000008",
  playerA: "40000000-0000-4000-8000-000000000001",
  playerB: "40000000-0000-4000-8000-000000000002",
  ordinaryPlayer: "40000000-0000-4000-8000-000000000003",
  linkA: "50000000-0000-4000-8000-000000000001",
  linkB: "50000000-0000-4000-8000-000000000002",
  ordinaryLink: "50000000-0000-4000-8000-000000000003",
  matchA: "60000000-0000-4000-8000-000000000001",
  matchSameTeam: "60000000-0000-4000-8000-000000000002",
  matchOtherClub: "60000000-0000-4000-8000-000000000003",
  matchStaff: "60000000-0000-4000-8000-000000000004",
};

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

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'sub', current_setting('request.jwt.claim.sub', true),
    'name', current_setting('request.jwt.claim.name', true),
    'email', current_setting('request.jwt.claim.email', true)
  );
$$;

create table public.clubs (id uuid primary key);
create table public.teams (id uuid primary key, club_id uuid not null);
create table public.users (
  id uuid primary key,
  club_id uuid,
  role text not null,
  status text not null default 'active'
);
create table public.players (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid not null,
  status text not null default 'active'
);
create table public.parent_player_links (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid not null,
  player_id uuid not null,
  auth_user_id uuid,
  email text not null default '',
  status text not null default 'active'
);
create table public.match_days (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  status text not null default 'scheduled',
  home_score integer not null default 0,
  away_score integer not null default 0,
  home_away text not null default 'home',
  phase_started_at timestamptz,
  timer_started_at timestamptz,
  timer_paused_at timestamptz,
  timer_elapsed_seconds integer not null default 0,
  timer_status text not null default 'not_started',
  full_time_resume_status text,
  match_clock_mode text not null default 'fixed',
  match_duration_minutes integer not null default 90,
  concluded_at timestamptz,
  concluded_by uuid,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.match_day_role_assignments (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null,
  club_id uuid not null,
  team_id uuid,
  role text not null,
  parent_link_id uuid not null,
  auth_user_id uuid
);
create table public.match_day_scorer_assignments (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null,
  club_id uuid not null,
  team_id uuid,
  parent_link_id uuid not null,
  auth_user_id uuid
);
create table public.match_day_events (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null,
  club_id uuid not null,
  team_id uuid,
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
  created_by_parent_link_id uuid,
  created_by_name text,
  event_status text not null default 'active',
  corrected_at timestamptz,
  corrected_by uuid,
  corrected_by_parent_link_id uuid,
  corrected_by_name text,
  correction_reason text not null default '',
  correction_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.match_day_event_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  team_id uuid,
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

create function public.current_user_has_active_authority()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.users actor
    where actor.id = auth.uid() and actor.status = 'active'
  );
$$;

create function public.current_user_role()
returns text
language sql
stable
as $$
  select actor.role from public.users actor where actor.id = auth.uid();
$$;

create function public.current_user_club_id()
returns uuid
language sql
stable
as $$
  select actor.club_id from public.users actor where actor.id = auth.uid();
$$;

create function public.can_manage_match_day(target_team_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(public.current_user_role() in ('coach', 'manager', 'team_admin', 'super_admin'), false);
$$;

create function public.get_initials_from_full_name(value text)
returns text
language sql
immutable
as $$
  select upper(left(trim(coalesce(value, '')), 1));
$$;

create function public.void_match_day_event(match_day_id_value uuid, event_id_value uuid, reason_code_value text, note_value text)
returns jsonb
language sql
as $$
  select jsonb_build_object('matchDayId', match_day_id_value, 'eventId', event_id_value);
$$;
`;

async function setActor(db, actorId) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    actorId,
  ]);
  await db.query(`select set_config('request.jwt.claim.name', $1, false)`, [
    `Actor ${actorId.slice(-4)}`,
  ]);
  await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [
    `${actorId.slice(-4)}@example.test`,
  ]);
}

async function expectDatabaseError(promise, messagePattern) {
  await assert.rejects(promise, messagePattern);
}

async function seedDatabase(db) {
  await db.query("insert into public.clubs(id) values ($1), ($2)", [
    IDS.clubA,
    IDS.clubB,
  ]);
  await db.query(
    "insert into public.teams(id, club_id) values ($1, $2), ($3, $4)",
    [IDS.teamA, IDS.clubA, IDS.teamB, IDS.clubB],
  );
  await db.query(
    `insert into public.users(id, club_id, role, status) values
      ($1, $2, 'parent_portal', 'active'),
      ($3, $2, 'parent_portal', 'active'),
      ($4, $2, 'parent_portal', 'active'),
      ($5, $2, 'coach', 'active'),
      ($6, $2, 'parent_portal', 'active'),
      ($7, $2, 'parent_portal', 'active'),
      ($8, $2, 'parent_portal', 'active'),
      ($9, $2, 'parent_portal', 'active')`,
    [
      IDS.scorerA,
      IDS.clubA,
      IDS.scorerB,
      IDS.ordinaryParent,
      IDS.staff,
      IDS.pendingParent,
      IDS.rejectedParent,
      IDS.linesmanParent,
      IDS.refereeParent,
    ],
  );
  await db.query(
    `insert into public.players(id, club_id, team_id, status) values
      ($1, $2, $3, 'active'), ($4, $2, $3, 'active'), ($5, $2, $3, 'active')`,
    [IDS.playerA, IDS.clubA, IDS.teamA, IDS.playerB, IDS.ordinaryPlayer],
  );
  await db.query(
    `insert into public.parent_player_links(id, club_id, team_id, player_id, auth_user_id, email, status) values
      ($1, $2, $3, $4, $5, 'a@example.test', 'active'),
      ($6, $2, $3, $7, $8, 'b@example.test', 'active'),
      ($9, $2, $3, $10, $11, 'ordinary@example.test', 'active')`,
    [
      IDS.linkA,
      IDS.clubA,
      IDS.teamA,
      IDS.playerA,
      IDS.scorerA,
      IDS.linkB,
      IDS.playerB,
      IDS.scorerB,
      IDS.ordinaryLink,
      IDS.ordinaryPlayer,
      IDS.ordinaryParent,
    ],
  );
  await db.query(
    `insert into public.match_days(id, club_id, team_id, status, timer_status, timer_elapsed_seconds)
     values
       ($1, $2, $3, 'scheduled', 'not_started', 0),
       ($4, $2, $3, 'scheduled', 'not_started', 0),
       ($5, $6, $7, 'scheduled', 'not_started', 0),
       ($8, $2, $3, 'scheduled', 'not_started', 0)`,
    [
      IDS.matchA,
      IDS.clubA,
      IDS.teamA,
      IDS.matchSameTeam,
      IDS.matchOtherClub,
      IDS.clubB,
      IDS.teamB,
      IDS.matchStaff,
    ],
  );
  await db.query(
    `insert into public.match_day_role_assignments(match_day_id, club_id, team_id, role, parent_link_id, auth_user_id)
     values ($1, $2, $3, 'scorer', $4, $5)`,
    [IDS.matchA, IDS.clubA, IDS.teamA, IDS.linkA, IDS.scorerA],
  );
  await db.query(
    `insert into public.match_day_scorer_assignments(match_day_id, club_id, team_id, parent_link_id, auth_user_id)
     values ($1, $2, $3, $4, $5)`,
    [IDS.matchA, IDS.clubA, IDS.teamA, IDS.linkA, IDS.scorerA],
  );
}

test("disposable database applies, rolls back, reapplies, and enforces parent scorer authority", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const db = new PGlite();

  try {
    await db.exec(schemaSql);
    await seedDatabase(db);

    await db.exec("begin");
    await db.exec(migration);
    const insideTransaction = await db.query(
      `select to_regprocedure('public.apply_match_day_timer_action(uuid,text,uuid,text,text,uuid)') is not null as present`,
    );
    assert.equal(insideTransaction.rows[0].present, true);
    await db.exec("rollback");

    const afterRollback = await db.query(
      `select to_regprocedure('public.apply_match_day_timer_action(uuid,text,uuid,text,text,uuid)') is not null as present`,
    );
    assert.equal(afterRollback.rows[0].present, false);

    await db.exec(migration);
    await setActor(db, IDS.scorerA);

    const authority = await db.query(
      "select public.current_user_is_match_day_scorer($1) as allowed",
      [IDS.matchA],
    );
    assert.equal(authority.rows[0].allowed, true);

    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await expectDatabaseError(
      db.query(
        `select public.update_match_day_score_as_scorer($1, $2, 1, 0, null)`,
        [IDS.linkA, IDS.matchA],
      ),
      /Login is required before updating the match score/,
    );

    for (const deniedActor of [
      IDS.pendingParent,
      IDS.rejectedParent,
      IDS.linesmanParent,
      IDS.refereeParent,
    ]) {
      await setActor(db, deniedActor);
      await expectDatabaseError(
        db.query(
          `select public.update_match_day_score_as_scorer($1, $2, 1, 0, null)`,
          [IDS.ordinaryLink, IDS.matchA],
        ),
        /Only the current selected scorer/,
      );
    }

    await db.query(
      `insert into public.match_day_role_assignments(match_day_id, club_id, team_id, role, parent_link_id, auth_user_id)
       values
         ($1, $2, $3, 'linesman', $4, $5),
         ($1, $2, $3, 'referee', $4, $6)`,
      [
        IDS.matchA,
        IDS.clubA,
        IDS.teamA,
        IDS.ordinaryLink,
        IDS.linesmanParent,
        IDS.refereeParent,
      ],
    );

    for (const deniedActor of [IDS.linesmanParent, IDS.refereeParent]) {
      await setActor(db, deniedActor);
      await expectDatabaseError(
        db.query(
          `select public.update_match_day_score_as_scorer($1, $2, 1, 0, null)`,
          [IDS.ordinaryLink, IDS.matchA],
        ),
        /Only the current selected scorer/,
      );
    }

    await setActor(db, IDS.ordinaryParent);
    await expectDatabaseError(
      db.query(
        `select public.update_match_day_score_as_scorer($1, $2, 1, 0, null)`,
        [IDS.ordinaryLink, IDS.matchA],
      ),
      /Only the current selected scorer/,
    );

    await setActor(db, IDS.scorerA);
    for (const deniedMatch of [IDS.matchSameTeam, IDS.matchOtherClub]) {
      await expectDatabaseError(
        db.query(
          `select public.update_match_day_score_as_scorer($1, $2, 1, 0, null)`,
          [IDS.linkA, deniedMatch],
        ),
        /Only the current selected scorer/,
      );
    }
    await expectDatabaseError(
      db.query(
        `select public.update_match_day_score_as_scorer($1, $2, 1, 0, null)`,
        [IDS.linkB, IDS.matchA],
      ),
      /selected scorer link does not match/,
    );
    await expectDatabaseError(
      db.query(
        `select public.update_match_day_score_as_scorer($1, $2, 1, 0, 'live')`,
        [IDS.linkA, IDS.matchA],
      ),
      /Lifecycle changes require an explicit Match Day clock action/,
    );

    await db.query(
      `select public.update_match_day_score_as_scorer($1, $2, 1, 0, null)`,
      [IDS.linkA, IDS.matchA],
    );
    let match = (
      await db.query("select * from public.match_days where id = $1", [
        IDS.matchA,
      ])
    ).rows[0];
    assert.equal(match.home_score, 1);
    assert.equal(match.status, "scheduled");
    assert.equal(match.timer_status, "not_started");
    assert.equal(match.timer_started_at, null);

    await expectDatabaseError(
      db.query(
        `select public.add_match_day_goal_as_scorer($1, $2, 'club', 'Player A')`,
        [IDS.linkA, IDS.matchA],
      ),
      /Start the match before recording a goal/,
    );

    await expectDatabaseError(
      db.query(`select public.set_match_day_timer_state($1, 'resume')`, [
        IDS.matchA,
      ]),
      /paused or Full Time match clock can be resumed/i,
    );

    const concurrentStarts = await Promise.all([
      db.query(`select public.set_match_day_timer_state($1, 'start') as result`, [
        IDS.matchA,
      ]),
      db.query(`select public.set_match_day_timer_state($1, 'start') as result`, [
        IDS.matchA,
      ]),
    ]);
    assert.equal(
      concurrentStarts.some(
        (result) => result.rows[0].result.timerStatus === "running",
      ),
      true,
    );
    assert.equal(
      concurrentStarts.some(
        (result) => result.rows[0].result.alreadyStarted === true,
      ),
      true,
    );
    const startEvents = await db.query(
      `select count(*)::integer as count from public.match_day_event_log where metadata ->> 'action' = 'start'`,
    );
    assert.equal(startEvents.rows[0].count, 1);

    await db.query(
      `select public.add_match_day_goal_as_scorer($1, $2, 'club', 'Player A')`,
      [IDS.linkA, IDS.matchA],
    );
    match = (
      await db.query("select * from public.match_days where id = $1", [
        IDS.matchA,
      ])
    ).rows[0];
    assert.equal(match.home_score, 2);
    assert.equal(match.status, "live");
    assert.equal(match.timer_status, "running");

    const goalEvent = await db.query(
      `select id from public.match_day_events where match_day_id = $1 and event_type = 'goal' limit 1`,
      [IDS.matchA],
    );
    await expectDatabaseError(
      db.query(
        `select public.void_match_day_goal($1, $2, $3, 'Parent attempted undo')`,
        [IDS.linkA, IDS.matchA, goalEvent.rows[0].id],
      ),
      /Parent views are read-only for event undo/,
    );

    await setActor(db, IDS.staff);
    const staffStart = await db.query(
      `select public.set_match_day_timer_state($1, 'start') as result`,
      [IDS.matchStaff],
    );
    assert.equal(staffStart.rows[0].result.timerStatus, "running");

    await db.query(
      `delete from public.match_day_role_assignments where match_day_id = $1`,
      [IDS.matchA],
    );
    await db.query(
      `delete from public.match_day_scorer_assignments where match_day_id = $1`,
      [IDS.matchA],
    );
    await db.query(
      `insert into public.match_day_role_assignments(match_day_id, club_id, team_id, role, parent_link_id, auth_user_id)
       values ($1, $2, $3, 'scorer', $4, $5)`,
      [IDS.matchA, IDS.clubA, IDS.teamA, IDS.linkB, IDS.scorerB],
    );
    await db.query(
      `insert into public.match_day_scorer_assignments(match_day_id, club_id, team_id, parent_link_id, auth_user_id)
       values ($1, $2, $3, $4, $5)`,
      [IDS.matchA, IDS.clubA, IDS.teamA, IDS.linkB, IDS.scorerB],
    );

    await setActor(db, IDS.scorerA);
    await expectDatabaseError(
      db.query(
        `select public.update_match_day_score_as_scorer($1, $2, 2, 1, null)`,
        [IDS.linkA, IDS.matchA],
      ),
      /Only the current selected scorer/,
    );

    await setActor(db, IDS.scorerB);
    await db.query(
      `select public.update_match_day_score_as_scorer($1, $2, 2, 1, null)`,
      [IDS.linkB, IDS.matchA],
    );
    await db.query(
      `update public.parent_player_links set status = 'revoked' where id = $1`,
      [IDS.linkB],
    );
    await expectDatabaseError(
      db.query(
        `select public.update_match_day_score_as_scorer($1, $2, 3, 1, null)`,
        [IDS.linkB, IDS.matchA],
      ),
      /Only the current selected scorer/,
    );

    await db.query(
      `update public.parent_player_links set status = 'active' where id = $1`,
      [IDS.linkB],
    );
    await db.query(`select public.set_match_day_timer_state($1, 'full_time')`, [
      IDS.matchA,
    ]);
    await db.query(`select public.set_match_day_timer_state($1, 'conclude')`, [
      IDS.matchA,
    ]);
    await expectDatabaseError(
      db.query(
        `select public.update_match_day_score_as_scorer($1, $2, 3, 1, null)`,
        [IDS.linkB, IDS.matchA],
      ),
      /Only the current selected scorer/,
    );

    const permissions = await db.query(`
      select
        has_function_privilege('public', 'public.update_match_day_score_as_scorer(uuid,uuid,integer,integer,text)', 'execute') as public_execute,
        has_function_privilege('anon', 'public.update_match_day_score_as_scorer(uuid,uuid,integer,integer,text)', 'execute') as anon_execute,
        has_function_privilege('authenticated', 'public.update_match_day_score_as_scorer(uuid,uuid,integer,integer,text)', 'execute') as authenticated_execute
    `);
    assert.equal(permissions.rows[0].public_execute, false);
    assert.equal(permissions.rows[0].anon_execute, false);
    assert.equal(permissions.rows[0].authenticated_execute, true);

    await db.exec(migration);
    const concludedAfterRepair = await db.query(
      "select concluded_at is not null as concluded from public.match_days where id = $1",
      [IDS.matchA],
    );
    assert.equal(concludedAfterRepair.rows[0].concluded, true);
  } finally {
    await db.close();
  }
});
