import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260725153849_parent_portal_confirmed_team_read_model.sql', import.meta.url),
  'utf8',
)
const availableSelectedMigration = await readFile(
  new URL('../supabase/migrations/20260827143000_parent_portal_available_selected_squad.sql', import.meta.url),
  'utf8',
)

const ids = Object.freeze({
  parentA: '10000000-0000-4000-8000-000000000001',
  parentB: '10000000-0000-4000-8000-000000000002',
  guardianA: '10000000-0000-4000-8000-000000000003',
  otherTeamParent: '10000000-0000-4000-8000-000000000004',
  otherClubParent: '10000000-0000-4000-8000-000000000005',
  clubA: '20000000-0000-4000-8000-000000000001',
  clubB: '20000000-0000-4000-8000-000000000002',
  teamA: '30000000-0000-4000-8000-000000000001',
  teamB: '30000000-0000-4000-8000-000000000002',
  teamC: '30000000-0000-4000-8000-000000000003',
  playerA: '40000000-0000-4000-8000-000000000001',
  playerB: '40000000-0000-4000-8000-000000000002',
  playerC: '40000000-0000-4000-8000-000000000003',
  playerD: '40000000-0000-4000-8000-000000000004',
  playerOtherTeam: '40000000-0000-4000-8000-000000000005',
  playerOtherClub: '40000000-0000-4000-8000-000000000006',
  linkA: '50000000-0000-4000-8000-000000000001',
  linkB: '50000000-0000-4000-8000-000000000002',
  guardianLinkA: '50000000-0000-4000-8000-000000000003',
  otherTeamLink: '50000000-0000-4000-8000-000000000004',
  otherClubLink: '50000000-0000-4000-8000-000000000005',
  fixtureA: '60000000-0000-4000-8000-000000000001',
  fixtureB: '60000000-0000-4000-8000-000000000002',
  fixtureC: '60000000-0000-4000-8000-000000000003',
})

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid not null,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      status text not null
    );
    create table public.match_days (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      match_date date,
      parent_visible boolean not null,
      parent_audience text not null,
      status text not null,
      previous_hidden_at timestamptz,
      deleted_at timestamptz
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_name text not null,
      status text not null default 'active',
      notes text
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
    create table public.match_day_player_availability (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null
    );
    create table public.match_day_availability_requests (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      player_id uuid not null,
      status text not null
    );
    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      invite_status text not null,
      response_requirement text not null
    );
  `)

  await db.exec(migration)
  await db.exec(availableSelectedMigration)

  await db.query(
    `insert into public.parent_player_links (id, auth_user_id, club_id, team_id, player_id, status)
     values
       ($1, $2, $6, $8, $11, 'active'),
       ($3, $4, $6, $8, $12, 'active'),
       ($5, $2, $6, $8, $11, 'active'),
       ($7, $9, $6, $10, $13, 'active'),
       ($14, $15, $16, $17, $18, 'active')`,
    [
      ids.linkA, ids.parentA, ids.linkB, ids.parentB, ids.guardianLinkA,
      ids.clubA, ids.otherTeamLink, ids.teamA, ids.otherTeamParent, ids.teamB,
      ids.playerA, ids.playerB, ids.playerOtherTeam, ids.otherClubLink, ids.otherClubParent,
      ids.clubB, ids.teamC, ids.playerOtherClub,
    ],
  )
  await db.query(
    `insert into public.match_days
      (id, club_id, team_id, match_date, parent_visible, parent_audience, status)
     values
       ($1, $4, $5, current_date + 1, true, 'all_team_parents', 'scheduled'),
       ($2, $4, $6, current_date + 1, true, 'all_team_parents', 'scheduled'),
       ($3, $7, $8, current_date + 1, true, 'all_team_parents', 'scheduled')`,
    [ids.fixtureA, ids.fixtureB, ids.fixtureC, ids.clubA, ids.teamA, ids.teamB, ids.clubB, ids.teamC],
  )
  await db.query(
    `insert into public.players (id, club_id, team_id, player_name, status, notes)
     values
       ($1, $7, $8, 'Zoe Able', 'active', 'private A'),
       ($2, $7, $8, 'alex Young', 'active', 'private B'),
       ($3, $7, $8, 'Ben Stone', 'active', 'private C'),
       ($4, $7, $8, 'Available Unselected', 'active', 'private D'),
       ($5, $7, $9, 'Other Team Player', 'active', 'private other team'),
       ($6, $10, $11, 'Other Club Player', 'active', 'private other club')`,
    [
      ids.playerA, ids.playerB, ids.playerC, ids.playerD, ids.playerOtherTeam,
      ids.playerOtherClub, ids.clubA, ids.teamA, ids.teamB, ids.clubB, ids.teamC,
    ],
  )
  await db.query(
    `insert into public.match_day_player_squad_decisions
      (match_day_id, club_id, team_id, player_id, status)
     values
       ($1, $4, $5, $7, 'selected'),
       ($1, $4, $5, $8, 'selected'),
       ($1, $4, $5, $9, 'selected'),
       ($1, $4, $5, $10, 'not_selected'),
       ($2, $4, $6, $11, 'selected'),
       ($3, $12, $13, $14, 'selected')`,
    [
      ids.fixtureA, ids.fixtureB, ids.fixtureC, ids.clubA, ids.teamA, ids.teamB,
      ids.playerA, ids.playerB, ids.playerC, ids.playerD, ids.playerOtherTeam,
      ids.clubB, ids.teamC, ids.playerOtherClub,
    ],
  )
  await db.query(
    `insert into public.match_day_player_availability (match_day_id, club_id, team_id, player_id, status)
     values
       ($1, $10, $11, $2, 'unavailable'),
       ($1, $10, $11, $3, 'maybe'),
       ($1, $10, $11, $4, 'available'),
       ($1, $10, $11, $5, 'available'),
       ($6, $10, $12, $7, 'available'),
       ($8, $13, $14, $9, 'available')`,
    [
      ids.fixtureA, ids.playerA, ids.playerB, ids.playerC, ids.playerD,
      ids.fixtureB, ids.playerOtherTeam, ids.fixtureC, ids.playerOtherClub,
      ids.clubA, ids.teamA, ids.teamB, ids.clubB, ids.teamC,
    ],
  )

  return db
}

async function readConfirmedTeam(db, parentId, linkId) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${parentId}';`)
  const result = await db.query(
    'select match_day_id, selected_player_names from public.get_parent_portal_confirmed_teams($1)',
    [linkId],
  )
  await db.exec('reset role;')
  return result.rows
}

