import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260904145951_calendar_pitch_type_and_volunteer_invite_transition.sql', import.meta.url),
  'utf8',
)

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create table public.calendar_events (id uuid primary key);
    create table public.match_days (id uuid primary key);
  `)
  await db.exec(migration)
  return db
}

test('migration stores the dropdown pitch types on calendar events and Match Day fixtures', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`
      insert into public.calendar_events (id, pitch_type)
      values ('10000000-0000-4000-8000-000000000001', 'grass');
      insert into public.match_days (id, pitch_type)
      values ('20000000-0000-4000-8000-000000000001', 'indoor');
      insert into public.match_days (id)
      values ('20000000-0000-4000-8000-000000000002');
    `)

    const calendar = await db.query('select pitch_type from public.calendar_events')
    const matches = await db.query('select pitch_type from public.match_days order by id')

    assert.deepEqual(calendar.rows, [{ pitch_type: 'grass' }])
    assert.deepEqual(matches.rows, [{ pitch_type: 'indoor' }, { pitch_type: '' }])
  } finally {
    await db.close()
  }
})

test('migration rejects values outside the requested dropdown and can be rerun safely', async () => {
  const db = await createDatabase()
  try {
    await assert.rejects(
      db.exec("insert into public.calendar_events (id, pitch_type) values ('10000000-0000-4000-8000-000000000002', 'sand')"),
      /calendar_events_pitch_type_check/i,
    )
    await db.exec(migration)
    await db.exec("insert into public.match_days (id, pitch_type) values ('20000000-0000-4000-8000-000000000003', 'other')")
    const result = await db.query("select pitch_type from public.match_days where id = '20000000-0000-4000-8000-000000000003'")
    assert.deepEqual(result.rows, [{ pitch_type: 'other' }])
  } finally {
    await db.close()
  }
})
