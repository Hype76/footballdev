import { createSupabaseAdminClient } from './lib/_supabase.js'
import { authorizeNativeScheduledRequest } from './lib/_processor-auth.js'

const WINDOW_MINUTES = 15
const THRESHOLDS = Object.freeze({
  critical: 1,
  errors: 5,
  denied: 20,
  authorityFailures: 5,
  authenticationFailures: 10,
})

export const config = {
  schedule: '*/15 * * * *',
}

function boundedCount(value) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

export function evaluateSecurityAuditThresholds(summary = {}, thresholds = THRESHOLDS) {
  const counts = {
    total: boundedCount(summary.total),
    critical: boundedCount(summary.critical),
    errors: boundedCount(summary.errors),
    denied: boundedCount(summary.denied),
    failures: boundedCount(summary.failures),
    authorityFailures: boundedCount(summary.authorityFailures),
    authenticationFailures: boundedCount(summary.authenticationFailures),
  }

  const exceeded = Object.entries(thresholds)
    .filter(([name, limit]) => counts[name] >= limit)
    .map(([name]) => name)

  return {
    event: 'security_audit_monitor_summary',
    windowMinutes: WINDOW_MINUTES,
    status: exceeded.length > 0 ? 'alert' : 'ok',
    exceeded,
    counts,
    latestEventAt: summary.latestEventAt || null,
  }
}

export async function runSecurityAuditMonitor({ client = createSupabaseAdminClient() } = {}) {
  const { data, error } = await client.rpc('security_audit_monitor_summary', {
    p_window_minutes: WINDOW_MINUTES,
  })

  if (error) {
    throw new Error('Security audit summary unavailable', { cause: error })
  }

  const result = evaluateSecurityAuditThresholds(data)
  const safeLog = JSON.stringify(result)

  if (result.status === 'alert') {
    console.warn(safeLog)
  } else {
    console.info(safeLog)
  }

  return result
}

export default async function handler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const result = await runSecurityAuditMonitor()
    return Response.json({ success: true, ...result }, { status: 200 })
  } catch {
    console.error(JSON.stringify({ event: 'security_audit_monitor_failure', status: 'error' }))
    return Response.json({ success: false, message: 'Monitor unavailable.' }, { status: 500 })
  }
}
