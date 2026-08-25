import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import {
  getManagerHomeNextUp,
  getManagerHomeNextUpContext,
  getManagerHomeNextUpHref,
} from '../src/lib/manager-home-next-up.js'

const migrationUrl = new URL('../supabase/migrations/20260803091136_fp_v1_scorer_eligibility_consistency_29a.sql', import.meta.url)
const serviceBoundaryMigrationUrl = new URL('../supabase/migrations/20260803094112_fp_v1_scorer_eligibility_service_boundary_29a.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const coachHomeUrl = new URL('../src/pages/CoachHomePage.jsx', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const volunteerFunctionUrl = new URL('../netlify/functions/select-match-day-volunteer.js', import.meta.url)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  otherTeam: '20000000-0000-4000-8000-000000000002',
  player: '30000000-0000-4000-8000-000000000001',
  otherPlayer: '30000000-0000-4000-8000-000000000002',
  activeParent: '40000000-0000-4000-8000-000000000001',
  inactiveParent: '40000000-0000-4000-8000-000000000002',
  wrongTeamParent: '40000000-0000-4000-8000-000000000003',
  activeUser: '50000000-0000-4000-8000-000000000001',
  inactiveUser: '50000000-0000-4000-8000-000000000002',
  staff: '50000000-0000-4000-8000-000000000003',
  match: '60000000-0000-4000-8000-000000000001',
  activeRequest: '70000000-0000-4000-8000-000000000001',
  inactiveRequest: '70000000-0000-4000-8000-000000000002',
  wrongTeamRequest: '70000000-0000-4000-8000-000000000003',
}

async function createEligibilityDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table public.match_days (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      status text not null default 'scheduled',
      deleted_at timestamptz,
      concluded_at timestamptz
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      status text not null default 'active'
    );
    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      email text,
      auth_user_id uuid,
      status text not null default 'active'
    );
    create table public.match_day_availability_requests (
      id uuid primary key,
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid,
      player_id uuid,
      recipient_email text,
      parent_link_id uuid,
      status text not null default 'available',
      volunteer_scorer_response text not null default 'yes'
    );
    create table public.match_day_role_assignments (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid,
      role text not null,
      parent_link_id uuid not null,
      auth_user_id uuid not null,
      assigned_by uuid,
      assigned_by_name text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (match_day_id, role)
    );
    create table public.match_day_scorer_assignments (
      match_day_id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      parent_link_id uuid not null,
      auth_user_id uuid not null,
      assigned_by uuid,
      assigned_by_name text,
      created_at timestamptz not null default now()
    );
    create function public.can_manage_match_day(target_team_id uuid)
    returns boolean language sql stable as $$ select true; $$;
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(await readFile(serviceBoundaryMigrationUrl, 'utf8'))
  await db.query(
    'insert into public.match_days(id, club_id, team_id) values ($1, $2, $3)',
    [ids.match, ids.club, ids.team],
  )
  await db.query(
    `insert into public.players(id, club_id, team_id, status) values
      ($1, $2, $3, 'active'),
      ($4, $2, $5, 'active')`,
    [ids.player, ids.club, ids.team, ids.otherPlayer, ids.otherTeam],
  )
  await db.query(
    `insert into public.parent_player_links(id, club_id, team_id, player_id, email, auth_user_id, status) values
      ($1, $2, null, $3, 'active@example.test', $4, 'active'),
      ($5, $2, $6, $3, 'inactive@example.test', $7, 'inactive'),
      ($8, $2, $9, $10, 'wrong-team@example.test', $7, 'active')`,
    [
      ids.activeParent,
      ids.club,
      ids.player,
      ids.activeUser,
      ids.inactiveParent,
      ids.team,
      ids.inactiveUser,
      ids.wrongTeamParent,
      ids.otherTeam,
      ids.otherPlayer,
    ],
  )
  await db.query(
    `insert into public.match_day_availability_requests(id, match_day_id, club_id, team_id, player_id, recipient_email, parent_link_id) values
      ($1, $2, $3, $4, $5, 'active@example.test', $6),
      ($7, $2, $3, $4, $5, 'inactive@example.test', $8),
      ($9, $2, $3, $4, $10, 'wrong-team@example.test', $11)`,
    [
      ids.activeRequest,
      ids.match,
      ids.club,
      ids.team,
      ids.player,
      ids.activeParent,
      ids.inactiveRequest,
      ids.inactiveParent,
      ids.wrongTeamRequest,
      ids.otherPlayer,
      ids.wrongTeamParent,
    ],
  )
  return db
}

