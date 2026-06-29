import process from 'node:process'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { createSupabaseAdminClient } from './lib/_supabase.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUPPORT_REFERENCE = 'FPO-V1-FEEDBACK-EMAIL-RECIPIENT-06'
const MAX_TEXT_LENGTH = 4000
const FEEDBACK_ATTACHMENT_BUCKET = 'tester-feedback-attachments'
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024
const FEEDBACK_NOTIFICATION_RECIPIENT = 'support@jeluma.com'
const ALLOWED_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const ATTACHMENT_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export const FEEDBACK_SAVE_ERROR_MESSAGE = 'Feedback could not be saved. Please try again or contact support.'
export const FEEDBACK_ATTACHMENT_BUCKET_NAME = FEEDBACK_ATTACHMENT_BUCKET
export const FEEDBACK_ATTACHMENT_MAX_BYTES = MAX_ATTACHMENT_BYTES

const ALLOWED_TYPES = new Set(['bug', 'suggestion', 'confusion', 'missing_feature', 'praise', 'other'])
const ALLOWED_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value, { maxLength = MAX_TEXT_LENGTH } = {}) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function nullableText(value, options) {
  const normalizedValue = normalizeText(value, options)
  return normalizedValue || null
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')

  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function getHeader(event, name) {
  const normalizedName = String(name || '').toLowerCase()
  const headers = event.headers || {}
  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === normalizedName)

  return matchingKey ? String(headers[matchingKey] || '') : ''
}

function parseJsonValue(value, fieldName) {
  try {
    return JSON.parse(value || '{}')
  } catch {
    throw Object.assign(new Error(`${fieldName} must be valid JSON.`), {
      code: 'validation_error',
      statusCode: 400,
    })
  }
}

function validateAttachmentBasics({ fileSize, mimeType }) {
  if (fileSize <= 0) {
    return null
  }

  if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
    throw Object.assign(new Error('Upload a PNG, JPG, or WebP screenshot.'), {
      code: 'invalid_attachment_type',
      statusCode: 400,
    })
  }

  if (fileSize > MAX_ATTACHMENT_BYTES) {
    throw Object.assign(new Error('Screenshot must be 3 MB or smaller.'), {
      code: 'attachment_too_large',
      statusCode: 400,
    })
  }

  return true
}

function hasPngSignature(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
}

function hasJpegSignature(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
}

function hasWebpSignature(buffer) {
  return buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
}

function validateAttachmentContent(buffer, mimeType) {
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw Object.assign(new Error('Screenshot must be 3 MB or smaller.'), {
      code: 'attachment_too_large',
      statusCode: 400,
    })
  }

  const isValid = (mimeType === 'image/png' && hasPngSignature(buffer))
    || (mimeType === 'image/jpeg' && hasJpegSignature(buffer))
    || (mimeType === 'image/webp' && hasWebpSignature(buffer))

  if (!isValid) {
    throw Object.assign(new Error('Screenshot file content did not match the selected image type.'), {
      code: 'invalid_attachment_content',
      statusCode: 400,
    })
  }
}

async function normalizeAttachmentFile(file) {
  if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
    return null
  }

  const fileSize = Number(file.size || 0)
  const mimeType = normalizeText(file.type, { maxLength: 120 }).toLowerCase()
  const originalFilename = normalizeText(file.name, { maxLength: 240 }) || 'screenshot'

  if (!validateAttachmentBasics({ fileSize, mimeType })) {
    return null
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  validateAttachmentContent(buffer, mimeType)

  return {
    buffer,
    fileSize: buffer.byteLength,
    mimeType,
    originalFilename,
  }
}

