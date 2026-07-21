import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260721110000_m1_password_recovery_abuse_controls.sql', import.meta.url)
const emailDigest = 'a'.repeat(64)
const ipDigest = 'b'.repeat(64)

test('password recovery limiter is service-role only, bounded, and stores digests', async () => {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')

  await db.exec(`
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
  `)
  await db.exec(migration)

  await db.exec('set role authenticated')
  await assert.rejects(
    db.query('select public.consume_password_recovery_rate_limit($1, $2)', [emailDigest, ipDigest]),
    /permission denied/i,
  )
  await db.exec('reset role')
  await db.exec('set role service_role')

  const results = []
  for (let index = 0; index < 4; index += 1) {
    const result = await db.query(
      'select public.consume_password_recovery_rate_limit($1, $2, 900, 3, 20) as result',
      [emailDigest, ipDigest],
    )
    results.push(result.rows[0].result)
  }

  assert.deepEqual(results.map((result) => result.allowed), [true, true, true, false])
  await db.exec('reset role')
  const stored = await db.query('select email_digest, ip_digest from public.password_recovery_rate_limit_attempts')
  assert.equal(stored.rows.length, 4)
  assert.equal(stored.rows.every((row) => row.email_digest === emailDigest && row.ip_digest === ipDigest), true)
  assert.doesNotMatch(JSON.stringify(stored.rows), /known@example|192\.0\.2\./)

  await db.close()
})
