import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260922093535_coach_training_attendance.sql', import.meta.url)
const scopeMigrationUrl = new URL('../supabase/migrations/20260922103001_coach_training_attendance_notification_scope.sql', import.meta.url)
const visibilityMigrationUrl = new URL('../supabase/migrations/20260923103000_team_admin_training_attendance_visibility.sql', import.meta.url)

const ids = {
  club: '10000000-0000-4000-8000-000000000001',
  team: '20000000-0000-4000-8000-000000000001',
  event: '30000000-0000-4000-8000-000000000001',
  request: '40000000-0000-4000-8000-000000000001',
  coach1: '50000000-0000-4000-8000-000000000001',
  coach2: '50000000-0000-4000-8000-000000000002',
}

async function createMigrationDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.clubs (id uuid primary key);
    create table public.users (
      id uuid primary key, club_id uuid not null references public.clubs(id),
      email text, username text, name text, role text, status text
    );
    create table public.teams (
      id uuid primary key, club_id uuid not null references public.clubs(id)
    );
    create table public.calendar_events (
      id uuid primary key, club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id), event_type text not null,
      cancelled_at timestamptz
    );
    create table public.team_staff (
      id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id),
      user_id uuid not null references public.users(id), role_key text not null, role_rank integer not null,
      unique(team_id, user_id)
    );
    create table public.training_availability_requests (
      id uuid primary key, club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      calendar_event_id uuid not null references public.calendar_events(id),
      occurrence_date date not null, occurrence_starts_at timestamptz not null,
      status text not null default 'open'
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(), club_id uuid, actor_id uuid,
      action text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz
    );
    create function public.training_availability_user_can_view(uuid, uuid)
    returns boolean language sql stable as $$ select true $$;
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(await readFile(scopeMigrationUrl, 'utf8'))
  await db.exec(await readFile(visibilityMigrationUrl, 'utf8'))
  return db
}

test('Coach Training attendance uses scoped read access and own-response RPC authority', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(migration, /create table public\.training_coach_attendance/i)
  assert.match(migration, /unique \(request_id, coach_user_id\)/i)
  assert.match(migration, /alter table public\.training_coach_attendance force row level security/i)
  assert.match(migration, /revoke all on public\.training_coach_attendance from public, anon, authenticated/i)
  assert.match(migration, /using \(public\.training_availability_user_can_view\(club_id, team_id\)\)/i)
  assert.match(migration, /attendance\.coach_user_id = actor_id/i)
  assert.match(migration, /join public\.team_staff assignment/i)
  assert.match(migration, /coalesce\(assignment\.role_rank, 0\) >= 20/i)
  assert.match(migration, /revoke all on function public\.submit_own_training_coach_attendance\(uuid, text\)/i)
  assert.match(migration, /grant execute on function public\.submit_own_training_coach_attendance\(uuid, text\)\s+to authenticated/i)
})

test('Coach invitations are generated for active assigned Team Coaches and claimed once', async () => {
  const [migration, scopeMigration] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(scopeMigrationUrl, 'utf8'),
  ])
  assert.match(migration, /from public\.team_staff assignment[\s\S]*join public\.users app_user/i)
  assert.match(migration, /app_user\.role in \('assistant_coach', 'coach', 'manager', 'head_manager', 'admin'\)/i)
  assert.match(migration, /create trigger sync_training_coach_attendance_after_staff_change/i)
  assert.match(scopeMigration, /notification_eligible boolean not null default false/i)
  assert.match(scopeMigration, /sync_training_coach_attendance\(new\.id, true\)/i)
  assert.match(scopeMigration, /sync_training_coach_attendance\(pending_request\.id, false\)/i)
  assert.match(scopeMigration, /where attendance\.notification_eligible[\s\S]*for update skip locked/i)
  assert.match(scopeMigration, /notification_claimed_by = worker_id_value/i)
  assert.match(scopeMigration, /notification_attempts < 5/i)
  assert.match(scopeMigration, /grant execute on function public\.claim_training_coach_attendance_notifications\(uuid, integer, integer\)\s+to service_role/i)
})

