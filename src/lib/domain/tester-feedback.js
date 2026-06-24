import { supabase } from '../supabase-client.js'

export const TESTER_FEEDBACK_TYPES = [
  { label: 'Bug', value: 'bug' },
  { label: 'Suggestion', value: 'suggestion' },
  { label: 'Confusion', value: 'confusion' },
  { label: 'Missing feature', value: 'missing_feature' },
  { label: 'Praise', value: 'praise' },
  { label: 'Other', value: 'other' },
]

export const TESTER_FEEDBACK_SEVERITIES = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
]

export const TESTER_FEEDBACK_MODULES = [
  'Shell/auth/workspace',
  'Club setup',
  'Teams/staff',
  'Players',
  'Form builder',
  'Assessments',
  'Parent invites',
  'Parent portal',
  'Email/messages',
  'Polls/availability',
  'Match day',
  'Billing',
  'Platform admin',
  'Mobile coach app',
  'Mobile parent app',
  'Other',
]

export async function createTesterFeedbackReport({ report, user }) {
  const payload = {
    submitted_by_user_id: user?.id || null,
    submitted_by_email: user?.email || report.submittedByEmail || '',
    submitted_by_name: user?.displayName || user?.name || report.submittedByName || '',
    role: user?.role || '',
    club_id: user?.clubId || null,
    team_id: user?.activeTeamId || null,
    module: report.module || '',
    phase: report.phase || 'phase_1',
    route: report.route || '',
    page_title: report.pageTitle || null,
    feedback_type: report.feedbackType || 'bug',
    severity: report.severity || 'medium',
    title: report.title || '',
    summary: report.summary || '',
    reproduction_steps: report.reproductionSteps || '',
    expected_result: report.expectedResult || '',
    actual_result: report.actualResult || '',
    browser_device: report.browserDevice || '',
    screenshot_url: report.screenshotUrl || null,
    log_reference: report.logReference || null,
  }

  const { data, error } = await supabase
    .from('tester_feedback_reports')
    .insert(payload)
    .select('id, created_at')
    .single()

  if (error) {
    throw error
  }

  return data
}
