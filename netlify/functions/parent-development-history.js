/* global Netlify */
import { Buffer } from 'node:buffer'
import { createClient } from '@supabase/supabase-js'
import { buildDevelopmentParentReportContent } from '../../src/lib/development-parent-report-content.js'
import { buildPdfBuffer } from '../../src/lib/pdf-builder.js'
import { buildAssessmentPdfDocument } from '../../src/lib/pdf-document.js'
import {
  buildDevelopmentPdfContentDisposition,
  buildDevelopmentPdfFilename,
} from '../../src/lib/development-pdf-filename.js'
import { buildPdfBrandingForAuthorisedScope } from './lib/_pdf-branding.js'
import {
  buildParentDevelopmentHistory,
  getParentDevelopmentReport,
  ParentDevelopmentHistoryError,
  validateParentDevelopmentScope,
} from './lib/_parent-development-history.js'
import {
  createDevelopmentOutputKey,
  createDevelopmentOutputQueueId,
  resolveDevelopmentParentReport,
} from './lib/_development-parent-email-output.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PDF_RENDER_TIMEOUT_MS = 25_000
const MAX_REQUEST_BYTES = 4096
const PDF_CACHE_MAX_ENTRIES = 12
const parentDevelopmentPdfCache = new Map()

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getBearerToken(request) {
  const [scheme, token] = normalizeText(request.headers.get('authorization')).split(/\s+/, 2)
  return scheme?.toLowerCase() === 'bearer' ? normalizeText(token) : ''
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  })
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

async function maybeSingle(query, message) {
  const { data, error } = await query.maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw new ParentDevelopmentHistoryError(message)
  }

  return data
}

async function loadParentScope({ authUserId, parentLinkId, supabaseAdmin }) {
  const message = 'Development history is not available for the selected child.'
  const parentLink = await maybeSingle(
    supabaseAdmin
      .from('parent_player_links')
      .select('id, auth_user_id, club_id, team_id, player_id, status')
      .eq('id', parentLinkId)
      .eq('auth_user_id', authUserId)
      .eq('status', 'active'),
    message,
  )
  const player = await maybeSingle(
    supabaseAdmin
      .from('players')
      .select('id, club_id, team_id, status, archived_at')
      .eq('id', parentLink.player_id)
      .eq('club_id', parentLink.club_id),
    message,
  )

  validateParentDevelopmentScope({
    authUserId,
    parentLink,
    player,
  })

  return { parentLink, player }
}

async function loadHistory({ parentLink, supabaseAdmin }) {
  const { data: reportRows, error: reportError } = await supabaseAdmin
    .from('development_parent_reports')
    .select('evaluation_id, club_id, report_snapshot, finalized_at')
    .eq('club_id', parentLink.club_id)
    .eq('report_snapshot->player->>id', parentLink.player_id)
    .order('finalized_at', { ascending: false })
    .limit(100)

  if (reportError) {
    throw reportError
  }

  const candidateRows = (reportRows ?? []).filter((row) =>
    Array.isArray(row.report_snapshot?.recipients)
    && row.report_snapshot.recipients.some(
      (recipient) => normalizeText(recipient?.linkId) === normalizeText(parentLink.id),
    ))
  const evaluationIds = candidateRows
    .map((row) => normalizeText(row.evaluation_id))
    .filter(Boolean)

  if (evaluationIds.length === 0) {
    return []
  }

  const { data: communicationLogs, error: communicationError } = await supabaseAdmin
    .from('communication_logs')
    .select('id, evaluation_id, channel, action, metadata, created_at')
    .eq('club_id', parentLink.club_id)
    .eq('player_id', parentLink.player_id)
    .in('evaluation_id', evaluationIds)
    .eq('channel', 'email')
    .in('action', ['parent_email_scheduled', 'parent_email_sent'])
    .eq('metadata->>recipientLinkId', parentLink.id)

  if (communicationError) {
    throw communicationError
  }

  const queueIds = evaluationIds.map((evaluationId) =>
    createDevelopmentOutputQueueId(
      createDevelopmentOutputKey(evaluationId, parentLink.id),
    ))
  const { data: queues, error: queueError } = await supabaseAdmin
    .from('scheduled_email_queue')
    .select('id, status, scheduled_at, last_error')
    .in('id', queueIds)

  if (queueError) {
    throw queueError
  }

  return buildParentDevelopmentHistory({
    communicationLogs: communicationLogs ?? [],
    parentLink,
    queues: queues ?? [],
    reportRows: candidateRows,
  })
}

