import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { createSupabaseAdminClient } from './lib/_supabase.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_ACTIONS = new Set(['create', 'view', 'approve', 'reject', 'complete'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
    body: JSON.stringify(payload),
  }
}

function httpError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode })
}

function optionalUuid(value, label) {
  const normalizedValue = normalizeText(value)

  if (normalizedValue && !UUID_PATTERN.test(normalizedValue)) {
    throw httpError('invalid_request', `${label} must be a valid ID.`, 400)
  }

  return normalizedValue || null
}

function getBearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function mapTransferError(error) {
  const detail = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()

  if (detail.includes('workspace_team_transfer_source_billing_review_required')) {
    return httpError('source_billing_review_required', 'The source Single Team billing must be cancelled or confirmed inactive before transfer.', 409)
  }

  if (detail.includes('workspace_team_transfer_source_user_review_required')) {
    return httpError('source_user_review_required', 'Review active source workspace users who are not assigned to the Team before transfer.', 409)
  }

  if (detail.includes('workspace_team_transfer_pending_owner_invite_review_required')) {
    return httpError('pending_owner_invite_review_required', 'Resolve the pending source workspace owner invite before transfer.', 409)
  }

  if (detail.includes('workspace_team_transfer_preservation_check_failed')) {
    return httpError('preservation_check_failed', 'The transfer was rolled back because preservation checks did not match.', 409)
  }

  if (detail.includes('workspace_team_transfer_not_permitted') || error?.code === '42501') {
    return httpError('not_permitted', 'This transfer action is not permitted for the signed-in account or current workspace state.', 403)
  }

  return error?.statusCode ? error : httpError('server_error', 'The controlled Team transfer could not be completed.', 500)
}

async function loadActor(event, supabaseAdmin) {
  const token = getBearerToken(event)

  if (!token) {
    throw httpError('unauthenticated', 'Sign in to review this Team transfer.', 401)
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user?.id) {
    throw httpError('unauthenticated', 'Sign in to review this Team transfer.', 401)
  }

  return loadActiveAuthorityProfile(supabaseAdmin, data.user, {
    select: 'id, email, username, name, role, role_label, role_rank, club_id, status',
  })
}

async function enrichTransfer(supabaseAdmin, transfer) {
  if (!transfer?.id) {
    return transfer
  }

  const [{ data: team }, { data: source }, { data: destination }] = await Promise.all([
    supabaseAdmin.from('teams').select('id, name').eq('id', transfer.teamId).maybeSingle(),
    supabaseAdmin.from('clubs').select('id, name').eq('id', transfer.sourceClubId).maybeSingle(),
    supabaseAdmin.from('clubs').select('id, name').eq('id', transfer.destinationClubId).maybeSingle(),
  ])

  return {
    ...transfer,
    teamName: normalizeText(team?.name) || 'Team',
    sourceWorkspaceName: normalizeText(source?.name) || 'Source workspace',
    destinationClubName: normalizeText(destination?.name) || 'Destination club',
  }
}

export async function manageWorkspaceTeamTransferResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
} = {}) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { success: false, code: 'method_not_allowed', message: 'Method Not Allowed' })
    }

    let body

    try {
      body = JSON.parse(event.body || '{}')
    } catch {
      throw httpError('invalid_request', 'Request body must be valid JSON.', 400)
    }

    const action = normalizeText(body.action).toLowerCase()

    if (!ALLOWED_ACTIONS.has(action)) {
      throw httpError('invalid_request', 'Choose a valid Team transfer action.', 400)
    }

    const actor = await loadActor(event, supabaseAdmin)
    const requestId = optionalUuid(body.requestId, 'Request ID')
    const teamId = optionalUuid(body.teamId, 'Team ID')
    const destinationClubId = optionalUuid(body.destinationClubId, 'Destination Club ID')

    if (action === 'create' && (!teamId || !destinationClubId)) {
      throw httpError('invalid_request', 'Team ID and destination Club ID are required.', 400)
    }

    if (action !== 'create' && !requestId) {
      throw httpError('invalid_request', 'Request ID is required.', 400)
    }

    const { data, error } = await supabaseAdmin.rpc('manage_workspace_team_transfer', {
      p_action: action,
      p_actor_id: actor.id,
      p_request_id: requestId,
      p_team_id: teamId,
      p_destination_club_id: destinationClubId,
    })

    if (error) {
      throw mapTransferError(error)
    }

    return jsonResponse(200, {
      success: true,
      transfer: await enrichTransfer(supabaseAdmin, data),
    })
  } catch (error) {
    const mappedError = mapTransferError(error)
    return jsonResponse(mappedError.statusCode || 500, {
      success: false,
      code: mappedError.code || 'server_error',
      message: mappedError.message,
    })
  }
}

export async function handler(event) {
  return manageWorkspaceTeamTransferResult(event)
}
