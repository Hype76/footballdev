import assert from 'node:assert/strict'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { DEFAULT_COACH_REMINDER_POLICY, planAvailabilityAutomation } from '../src/lib/coach-reminder-policy.js'
import { processCoachReminderJob } from '../netlify/functions/lib/_coach-reminder-worker.js'

test('worker commits effect, outbox and completion atomically in PostgreSQL; rollback and replay are safe', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  const context = {
    policy: { id: 'p', revision: '1', clubId: 'club', teamId: 'team', optedIn: true, configuredAt: '2026-10-01T00:00:00Z', effectiveFrom: '2026-10-01T00:00:00Z',
      options: { ...DEFAULT_COACH_REMINDER_POLICY, deadlineMode: 'automatic_not_attending', deadlineAfterHours: 48 } },
    event: { id: 'e', revision: '1', clubId: 'club', teamId: 'team', kind: 'MATCH', status: 'scheduled', startsAt: '2026-10-10T12:00:00Z' },
    invitation: { id: 'i', revision: '1', responseRevision: '1', clubId: 'club', teamId: 'team', eventId: 'e', playerId: 'player',
      createdAt: '2026-10-01T01:00:00Z', deliveredAt: '2026-10-01T02:00:00Z', memberActive: true, parentResponderActive:true, responseStatus: 'pending' },
    recipients: [{ id: 'parent', audience: 'availability', clubId: 'club', teamId: 'team', playerId: 'player', active: true, authorized: true, notificationsEnabled: true }],
    authorityActive: true, now: '2026-10-04T00:00:00Z',
  }
  const job = planAvailabilityAutomation(context)[0]
  // Test-only tables. No application migration or live database is involved.
  await db.exec(`
    create table local_jobs (key text primary key, payload jsonb not null, state text not null);
    create table local_context (payload jsonb not null);
    create table local_effects (job_key text primary key, payload jsonb not null);
    create table local_outbox (key text primary key, payload jsonb not null);
    create table explicit_answers (status text not null);
    insert into explicit_answers values ('pending');
  `)
  await db.query('insert into local_jobs values ($1,$2,\'pending\')', [job.key, JSON.stringify(job)])
  await db.query('insert into local_context values ($1)', [JSON.stringify(context)])
  let interrupt = true
  const repository = { withLockedJob: async (key, run) => db.transaction(async transaction => {
    const { rows } = await transaction.query('select payload,state from local_jobs where key=$1 for update', [key])
    return run({
      getJob: async () => rows[0] ? { ...rows[0].payload, state: rows[0].state } : null,
      loadCurrentContext: async () => (await transaction.query('select payload from local_context')).rows[0].payload,
      insertEffectOnce: async effect => transaction.query('insert into local_effects values ($1,$2) on conflict do nothing', [effect.jobKey, JSON.stringify(effect)]),
      insertNotificationOnce: async notification => {
        if (interrupt) throw new Error('Interruption before outbox commit')
        return transaction.query('insert into local_outbox values ($1,$2) on conflict do nothing', [notification.idempotencyKey, JSON.stringify(notification)])
      },
      finish: async result => transaction.query('update local_jobs set state=$2 where key=$1', [key, result.state]),
    })
  }) }
  const run = () => processCoachReminderJob({ repository, jobKey: job.key, now: context.now })
  await assert.rejects(run(), /Interruption/)
  assert.equal((await db.query('select count(*)::int n from local_effects')).rows[0].n, 0)
  assert.equal((await db.query('select state from local_jobs')).rows[0].state, 'pending')
  interrupt = false
  assert.equal((await run()).state, 'completed')
  assert.equal((await run()).duplicate, true)
  assert.equal((await db.query('select count(*)::int n from local_effects')).rows[0].n, 1)
  assert.equal((await db.query('select count(*)::int n from local_outbox')).rows[0].n, 1)
  assert.equal((await db.query('select status from explicit_answers')).rows[0].status, 'pending')
  assert.equal((await db.query('select payload from local_effects')).rows[0].payload.provenance, 'coach_deadline_automation')
})
