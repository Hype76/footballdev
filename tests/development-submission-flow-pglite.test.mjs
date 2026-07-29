import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const ids = {
  actor: '22222222-2222-4222-8222-222222222222',
  club: '11111111-1111-4111-8111-111111111111',
  evaluation: '55555555-5555-4555-8555-555555555555',
  player: '44444444-4444-4444-8444-444444444444',
  team: '33333333-3333-4333-8333-333333333333',
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.clubs (id uuid primary key);
    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id)
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid references public.teams(id)
    );
    create table public.evaluations (
      id uuid primary key,
      club_id uuid not null references public.clubs(id)
    );
    create table public.communication_logs (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      player_id uuid references public.players(id),
      evaluation_id uuid references public.evaluations(id),
      user_id uuid,
      channel text not null,
      action text not null,
      metadata jsonb not null default '{}'::jsonb
    );
  `)
  const migration = await readFile(
    new URL('../supabase/migrations/20260729220000_development_submission_confirmation.sql', import.meta.url),
    'utf8',
  )
  await db.exec(migration)
  await db.query('insert into auth.users (id) values ($1)', [ids.actor])
  await db.query('insert into public.clubs (id) values ($1)', [ids.club])
  await db.query(
    'insert into public.teams (id, club_id) values ($1, $2)',
    [ids.team, ids.club],
  )
  await db.query(
    'insert into public.players (id, club_id, team_id) values ($1, $2, $3)',
    [ids.player, ids.club, ids.team],
  )
  await db.query(
    'insert into public.evaluations (id, club_id) values ($1, $2)',
    [ids.evaluation, ids.club],
  )
  return db
}

test('append-only submission migration parses and stores one canonical confirmation operation', async () => {
  const db = await createDatabase()

  try {
    await db.query(
      `
        insert into public.development_submission_operations (
          operation_id,
          evaluation_id,
          club_id,
          team_id,
          player_id,
          actor_id,
          send_mode,
          attach_pdf,
          include_attendance,
          selected_parent_link_ids,
          selected_response_count,
          reminder_date,
          confirmation_hash
        ) values ($1, $1, $2, $3, $4, $5, 'now', true, true, '[]'::jsonb, 9, '2026-08-29', 'hash-one')
        on conflict (operation_id) do update set
          confirmation_hash = excluded.confirmation_hash,
          confirmed_at = now()
      `,
      [ids.evaluation, ids.club, ids.team, ids.player, ids.actor],
    )
    await db.query(
      `
        insert into public.development_submission_operations (
          operation_id,
          evaluation_id,
          club_id,
          team_id,
          player_id,
          actor_id,
          send_mode,
          confirmation_hash
        ) values ($1, $1, $2, $3, $4, $5, 'now', 'hash-two')
        on conflict (operation_id) do update set
          confirmation_hash = excluded.confirmation_hash,
          confirmed_at = now()
      `,
      [ids.evaluation, ids.club, ids.team, ids.player, ids.actor],
    )
    const result = await db.query(`
      select count(*)::integer as count, max(confirmation_hash) as confirmation_hash
      from public.development_submission_operations
    `)

    assert.equal(result.rows[0].count, 1)
    assert.equal(result.rows[0].confirmation_hash, 'hash-two')
  } finally {
    await db.close()
  }
})

test('reminder and Development output unique indexes reject duplicate side effects', async () => {
  const db = await createDatabase()

  try {
    const baseColumns = `
      id, club_id, player_id, evaluation_id, user_id, channel, action, metadata
    `
    await db.query(
      `
        insert into public.communication_logs (${baseColumns})
        values (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          $1,
          $2,
          $3,
          $4,
          'reminder',
          'next_assessment_reminder_set',
          '{"dueDate":"2026-08-29"}'::jsonb
        )
      `,
      [ids.club, ids.player, ids.evaluation, ids.actor],
    )
    await assert.rejects(
      db.query(
        `
          insert into public.communication_logs (${baseColumns})
          values (
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            $1,
            $2,
            $3,
            $4,
            'reminder',
            'next_assessment_reminder_set',
            '{"dueDate":"2026-08-29"}'::jsonb
          )
        `,
        [ids.club, ids.player, ids.evaluation, ids.actor],
      ),
      /duplicate key|unique constraint/i,
    )

    await db.query(
      `
        insert into public.communication_logs (${baseColumns})
        values (
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          $1,
          $2,
          $3,
          $4,
          'email',
          'parent_email_sent',
          '{"developmentOutputKey":"output-key"}'::jsonb
        )
      `,
      [ids.club, ids.player, ids.evaluation, ids.actor],
    )
    await assert.rejects(
      db.query(
        `
          insert into public.communication_logs (${baseColumns})
          values (
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            $1,
            $2,
            $3,
            $4,
            'email',
            'parent_email_sent',
            '{"developmentOutputKey":"output-key"}'::jsonb
          )
        `,
        [ids.club, ids.player, ids.evaluation, ids.actor],
      ),
      /duplicate key|unique constraint/i,
    )
    await db.query(
      `
        insert into public.communication_logs (${baseColumns})
        values (
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          $1,
          $2,
          $3,
          $4,
          'email',
          'parent_email_scheduled',
          '{"developmentOutputKey":"output-key"}'::jsonb
        )
      `,
      [ids.club, ids.player, ids.evaluation, ids.actor],
    )
    const counts = await db.query(`
      select
        count(*) filter (where channel = 'reminder')::integer as reminders,
        count(*) filter (where channel = 'email')::integer as email_logs
      from public.communication_logs
    `)

    assert.deepEqual(counts.rows[0], {
      reminders: 1,
      email_logs: 2,
    })
  } finally {
    await db.close()
  }
})
