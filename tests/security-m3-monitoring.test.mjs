import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-service-role-key-for-tests'

const monitorModule = await import('../netlify/functions/security-audit-monitor.js')
const migration = await readFile(
  new URL('../supabase/migrations/20260721211500_m3_security_monitoring_assurance.sql', import.meta.url),
  'utf8',
)
const auditDomain = await readFile(new URL('../src/lib/domain/audit.js', import.meta.url), 'utf8')
const retentionFunction = await readFile(new URL('../netlify/functions/cleanup-expired-retention.js', import.meta.url), 'utf8')

test('security audit metadata is server derived, classified and redacted', () => {
  assert.match(migration, /create or replace function public\.record_security_audit_event/i)
  assert.match(migration, /where users\.id = auth\.uid\(\)/i)
  assert.match(migration, /app_private\.redact_security_audit_metadata/i)
  assert.match(migration, /authorization\|cookie\|credential\|email\|password\|phone\|recipient\|secret\|session\|token\|address/i)
  assert.match(migration, /revoke insert, update, delete, truncate on table public\.audit_logs from authenticated/i)
  assert.match(auditDomain, /\.rpc\('record_security_audit_event'/)
  assert.doesNotMatch(auditDomain, /from\('audit_logs'\)\.insert/)
})

test('read-only monitor thresholds are deterministic and bounded', () => {
  const summary = {
    total: 44,
    critical: 1,
    errors: 5,
    denied: 20,
    failures: 3,
    authorityFailures: 5,
    authenticationFailures: 10,
    latestEventAt: '2026-07-21T20:00:00.000Z',
  }

  const first = monitorModule.evaluateSecurityAuditThresholds(summary)
  const second = monitorModule.evaluateSecurityAuditThresholds(summary)

  assert.deepEqual(first, second)
  assert.equal(first.status, 'alert')
  assert.deepEqual(first.exceeded, ['critical', 'errors', 'denied', 'authorityFailures', 'authenticationFailures'])
  assert.equal(first.windowMinutes, 15)
})

test('scheduled monitor is authenticated, read only and has no communication path', async () => {
  assert.deepEqual(monitorModule.config, { schedule: '*/15 * * * *' })
  assert.match(migration, /create or replace function public\.security_audit_monitor_summary[\s\S]*language plpgsql[\s\S]*stable/i)
  assert.match(migration, /grant execute on function public\.security_audit_monitor_summary\(integer\) to service_role/i)

  const source = await readFile(new URL('../netlify/functions/security-audit-monitor.js', import.meta.url), 'utf8')
  assert.match(source, /authorizeNativeScheduledRequest\(request\)/)
  assert.doesNotMatch(source, /sendEmail|resend|web-push|scheduled_email_queue|\.insert\(|\.update\(|\.delete\(/i)

  const response = await monitorModule.default(new Request('https://example.test/.netlify/functions/security-audit-monitor'))
  assert.equal(response.status, 404)
})

test('monitor reports only aggregate safe fields and remains idempotent', async () => {
  const calls = []
  const client = {
    async rpc(name, parameters) {
      calls.push({ name, parameters })
      return {
        data: {
          total: 2,
          critical: 0,
          errors: 0,
          denied: 1,
          failures: 0,
          authorityFailures: 0,
          authenticationFailures: 1,
          latestEventAt: null,
        },
        error: null,
      }
    },
  }

  const first = await monitorModule.runSecurityAuditMonitor({ client })
  const second = await monitorModule.runSecurityAuditMonitor({ client })

  assert.deepEqual(first, second)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    name: 'security_audit_monitor_summary',
    parameters: { p_window_minutes: 15 },
  })
  assert.deepEqual(Object.keys(first.counts), [
    'total',
    'critical',
    'errors',
    'denied',
    'failures',
    'authorityFailures',
    'authenticationFailures',
  ])
})

test('retention is bounded, disabled until approved configuration and cannot touch unexpired rows', () => {
  assert.match(migration, /retention_until >= created_at \+ interval '30 days'/i)
  assert.match(migration, /retention_until <= created_at \+ interval '730 days'/i)
  assert.match(migration, /where retention_until <= timezone\('utc', now\(\)\)/i)
  assert.match(migration, /limit bounded_limit[\s\S]*for update skip locked/i)
  assert.match(retentionFunction, /SECURITY_AUDIT_RETENTION_ENABLED/)
  assert.match(retentionFunction, /prune_expired_security_audit_events/)
})

test('migration does not send communications or mutate business tables', () => {
  assert.doesNotMatch(migration, /scheduled_email_queue|communication_logs|send_email|web-push|resend|sms/i)
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.(?:clubs|users|teams|players|match_days|calendar_events)/i)
})