test('Coach attendance migration executes and adds invitations for existing and newly assigned Coaches', async () => {
  const db = await createMigrationDb()
  await db.exec(`
    insert into public.clubs(id) values ('${ids.club}');
    insert into public.teams(id, club_id) values ('${ids.team}', '${ids.club}');
    insert into public.calendar_events(id, club_id, team_id, event_type)
    values ('${ids.event}', '${ids.club}', '${ids.team}', 'training');
    insert into public.users(id, club_id, email, name, role, status) values
      ('${ids.coach1}', '${ids.club}', 'coach1@example.test', 'Dave Miller', 'coach', 'active'),
      ('${ids.coach2}', '${ids.club}', 'coach2@example.test', 'Emily Carter', 'assistant_coach', 'active');
    insert into public.team_staff(team_id, user_id, role_key, role_rank)
    values ('${ids.team}', '${ids.coach1}', 'coach', 30);
    insert into public.training_availability_requests(
      id, club_id, team_id, calendar_event_id, occurrence_date, occurrence_starts_at
    ) values (
      '${ids.request}', '${ids.club}', '${ids.team}', '${ids.event}', current_date + 1, now() + interval '1 day'
    );
  `)
  let rows = await db.query('select id, coach_user_id, status, notification_eligible, notification_status from public.training_coach_attendance order by coach_user_id')
  assert.equal(rows.rows.length, 1)
  assert.equal(rows.rows[0].coach_user_id, ids.coach1)
  assert.equal(rows.rows[0].status, 'pending')
  assert.equal(rows.rows[0].notification_eligible, true)
  assert.equal(rows.rows[0].notification_status, 'pending')

  await db.exec(`
    insert into public.team_staff(team_id, user_id, role_key, role_rank)
    values ('${ids.team}', '${ids.coach2}', 'assistant_coach', 20)
  `)
  rows = await db.query('select id, coach_user_id, status, notification_eligible, notification_status from public.training_coach_attendance order by coach_user_id')
  assert.deepEqual(rows.rows.map(({ coach_user_id, notification_eligible, notification_status, status }) => ({ coach_user_id, notification_eligible, notification_status, status })), [
    { coach_user_id: ids.coach1, notification_eligible: true, notification_status: 'pending', status: 'pending' },
    { coach_user_id: ids.coach2, notification_eligible: false, notification_status: 'skipped', status: 'pending' },
  ])

  const claims = await db.query(`select coach_user_id from public.claim_training_coach_attendance_notifications(gen_random_uuid(), 25, 90)`)
  assert.deepEqual(claims.rows, [{ coach_user_id: ids.coach1 }])

  await db.exec(`select set_config('request.jwt.claim.sub', '${ids.coach1}', false)`)
  const result = await db.query(`select public.submit_own_training_coach_attendance('${rows.rows[0].id}'::uuid, 'available')`)
  assert.equal(result.rows.length, 1)
  await db.close()
})

test('Team Admin can hide from upcoming Training attendance and restore visibility without deleting history', async () => {
  const migration = await readFile(visibilityMigrationUrl, 'utf8')
  assert.match(migration, /show_in_training_attendance boolean not null default true/i)
  assert.match(migration, /is_visible boolean not null default true/i)
  assert.match(migration, /assignment\.role_key = 'head_manager'/i)
  assert.match(migration, /coalesce\(assignment\.role_rank, 0\) >= 70/i)
  assert.match(migration, /attendance\.occurrence_starts_at > changed_at/i)
  assert.match(migration, /is_visible[\s\S]*training_availability_user_can_view/i)

  const db = await createMigrationDb()
  await db.exec(`
    insert into public.clubs(id) values ('${ids.club}');
    insert into public.teams(id, club_id) values ('${ids.team}', '${ids.club}');
    insert into public.calendar_events(id, club_id, team_id, event_type)
    values ('${ids.event}', '${ids.club}', '${ids.team}', 'training');
    insert into public.users(id, club_id, email, name, role, status)
    values ('${ids.coach1}', '${ids.club}', 'admin@example.test', 'Team Admin', 'head_manager', 'active');
    insert into public.team_staff(team_id, user_id, role_key, role_rank)
    values ('${ids.team}', '${ids.coach1}', 'head_manager', 70);
    insert into public.training_availability_requests(
      id, club_id, team_id, calendar_event_id, occurrence_date, occurrence_starts_at
    ) values (
      '${ids.request}', '${ids.club}', '${ids.team}', '${ids.event}', current_date + 1, now() + interval '1 day'
    );
    select set_config('request.jwt.claim.sub', '${ids.coach1}', false);
  `)

  let setting = await db.query(`select public.get_own_training_attendance_visibility('${ids.team}'::uuid) as visible`)
  assert.equal(setting.rows[0].visible, true)

  await db.query(`select public.set_own_training_attendance_visibility('${ids.team}'::uuid, false)`)
  let rows = await db.query('select is_visible, notification_eligible, notification_status, status from public.training_coach_attendance')
  assert.deepEqual(rows.rows, [{ is_visible: false, notification_eligible: false, notification_status: 'skipped', status: 'pending' }])
  let claims = await db.query('select coach_user_id from public.claim_training_coach_attendance_notifications(gen_random_uuid(), 25, 90)')
  assert.deepEqual(claims.rows, [])

  await db.query(`select public.set_own_training_attendance_visibility('${ids.team}'::uuid, true)`)
  setting = await db.query(`select public.get_own_training_attendance_visibility('${ids.team}'::uuid) as visible`)
  rows = await db.query('select is_visible, status from public.training_coach_attendance')
  assert.equal(setting.rows[0].visible, true)
  assert.deepEqual(rows.rows, [{ is_visible: true, status: 'pending' }])
  await db.close()
})