function normalizeBase64Attachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return null
  }

  const encodedValue = normalizeText(attachment.contentBase64 || attachment.base64 || attachment.data, {
    maxLength: MAX_ATTACHMENT_BYTES * 2,
  })

  if (!encodedValue) {
    return null
  }

  const mimeType = normalizeText(attachment.mimeType || attachment.type, { maxLength: 120 }).toLowerCase()
  const originalFilename = normalizeText(attachment.fileName || attachment.name, { maxLength: 240 }) || 'screenshot'
  const declaredSize = Number(attachment.size || 0)

  validateAttachmentBasics({ fileSize: declaredSize || 1, mimeType })

  const contentBase64 = encodedValue.includes(',')
    ? encodedValue.split(',').pop()
    : encodedValue
  const buffer = Buffer.from(String(contentBase64 || ''), 'base64')

  if (!buffer.byteLength) {
    return null
  }

  if (declaredSize > 0 && declaredSize !== buffer.byteLength) {
    throw Object.assign(new Error('Screenshot file content did not match the uploaded metadata.'), {
      code: 'invalid_attachment_content',
      statusCode: 400,
    })
  }

  validateAttachmentContent(buffer, mimeType)

  return {
    buffer,
    fileSize: buffer.byteLength,
    mimeType,
    originalFilename,
  }
}

function isLikelyBase64Body(value) {
  const text = String(value || '').trim()

  return text.length > 0
    && text.length % 4 === 0
    && /^[A-Za-z0-9+/=\r\n]+$/.test(text)
}

function getMultipartBodyCandidates(event) {
  const body = String(event.body || '')
  const candidates = []
  const seen = new Set()
  const addCandidate = (label, buffer) => {
    const key = `${label}:${buffer.toString('base64')}`

    if (!seen.has(key)) {
      candidates.push({ buffer, label })
      seen.add(key)
    }
  }

  if (event.isBase64Encoded) {
    addCandidate('base64', Buffer.from(body, 'base64'))
    return candidates
  }

  addCandidate('utf8', Buffer.from(body, 'utf8'))
  addCandidate('latin1', Buffer.from(body, 'latin1'))

  if (isLikelyBase64Body(body)) {
    addCandidate('base64-fallback', Buffer.from(body, 'base64'))
  }

  return candidates
}

async function parseMultipartBody(event, contentType) {
  let lastError = null

  for (const candidate of getMultipartBodyCandidates(event)) {
    try {
      const request = new Request('https://footballplayer.online/.netlify/functions/submit-tester-feedback', {
        method: 'POST',
        headers: {
          'content-type': contentType,
        },
        body: candidate.buffer,
      })
      const formData = await request.formData()

      return {
        attachment: await normalizeAttachmentFile(formData.get('screenshot')),
        context: parseJsonValue(formData.get('context') || '{}', 'Context'),
        report: parseJsonValue(formData.get('report') || '{}', 'Report'),
      }
    } catch (error) {
      lastError = error
    }
  }

  if (lastError?.statusCode) {
    throw lastError
  }

  console.error('tester_feedback_multipart_parse_failed', {
    bodyLength: String(event.body || '').length,
    contentType: normalizeText(contentType, { maxLength: 160 }),
    isBase64Encoded: Boolean(event.isBase64Encoded),
    message: normalizeText(lastError?.message, { maxLength: 240 }),
    reference: SUPPORT_REFERENCE,
  })

  throw Object.assign(new Error('Feedback upload could not be read.'), {
    code: 'invalid_multipart_body',
    statusCode: 400,
  })
}

async function parseBody(event) {
  const contentType = getHeader(event, 'content-type').toLowerCase()

  if (contentType.includes('multipart/form-data')) {
    return parseMultipartBody(event, contentType)
  }

  const body = parseJsonValue(event.body || '{}', 'Request body')
  return {
    attachment: normalizeBase64Attachment(body.screenshotAttachment || body.attachment),
    context: body.context || {},
    report: body.report || {},
  }
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? '').trim())
}

