import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260823161603_promoted_player_scorer_volunteer_eligibility.sql',
  import.meta.url,
)

const IDS = {
  authUser: '10000000-0000-4000-8000-000000000001',
  club: '20000000-0000-4000-8000-000000000001',
  link: '30000000-0000-4000-8000-000000000001',
  match: '40000000-0000-4000-8000-000000000001',
  membership: '50000000-0000-4000-8000-000000000001',
  player: '60000000-0000-4000-8000-000000000001',
  team: '70000000-0000-4000-8000-000000000001',
  wrongTeam: '70000000-0000-4000-8000-000000000002',
}

const schemaSql = `
create role anon;
create role authenticated;
create role service_role;
create schema app_private;

create table public.match_days (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  status text not null default 'scheduled',
  concluded_at timestamptz,
  deleted_at timestamptz
);

create table public.players (
  id uuid primary key,
  club_id uuid not null,
  status text not null,
  section text not null,
  archived_at timestamptz
);

create table public.parent_player_links (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid,
  player_id uuid not null,
  link_type text not null,
  status text not null,
  auth_user_id uuid
);

create table public.player_team_memberships (
  id uuid primary key,
  club_id uuid not null,
  team_id uuid not null,
  player_id uuid not null,
  status text not null,
  ended_at timestamptz
);
`

async function getEligibility(db) {
  const result = await db.query(
    'select * from app_private.match_day_scorer_link_eligibility($1, $2)',
    [IDS.match, IDS.link],
  )
  return result.rows[0]
}

test('promoted Squad players with current memberships remain eligible scorer volunteers', async () => {
  const db = new PGlite()

  try {
    await db.exec(schemaSql)
    await db.exec(await readFile(migrationUrl, 'utf8'))
    await db.query(
      `insert into public.match_days(id, club_id, team_id)
       values ($1, $2, $3)`,
      [IDS.match, IDS.club, IDS.team],
    )
    await db.query(
      `insert into public.players(id, club_id, status, section)
       values ($1, $2, 'promoted', 'Squad')`,
      [IDS.player, IDS.club],
    )
    await db.query(
      `insert into public.parent_player_links(
         id, club_id, team_id, player_id, link_type, status, auth_user_id
       ) values ($1, $2, $3, $4, 'parent', 'active', $5)`,
      [IDS.link, IDS.club, IDS.team, IDS.player, IDS.authUser],
    )
    await db.query(
      `insert into public.player_team_memberships(
         id, club_id, team_id, player_id, status, ended_at
       ) values ($1, $2, $3, $4, 'active', null)`,
      [IDS.membership, IDS.club, IDS.team, IDS.player],
    )

    let eligibility = await getEligibility(db)
    assert.equal(eligibility.eligible, true)
    assert.equal(eligibility.auth_user_id, IDS.authUser)

    await db.query("update public.players set status = 'active' where id = $1", [IDS.player])
    eligibility = await getEligibility(db)
    assert.equal(eligibility.eligible, true)

    await db.query(
      "update public.players set archived_at = now() where id = $1",
      [IDS.player],
    )
    eligibility = await getEligibility(db)
    assert.equal(eligibility.eligible, false)

    await db.query(
      "update public.players set archived_at = null where id = $1",
      [IDS.player],
    )
    await db.query(
      "update public.player_team_memberships set status = 'inactive', ended_at = now() where id = $1",
      [IDS.membership],
    )
    eligibility = await getEligibility(db)
    assert.equal(eligibility.eligible, false)

    await db.query(
      "update public.player_team_memberships set status = 'active', ended_at = null, team_id = $2 where id = $1",
      [IDS.membership, IDS.wrongTeam],
    )
    eligibility = await getEligibility(db)
    assert.equal(eligibility.eligible, false)
  } finally {
    await db.close()
  }
})
