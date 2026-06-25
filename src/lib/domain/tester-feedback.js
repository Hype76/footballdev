import { supabase } from '../supabase-client.js'

export const TESTER_FEEDBACK_SAVE_ERROR_MESSAGE = 'Feedback could not be saved. Please try again or contact support.'

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
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''

  if (sessionError || !accessToken) {
    throw new Error('Sign in before sending feedback.')
  }

  const response = await fetch('/.netlify/functions/submit-tester-feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      report,
      context: {
        activeTeamId: user?.activeTeamId || '',
      },
    }),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || TESTER_FEEDBACK_SAVE_ERROR_MESSAGE)
  }

  return payload.report
}