async function loadBrandingScope({ parentLink, report, supabaseAdmin }) {
  const unavailableMessage = 'This Development PDF is not available.'
  const club = await maybeSingle(
    supabaseAdmin
      .from('clubs')
      .select('id, name, logo_url, theme_accent')
      .eq('id', parentLink.club_id),
    unavailableMessage,
  )
  const team = await maybeSingle(
    supabaseAdmin
      .from('teams')
      .select('id, club_id, name')
      .eq('id', report.team.id)
      .eq('club_id', parentLink.club_id),
    unavailableMessage,
  )

  return { club, team }
}

async function loadReportEvaluation({ parentLink, report, supabaseAdmin }) {
  const unavailableMessage = 'This Development PDF is not available.'
  const evaluation = await maybeSingle(
    supabaseAdmin
      .from('evaluations')
      .select('id, club_id, team_id, player_id, player_name, team, section, session, date, created_at, coach_id, coach, created_by_name, scores, average_score, comments, form_responses, feedback_form_id, feedback_form_name, feedback_form_version, feedback_form_snapshot')
      .eq('id', report.id)
      .eq('club_id', parentLink.club_id)
      .eq('player_id', parentLink.player_id),
    unavailableMessage,
  )
  const player = await maybeSingle(
    supabaseAdmin
      .from('players')
      .select('id, club_id, team_id, player_name, team')
      .eq('id', parentLink.player_id)
      .eq('club_id', parentLink.club_id),
    unavailableMessage,
  )
  let historyQuery = supabaseAdmin
    .from('evaluations')
    .select('id, club_id, team_id, player_id, player_name, team, section, session, date, created_at, scores, average_score, comments, form_responses, feedback_form_id, feedback_form_name, feedback_form_snapshot')
    .eq('club_id', parentLink.club_id)
    .eq('player_id', parentLink.player_id)
    .lte('created_at', evaluation.created_at)
    .order('created_at', { ascending: true })
    .limit(100)

  if (normalizeText(evaluation.team_id || player.team_id)) {
    historyQuery = historyQuery.eq('team_id', evaluation.team_id || player.team_id)
  }

  const { data: evaluations, error } = await historyQuery

  if (error) {
    throw error
  }

  return { evaluation, evaluations: evaluations ?? [evaluation], player }
}

async function repairEmptyReportSnapshot({
  club,
  parentLink,
  report,
  reportSnapshot,
  supabaseAdmin,
  team,
} = {}) {
  if (Array.isArray(reportSnapshot?.responseItems) && reportSnapshot.responseItems.length > 0) {
    return reportSnapshot
  }

  const { evaluation, evaluations, player } = await loadReportEvaluation({
    parentLink,
    report,
    supabaseAdmin,
  })
  const requestedSections = (Array.isArray(reportSnapshot?.emailSections)
    ? reportSnapshot.emailSections
    : [])
    .map((section) => ({ key: normalizeText(section?.key) }))
    .filter((section) => section.key)
  const rebuilt = resolveDevelopmentParentReport({
    club,
    evaluation,
    evaluations,
    player,
    recipients: Array.isArray(reportSnapshot?.recipients) ? reportSnapshot.recipients : [],
    requestedResponses: undefined,
    requestedSections,
    team,
  })

  return {
    ...rebuilt,
    finalizedAt: normalizeText(reportSnapshot?.finalizedAt) || rebuilt.finalizedAt,
    recipients: Array.isArray(reportSnapshot?.recipients)
      ? reportSnapshot.recipients
      : rebuilt.recipients,
  }
}

