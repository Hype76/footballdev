import { supabase } from '../supabase-client.js'

export const TESTER_FEEDBACK_SAVE_ERROR_MESSAGE = 'Feedback could not be saved. Please try again or contact support.'
export const TESTER_FEEDBACK_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024
export const TESTER_FEEDBACK_SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

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

export function validateTesterFeedbackScreenshot(file) {
  if (!file) {
    return null
  }

  if (!TESTER_FEEDBACK_SCREENSHOT_TYPES.has(file.type)) {
    throw new Error('Upload a PNG, JPG, or WebP screenshot.')
  }

  if (file.size > TESTER_FEEDBACK_SCREENSHOT_MAX_BYTES) {
    throw new Error('Screenshot must be 5 MB or smaller.')
  }

  return file
}

export function formatTesterFeedbackScreenshotSize(bytes) {
  const size = Number(bytes || 0)

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function buildTesterFeedbackRequestBody({ report, screenshotFile, user }) {
  const context = {
    activeTeamId: user?.activeTeamId || '',
  }

  if (!screenshotFile) {
    return {
      body: JSON.stringify({
        context,
        report,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    }
  }

  const body = new FormData()
  body.set('report', JSON.stringify(report))
  body.set('context', JSON.stringify(context))
  body.set('screenshot', screenshotFile, screenshotFile.name || 'screenshot')

  return {
    body,
    headers: {},
  }
}

export async function createTesterFeedbackReport({ report, screenshotFile = null, user }) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''

  if (sessionError || !accessToken) {
    throw new Error('Sign in before sending feedback.')
  }

  const validatedScreenshot = validateTesterFeedbackScreenshot(screenshotFile)
  const requestBody = buildTesterFeedbackRequestBody({
    report,
    screenshotFile: validatedScreenshot,
    user,
  })

  const response = await fetch('/.netlify/functions/submit-tester-feedback', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...requestBody.headers,
    },
    body: requestBody.body,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || TESTER_FEEDBACK_SAVE_ERROR_MESSAGE)
  }

  return payload.report
}
