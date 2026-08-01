import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260801084342_event_player_notification_updated_at_repair_18.sql',
  import.meta.url,
)
const migration = await readFile(migrationUrl, 'utf8')

test('Ref 18 adds a durable updated_at lifecycle to the event-player delivery ledger', async () => {
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;

    create table public.event_player_notification_events (
      id uuid primary key default gen_random_uuid(),
      status text not null default 'queued',
      requested_at timestamptz not null default timezone('utc', now()),
      last_error text
    );
  `)

  await db.exec(migration)

  const inserted = await db.query(`
    insert into public.event_player_notification_events (status)
    values ('queued')
    returning id, updated_at
  `)

  const firstUpdatedAt = inserted.rows[0].updated_at
  assert.ok(firstUpdatedAt instanceof Date)

  await new Promise((resolve) => setTimeout(resolve, 5))

  const transitioned = await db.query(`
    update public.event_player_notification_events
    set status = 'failed', last_error = 'synthetic processor failure'
    where id = $1
    returning status, last_error, updated_at
  `, [inserted.rows[0].id])

  assert.equal(transitioned.rows[0].status, 'failed')
  assert.equal(transitioned.rows[0].last_error, 'synthetic processor failure')
  assert.ok(transitioned.rows[0].updated_at > firstUpdatedAt)

  const functionSecurity = await db.query(`
    select prosecdef
    from pg_proc
    where oid = 'public.set_event_player_notification_events_updated_at()'::regprocedure
  `)
  assert.equal(functionSecurity.rows[0].prosecdef, false)

  const trigger = await db.query(`
    select count(*)::integer as count
    from pg_trigger
    where tgrelid = 'public.event_player_notification_events'::regclass
      and tgname = 'event_player_notification_events_set_updated_at'
      and not tgisinternal
  `)
  assert.equal(trigger.rows[0].count, 1)

  await db.close()
})

test('Ref 18 preserves the processor update contract and least-privilege migration shape', () => {
  assert.match(migration, /add column if not exists updated_at timestamptz not null default timezone\('utc', now\(\)\)/i)
  assert.match(migration, /security invoker/i)
  assert.match(migration, /set search_path = ''/i)
  assert.match(migration, /revoke all on function public\.set_event_player_notification_events_updated_at\(\)[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /before update on public\.event_player_notification_events/i)
})