function getCachedParentDevelopmentPdf(cacheKey) {
  const cached = parentDevelopmentPdfCache.get(cacheKey)

  if (!cached) {
    return null
  }

  parentDevelopmentPdfCache.delete(cacheKey)
  parentDevelopmentPdfCache.set(cacheKey, cached)
  return {
    ...cached,
    buffer: Buffer.from(cached.buffer),
    diagnostics: {
      ...cached.diagnostics,
      rendererStage: 'memory_cache',
    },
  }
}

function setCachedParentDevelopmentPdf(cacheKey, value) {
  parentDevelopmentPdfCache.set(cacheKey, {
    ...value,
    buffer: Buffer.from(value.buffer),
  })

  while (parentDevelopmentPdfCache.size > PDF_CACHE_MAX_ENTRIES) {
    const oldestKey = parentDevelopmentPdfCache.keys().next().value
    parentDevelopmentPdfCache.delete(oldestKey)
  }
}

function getReportSnapshot(reportRows, reportId) {
  return reportRows.find(
    (row) => normalizeText(row.evaluation_id) === normalizeText(reportId),
  )?.report_snapshot
}

async function buildParentDevelopmentPdf({
  parentLink,
  report,
  reportSnapshot,
  supabaseAdmin,
} = {}) {
  if (!reportSnapshot) {
    throw new ParentDevelopmentHistoryError(
      'This Development PDF is not available.',
      404,
      'PARENT_DEVELOPMENT_PDF_NOT_FOUND',
    )
  }

  const { club, team } = await loadBrandingScope({
    parentLink,
    report,
    supabaseAdmin,
  })
  const resolvedReportSnapshot = await repairEmptyReportSnapshot({
    club,
    parentLink,
    report,
    reportSnapshot,
    supabaseAdmin,
    team,
  })
  const cacheKey = [
    normalizeText(parentLink.id),
    normalizeText(report.id),
    normalizeText(resolvedReportSnapshot.finalizedAt),
    String(resolvedReportSnapshot.responseItems?.length || 0),
  ].join(':')
  const cachedPdf = getCachedParentDevelopmentPdf(cacheKey)

  if (cachedPdf) {
    return cachedPdf
  }

  const diagnostics = {
    caller: 'parent-development-history',
    cleanupState: 'not_started',
    networkRequestCount: 0,
    rendererStage: 'queued',
    workflow: 'parent_development_download',
  }
  const branding = await buildPdfBrandingForAuthorisedScope({
    supabaseAdmin,
    club,
    team,
    reportType: 'assessment',
    diagnostics,
  })
  const content = buildDevelopmentParentReportContent(resolvedReportSnapshot)
  const document = buildAssessmentPdfDocument({ content })
  const pdfBuffer = await withTimeout(
    buildPdfBuffer(document, { branding, diagnostics }),
    PDF_RENDER_TIMEOUT_MS,
    'Development PDF generation timed out.',
  )

  if (!pdfBuffer?.length) {
    throw new Error('Development PDF generation returned no content.')
  }

  const result = {
    buffer: Buffer.from(pdfBuffer),
    diagnostics,
    filename: buildDevelopmentPdfFilename(resolvedReportSnapshot),
  }

  setCachedParentDevelopmentPdf(cacheKey, result)
  return result
}

