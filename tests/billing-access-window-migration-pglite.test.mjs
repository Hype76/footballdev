import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260808054940_billing_access_window_v1.sql', import.meta.url), 'utf8')
const actorId = '10000000-0000-4000-8000-000000000001'
const clubId = '20000000-0000-4000-8000-000000000001'

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.users (
      id uuid primary key references auth.users(id),
      email text,
      role text,
      role_rank integer default 0,
      club_id uuid
    );
    create table public.clubs (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      plan_key text,
      plan_status text,
      is_plan_comped boolean not null default false,
      workspace_owner_user_id uuid,
      stripe_customer_id text,
      stripe_subscription_id text,
      stripe_price_id text,
      current_period_end timestamptz,
      status text default 'active',
      archived_at timestamptz
    );
    create table public.user_club_memberships (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null,
      email text,
      role text,
      role_label text,
      role_rank integer default 0,
      club_id uuid not null references public.clubs(id),
      status text default 'active',
      created_at timestamptz default now()
    );
    create table public.teams (id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id), name text);
    create table public.players (id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id), team_id uuid references public.teams(id));
    create table public.evaluations (id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id), player_name text);
    insert into auth.users(id) values ('${actorId}');
    insert into public.users(id, email, role, role_rank) values ('${actorId}', 'staff@example.test', 'coach', 30);
    create function auth.uid() returns uuid language sql stable as $function$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $function$;
  `)
  await db.exec(migration)
  return db
}

async function insertWorkspace(db, values = {}) {
  await db.query(`
    insert into public.clubs(id, name, plan_key, plan_status, is_plan_comped, billing_arrangement, billing_start_at)
    values ($1, 'FP TEST', $2, $3, $4, $5, $6)
  `, [clubId, values.planKey ?? 'single_team', values.planStatus ?? 'past_due', values.isPlanComped ?? false, values.arrangement ?? null, values.startAt ?? null])
  await db.query(`insert into public.user_club_memberships(auth_user_id, email, role, role_rank, club_id) values ($1, 'staff@example.test', $2, $3, $4)`, [actorId, values.role ?? 'coach', values.roleRank ?? 30, clubId])
  await db.exec(`select set_config('request.jwt.claim.sub', '${actorId}', false)`)
}

test('migration is additive and legacy workspaces retain staff writes', async () => {
  const db = await createDatabase()
  await insertWorkspace(db)
  await assert.doesNotReject(() => db.query(`insert into public.evaluations(club_id, player_name) values ($1, 'Legacy Player')`, [clubId]))
  const columns = await db.query(`select column_name from information_schema.columns where table_name = 'clubs' and column_name like 'billing_%' order by column_name`)
  assert.deepEqual(columns.rows.map((row) => row.column_name), ['billing_arrangement', 'billing_configuration_updated_at', 'billing_configuration_updated_by', 'billing_start_at'])
  await db.close()
})

test('database backstop blocks expired staff writes but leaves Parent writes unaffected', async () => {
  const staffDb = await createDatabase()
  await insertWorkspace(staffDb, { arrangement: 'deferred', startAt: '2020-01-01T00:00:00Z' })
  await assert.rejects(() => staffDb.query(`insert into public.evaluations(club_id, player_name) values ($1, 'Blocked Player')`, [clubId]), /payment_required/)
  await staffDb.close()

  const parentDb = await createDatabase()
  await insertWorkspace(parentDb, { arrangement: 'deferred', startAt: '2020-01-01T00:00:00Z', role: 'parent', roleRank: 0 })
  await assert.doesNotReject(() => parentDb.query(`insert into public.evaluations(club_id, player_name) values ($1, 'Parent Operation')`, [clubId]))
  await parentDb.close()
})

test('active Stripe status and complimentary access override an expired date', async () => {
  for (const values of [
    { arrangement: 'deferred', startAt: '2020-01-01T00:00:00Z', planStatus: 'active' },
    { arrangement: 'complimentary', planStatus: 'past_due', isPlanComped: true },
  ]) {
    const db = await createDatabase()
    await insertWorkspace(db, values)
    await assert.doesNotReject(() => db.query(`insert into public.evaluations(club_id, player_name) values ($1, 'Allowed Player')`, [clubId]))
    await db.close()
  }
})

test('unknown commercial scope fails closed after explicit configuration', async () => {
  const db = await createDatabase()
  await insertWorkspace(db, { planKey: 'mystery', arrangement: 'deferred', startAt: '2030-01-01T00:00:00Z' })
  await assert.rejects(() => db.query(`insert into public.evaluations(club_id, player_name) values ($1, 'Blocked Player')`, [clubId]), /payment_required/)
  await db.close()
})