test('29A uses one database eligibility rule for listing, API resolution, and scorer assignment', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /app_private\.match_day_scorer_link_eligibility/)
  assert.match(migration, /app_private\.resolve_match_day_scorer_request_eligibility/)
  assert.match(migration, /public\.get_match_day_scorer_eligibility/)
  assert.match(migration, /public\.resolve_match_day_scorer_eligibility/)
  assert.match(migration, /sync_match_day_scorer_assignment[\s\S]*app_private\.match_day_scorer_link_eligibility/)
  assert.match(migration, /player\.team_id = match_row\.team_id/)
  assert.match(migration, /parent_link\.status = 'active'/)
  assert.match(migration, /parent_link\.auth_user_id is not null/)
})

test('29A eligibility accepts the canonical current player team and rejects inactive or other-team links', async () => {
  const db = await createEligibilityDatabase()

  try {
    const active = await db.query(
      'select * from public.resolve_match_day_scorer_eligibility($1, $2)',
      [ids.match, ids.activeRequest],
    )
    const inactive = await db.query(
      'select * from public.resolve_match_day_scorer_eligibility($1, $2)',
      [ids.match, ids.inactiveRequest],
    )
    const wrongTeam = await db.query(
      'select * from public.resolve_match_day_scorer_eligibility($1, $2)',
      [ids.match, ids.wrongTeamRequest],
    )

    assert.equal(active.rows[0].eligible, true)
    assert.equal(active.rows[0].parent_link_id, ids.activeParent)
    assert.equal(inactive.rows[0].eligible, false)
    assert.match(inactive.rows[0].reason, /active signed-in account/)
    assert.equal(wrongTeam.rows[0].eligible, false)

    await db.query(
      'select public.sync_match_day_scorer_assignment($1, $2, $3, $4, true)',
      [ids.match, ids.activeParent, ids.staff, 'FP TEST Coach'],
    )
    const assignment = await db.query(
      'select parent_link_id, auth_user_id from public.match_day_role_assignments where match_day_id = $1 and role = $2',
      [ids.match, 'scorer'],
    )
    assert.deepEqual(assignment.rows[0], {
      parent_link_id: ids.activeParent,
      auth_user_id: ids.activeUser,
    })

    await assert.rejects(
      db.query(
        'select public.sync_match_day_scorer_assignment($1, $2, $3, $4, true)',
        [ids.match, ids.inactiveParent, ids.staff, 'FP TEST Coach'],
      ),
      /active signed-in account/,
    )
  } finally {
    await db.close()
  }
})

test('29A eligibility remains authoritative while the selected scorer receives the 32A confirmation email', async () => {
  const [domain, page, volunteerFunction] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(matchDayPageUrl, 'utf8'),
    readFile(volunteerFunctionUrl, 'utf8'),
  ])

  assert.match(domain, /select-match-day-volunteer\?matchDayId=/)
  assert.match(domain, /includeScorerEligibility = false/)
  assert.match(page, /includeScorerEligibility: true, accessToken: session\?\.access_token/)
  assert.match(domain, /scorer_eligible: eligibility\?\.eligible === true/)
  assert.match(page, /eligible: role\.key === 'scorer' \? request\.scorerEligible === true : true/)
  assert.match(page, /row\?\.eligible === false/)
  assert.doesNotMatch(page, /type: 'scorer_selected'/)
  assert.match(volunteerFunction, /rpc\('resolve_match_day_scorer_eligibility'/)
  assert.match(volunteerFunction, /event\.httpMethod === 'GET'[\s\S]*rpc\([\s\S]*'get_match_day_scorer_eligibility'/)
  assert.match(volunteerFunction, /if \(selected && !isSameSelection\)/)
  assert.match(volunteerFunction, /Open scorer Game Mode/)
  assert.match(volunteerFunction, /parent-portal\?\$\{searchParams\.toString\(\)\}/)
  assert.match(volunteerFunction, /if \(previousAssignment\?\.id && \(!selected \|\| !isSameSelection\)\)/)
})

