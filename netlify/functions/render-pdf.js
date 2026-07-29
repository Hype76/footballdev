import { createHash, randomUUID } from 'node:crypto'
import { buildPdfBuffer, countPdfPages } from '../../src/lib/pdf-builder.js'
import { PDF_REPORT_TYPES } from '../../src/lib/pdf-document.js'
import {
  assertPlanFeature,
  getAuthenticatedPlanProfile,
  getClubPlanProfile,
} from './lib/_plan-gate.js'
import { loadCommunicationPdfDocument } from './lib/_pdf-report.js'
import { supabaseAdmin } from './lib/_supabase.js'

const MAX_REQUEST_BYTES = 16_384
const FIXED_FILENAME = 'football-player-report.pdf'
const REQUEST_FIELDS = ['clubId', 'communicationLogId', 'reportType']

function safeJson(status, code, message, extraHeaders = {}) {
  return Response.json(
    { error: message, code },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders,
      },
    },
  )
}

function safeReference(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return 'none'
  }

  return createHash('sha256').update(normalizedValue).digest('hex').slice(0, 12)
}

function invalidRequest(code = 'PDF_INVALID_REQUEST') {
  throw Object.assign(new Error('The PDF request is not valid.'), { code, statusCode: 400 })
}

function parseRequestBody(rawBody) {
  let body

  try {
    body = JSON.parse(rawBody)
  } catch {
    invalidRequest()
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalidRequest()
  }

  if (Object.keys(body).some((key) => !REQUEST_FIELDS.includes(key))) {
    invalidRequest('PDF_UNSUPPORTED_FIELD')
  }

  const reportType = String(body.reportType ?? '').trim()
  const clubId = String(body.clubId ?? '').trim()
  const communicationLogId = String(body.communicationLogId ?? '').trim()

  if (reportType !== PDF_REPORT_TYPES.parentMessage || !clubId || !communicationLogId) {
    invalidRequest()
  }

  if (clubId.length > 80 || communicationLogId.length > 80) {
    invalidRequest()
  }

  return { reportType, clubId, communicationLogId }
}

function requestToLegacyEvent(request) {
  return {
    headers: Object.fromEntries(request.headers.entries()),
  }
}

async function authenticatePdfRequest(event) {
  return getAuthenticatedPlanProfile(event, {})
}

function createTargetPlanProfile(actorProfile, clubPlanProfile) {
  return {
    ...clubPlanProfile,
    id: actorProfile.id,
    authUserId: actorProfile.authUserId,
    email: actorProfile.email,
    authEmail: actorProfile.authEmail,
    name: actorProfile.name,
    role: actorProfile.role,
    roleLabel: actorProfile.roleLabel,
    roleRank: actorProfile.roleRank,
    accountStatus: actorProfile.accountStatus,
  }
}

function getPublicError(error) {
  const status = Number(error?.statusCode ?? 500)

  if (status === 401) {
    return { status: 401, code: 'PDF_AUTH_REQUIRED', message: 'Login is required.' }
  }

  if (status === 403 || status === 404) {
    return { status, code: status === 404 ? 'PDF_REPORT_NOT_FOUND' : 'PDF_ACCESS_DENIED', message: 'This PDF report is not available.' }
  }

  if (status === 400 || status === 413) {
    return { status, code: error?.code || 'PDF_INVALID_REQUEST', message: 'The PDF request is not valid.' }
  }

  if (status === 429) {
    return { status, code: 'PDF_RENDER_BUSY', message: 'PDF generation is busy. Try again shortly.' }
  }

  if (status === 504) {
    return { status, code: 'PDF_RENDER_TIMEOUT', message: 'PDF generation timed out.' }
  }

  return { status: 500, code: 'PDF_RENDER_FAILED', message: 'PDF generation failed.' }
}

