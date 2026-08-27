import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260827134912_team_notification_display_name.sql',
  import.meta.url,
)
const migrationSql = await readFile(migrationUrl, 'utf8')

const CLUB_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_CLUB_ID = '10000000-0000-4000-8000-000000000002'
const TEAM_ID = '10000000-0000-4000-8000-000000000003'
const COACH_ID = '10000000-0000-4000-8000-000000000004'
const OTHER_COACH_ID = '10000000-0000-4000-8000-000000000005'

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema if not exists auth;
    create schema if not exists app_private;
    create role anon;
    create role authenticated;
    create role service_role;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.users (
      id uuid primary key,
      club_id uuid,
      display_name text,
      email text,
      name text,
      role text,
      role_rank integer,
      status text
    );

    create table public.clubs (
      id uuid primary key,
      status text
    );

    create table public.user_club_memberships (
      auth_user_id uuid not null,
      club_id uuid not null,
      role text not null,
      role_rank integer not null
    );

    create table public.teams (
      id uuid primary key,
      archived_at timestamptz,
      club_id uuid not null,
      name text not null,
      status text,
      updated_at timestamptz,
      updated_by uuid,
      updated_by_email text,
      updated_by_name text
    );

    create table public.team_staff (
      id uuid primary key default gen_random_uuid(),
      team_id uuid not null,
      user_id uuid not null,
      role_rank integer not null
    );

    create table public.audit_logs (
      id bigint generated always as identity primary key,
      action text not null,
      actor_id uuid,
      club_id uuid not null,
      entity_id uuid,
      entity_type text,
      metadata jsonb not null default '{}'::jsonb
    );

    create function app_private.actor_can_manage_team_resource(
      p_actor_id uuid,
      p_club_id uuid,
      p_team_id uuid,
      p_minimum_rank integer
    )
    returns boolean
    language sql
    stable
    as $$
      select exists (
        select 1
        from public.users app_user
        join public.user_club_memberships membership
          on membership.auth_user_id = app_user.id
         and membership.club_id = app_user.club_id
         and membership.role = app_user.role
         and membership.role_rank = app_user.role_rank
        join public.clubs club
          on club.id = app_user.club_id
         and coalesce(club.status, 'active') = 'active'
        left join public.team_staff assignment
          on assignment.team_id = p_team_id
         and assignment.user_id = app_user.id
        where app_user.id = p_actor_id
          and app_user.club_id = p_club_id
          and app_user.status = 'active'
          and app_user.role not in ('parent_portal', 'super_admin')
          and (
            app_user.role = 'admin'
            or assignment.role_rank >= p_minimum_rank
          )
      )
    $$;
  `)
  await db.exec(migrationSql)
  await db.exec(`
    insert into public.clubs (id, status)
    values
      ('${CLUB_ID}', 'active'),
      ('${OTHER_CLUB_ID}', 'active');

    insert into public.users (id, club_id, display_name, email, name, role, role_rank, status)
    values
      ('${COACH_ID}', '${CLUB_ID}', 'Test Coach', 'coach@example.invalid', 'Coach', 'coach', 20, 'active'),
      ('${OTHER_COACH_ID}', '${OTHER_CLUB_ID}', 'Other Coach', 'other@example.invalid', 'Other', 'coach', 20, 'active');

    insert into public.user_club_memberships (auth_user_id, club_id, role, role_rank)
    values
      ('${COACH_ID}', '${CLUB_ID}', 'coach', 20),
      ('${OTHER_COACH_ID}', '${OTHER_CLUB_ID}', 'coach', 20);

    insert into public.teams (id, club_id, name)
    values ('${TEAM_ID}', '${CLUB_ID}', 'U17 Green');

    insert into public.team_staff (team_id, user_id, role_rank)
    values ('${TEAM_ID}', '${COACH_ID}', 20);
  `)

  return db
}

test('authorised Team staff update only the notification label and create an audit record', async () => {
  const db = await createDatabase()
  await db.exec(`select set_config('request.jwt.claim.sub', '${COACH_ID}', false);`)

  const result = await db.query(
    `select id, name, notification_display_name
     from public.set_team_notification_display_name($1, $2)`,
    [TEAM_ID, '  U17G  '],
  )

  assert.deepEqual(result.rows, [{
    id: TEAM_ID,
    name: 'U17 Green',
    notification_display_name: 'U17G',
  }])

  const audit = await db.query(
    `select action, metadata from public.audit_logs where entity_id = $1`,
    [TEAM_ID],
  )
  assert.equal(audit.rows.length, 1)
  assert.equal(audit.rows[0].action, 'team_notification_display_name_updated')
  assert.equal(audit.rows[0].metadata.officialTeamName, 'U17 Green')
  assert.equal(audit.rows[0].metadata.notificationDisplayName, 'U17G')
})

test('cross-club, blank, and overlong updates fail without changing Team data', async () => {
  const db = await createDatabase()
  await db.exec(`select set_config('request.jwt.claim.sub', '${OTHER_COACH_ID}', false);`)

  await assert.rejects(
    db.query(`select * from public.set_team_notification_display_name($1, $2)`, [TEAM_ID, 'Other']),
    /Coach or manager access is required/i,
  )

  await db.exec(`select set_config('request.jwt.claim.sub', '${COACH_ID}', false);`)
  await assert.rejects(
    db.query(`select * from public.set_team_notification_display_name($1, $2)`, [TEAM_ID, '']),
    /between 1 and 40 characters/i,
  )
  await assert.rejects(
    db.query(`select * from public.set_team_notification_display_name($1, $2)`, [TEAM_ID, 'x'.repeat(41)]),
    /between 1 and 40 characters/i,
  )

  const team = await db.query(
    `select name, notification_display_name from public.teams where id = $1`,
    [TEAM_ID],
  )
  assert.deepEqual(team.rows, [{ name: 'U17 Green', notification_display_name: null }])
  const audit = await db.query(`select count(*)::integer as count from public.audit_logs`)
  assert.equal(audit.rows[0].count, 0)
})