function isSchemaOrTableError(error) {
  const code = normalizeText(error?.code).toLowerCase()
  const message = normalizeText(error?.message).toLowerCase()
  const details = normalizeText(error?.details).toLowerCase()

  return code === '42p01'
    || code === 'pgrst205'
    || code === 'pgrst204'
    || message.includes('schema cache')
    || message.includes('tester_feedback_reports')
    || details.includes('tester_feedback_reports')
}

function publicError(error) {
  if (error?.statusCode && error?.code) {
    return error
  }

  if (isSchemaOrTableError(error)) {
    return Object.assign(new Error(FEEDBACK_SAVE_ERROR_MESSAGE), {
      code: 'feedback_storage_unavailable',
      statusCode: 503,
    })
  }

  return Object.assign(new Error(FEEDBACK_SAVE_ERROR_MESSAGE), {
    code: 'feedback_save_failed',
    statusCode: 500,
  })
}

async function getAuthenticatedProfile(event, supabaseAdmin) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Sign in before sending feedback.'), {
      code: 'unauthenticated',
      statusCode: 401,
    })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw Object.assign(new Error('Sign in before sending feedback.'), {
      code: 'unauthenticated',
      statusCode: 401,
    })
  }

  const authUser = authData.user
  const authEmail = normalizeText(authUser.email, { maxLength: 320 }).toLowerCase()
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, email, username, name, display_name, role, role_label, role_rank, club_id')
    .or(`id.eq.${authUser.id},email.eq.${authEmail}`)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile?.id) {
    throw Object.assign(new Error('Signed-in user profile was not found.'), {
      code: 'profile_not_found',
      statusCode: 403,
    })
  }

  return {
    id: profile.id,
    email: normalizeText(profile.email || authEmail, { maxLength: 320 }).toLowerCase(),
    name: normalizeText(profile.display_name || profile.name || profile.username || profile.email || authEmail, { maxLength: 240 }),
    role: normalizeText(profile.role, { maxLength: 80 }),
    roleLabel: normalizeText(profile.role_label, { maxLength: 120 }),
    roleRank: Number(profile.role_rank ?? 0),
    clubId: isUuid(profile.club_id) ? profile.club_id : null,
  }
}

async function resolveTeamContext({ activeTeamId, profile, supabaseAdmin }) {
  const teamId = normalizeText(activeTeamId, { maxLength: 64 })

  if (!teamId) {
    return null
  }

  if (!isUuid(teamId)) {
    throw Object.assign(new Error('Selected team context was not valid.'), {
      code: 'invalid_team_context',
      statusCode: 400,
    })
  }

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, club_id')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError) {
    throw teamError
  }

  if (!team?.id || String(team.club_id) !== String(profile.clubId)) {
    throw Object.assign(new Error('Selected team context was not available.'), {
      code: 'invalid_team_context',
      statusCode: 403,
    })
  }

  if (profile.role === 'super_admin' || profile.role === 'admin') {
    return team.id
  }

  const { data: assignment, error: assignmentError } = await supabaseAdmin
    .from('team_staff')
    .select('id')
    .eq('team_id', team.id)
    .eq('user_id', profile.id)
    .maybeSingle()

  if (assignmentError) {
    throw assignmentError
  }

  if (!assignment?.id) {
    throw Object.assign(new Error('Selected team context was not available.'), {
      code: 'invalid_team_context',
      statusCode: 403,
    })
  }

  return team.id
}