test('29A exposes scorer eligibility only through the authenticated service boundary', async () => {
  const migration = await readFile(serviceBoundaryMigrationUrl, 'utf8')

  assert.match(migration, /revoke all on function public\.get_match_day_scorer_eligibility\(uuid\) from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.get_match_day_scorer_eligibility\(uuid\) to service_role/)
  assert.doesNotMatch(migration, /can_manage_match_day/)
})

test('29A Manager Home chooses the first future canonical team event and excludes stale data', async () => {
  const sessionsPage = await readFile(sessionsPageUrl, 'utf8')
  const now = new Date('2026-08-03T09:00:00+01:00')
  const next = getManagerHomeNextUp({
    activeTeamId: ids.team,
    now,
    calendarEvents: [
      {
        id: 'past-training',
        teamId: ids.team,
        title: 'Past training',
        eventType: 'training',
        startsAt: '2026-08-02T18:00:00+01:00',
        endsAt: '2026-08-02T19:00:00+01:00',
        recurrenceFrequency: 'none',
      },
      {
        id: 'other-team',
        teamId: ids.otherTeam,
        title: 'Other team training',
        eventType: 'training',
        startsAt: '2026-08-03T10:00:00+01:00',
        endsAt: '2026-08-03T11:00:00+01:00',
        recurrenceFrequency: 'none',
      },
      {
        id: 'next-training',
        teamId: ids.team,
        title: 'First future training',
        eventType: 'training',
        startsAt: '2026-08-03T11:00:00+01:00',
        endsAt: '2026-08-03T12:00:00+01:00',
        recurrenceFrequency: 'none',
      },
    ],
    matchDays: [
      {
        id: 'cancelled-match',
        teamId: ids.team,
        opponent: 'Cancelled FC',
        matchDate: '2026-08-03',
        kickoffTime: '09:30',
        status: 'cancelled',
      },
      {
        id: 'later-match',
        teamId: ids.team,
        opponent: 'Later FC',
        matchDate: '2026-08-03',
        kickoffTime: '15:00',
        status: 'scheduled',
      },
    ],
  })

  assert.equal(next.sourceId, 'next-training')
  assert.equal(next.title, 'First future training')
  assert.equal(getManagerHomeNextUpHref(next), '/calendar?action=view&eventId=next-training&source=calendar')
  assert.match(sessionsPage, /\['manage-players', 'view-responses', 'view'\]\.includes\(requestedAction\)/)
  assert.match(sessionsPage, /mode: requestedAction === 'manage-players' \? 'manage-players' : 'view'/)
  assert.match(getManagerHomeNextUpContext(next), /Training/)
  assert.match(getManagerHomeNextUpContext(next), /11:00/)
})

test('29A Manager Home expands recurrence, opens fixtures directly, and has a clear empty state', async () => {
  const recurring = getManagerHomeNextUp({
    activeTeamId: ids.team,
    now: new Date('2026-08-08T10:00:00+01:00'),
    calendarEvents: [{
      id: 'weekly-training',
      teamId: ids.team,
      title: 'Weekly training',
      eventType: 'training',
      startsAt: '2026-08-01T18:00:00+01:00',
      endsAt: '2026-08-01T19:00:00+01:00',
      recurrenceFrequency: 'weekly',
      recurrenceUntil: '2026-08-31',
    }],
  })
  const fixture = getManagerHomeNextUp({
    activeTeamId: ids.team,
    now: new Date('2026-08-03T09:00:00+01:00'),
    matchDays: [{
      id: 'future-fixture',
      teamId: ids.team,
      opponent: 'Future FC',
      matchDate: '2026-08-03',
      kickoffTime: '10:30',
      status: 'scheduled',
    }],
  })
  const coachHome = await readFile(coachHomeUrl, 'utf8')

  assert.equal(recurring.data.recurrenceOccurrenceDate, '2026-08-08')
  assert.equal(getManagerHomeNextUpHref(fixture), '/match-day?fixture=future-fixture')
  assert.equal(getManagerHomeNextUp({ now: new Date('2026-08-03T09:00:00+01:00') }), null)
  assert.match(coachHome, /getCalendarEvents\(\{ user \}\)/)
  assert.match(coachHome, /getMatchDays\(\{ user \}\)/)
  assert.match(coachHome, /No upcoming event scheduled/)
  assert.doesNotMatch(coachHome.slice(coachHome.indexOf('data-testid="manager-home-next-session"')), /activeSession\?\.title/)
})
