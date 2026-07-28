import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const inviteSource = await readFile(
  new URL('../src/lib/domain/calendar-event-invites.js', import.meta.url),
  'utf8',
)
const syncMigration = await readFile(
  new URL(
    '../supabase/migrations/20260728070451_calendar_invite_transactional_sync.sql',
    import.meta.url,
  ),
  'utf8',
)

test('calendar invite saves use one transactional sync with the complete live source identity', () => {
  assert.match(inviteSource, /\.rpc\('sync_calendar_event_invites'/)
  assert.doesNotMatch(inviteSource, /\.from\('calendar_event_invites'\)[\s\S]*\.upsert\(/)
  assert.match(syncMigration, /security invoker/)
  assert.match(
    syncMigration,
    /on conflict \(\s*club_id,\s*player_id,\s*calendar_event_id,\s*assessment_session_id,\s*match_day_id\s*\)/,
  )
})

test('the stale four-column conflict target fails after Match Day schema drift', async () => {
  const db = new PGlite()

  try {
    await db.exec(`
      create table public.calendar_event_invites (
        id uuid primary key,
        club_id uuid not null,
        team_id uuid not null,
        player_id uuid not null,
        calendar_event_id uuid,
        assessment_session_id uuid,
        match_day_id uuid,
        invite_status text not null
      );

      create unique index calendar_event_invites_source_player_key
      on public.calendar_event_invites (
        club_id,
        player_id,
        calendar_event_id,
        assessment_session_id,
        match_day_id
      ) nulls not distinct;
    `)

    await assert.rejects(
      db.exec(`
        insert into public.calendar_event_invites (
          id,
          club_id,
          team_id,
          player_id,
          calendar_event_id,
          assessment_session_id,
          match_day_id,
          invite_status
        ) values (
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000001',
          '50000000-0000-4000-8000-000000000001',
          null,
          null,
          'active'
        )
        on conflict (
          club_id,
          player_id,
          calendar_event_id,
          assessment_session_id
        ) do update set invite_status = excluded.invite_status;
      `),
      /there is no unique or exclusion constraint matching the ON CONFLICT specification/,
    )
  } finally {
    await db.close()
  }
})

test('the complete conflict target makes repeated and rapid saves idempotent', async () => {
  const db = new PGlite()

  try {
    await db.exec(`
      create table public.calendar_event_invites (
        id uuid primary key,
        club_id uuid not null,
        team_id uuid not null,
        player_id uuid not null,
        calendar_event_id uuid,
        assessment_session_id uuid,
        match_day_id uuid,
        invite_status text not null,
        notify_requested boolean not null default false
      );

      create unique index calendar_event_invites_source_player_key
      on public.calendar_event_invites (
        club_id,
        player_id,
        calendar_event_id,
        assessment_session_id,
        match_day_id
      ) nulls not distinct;
    `)

    const save = (notifyRequested) => db.exec(`
      insert into public.calendar_event_invites (
        id,
        club_id,
        team_id,
        player_id,
        calendar_event_id,
        assessment_session_id,
        match_day_id,
        invite_status,
        notify_requested
      ) values (
        gen_random_uuid(),
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000001',
        null,
        null,
        'active',
        ${notifyRequested}
      )
      on conflict (
        club_id,
        player_id,
        calendar_event_id,
        assessment_session_id,
        match_day_id
      ) do update set
        invite_status = excluded.invite_status,
        notify_requested = excluded.notify_requested;
    `)

    await save(false)
    await Promise.all([save(true), save(true)])

    const result = await db.query(`
      select count(*)::integer as row_count, bool_and(notify_requested) as notify_requested
      from public.calendar_event_invites;
    `)

    assert.deepEqual(result.rows, [{ row_count: 1, notify_requested: true }])
  } finally {
    await db.close()
  }
})

async function createTransactionalSyncDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select '10000000-0000-4000-8000-000000000001'::uuid;
    $$;

    create table public.users (
      id uuid primary key,
      club_id uuid,
      name text,
      email text
    );
    create table public.teams (
      id uuid primary key,
      club_id uuid not null
    );
    create table public.team_staff (
      team_id uuid not null,
      user_id uuid not null
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null
    );
    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      status text not null
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null
    );
    create table public.assessment_sessions (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null
    );
    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid,
      assessment_session_id uuid,
      player_id uuid not null,
      parent_link_id uuid,
      player_status_at_invite text not null default '',
      recipient_type text not null default 'parent_guardian',
      parent_contact_name text not null default '',
      parent_contact_email text not null default '',
      player_contact_email text not null default '',
      recipient_contacts jsonb not null default '[]'::jsonb,
      invite_status text not null default 'active',
      notify_requested boolean not null default false,
      invited_at timestamptz not null default timezone('utc', now()),
      cancelled_at timestamptz,
      responded_at timestamptz,
      created_by uuid,
      created_by_name text not null default '',
      created_by_email text not null default '',
      updated_by uuid,
      updated_by_name text not null default '',
      updated_by_email text not null default '',
      created_at timestamptz not null default timezone('utc', now()),
      updated_at timestamptz not null default timezone('utc', now()),
      match_day_id uuid,
      response_requirement text not null default 'response_required'
    );

    create unique index calendar_event_invites_source_player_key
    on public.calendar_event_invites (
      club_id,
      player_id,
      calendar_event_id,
      assessment_session_id,
      match_day_id
    ) nulls not distinct;

    create function public.current_user_club_id()
    returns uuid
    language sql
    stable
    as $$
      select '20000000-0000-4000-8000-000000000001'::uuid;
    $$;

    create function public.current_user_role_rank()
    returns integer
    language sql
    stable
    as $$
      select 50;
    $$;

    insert into public.users values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'FP TEST Manager',
      'manager@example.test'
    );
    insert into public.teams values
      (
        '30000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001'
      ),
      (
        '30000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002'
      );
    insert into public.calendar_events values (
      '40000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001'
    );
    insert into public.players values
      (
        '50000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001'
      ),
      (
        '50000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001'
      ),
      (
        '50000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000002'
      );
    insert into public.calendar_event_invites (
      club_id,
      team_id,
      calendar_event_id,
      player_id
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001'
    );
  `)
  await db.exec(syncMigration)

  return db
}

function syncCalendarInvites(db, inviteRows, overrides = {}) {
  return db.query(
    `
      select *
      from public.sync_calendar_event_invites(
        team_id_value => $1,
        calendar_event_id_value => $2,
        assessment_session_id_value => $3,
        invite_rows_value => $4::jsonb
      );
    `,
    [
      overrides.teamId ?? '30000000-0000-4000-8000-000000000001',
      overrides.calendarEventId ?? '40000000-0000-4000-8000-000000000001',
      overrides.assessmentSessionId ?? null,
      JSON.stringify(inviteRows),
    ],
  )
}

test('transactional sync rolls back removals after a controlled related-write failure', async () => {
  const db = await createTransactionalSyncDatabase()

  try {
    await db.exec(`
      create function public.fail_selected_invite()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.player_id = '50000000-0000-4000-8000-000000000002'::uuid then
          raise exception 'controlled related-write failure';
        end if;
        return new;
      end;
      $$;

      create trigger calendar_invite_controlled_failure
      before insert on public.calendar_event_invites
      for each row execute function public.fail_selected_invite();
    `)

    await assert.rejects(
      syncCalendarInvites(db, [
        {
          player_id: '50000000-0000-4000-8000-000000000002',
          parent_contact_email: 'internal@example.test',
          notify_requested: false,
        },
      ]),
      /controlled related-write failure/,
    )

    const result = await db.query(`
      select player_id, invite_status, cancelled_at
      from public.calendar_event_invites
      order by player_id;
    `)

    assert.deepEqual(result.rows, [
      {
        player_id: '50000000-0000-4000-8000-000000000001',
        invite_status: 'active',
        cancelled_at: null,
      },
    ])
  } finally {
    await db.close()
  }
})

test('transactional sync is retry-safe, duplicate-free, and rejects cross-tenant input', async () => {
  const db = await createTransactionalSyncDatabase()
  const selectedRows = [
    {
      player_id: '50000000-0000-4000-8000-000000000002',
      parent_contact_email: 'internal@example.test',
      notify_requested: true,
    },
  ]

  try {
    await syncCalendarInvites(db, selectedRows)
    await syncCalendarInvites(db, selectedRows)

    const result = await db.query(`
      select player_id, invite_status, notify_requested
      from public.calendar_event_invites
      order by player_id;
    `)

    assert.deepEqual(result.rows, [
      {
        player_id: '50000000-0000-4000-8000-000000000001',
        invite_status: 'cancelled',
        notify_requested: false,
      },
      {
        player_id: '50000000-0000-4000-8000-000000000002',
        invite_status: 'active',
        notify_requested: true,
      },
    ])

    await assert.rejects(
      syncCalendarInvites(
        db,
        [{
          player_id: '50000000-0000-4000-8000-000000000003',
          notify_requested: false,
        }],
        {
          teamId: '30000000-0000-4000-8000-000000000002',
        },
      ),
      /selected team is outside the active club/,
    )

    await assert.rejects(
      syncCalendarInvites(db, [{
        player_id: '50000000-0000-4000-8000-000000000003',
        notify_requested: false,
      }]),
      /selected players are outside the active club or team/,
    )
  } finally {
    await db.close()
  }
})