function validateReport(report) {
  const title = normalizeText(report?.title, { maxLength: 240 })
  const summary = normalizeText(report?.summary, { maxLength: 4000 })

  if (!title) {
    throw Object.assign(new Error('Add a title before sending feedback.'), {
      code: 'missing_title',
      statusCode: 400,
    })
  }

  if (!summary) {
    throw Object.assign(new Error('Add a summary before sending feedback.'), {
      code: 'missing_summary',
      statusCode: 400,
    })
  }

  const feedbackType = normalizeText(report?.feedbackType, { maxLength: 80 })
  const severity = normalizeText(report?.severity, { maxLength: 80 })

  return {
    actual_result: normalizeText(report?.actualResult),
    browser_device: normalizeText(report?.browserDevice, { maxLength: 1000 }),
    expected_result: normalizeText(report?.expectedResult),
    feedback_type: ALLOWED_TYPES.has(feedbackType) ? feedbackType : 'bug',
    log_reference: nullableText(report?.logReference, { maxLength: 1000 }),
    module: normalizeText(report?.module, { maxLength: 160 }),
    page_title: nullableText(report?.pageTitle, { maxLength: 240 }),
    phase: normalizeText(report?.phase, { maxLength: 120 }) || 'production',
    reproduction_steps: normalizeText(report?.reproductionSteps),
    route: normalizeText(report?.route, { maxLength: 500 }),
    screenshot_url: null,
    severity: ALLOWED_SEVERITIES.has(severity) ? severity : 'medium',
    summary,
    title,
  }
}

function safeDiagnostic(error) {
  return {
    code: normalizeText(error?.code || error?.status || error?.statusCode),
    details: normalizeText(error?.details),
    hint: normalizeText(error?.hint),
    message: normalizeText(error?.message),
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeText(value))
}

function getFeedbackNotificationRecipient(env = process.env) {
  return normalizeText(env.FEEDBACK_NOTIFY_TO || FEEDBACK_NOTIFICATION_RECIPIENT, { maxLength: 320 }).toLowerCase()
}

function getAttachmentMetadata(reportId, profile, attachment) {
  if (!attachment) {
    return null
  }

  const attachmentId = randomUUID()
  const extension = ATTACHMENT_EXTENSIONS[attachment.mimeType] || 'bin'

  return {
    screenshot_file_size: attachment.fileSize,
    screenshot_mime_type: attachment.mimeType,
    screenshot_original_filename: attachment.originalFilename,
    screenshot_storage_bucket: FEEDBACK_ATTACHMENT_BUCKET,
    screenshot_storage_path: `tester-feedback/${reportId}/${attachmentId}.${extension}`,
    screenshot_uploaded_at: new Date().toISOString(),
    screenshot_uploaded_by: profile.id,
  }
}

async function uploadFeedbackAttachment(supabaseAdmin, metadata, attachment) {
  if (!metadata || !attachment) {
    return null
  }

  const { error } = await supabaseAdmin.storage
    .from(metadata.screenshot_storage_bucket)
    .upload(metadata.screenshot_storage_path, attachment.buffer, {
      contentType: attachment.mimeType,
      upsert: false,
    })

  if (error) {
    throw Object.assign(new Error('Screenshot could not be uploaded. Please try again.'), {
      code: 'attachment_upload_failed',
      statusCode: 503,
    })
  }

  return metadata
}

async function updateFeedbackAttachmentMetadata(supabaseAdmin, { metadata, reportId }) {
  if (!metadata?.screenshot_storage_path) {
    return null
  }

  const { error } = await supabaseAdmin
    .from('tester_feedback_reports')
    .update(metadata)
    .eq('id', reportId)

  if (error) {
    throw error
  }

  return metadata
}

async function removeUploadedAttachment(supabaseAdmin, metadata) {
  if (!metadata?.screenshot_storage_bucket || !metadata?.screenshot_storage_path) {
    return
  }

  try {
    await supabaseAdmin.storage
      .from(metadata.screenshot_storage_bucket)
      .remove([metadata.screenshot_storage_path])
  } catch (error) {
    console.error('tester_feedback_attachment_cleanup_failed', {
      message: normalizeText(error?.message),
      path: metadata.screenshot_storage_path,
      reference: SUPPORT_REFERENCE,
    })
  }
}