export function createRenderPdfHandler({
  authenticate = authenticatePdfRequest,
  loadClubPlan = getClubPlanProfile,
  loadReport = loadCommunicationPdfDocument,
  render = buildPdfBuffer,
  database = supabaseAdmin,
  logger = console,
} = {}) {
  return async function renderPdf(request, context = {}) {
    const requestId = String(context.requestId ?? '').trim() || randomUUID()
    const startedAt = Date.now()
    let status = 500
    let outputBytes = 0
    const diagnostics = {
      authorityResult: 'not_started',
      browserLaunchResult: 'not_started',
      caller: 'render-pdf',
      cleanupState: 'not_started',
      failureCategory: 'none',
      networkRequestCount: 0,
      pageCount: 0,
      rendererInvocation: false,
      rendererStage: 'request_received',
      workflow: 'manual_download',
    }

    try {
      if (request.method !== 'POST') {
        status = 405
        return safeJson(405, 'PDF_METHOD_NOT_ALLOWED', 'Method not allowed.', { Allow: 'POST' })
      }

      const contentType = String(request.headers.get('content-type') ?? '').toLowerCase()

      if (!contentType.startsWith('application/json')) {
        status = 415
        return safeJson(415, 'PDF_CONTENT_TYPE_REQUIRED', 'Content-Type must be application/json.')
      }

      const declaredLength = Number(request.headers.get('content-length') ?? 0)

      if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
        status = 413
        return safeJson(413, 'PDF_REQUEST_TOO_LARGE', 'The PDF request is not valid.')
      }

      const bodyBytes = new Uint8Array(await request.arrayBuffer())

      if (bodyBytes.byteLength > MAX_REQUEST_BYTES) {
        status = 413
        return safeJson(413, 'PDF_REQUEST_TOO_LARGE', 'The PDF request is not valid.')
      }

      const body = parseRequestBody(new TextDecoder().decode(bodyBytes))
      diagnostics.clubRef = safeReference(body.clubId)
      diagnostics.resourceRef = safeReference(body.communicationLogId)
      diagnostics.rendererStage = 'authentication'
      const actorProfile = await authenticate(requestToLegacyEvent(request), {})
      diagnostics.actorRef = safeReference(actorProfile.id || actorProfile.authUserId)
      diagnostics.authorityResult = 'authenticated'
      let planProfile = actorProfile

      if (actorProfile.role === 'super_admin') {
        const targetClubPlan = await loadClubPlan(body.clubId)
        planProfile = createTargetPlanProfile(actorProfile, targetClubPlan)
      }

      assertPlanFeature(planProfile, 'pdfReports')
      diagnostics.rendererStage = 'resource_resolution'

      const document = await loadReport({
        supabaseAdmin: database,
        profile: actorProfile,
        clubId: body.clubId,
        communicationLogId: body.communicationLogId,
        diagnostics,
      })
      diagnostics.authorityResult = 'authorized'
      diagnostics.rendererInvocation = true
      const pdfBuffer = await render(document, { diagnostics })
      outputBytes = pdfBuffer.length
      diagnostics.outputBytes = outputBytes
      diagnostics.pageCount = diagnostics.pageCount || countPdfPages(pdfBuffer)
      status = 200

      return new Response(pdfBuffer, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${FIXED_FILENAME}"`,
          'Content-Security-Policy': "sandbox; default-src 'none'",
          'Content-Type': 'application/pdf',
          'X-PDF-Page-Count': String(diagnostics.pageCount),
          'X-PDF-Request-Id': requestId,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      const publicError = getPublicError(error)
      status = publicError.status
      diagnostics.failureCategory = String(error?.code || error?.name || publicError.code)

      if (status >= 500) {
        logger.error?.('PDF renderer request failed', {
          requestId,
          code: publicError.code,
          errorName: String(error?.name ?? 'Error'),
          failureCategory: diagnostics.failureCategory,
          step: diagnostics.rendererStage,
        })
      }

      return safeJson(publicError.status, publicError.code, publicError.message, {
        'X-PDF-Request-Id': requestId,
      })
    } finally {
      logger.info?.('PDF renderer request completed', {
        requestId,
        status,
        durationMs: Date.now() - startedAt,
        outputBucket: outputBytes === 0 ? 'none' : outputBytes < 1_000_000 ? 'under-1mb' : '1mb-or-more',
        actorRef: diagnostics.actorRef || 'none',
        authorityResult: diagnostics.authorityResult,
        browserLaunchResult: diagnostics.browserLaunchResult,
        caller: diagnostics.caller,
        cleanupState: diagnostics.cleanupState,
        clubRef: diagnostics.clubRef || 'none',
        failureCategory: diagnostics.failureCategory,
        networkRequestCount: diagnostics.networkRequestCount,
        pageCount: diagnostics.pageCount,
        rendererInvocation: diagnostics.rendererInvocation,
        resourceRef: diagnostics.resourceRef || 'none',
        step: diagnostics.rendererStage,
        teamRef: safeReference(diagnostics.teamId),
        workflow: diagnostics.workflow,
      })
    }
  }
}

export default createRenderPdfHandler()
