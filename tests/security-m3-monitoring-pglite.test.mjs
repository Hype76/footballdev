import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260721211500_m3_security_monitoring_assurance.sql', import.meta.url),
  'utf8',
)

const IDS = {
  club: '10000000-0000-4000-8000-000000000001',
  actor: '20000000-0000-4000-8000-000000000001',
  forgedActor: '20000000-0000-4000-8000-000000000002',
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema app_private;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('app.test_uid', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('app.test_role', true), '')
    $$;

    create table public.clubs (
      id uuid primary key
    );
    create table public.users (
      id uuid primary key,
      club_id uuid references public.clubs(id),
      username text,
      name text,
      email text,
      role text,
      role_label text,
      role_rank integer
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid references public.clubs(id) on delete cascade,
      actor_id uuid references public.users(id) on delete set null,
      actor_name text,
      actor_email text,
      actor_role_label text,
      actor_role_rank integer not null default 0,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default timezone('utc', now())
    );
    alter table public.audit_logs enable row level security;
    grant select, insert on public.audit_logs to authenticated;
    create policy audit_logs_select_scoped on public.audit_logs for select to authenticated using (actor_id = auth.uid());
    create policy audit_logs_insert_scoped on public.audit_logs for insert to authenticated with check (actor_id = auth.uid());

    insert into public.clubs(id) values ('${IDS.club}');
    insert into public.users(id, club_id, username, name, email, role, role_label, role_rank) values
      ('${IDS.actor}', '${IDS.club}', 'Authoritative User', 'Authoritative User', 'actor@example.test', 'admin', 'Admin', 50),
      ('${IDS.forgedActor}', '${IDS.club}', 'Other User', 'Other User', 'other@example.test', 'coach', 'Coach', 20);
  `)
  await db.exec(migration)
  return db
}

test('audit RPC derives actor and tenant while redacting nested sensitive metadata', async () => {
  const db = await createDatabase()
  await db.exec(`
    select set_config('app.test_uid', '${IDS.actor}', false);
    select set_config('app.test_role', 'authenticated', false);
    set role authenticated;
    select public.record_security_audit_event(
      'authority_change',
      'user',
      '${IDS.forgedActor}',
      '{"teamId":"team-1","email":"private@example.test","nested":{"token":"secret-value","safe":"kept"}}'::jsonb,
      null,
      'warning',
      'success',
      'authority',
      'application'
    );
    reset role;
  `)

  const { rows } = await db.query(`
    select club_id, actor_id, actor_name, actor_email, severity, outcome, event_category, source, metadata
    from public.audit_logs
  `)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].club_id, IDS.club)
  assert.equal(rows[0].actor_id, IDS.actor)
  assert.equal(rows[0].actor_name, 'Authoritative User')
  assert.equal(rows[0].actor_email, '')
  assert.equal(rows[0].severity, 'warning')
  assert.equal(rows[0].event_category, 'authority')
  assert.equal(rows[0].metadata.email, '[redacted]')
  assert.equal(rows[0].metadata.nested.token, '[redacted]')
  assert.equal(rows[0].metadata.nested.safe, 'kept')

  await db.close()
})

test('direct client mutation is denied and monitor RPC is service-role only', async () => {
  const db = await createDatabase()
  await db.exec(`
    select set_config('app.test_uid', '${IDS.actor}', false);
    select set_config('app.test_role', 'authenticated', false);
    set role authenticated;
  `)

  await assert.rejects(
    db.exec(`insert into public.audit_logs(action, entity_type, actor_id) values ('forged', 'user', '${IDS.actor}')`),
    /permission denied/i,
  )
  await assert.rejects(
    db.exec('select public.security_audit_monitor_summary(15)'),
    /service role required|permission denied/i,
  )

  await db.exec(`
    reset role;
    select set_config('app.test_role', 'service_role', false);
    set role service_role;
  `)
  const { rows } = await db.query('select public.security_audit_monitor_summary(2) as summary')
  assert.equal(rows[0].summary.windowMinutes, 5)
  assert.equal(rows[0].summary.total, 0)

  await db.close()
})

test('retention routine deletes only expired audit rows and is bounded', async () => {
  const db = await createDatabase()
  await db.exec(`
    insert into public.audit_logs(action, entity_type, created_at, retention_until)
    values
      ('expired', 'security_event', now() - interval '401 days', now() - interval '1 day'),
      ('retained', 'security_event', now(), now() + interval '400 days');
    select set_config('app.test_role', 'service_role', false);
    set role service_role;
  `)

  const { rows } = await db.query('select public.prune_expired_security_audit_events(10000) as deleted')
  assert.equal(rows[0].deleted, 1)

  await db.exec('reset role')
  const remaining = await db.query('select action from public.audit_logs order by action')
  assert.deepEqual(remaining.rows.map((row) => row.action), ['retained'])

  await db.close()
})