test('scheduled processor sends and completes one claimed Coach invitation', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
  const { processTrainingCoachAttendance } = await import('../netlify/functions/process-training-coach-attendance.js')
  const attendance = {
    id: 'attendance-1', calendar_event_id: 'event-1', club_id: 'club-1', team_id: 'team-1',
    coach_user_id: 'coach-1', occurrence_date: '2099-09-24',
  }
  const rpcCalls = []
  const client = {
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      if (name === 'claim_training_coach_attendance_notifications') return { data: [attendance], error: null }
      if (name === 'complete_training_coach_attendance_notification') return { data: true, error: null }
      throw new Error(`Unexpected RPC ${name}`)
    },
    from(table) {
      assert.equal(table, 'calendar_events')
      const query = { select() { return query }, eq() { return query }, is() { return query }, async maybeSingle() { return { data: { id: 'event-1', title: 'Thursday Training' }, error: null } } }
      return query
    },
  }
  const deliveries = []
  const summary = await processTrainingCoachAttendance({
    client,
    sendInvitation: async value => { deliveries.push(value); return { failed: 0, sent: 1, skipped: false } },
    workerId: 'worker-1',
  })
  assert.deepEqual(summary, { claimed: 1, failed: 0, sent: 1, skipped: 0 })
  assert.equal(deliveries[0].attendance.coach_user_id, 'coach-1')
  assert.equal(deliveries[0].eventTitle, 'Thursday Training')
  assert.equal(rpcCalls.at(-1).args.outcome_value, 'sent')
})

test('Coach mobile loads the Coach section and only submits the signed-in Coach response', async () => {
  const [data, table, screen, push, app, web, visibility] = await Promise.all([
    readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachMatchInviteTable.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/send-coach-mobile-push.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/UserSettingsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/training-attendance-visibility.js', import.meta.url), 'utf8'),
  ])
  assert.match(data, /from\('training_coach_attendance'\)/)
  assert.match(data, /attendance\.coachUserId !== user\?\.id/)
  assert.match(data, /submit_own_training_coach_attendance/)
  assert.match(table, /Coaches \(\{attendance\.length\}\)/)
  assert.match(table, /Players \(\{invites\.length\}\)/)
  assert.match(table, /Only this Coach can change their response/)
  assert.match(screen, /submitOwnTrainingCoachAttendance/)
  assert.match(push, /sendCoachTrainingAttendanceInvitationPush/)
  assert.match(push, /training_coach_attendance_invite/)
  assert.match(push, /eligibleDevices\.filter\(\(device\) => device\.auth_user_id === attendance\.coach_user_id\)/)
  assert.match(app, /Show me in Training attendance/)
  assert.match(web, /Show me in Training attendance/)
  assert.match(visibility, /normalizeText\(user\.role\) === 'head_manager'/)
  assert.match(visibility, /Number\(user\.roleRank \?\? 0\) >= 70/)
  assert.match(visibility, /set_own_training_attendance_visibility/)
})