export default async (request) => {
  if (!['GET', 'POST'].includes(request.method)) {
    return json(
      405,
      { success: false, message: 'Method not allowed.' },
      { Allow: 'GET, POST' },
    )
  }

  try {
    const accessToken = getBearerToken(request)

    if (!accessToken) {
      throw new ParentDevelopmentHistoryError(
        'Sign in again before opening Development history.',
        401,
        'PARENT_DEVELOPMENT_SIGN_IN_REQUIRED',
      )
    }

    let body

    if (request.method === 'GET') {
      const url = new URL(request.url)
      body = {
        action: 'download_pdf',
        parentLinkId: url.searchParams.get('parentLinkId'),
        reportId: url.searchParams.get('reportId'),
      }
    } else {
      const contentType = normalizeText(request.headers.get('content-type')).toLowerCase()

      if (!contentType.startsWith('application/json')) {
        throw new ParentDevelopmentHistoryError(
          'Content-Type must be application/json.',
          415,
          'PARENT_DEVELOPMENT_CONTENT_TYPE_REQUIRED',
        )
      }

      const declaredLength = Number(request.headers.get('content-length') || 0)

      if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
        throw new ParentDevelopmentHistoryError(
          'The Development history request is not valid.',
          413,
          'PARENT_DEVELOPMENT_REQUEST_TOO_LARGE',
        )
      }

      const bodyBytes = new Uint8Array(await request.arrayBuffer())

      if (bodyBytes.byteLength > MAX_REQUEST_BYTES) {
        throw new ParentDevelopmentHistoryError(
          'The Development history request is not valid.',
          413,
          'PARENT_DEVELOPMENT_REQUEST_TOO_LARGE',
        )
      }

      try {
        body = JSON.parse(new TextDecoder().decode(bodyBytes))
      } catch {
        throw new ParentDevelopmentHistoryError(
          'The Development history request is not valid.',
          400,
          'PARENT_DEVELOPMENT_REQUEST_INVALID',
        )
      }
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ParentDevelopmentHistoryError(
        'The Development history request is not valid.',
        400,
        'PARENT_DEVELOPMENT_REQUEST_INVALID',
      )
    }

    const action = normalizeText(body.action || 'list')
    const parentLinkId = normalizeText(body.parentLinkId)

    if (!UUID_PATTERN.test(parentLinkId)) {
      throw new ParentDevelopmentHistoryError(
        'Choose a valid linked child.',
        400,
        'PARENT_DEVELOPMENT_LINK_REQUIRED',
      )
    }

    const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL')
    const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Parent Development history is not configured.')
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken)

    if (authError || !authData?.user?.id) {
      throw new ParentDevelopmentHistoryError(
        'Sign in again before opening Development history.',
        401,
        'PARENT_DEVELOPMENT_SIGN_IN_REQUIRED',
      )
    }

    const { parentLink } = await loadParentScope({
      authUserId: authData.user.id,
      parentLinkId,
      supabaseAdmin,
    })
    const history = await loadHistory({ parentLink, supabaseAdmin })

    if (action === 'list') {
      return json(200, {
        success: true,
        parentLinkId,
        reports: history,
      })
    }

    if (action !== 'download_pdf') {
      throw new ParentDevelopmentHistoryError(
        'Choose a valid Development history action.',
        400,
        'PARENT_DEVELOPMENT_ACTION_INVALID',
      )
    }

    const reportId = normalizeText(body.reportId)

    if (!UUID_PATTERN.test(reportId)) {
      throw new ParentDevelopmentHistoryError(
        'Choose a valid Development report.',
        400,
        'PARENT_DEVELOPMENT_REPORT_REQUIRED',
      )
    }

    const report = getParentDevelopmentReport(history, reportId)
    const { data: reportRows, error: reportRowsError } = await supabaseAdmin
      .from('development_parent_reports')
      .select('evaluation_id, report_snapshot')
      .eq('evaluation_id', report.id)
      .eq('club_id', parentLink.club_id)
      .limit(1)

    if (reportRowsError) {
      throw reportRowsError
    }

    const reportSnapshot = getReportSnapshot(reportRows ?? [], report.id)
    const { buffer, diagnostics, filename } = await buildParentDevelopmentPdf({
      parentLink,
      report,
      reportSnapshot,
      supabaseAdmin,
    })

    return new Response(buffer, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': buildDevelopmentPdfContentDisposition(filename),
        'Content-Length': String(buffer.length),
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Content-Type': 'application/pdf',
        'X-PDF-Cleanup-State': normalizeText(diagnostics.cleanupState || 'unknown'),
        'X-PDF-Network-Requests': String(Number(diagnostics.networkRequestCount || 0)),
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 500)

    if (status >= 500) {
      console.error('Parent Development history failed', {
        code: normalizeText(error?.code || 'PARENT_DEVELOPMENT_FAILED'),
        errorName: normalizeText(error?.name || 'Error'),
      })
    }

    return json(status, {
      success: false,
      code: normalizeText(error?.code || 'PARENT_DEVELOPMENT_FAILED'),
      message: status >= 500
        ? 'Development history could not be prepared.'
        : error.message || 'Development history is not available for the selected child.',
    })
  }
}

export const config = {
  path: '/api/parent-development/history',
}
