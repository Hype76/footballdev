import { DEMO_RESET_MANIFEST } from './lib/_demo-reset-manifest.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_BODY_KEYS = new Set(['operationId'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message, code) {
  return jsonResponse(statusCode, { success: false, code, message })
}

function parseRequestBody(event) {
  let body = {}

  try {
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    throw Object.assign(new Error('The reset request is invalid.'), {
      statusCode: 400,
      safeCode: 'INVALID_REQUEST',
    })
  }

  if (!body || Array.isArray(body) || typeof body !== 'object') {
    throw Object.assign(new Error('The reset request is invalid.'), {
      statusCode: 400,
      safeCode: 'INVALID_REQUEST',
    })
  }

  if (Object.keys(body).some((key) => !ALLOWED_BODY_KEYS.has(key))) {
    throw Object.assign(new Error('The reset request contains unsupported fields.'), {
      statusCode: 400,
      safeCode: 'UNSUPPORTED_SCOPE',
    })
  }

  const operationId = normalizeText(body.operationId)

  if (!UUID_PATTERN.test(operationId)) {
    throw Object.assign(new Error('The reset request needs a valid operation identifier.'), {
      statusCode: 400,
      safeCode: 'INVALID_OPERATION_ID',
    })
  }

  return { operationId }
}

function getBearerToken(event) {
  const header = normalizeText(event.headers?.authorization || event.headers?.Authorization)
  const match = header.match(/^Bearer\s+(.+)$/i)
  return normalizeText(match?.[1])
}

function safeLog(level, eventName, details = {}) {
  const entry = {
    event: eventName,
    scope: DEMO_RESET_MANIFEST.scopeKey,
    ...details,
  }
  const logger = console[level] || console.info
  logger(JSON.stringify(entry))
}

function classifyRpcError(error) {
  const code = normalizeText(error?.code)
  const message = normalizeText(error?.message)

  if (code === '55P03' || message.includes('DEMO_RESET_LOCKED')) {
    return {
      statusCode: 409,
      safeCode: 'RESET_ALREADY_RUNNING',
      message: 'The demo workspace is already being prepared. Try again in a moment.',
      lockResult: 'conflict',
    }
  }

  if (['22023', '42501', '55000'].includes(code) || message.includes('DEMO_SCOPE_')) {
    return {
      statusCode: 409,
      safeCode: 'DEMO_SCOPE_REVIEW_REQUIRED',
      message: 'The demo workspace needs a controlled recovery review before it can be opened.',
      lockResult: 'not_acquired',
    }
  }

  return {
    statusCode: 500,
    safeCode: 'RESET_FAILED',
    message: 'The demo workspace could not be prepared right now.',
    lockResult: 'unknown',
  }
}

async function recordFailedAttempt(supabaseAdmin, {
  actorId,
  failureStage,
  lockResult,
  operationId,
  safeErrorCode,
}) {
  if (!actorId || !operationId) {
    return
  }

  const { error } = await supabaseAdmin.from('demo_reset_operations').insert({
    operation_id: operationId,
    demo_scope: DEMO_RESET_MANIFEST.scopeKey,
    actor_id: actorId,
    actor_category: 'approved_demo_identity',
    lock_result: lockResult,
    outcome: safeErrorCode === 'RESET_ALREADY_RUNNING' ? 'conflict' : 'failed',
    failure_stage: failureStage,
    safe_error_code: safeErrorCode,
    created_counts: {},
    updated_counts: {},
    removed_counts: {},
    finished_at: new Date().toISOString(),
  })

  if (error) {
    safeLog('warn', 'demo_reset_audit_write_failed', {
      operationId,
      safeErrorCode: 'AUDIT_WRITE_FAILED',
    })
  }
}