async function attachFeedbackScreenshot(supabaseAdmin, { attachment, metadata, reportId }) {
  if (!attachment || !metadata) {
    return {
      metadata: null,
      uploaded: false,
      warning: '',
    }
  }

  let uploadedMetadata = null

  try {
    uploadedMetadata = await uploadFeedbackAttachment(supabaseAdmin, metadata, attachment)
    await updateFeedbackAttachmentMetadata(supabaseAdmin, {
      metadata: uploadedMetadata,
      reportId,
    })

    return {
      metadata: uploadedMetadata,
      uploaded: true,
      warning: '',
    }
  } catch (error) {
    if (uploadedMetadata) {
      await removeUploadedAttachment(supabaseAdmin, uploadedMetadata)
    }

    console.error('tester_feedback_attachment_upload_failed', {
      code: normalizeText(error?.code || error?.status || error?.statusCode),
      message: normalizeText(error?.message),
      reference: SUPPORT_REFERENCE,
      reportId,
    })

    return {
      metadata: null,
      uploaded: false,
      warning: 'Feedback was saved, but screenshot upload failed.',
    }
  }
}

function buildFeedbackNotificationHtml({ attachmentMetadata, data, profile, report }) {
  const rows = [
    ['Report ID', data.id],
    ['Reporter', `${profile.name || 'Unknown'} <${profile.email || 'No email'}>`],
    ['Type', report.feedback_type || 'Unknown'],
    ['Severity', report.severity || 'Unknown'],
    ['Module', report.module || 'Unknown'],
    ['Route', report.route || 'Unknown'],
    ['Phase', report.phase || 'production'],
    ['Attachment', attachmentMetadata?.screenshot_storage_path ? 'Screenshot uploaded' : 'None'],
  ]

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5; padding: 24px;">
      <div style="max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 18px; overflow: hidden;">
        <div style="background: #101510; color: #ffffff; padding: 24px;">
          <p style="margin: 0 0 8px; color: #d8ff2f; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">Football Player</p>
          <h1 style="margin: 0; font-size: 24px;">New Report Issue submission</h1>
        </div>
        <div style="padding: 24px; background: #ffffff;">
          <h2 style="margin: 0 0 12px; font-size: 20px;">${escapeHtml(report.title)}</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${rows.map(([label, value]) => `
                <tr>
                  <td style="width: 160px; padding: 10px; border-bottom: 1px solid #e5e7eb; color: #4b5563; font-weight: 700;">${escapeHtml(label)}</td>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(value)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="margin-top: 20px;">
            <p style="margin: 0 0 8px; color: #4b5563; font-size: 14px; font-weight: 700;">Summary</p>
            <div style="white-space: pre-line; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px;">${escapeHtml(report.summary)}</div>
          </div>
          <p style="margin: 20px 0 0; color: #4b5563; font-size: 14px;">Open the Platform Feedback issue reports area to review details and view any screenshot attachment.</p>
        </div>
      </div>
    </div>
  `
}

async function updateFeedbackEmailStatus(supabaseAdmin, { error = '', reportId, sentAt = null, status }) {
  const { error: updateError } = await supabaseAdmin
    .from('tester_feedback_reports')
    .update({
      feedback_email_error: normalizeText(error, { maxLength: 500 }),
      feedback_email_sent_at: sentAt,
      feedback_email_status: status,
    })
    .eq('id', reportId)

  if (updateError) {
    console.error('tester_feedback_email_status_update_failed', {
      code: normalizeText(updateError.code),
      message: normalizeText(updateError.message),
      reference: SUPPORT_REFERENCE,
      reportId,
      status,
    })
  }
}

async function sendFeedbackNotification({
  attachmentMetadata,
  data,
  emailSender,
  env,
  profile,
  report,
  resendClient,
}) {
  const recipient = getFeedbackNotificationRecipient(env)

  if (!isValidEmail(recipient)) {
    return {
      error: 'Feedback notification recipient is not configured.',
      sentAt: null,
      status: 'not_configured',
    }
  }

  try {
    await emailSender({
      from: createFromAddress('Football Player Feedback', env),
      html: buildFeedbackNotificationHtml({ attachmentMetadata, data, profile, report }),
      reply_to: isValidEmail(profile.email) ? profile.email : undefined,
      subject: `Report Issue: ${report.title}`,
      to: [recipient],
    }, {
      context: {
        actorEmail: profile.email,
        actorId: profile.id,
        clubId: profile.clubId || '',
        emailType: 'tester_feedback_notification',
        targetEntityId: data.id,
        targetEntityType: 'tester_feedback_report',
        teamId: data.team_id || '',
        userRole: profile.role,
      },
      env,
      publicMessage: 'Feedback notification could not be sent.',
      resendClient,
    })

    return {
      error: '',
      sentAt: new Date().toISOString(),
      status: 'sent',
    }
  } catch (error) {
    console.error('tester_feedback_notification_failed', {
      code: normalizeText(error?.code),
      message: normalizeText(error?.message),
      reference: SUPPORT_REFERENCE,
      reportId: data.id,
    })

    return {
      error: normalizeText(error?.message, { maxLength: 500 }) || 'Feedback notification could not be sent.',
      sentAt: null,
      status: 'failed',
    }
  }
}

export async function submitTesterFeedbackResult(event, {
  emailSender = sendEmail,
  env = process.env,
  resendClient = null,
  supabaseAdmin = createSupabaseAdminClient(event),
} = {}) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
  }

  let profile = null

  try {
    const body = await parseBody(event)
    profile = await getAuthenticatedProfile(event, supabaseAdmin)
    const report = validateReport(body.report || {})
    const teamId = await resolveTeamContext({
      activeTeamId: body.context?.activeTeamId,
      profile,
      supabaseAdmin,
    })
    const reportId = randomUUID()
    const attachmentMetadata = getAttachmentMetadata(reportId, profile, body.attachment)

    const { data, error } = await supabaseAdmin
      .from('tester_feedback_reports')
      .insert({
        id: reportId,
        submitted_by_user_id: profile.id,
        submitted_by_email: profile.email,
        submitted_by_name: profile.name,
        role: profile.role,
        club_id: profile.clubId,
        team_id: teamId,
        ...report,
        status: 'new',
        resolution_state: '',
      })
      .select('id, created_at, team_id')
      .single()

    if (error) {
      throw error
    }

    const attachmentResult = await attachFeedbackScreenshot(supabaseAdmin, {
      attachment: body.attachment,
      metadata: attachmentMetadata,
      reportId: data.id,
    })

    const emailNotification = await sendFeedbackNotification({
      attachmentMetadata: attachmentResult.metadata,
      data,
      emailSender,
      env,
      profile,
      report,
      resendClient,
    })
    await updateFeedbackEmailStatus(supabaseAdmin, {
      error: emailNotification.error,
      reportId: data.id,
      sentAt: emailNotification.sentAt,
      status: emailNotification.status,
    })

    return jsonResponse(200, {
      success: true,
      attachment: {
        uploaded: attachmentResult.uploaded,
        warning: attachmentResult.warning,
      },
      emailNotification: {
        status: emailNotification.status,
      },
      report: data,
    })
  } catch (error) {
    const normalizedError = publicError(error)
    const diagnostic = safeDiagnostic(error)
    console.error('tester_feedback_submit_failed', {
      actorId: profile?.id || undefined,
      clubId: profile?.clubId || undefined,
      code: normalizedError.code || 'feedback_save_failed',
      message: diagnostic.message || undefined,
      reference: SUPPORT_REFERENCE,
      statusCode: normalizedError.statusCode || 500,
      supabaseCode: diagnostic.code || undefined,
      supabaseDetails: diagnostic.details || undefined,
      supabaseHint: diagnostic.hint || undefined,
    })

    return jsonResponse(normalizedError.statusCode || 500, {
      success: false,
      code: normalizedError.code || 'feedback_save_failed',
      message: normalizedError.message || FEEDBACK_SAVE_ERROR_MESSAGE,
    })
  }
}

export async function handler(event) {
  return submitTesterFeedbackResult(event)
}
