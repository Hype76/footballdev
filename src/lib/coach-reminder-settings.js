import { buildTeamCoachReminderConfiguration, DEFAULT_COACH_REMINDER_POLICY, normalizeCoachReminderPolicy } from './coach-reminder-policy.js'

export function normalizeTeamCoachReminderPolicy(row, { clubId, teamId }) {
  if (!row) return { id: '', clubId, teamId, revision: 0, options: { ...DEFAULT_COACH_REMINDER_POLICY },
    optedIn: false, configuredAt: null, effectiveFrom: null, updatedAt: null, updatedBy: null }
  if (row.club_id !== clubId || row.team_id !== teamId) throw new Error('Reminder settings belong to a different team.')
  const revision = Number(row.revision)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Reminder settings have an invalid version.')
  return { id: row.id, clubId, teamId, revision, options: normalizeCoachReminderPolicy(row.options),
    optedIn: row.opted_in === true, configuredAt: row.configured_at, effectiveFrom: row.effective_from,
    updatedAt: row.updated_at, updatedBy: row.updated_by }
}

export function buildTeamCoachReminderSave({ policy, options, optedIn, requestId }) {
  if (!policy?.teamId || !policy.clubId || !Number.isSafeInteger(policy.revision) || policy.revision < 0) throw new Error('Reload the team reminder settings before saving.')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) throw new Error('A reminder save request ID is required.')
  return { action: 'save', teamId: policy.teamId, expectedRevision: policy.revision, requestId,
    ...buildTeamCoachReminderConfiguration({ options, optedIn }) }
}

export async function requestTeamCoachReminderPolicy({ accessToken, payload, apiBaseUrl = '', fetchImpl = globalThis.fetch }) {
  if (!accessToken) throw new Error('Sign in again before changing team reminders.')
  const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/.netlify/functions/team-coach-reminder-policy`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.success !== true) throw Object.assign(new Error(result.message || 'Team reminder settings could not be loaded.'), { statusCode: response.status })
  return result
}