export function createResetDemoAccountHandler({
  createAdminClient,
  loadAuthorityProfile,
} = {}) {
  if (typeof createAdminClient !== 'function' || typeof loadAuthorityProfile !== 'function') {
    throw new TypeError('Demo reset handler dependencies are required.')
  }

  return async function resetDemoAccountHandler(event = {}) {
    if (event.httpMethod !== 'POST') {
      return failureResponse(405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED')
    }

    let operationId = ''
    let actorId = ''
    let supabaseAdmin = null

    try {
      ;({ operationId } = parseRequestBody(event))

      const token = getBearerToken(event)

      if (!token) {
        return failureResponse(401, 'Login is required.', 'AUTH_REQUIRED')
      }

      supabaseAdmin = createAdminClient(event)

      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

      if (authError || !authData?.user?.id) {
        return failureResponse(401, 'Login is required.', 'AUTH_REQUIRED')
      }

      actorId = normalizeText(authData.user.id)

      if (normalizeEmail(authData.user.email) !== normalizeEmail(DEMO_RESET_MANIFEST.actor.email)) {
        return failureResponse(403, 'This reset is limited to the approved demo account.', 'DEMO_SCOPE_DENIED')
      }

      const authorityProfile = await loadAuthorityProfile(supabaseAdmin, authData.user, {
        select: 'id, email, role, role_rank, club_id, status, clubs:club_id (id, name, status, plan_key, plan_status, is_plan_comped)',
      })
      const club = Array.isArray(authorityProfile?.clubs) ? authorityProfile.clubs[0] : authorityProfile?.clubs

      if (
        normalizeEmail(authorityProfile?.email) !== normalizeEmail(DEMO_RESET_MANIFEST.actor.email)
        || normalizeText(authorityProfile?.role) !== DEMO_RESET_MANIFEST.actor.role
        || Number(authorityProfile?.role_rank) !== DEMO_RESET_MANIFEST.actor.roleRank
        || normalizeText(club?.name) !== DEMO_RESET_MANIFEST.club.name
        || normalizeText(club?.status || 'active') !== 'active'
      ) {
        return failureResponse(403, 'This reset is limited to the approved demo workspace.', 'DEMO_SCOPE_DENIED')
      }

      safeLog('info', 'demo_reset_started', { operationId })

      const { data, error } = await supabaseAdmin.rpc('reset_demo_account_atomic', {
        p_actor_id: actorId,
        p_operation_id: operationId,
      })

      if (error) {
        const failure = classifyRpcError(error)

        await recordFailedAttempt(supabaseAdmin, {
          actorId,
          failureStage: 'database_transaction',
          lockResult: failure.lockResult,
          operationId,
          safeErrorCode: failure.safeCode,
        })
        safeLog('warn', 'demo_reset_failed', {
          operationId,
          safeErrorCode: failure.safeCode,
        })

        return failureResponse(failure.statusCode, failure.message, failure.safeCode)
      }

      safeLog('info', 'demo_reset_completed', {
        operationId,
        cached: data?.cached === true,
        lockResult: normalizeText(data?.lock_result || 'acquired'),
      })

      return jsonResponse(200, {
        success: true,
        operationId,
        outcome: data?.cached === true ? 'already_completed' : 'completed',
      })
    } catch (error) {
      const statusCode = Number(error?.statusCode || 500)
      const safeCode = normalizeText(error?.safeCode || 'RESET_FAILED')
      const safeMessage = statusCode < 500
        ? normalizeText(error?.message || 'The reset request is invalid.')
        : 'The demo workspace could not be prepared right now.'

      if (supabaseAdmin && actorId && operationId) {
        await recordFailedAttempt(supabaseAdmin, {
          actorId,
          failureStage: 'request_validation',
          lockResult: 'not_attempted',
          operationId,
          safeErrorCode: safeCode,
        })
      }

      safeLog('warn', 'demo_reset_failed', { operationId: operationId || undefined, safeErrorCode: safeCode })
      return failureResponse(statusCode, safeMessage, safeCode)
    }
  }
}

export async function handler(event) {
  const { createSupabaseAdminClient } = await import('./lib/_supabase.js')
  const { loadActiveAuthorityProfile } = await import('./lib/_authority-profile.js')
  const resetHandler = createResetDemoAccountHandler({
    createAdminClient: createSupabaseAdminClient,
    loadAuthorityProfile: loadActiveAuthorityProfile,
  })
  return resetHandler(event)
}