test('same-team parents and another guardian receive only the identical Available and Selected squad', async () => {
  const db = await createDatabase()

  try {
    const parentA = await readConfirmedTeam(db, ids.parentA, ids.linkA)
    const parentB = await readConfirmedTeam(db, ids.parentB, ids.linkB)
    const guardianA = await readConfirmedTeam(db, ids.parentA, ids.guardianLinkA)
    const expected = ['Ben Stone']

    assert.deepEqual(parentA, [{ match_day_id: ids.fixtureA, selected_player_names: expected }])
    assert.deepEqual(parentB, parentA)
    assert.deepEqual(guardianA, parentA)
    assert.equal(new Set(parentA[0].selected_player_names).size, 1)
    assert.ok(!parentA[0].selected_player_names.includes('Available Unselected'))
    assert.ok(!parentA[0].selected_player_names.includes('Zoe Able'))
    assert.ok(!parentA[0].selected_player_names.includes('alex Young'))
  } finally {
    await db.close()
  }
})

test('other-team, cross-club, guessed-link and anonymous access fail closed', async () => {
  const db = await createDatabase()

  try {
    assert.deepEqual(
      await readConfirmedTeam(db, ids.otherTeamParent, ids.otherTeamLink),
      [{ match_day_id: ids.fixtureB, selected_player_names: ['Other Team Player'] }],
    )
    assert.deepEqual(
      await readConfirmedTeam(db, ids.otherClubParent, ids.otherClubLink),
      [{ match_day_id: ids.fixtureC, selected_player_names: ['Other Club Player'] }],
    )
    assert.deepEqual(await readConfirmedTeam(db, ids.parentA, ids.otherTeamLink), [])
    assert.deepEqual(
      await readConfirmedTeam(db, ids.parentA, '50000000-0000-4000-8000-000000000099'),
      [],
    )

    await db.exec('set role anon; reset request.jwt.claim.sub;')
    await assert.rejects(
      db.query('select * from public.get_parent_portal_confirmed_teams($1)', [ids.linkA]),
      /permission denied/i,
    )
  } finally {
    await db.close()
  }
})

test('availability and selection changes update the same bounded read model', async () => {
  const db = await createDatabase()

  try {
    await db.query(
      `update public.match_day_player_squad_decisions
       set status = 'not_selected'
       where match_day_id = $1 and player_id = $2`,
      [ids.fixtureA, ids.playerC],
    )
    assert.deepEqual(
      await readConfirmedTeam(db, ids.parentA, ids.linkA),
      [{ match_day_id: ids.fixtureA, selected_player_names: [] }],
    )

    await db.query(
      `update public.match_day_player_availability
       set status = 'available'
       where match_day_id = $1 and player_id = $2`,
      [ids.fixtureA, ids.playerA],
    )
    assert.deepEqual(
      await readConfirmedTeam(db, ids.parentA, ids.linkA),
      [{ match_day_id: ids.fixtureA, selected_player_names: ['Zoe Able'] }],
    )
  } finally {
    await db.close()
  }
})
