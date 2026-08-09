import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260809205356_parent_chat_operational_scope_containment_34a.sql',
  import.meta.url,
)

const ids = {
  clubA: '10000000-0000-4000-8000-000000000001',
  clubB: '10000000-0000-4000-8000-000000000002',
  teamA: '20000000-0000-4000-8000-000000000001',
  teamB: '20000000-0000-4000-8000-000000000002',
  teamArchived: '20000000-0000-4000-8000-000000000003',
  teamOtherClub: '20000000-0000-4000-8000-000000000004',
  coachA: '30000000-0000-4000-8000-000000000001',
  coachB: '30000000-0000-4000-8000-000000000002',
  multiTeam: '30000000-0000-4000-8000-000000000003',
  clubAdminUnassigned: '30000000-0000-4000-8000-000000000004',
  clubAdminAssigned: '30000000-0000-4000-8000-000000000005',
  removedStaff: '30000000-0000-4000-8000-000000000006',
  parentOnly: '30000000-0000-4000-8000-000000000007',
  platformAdmin: '30000000-0000-4000-8000-000000000008',
  staleMembership: '30000000-0000-4000-8000-000000000009',
  otherClubCoach: '30000000-0000-4000-8000-000000000010',
}

function extractFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}`)
  const nextRevoke = source.indexOf('\nrevoke ', start)
  assert.ok(start >= 0, `${name} starts`)
  assert.ok(nextRevoke > start, `${name} ends`)
  return source.slice(start, nextRevoke)
}

test('Phase 34A removes Club-wide Parent Chat bypass and reconciles metadata only', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const authority = extractFunction(migration, 'parent_chat_staff_can_access_team')

  assert.match(authority, /join public\.team_staff assignment/i)
  assert.match(authority, /assignment\.user_id = staff\.id/i)
  assert.match(authority, /assignment\.team_id = target_team_id/i)
  assert.match(authority, /join public\.user_club_memberships membership/i)
  assert.match(authority, /membership\.role = staff\.role/i)
  assert.match(authority, /membership\.role_rank = staff\.role_rank/i)
  assert.match(authority, /team\.archived_at is null/i)
  assert.match(authority, /coalesce\(team\.status, 'active'\) = 'active'/i)
  assert.match(authority, /club\.archived_at is null/i)
  assert.match(authority, /coalesce\(club\.status, 'active'\) = 'active'/i)
  assert.doesNotMatch(authority, /role_rank[^\n]+>=\s*50\s*\n\s*or/i)

  assert.match(migration, /perform public\.parent_chat_reconcile_room\(room_record\.id\)/i)
  assert.doesNotMatch(migration, /parent_chat_messages\s+(set|where|values)/i)
  assert.doesNotMatch(migration, /insert into public\.parent_chat_messages/i)
  assert.doesNotMatch(migration, /delete from public\.parent_chat_messages/i)
  assert.doesNotMatch(migration, /email|push|sms/i)
  assert.match(
    migration,
    /revoke all on function public\.parent_chat_staff_can_access_team\(uuid, uuid, uuid\)[\s\S]*from public, anon/i,
  )
  assert.match(
    migration,
    /grant execute on function public\.parent_chat_staff_can_access_team\(uuid, uuid, uuid\)[\s\S]*to authenticated, service_role/i,
  )
})

test('Phase 34A role and context matrix is assignment scoped and fail closed', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const authority = extractFunction(migration, 'parent_chat_staff_can_access_team')
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create table public.clubs (
      id uuid primary key,
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.teams (
      id uuid primary key,
      club_id uuid not null,
      status text not null default 'active',
      archived_at timestamptz
    );

    create table public.users (
      id uuid primary key,
      club_id uuid,
      status text not null default 'active',
      role text not null,
      role_rank integer not null
    );

    create table public.user_club_memberships (
      auth_user_id uuid not null,
      club_id uuid not null,
      role text not null,
      role_rank integer not null
    );

    create table public.team_staff (
      user_id uuid not null,
      team_id uuid not null
    );
  `)

  await db.query(
    `insert into public.clubs(id, status, archived_at)
     values ($1, 'active', null), ($2, 'active', null)`,
    [ids.clubA, ids.clubB],
  )
  await db.query(
    `insert into public.teams(id, club_id, status, archived_at)
     values
       ($1, $5, 'active', null),
       ($2, $5, 'active', null),
       ($3, $5, 'archived', statement_timestamp()),
       ($4, $6, 'active', null)`,
    [ids.teamA, ids.teamB, ids.teamArchived, ids.teamOtherClub, ids.clubA, ids.clubB],
  )

  const users = [
    [ids.coachA, ids.clubA, 'active', 'coach', 30],
    [ids.coachB, ids.clubA, 'active', 'coach', 30],
    [ids.multiTeam, ids.clubA, 'active', 'coach', 30],
    [ids.clubAdminUnassigned, ids.clubA, 'active', 'admin', 100],
    [ids.clubAdminAssigned, ids.clubA, 'active', 'admin', 100],
    [ids.removedStaff, ids.clubA, 'inactive', 'coach', 30],
    [ids.parentOnly, ids.clubA, 'active', 'parent_portal', 0],
    [ids.platformAdmin, ids.clubA, 'active', 'super_admin', 100],
    [ids.staleMembership, ids.clubA, 'active', 'coach', 30],
    [ids.otherClubCoach, ids.clubB, 'active', 'coach', 30],
  ]

  for (const user of users) {
    await db.query(
      `insert into public.users(id, club_id, status, role, role_rank)
       values ($1, $2, $3, $4, $5)`,
      user,
    )
    await db.query(
      `insert into public.user_club_memberships(auth_user_id, club_id, role, role_rank)
       values ($1, $2, $3, $4)`,
      user[0] === ids.staleMembership
        ? [user[0], user[1], 'manager', 50]
        : [user[0], user[1], user[3], user[4]],
    )
  }

  for (const [userId, teamId] of [
    [ids.coachA, ids.teamA],
    [ids.coachB, ids.teamB],
    [ids.multiTeam, ids.teamA],
    [ids.multiTeam, ids.teamB],
    [ids.clubAdminAssigned, ids.teamA],
    [ids.removedStaff, ids.teamA],
    [ids.parentOnly, ids.teamA],
    [ids.platformAdmin, ids.teamA],
    [ids.staleMembership, ids.teamA],
    [ids.otherClubCoach, ids.teamOtherClub],
    [ids.coachA, ids.teamArchived],
  ]) {
    await db.query(
      `insert into public.team_staff(user_id, team_id) values ($1, $2)`,
      [userId, teamId],
    )
  }

  await db.exec(authority)

  async function allowed(userId, clubId, teamId) {
    const result = await db.query(
      `select public.parent_chat_staff_can_access_team($1, $2, $3) as allowed`,
      [userId, clubId, teamId],
    )
    return result.rows[0].allowed
  }

  assert.equal(await allowed(ids.coachA, ids.clubA, ids.teamA), true)
  assert.equal(await allowed(ids.coachA, ids.clubA, ids.teamB), false)
  assert.equal(await allowed(ids.coachB, ids.clubA, ids.teamA), false)
  assert.equal(await allowed(ids.coachB, ids.clubA, ids.teamB), true)
  assert.equal(await allowed(ids.multiTeam, ids.clubA, ids.teamA), true)
  assert.equal(await allowed(ids.multiTeam, ids.clubA, ids.teamB), true)
  assert.equal(await allowed(ids.clubAdminUnassigned, ids.clubA, ids.teamA), false)
  assert.equal(await allowed(ids.clubAdminAssigned, ids.clubA, ids.teamA), true)
  assert.equal(await allowed(ids.clubAdminAssigned, ids.clubA, ids.teamB), false)
  assert.equal(await allowed(ids.removedStaff, ids.clubA, ids.teamA), false)
  assert.equal(await allowed(ids.parentOnly, ids.clubA, ids.teamA), false)
  assert.equal(await allowed(ids.platformAdmin, ids.clubA, ids.teamA), false)
  assert.equal(await allowed(ids.staleMembership, ids.clubA, ids.teamA), false)
  assert.equal(await allowed(ids.coachA, ids.clubA, ids.teamArchived), false)
  assert.equal(await allowed(ids.otherClubCoach, ids.clubA, ids.teamA), false)
  assert.equal(await allowed(ids.otherClubCoach, ids.clubB, ids.teamOtherClub), true)
  assert.equal(await allowed(ids.coachA, ids.clubB, ids.teamOtherClub), false)

  await db.query(
    `update public.clubs set archived_at = statement_timestamp() where id = $1`,
    [ids.clubA],
  )
  assert.equal(await allowed(ids.coachA, ids.clubA, ids.teamA), false)

  await db.close()
})
