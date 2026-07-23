import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import {
  buildErrorWorkbook,
  buildTransferWorkbook,
  DATA_TRANSFER_FILENAME,
  DATA_TRANSFER_MAX_BYTES,
  DATA_TRANSFER_MIME,
  DATA_TRANSFER_RAW_RETENTION_DAYS,
  DATA_TRANSFER_TEMPLATE_VERSION,
  createPublicTransferReference,
  parseTransferWorkbook,
} from './lib/_data-transfer-workbook.js'
import { buildImportPlan, toWorkbookExportData } from './lib/_data-transfer-plan.js'

const PRIVATE_BUCKET = 'data-transfer-private'
const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'head_manager', 'manager'])

function response(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(payload) }
}

function workbookResponse(buffer, filename) {
  const safeFilename = String(filename || DATA_TRANSFER_FILENAME).replace(/[\r\n"\\/]/g, '-').replace(/[^a-z0-9._ -]/gi, '-').slice(0, 180) || DATA_TRANSFER_FILENAME
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'Content-Type': DATA_TRANSFER_MIME,
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: buffer.toString('base64'),
  }
}

function text(value) {
  return String(value ?? '').trim()
}

function bearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const match = String(header).match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function statusError(message, statusCode = 400, code = 'DATA_TRANSFER_ERROR') {
  return Object.assign(new Error(message), { statusCode, code })
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {}
  } catch {
    throw statusError('The request body is not valid JSON.', 400, 'INVALID_JSON')
  }
}

async function authenticate(event) {
  const token = bearerToken(event)
  if (!token) throw statusError('Login is required.', 401, 'LOGIN_REQUIRED')
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData?.user?.id) throw statusError('Login is required.', 401, 'LOGIN_REQUIRED')
  const authUser = authData.user
  const email = text(authUser.email).toLowerCase()
  const profile = await loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    select: 'id, email, name, username, role, role_label, role_rank, club_id, status',
  })
  if (!ALLOWED_ROLES.has(profile.role)) throw statusError('Data Transfer is not available for this role.', 403, 'ROLE_DENIED')
  if (profile.role !== 'super_admin' && Number(profile.role_rank || 0) < 50) throw statusError('Manager access is required.', 403, 'ROLE_DENIED')
  return {
    id: profile.id,
    email,
    name: text(profile.name || profile.username || profile.email),
    role: profile.role,
    roleRank: Number(profile.role_rank || 0),
    clubId: text(profile.club_id),
  }
}

async function listPlatformClubs() {
  const { data, error } = await supabaseAdmin.from('clubs').select('id, name, status').order('name')
  if (error) throw error
  return (data || []).map((club) => ({ id: club.id, name: text(club.name), status: text(club.status || 'active') }))
}

async function resolveScope(actor, body, { requireClub = true, requireSelection = false } = {}) {
  const requestedClubId = text(body.clubId)
  let clubId = actor.clubId
  let auditReason = ''
  if (actor.role === 'super_admin') {
    clubId = requestedClubId
    auditReason = text(body.auditReason)
    if (requireClub && !clubId) throw statusError('Select a club before using Data Transfer.', 400, 'CLUB_SCOPE_REQUIRED')
    if (requireClub && auditReason.length < 10) throw statusError('Enter a clear support or audit reason of at least 10 characters.', 400, 'AUDIT_REASON_REQUIRED')
  } else if (requestedClubId && requestedClubId !== actor.clubId) {
    throw statusError('The selected club is outside your account scope.', 403, 'CROSS_CLUB_SCOPE_DENIED')
  }
  if (!requireClub && !clubId) return null
  if (!clubId) throw statusError('Your account is not linked to a club.', 403, 'CLUB_SCOPE_REQUIRED')

  const [{ data: club, error: clubError }, { data: allTeams, error: teamsError }] = await Promise.all([
    supabaseAdmin.from('clubs').select('id, name, status').eq('id', clubId).maybeSingle(),
    supabaseAdmin.from('teams').select('id, club_id, name, status').eq('club_id', clubId).order('name'),
  ])
  if (clubError || !club) throw statusError('The selected club could not be loaded.', 404, 'CLUB_NOT_FOUND')
  if (teamsError) throw teamsError
  if (text(club.status || 'active') === 'suspended') throw statusError('This club workspace is suspended.', 403, 'CLUB_SUSPENDED')

  let authorizedTeams = allTeams || []
  const canManageAllTeams = actor.role === 'super_admin' || actor.role === 'admin'
  if (!canManageAllTeams) {
    const { data: assignments, error } = await supabaseAdmin.from('team_staff').select('team_id').eq('user_id', actor.id)
    if (error) throw error
    const assignedIds = new Set((assignments || []).map((row) => row.team_id))
    authorizedTeams = authorizedTeams.filter((team) => assignedIds.has(team.id))
    if (!authorizedTeams.length) throw statusError('No authorized team assignment is available for Data Transfer.', 403, 'TEAM_SCOPE_REQUIRED')
  }
  const requestedTeamIds = Array.isArray(body.teamIds) ? [...new Set(body.teamIds.map(text).filter(Boolean))] : []
  const requestedClubWideScope = body.clubWideScope === true
  if (requestedClubWideScope && !canManageAllTeams) throw statusError('Club-wide scope is not available for this role.', 403, 'CLUB_WIDE_SCOPE_DENIED')
  if (requestedClubWideScope && requestedTeamIds.length) throw statusError('Choose either club-wide scope or selected teams.', 400, 'SCOPE_SELECTION_CONFLICT')
  if (requireSelection && !requestedClubWideScope && !requestedTeamIds.length) throw statusError('Confirm club-wide scope or select at least one authorized team.', 400, 'TEAM_SCOPE_REQUIRED')
  if (requestedTeamIds.length) {
    const allowedIds = new Set(authorizedTeams.map((team) => team.id))
    if (requestedTeamIds.some((id) => !allowedIds.has(id))) throw statusError('One or more selected teams are outside your authorized scope.', 403, 'CROSS_TEAM_SCOPE_DENIED')
    authorizedTeams = authorizedTeams.filter((team) => requestedTeamIds.includes(team.id))
  }
  if (!canManageAllTeams && !authorizedTeams.length) throw statusError('Select at least one authorized team.', 400, 'TEAM_SCOPE_REQUIRED')
  const isClubWideScope = canManageAllTeams && (requestedClubWideScope || (!requireSelection && !requestedTeamIds.length))

  return {
    actorId: actor.id,
    actorRole: actor.role,
    clubId,
    clubName: text(club.name),
    auditReason,
    authorizedTeamIds: authorizedTeams.map((team) => team.id),
    teams: authorizedTeams.map((team) => ({ id: team.id, name: text(team.name), status: text(team.status || 'active') })),
    canManageClub: canManageAllTeams,
    canManageTeams: canManageAllTeams,
    canManageAllTeams,
    isClubWideScope,
  }
}

async function loadExisting(scope) {
  const teamFilter = scope.isClubWideScope ? null : scope.authorizedTeamIds
  const teamsQuery = supabaseAdmin.from('teams').select('id, club_id, name, transfer_reference, age_group, category, season, league, division, home_ground, training_day, training_time, status, updated_at').eq('club_id', scope.clubId)
  const playersQuery = supabaseAdmin.from('players').select('id, club_id, team_id, team, player_name, first_name, last_name, preferred_name, transfer_reference, date_of_birth, gender, section, shirt_number, positions, status, updated_at').eq('club_id', scope.clubId)
  const [clubResult, teamsResult, playersResult, guardiansResult, linksResult] = await Promise.all([
    supabaseAdmin.from('clubs').select('id, name, transfer_reference, fa_affiliation_number, address_line_1, address_line_2, town_city, county, postcode, country, primary_contact_name, primary_contact_email, primary_contact_phone, website, season, updated_at').eq('id', scope.clubId).single(),
    teamsQuery,
    playersQuery,
    supabaseAdmin.from('guardians').select('id, club_id, transfer_reference, first_name, last_name, email, phone, address_line_1, address_line_2, town_city, county, postcode, country, status, updated_at').eq('club_id', scope.clubId),
    supabaseAdmin.from('parent_player_links').select('id, club_id, team_id, player_id, guardian_id, email, relationship, primary_contact, receives_communications, emergency_contact, status').eq('club_id', scope.clubId),
  ])
  for (const result of [clubResult, teamsResult, playersResult, guardiansResult, linksResult]) if (result.error) throw result.error
  const allPlayers = playersResult.data || []
  const allGuardians = guardiansResult.data || []
  const allLinks = linksResult.data || []
  const scopedTeams = teamFilter ? (teamsResult.data || []).filter((team) => teamFilter.includes(team.id)) : (teamsResult.data || [])
  const scopedPlayers = teamFilter ? allPlayers.filter((player) => teamFilter.includes(player.team_id)) : allPlayers
  const scopedPlayerIds = new Set(scopedPlayers.map((player) => player.id))
  const scopedLinks = teamFilter ? allLinks.filter((link) => scopedPlayerIds.has(link.player_id) && teamFilter.includes(link.team_id)) : allLinks
  const scopedLinkIds = new Set(scopedLinks.map((link) => link.id))
  const scopedGuardianIds = new Set(scopedLinks.map((link) => link.guardian_id).filter(Boolean))
  const scopedGuardians = teamFilter ? allGuardians.filter((guardian) => scopedGuardianIds.has(guardian.id)) : allGuardians
  const publicRef = (entity, prefix) => text(entity?.transfer_reference) || createPublicTransferReference(prefix, entity?.id)
  const scopedClub = scope.canManageClub ? clubResult.data : {
    id: clubResult.data.id,
    name: clubResult.data.name,
    transfer_reference: clubResult.data.transfer_reference,
    season: clubResult.data.season,
    updated_at: clubResult.data.updated_at,
  }
  return {
    club: scopedClub,
    teams: scopedTeams,
    players: scopedPlayers,
    guardians: scopedGuardians,
    links: scopedLinks,
    restrictedPlayerReferences: teamFilter ? allPlayers.filter((player) => !scopedPlayerIds.has(player.id)).map((player) => publicRef(player, 'PLAYER')) : [],
    restrictedGuardianReferences: teamFilter ? allGuardians.filter((guardian) => !scopedGuardianIds.has(guardian.id)).map((guardian) => publicRef(guardian, 'GUARDIAN')) : [],
    legacyGuardianEmails: scopedLinks.filter((link) => !link.guardian_id).map((link) => text(link.email).toLowerCase()).filter(Boolean),
    restrictedGuardianEmails: teamFilter ? [
      ...allGuardians.filter((guardian) => !scopedGuardianIds.has(guardian.id)).map((guardian) => text(guardian.email).toLowerCase()),
      ...allLinks.filter((link) => !scopedLinkIds.has(link.id)).map((link) => text(link.email).toLowerCase()),
    ].filter(Boolean) : [],
  }
}

async function insertAudit({ action, actor, batchId = null, metadata = {}, scope }) {
  const { error } = await supabaseAdmin.from('data_transfer_audit_entries').insert({
    batch_id: batchId,
    actor_id: actor.id,
    club_id: scope.clubId,
    action,
    metadata: { ...metadata, actorRole: actor.role, authorizedTeamIds: scope.authorizedTeamIds, auditReason: scope.auditReason || undefined },
  })
  if (error) throw error
}

async function recordDownload({ actor, buffer, scope, transferType }) {
  const batchId = randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DATA_TRANSFER_RAW_RETENTION_DAYS * 86400000).toISOString()
  const { error } = await supabaseAdmin.from('data_transfer_batches').insert({
    id: batchId,
    actor_id: actor.id,
    actor_role: actor.role,
    club_id: scope.clubId,
    authorized_team_ids: scope.authorizedTeamIds,
    audit_reason: scope.auditReason || null,
    transfer_type: transferType,
    state: 'completed',
    template_version: DATA_TRANSFER_TEMPLATE_VERSION,
    workbook_name: DATA_TRANSFER_FILENAME,
    workbook_sha256: sha256(buffer),
    workbook_size_bytes: buffer.length,
    raw_expires_at: expiresAt,
    counts: {},
    completed_at: now.toISOString(),
  })
  if (error) throw error
  await insertAudit({ action: `data_transfer_${transferType}_downloaded`, actor, batchId, scope, metadata: { workbookSha256: sha256(buffer), sizeBytes: buffer.length } })
  return batchId
}

async function handleScope(actor, body) {
  if (actor.role === 'super_admin' && !text(body.clubId)) {
    return response(200, { success: true, role: actor.role, requiresClubSelection: true, clubs: await listPlatformClubs(), teams: [] })
  }
  const scope = await resolveScope(actor, body)
  return response(200, { success: true, role: actor.role, requiresAuditReason: actor.role === 'super_admin', club: { id: scope.clubId, name: scope.clubName }, teams: scope.teams, authorizedTeamIds: scope.authorizedTeamIds, canManageClub: scope.canManageClub, canManageTeams: scope.canManageTeams, isClubWideScope: scope.isClubWideScope })
}

async function handleDownload(actor, body, transferType) {
  const scope = await resolveScope(actor, body, { requireSelection: true })
  const existing = transferType === 'export' ? await loadExisting(scope) : null
  const data = existing ? toWorkbookExportData(existing, scope) : {}
  const scopeLabel = `${scope.clubName}${scope.isClubWideScope ? ' | Club-wide' : ` | ${scope.teams.map((team) => team.name).join(', ')}`}`
  const buffer = await buildTransferWorkbook({ data, mode: transferType, scopeLabel })
  await recordDownload({ actor, buffer, scope, transferType: transferType === 'blank' ? 'blank_template' : 'export' })
  return workbookResponse(buffer, DATA_TRANSFER_FILENAME)
}

async function handleInspect(actor, body) {
  const scope = await resolveScope(actor, body, { requireSelection: true })
  const importOptions = {
    allowTeamCreation: body.allowTeamCreation === true,
    createPossibleDuplicates: body.createPossibleDuplicates === true,
    fillBlankFields: body.fillBlankFields === true,
    importMode: text(body.importMode) || 'additive',
    season: text(body.season),
    updateConflicts: body.updateConflicts === true,
  }
  if (importOptions.importMode !== 'additive') throw statusError('Only the additive V1 import mode is supported.', 400, 'IMPORT_MODE_UNSUPPORTED')
  if (text(body.mimeType) && text(body.mimeType) !== DATA_TRANSFER_MIME) throw statusError('Only XLSX workbooks are supported.', 415, 'UNSUPPORTED_MEDIA_TYPE')
  const base64 = text(body.workbookBase64)
  if (!base64) throw statusError('Choose an XLSX workbook to inspect.', 400, 'WORKBOOK_REQUIRED')
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > DATA_TRANSFER_MAX_BYTES) throw statusError('The workbook exceeds the 4 MB upload limit.', 413, 'WORKBOOK_TOO_LARGE')
  const workbookSha256 = sha256(buffer)
  const batchId = randomUUID()
  const storagePath = `${scope.clubId}/${batchId}.xlsx`
  const expiresAt = new Date(Date.now() + DATA_TRANSFER_RAW_RETENTION_DAYS * 86400000).toISOString()
  let parsed
  try {
    parsed = await parseTransferWorkbook(buffer)
  } catch (error) {
    parsed = { templateVersion: DATA_TRANSFER_TEMPLATE_VERSION, rowsBySheet: {}, errors: [{ sheet: '', row: 0, column: '', code: error.code || 'WORKBOOK_REJECTED', message: error.message }] }
  }
  let planResult = { plan: null, planSha256: '', counts: { total: 0, error: parsed.errors.length }, errors: [], warnings: [], rowResults: [] }
  if (Object.keys(parsed.rowsBySheet).length) {
    const existing = await loadExisting(scope)
    planResult = buildImportPlan({ actorScope: scope, existing, importOptions, rowsBySheet: parsed.rowsBySheet })
  }
  const errors = [...parsed.errors, ...planResult.errors]
  const state = errors.length ? 'invalid' : 'ready_for_review'
  const confirmationToken = errors.length ? '' : randomUUID()
  const confirmationSha256 = confirmationToken ? sha256(confirmationToken) : null
  const { error: uploadError } = await supabaseAdmin.storage.from(PRIVATE_BUCKET).upload(storagePath, buffer, { contentType: DATA_TRANSFER_MIME, upsert: false })
  if (uploadError) throw uploadError
  const { error: batchError } = await supabaseAdmin.from('data_transfer_batches').insert({
    id: batchId,
    actor_id: actor.id,
    actor_role: actor.role,
    club_id: scope.clubId,
    authorized_team_ids: scope.authorizedTeamIds,
    audit_reason: scope.auditReason || null,
    transfer_type: 'import',
    state,
    template_version: parsed.templateVersion || DATA_TRANSFER_TEMPLATE_VERSION,
    workbook_name: text(body.fileName) || DATA_TRANSFER_FILENAME,
    workbook_sha256: workbookSha256,
    workbook_size_bytes: buffer.length,
    storage_path: storagePath,
    raw_expires_at: expiresAt,
    options: { ...importOptions, teamIds: scope.authorizedTeamIds },
    plan: planResult.plan,
    plan_sha256: planResult.planSha256 || null,
    confirmation_sha256: confirmationSha256,
    counts: planResult.counts,
    warnings: planResult.warnings,
    error_summary: errors,
  })
  if (batchError) {
    await supabaseAdmin.storage.from(PRIVATE_BUCKET).remove([storagePath])
    throw batchError
  }
  if (planResult.rowResults.length) {
    const { error: rowsError } = await supabaseAdmin.from('data_transfer_row_results').insert(planResult.rowResults.map((row) => ({ ...row, batch_id: batchId })))
    if (rowsError) throw rowsError
  }
  await insertAudit({ action: errors.length ? 'data_transfer_inspection_invalid' : 'data_transfer_preview_ready', actor, batchId, scope, metadata: { workbookSha256, counts: planResult.counts, errorCount: errors.length } })
  return response(200, {
    success: true,
    batch: { id: batchId, state, workbookSha256, templateVersion: parsed.templateVersion, expiresAt, counts: planResult.counts },
    confirmationToken,
    errors,
    warnings: planResult.warnings,
    preview: planResult.rowResults.map((row) => ({ sheet: row.sheet_name, row: row.source_row, entityType: row.entity_type, reference: row.transfer_reference, outcome: row.outcome, codes: row.codes, explanation: row.explanation, proposedChanges: row.proposed_changes })),
  })
}

async function loadBatchForActor(actor, batchId) {
  const { data: batch, error } = await supabaseAdmin.from('data_transfer_batches').select('*').eq('id', batchId).maybeSingle()
  if (error || !batch) throw statusError('Transfer batch was not found.', 404, 'BATCH_NOT_FOUND')
  const scope = await resolveScope(actor, { clubId: batch.club_id, auditReason: batch.audit_reason || 'Existing transfer audit' })
  const allowedTeams = new Set(scope.authorizedTeamIds)
  const batchTeamIds = batch.authorized_team_ids || []
  if (!scope.canManageAllTeams && batchTeamIds.some((id) => !allowedTeams.has(id))) throw statusError('This transfer batch is outside your team scope.', 403, 'BATCH_SCOPE_DENIED')
  const batchScope = {
    ...scope,
    authorizedTeamIds: batchTeamIds,
    teams: scope.teams.filter((team) => batchTeamIds.includes(team.id)),
    isClubWideScope: scope.canManageAllTeams && batchTeamIds.length === scope.teams.length,
  }
  return { batch, scope: batchScope }
}

async function handleConfirm(actor, body) {
  const batchId = text(body.batchId)
  const token = text(body.confirmationToken)
  if (!batchId || !token) throw statusError('Batch confirmation details are required.', 400, 'CONFIRMATION_REQUIRED')
  const { batch, scope } = await loadBatchForActor(actor, batchId)
  if (batch.actor_id !== actor.id) throw statusError('The transfer plan is bound to the account that created it.', 403, 'ACTOR_BINDING_MISMATCH')
  if (batch.confirmation_sha256 !== sha256(token)) throw statusError('The confirmation token is invalid.', 403, 'CONFIRMATION_INVALID')
  if (!['ready_for_review', 'awaiting_confirmation', 'completed', 'completed_with_warnings'].includes(batch.state)) throw statusError('This transfer is not ready for confirmation.', 409, 'BATCH_STATE_INVALID')
  if (batch.state === 'ready_for_review') {
    const { data: claimed, error } = await supabaseAdmin.from('data_transfer_batches').update({ state: 'awaiting_confirmation', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', batch.id).eq('state', 'ready_for_review').select('id').maybeSingle()
    if (error) throw error
    if (!claimed) {
      const { data: current } = await supabaseAdmin.from('data_transfer_batches').select('state').eq('id', batch.id).single()
      if (!['awaiting_confirmation', 'processing', 'completed', 'completed_with_warnings'].includes(current?.state)) throw statusError('This transfer was changed before confirmation.', 409, 'STALE_CONFIRMATION')
    }
  }
  const { data, error } = await supabaseAdmin.rpc('execute_data_transfer_import', { batch_id_value: batch.id, plan_sha256_value: batch.plan_sha256 })
  if (error) throw error
  if (data?.state === 'failed') throw statusError('The import transaction failed without committing business records. Review the batch error report.', 409, data.errorCode || 'IMPORT_TRANSACTION_FAILED')
  await insertAudit({ action: data?.idempotent ? 'data_transfer_confirmation_retried' : 'data_transfer_confirmation_accepted', actor, batchId: batch.id, scope, metadata: { planSha256: batch.plan_sha256, idempotent: Boolean(data?.idempotent) } })
  return response(200, { success: true, result: data })
}

async function handleHistory(actor, body) {
  const scope = await resolveScope(actor, body)
  const { data, error } = await supabaseAdmin.from('data_transfer_batches')
    .select('id, actor_id, actor_role, authorized_team_ids, transfer_type, state, template_version, workbook_name, workbook_sha256, counts, warnings, error_summary, storage_path, created_at, completed_at, rolled_back_at, rollback_blocked_reason, raw_expires_at')
    .eq('club_id', scope.clubId).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  const allowed = new Set(scope.authorizedTeamIds)
  const scopedHistory = (data || []).filter((batch) => scope.isClubWideScope || (batch.authorized_team_ids || []).every((id) => allowed.has(id)))
  const actorIds = [...new Set(scopedHistory.map((batch) => batch.actor_id).filter(Boolean))]
  const { data: actors, error: actorsError } = actorIds.length
    ? await supabaseAdmin.from('users').select('id, name, username').in('id', actorIds)
    : { data: [], error: null }
  if (actorsError) throw actorsError
  const actorNames = new Map((actors || []).map((entry) => [entry.id, text(entry.name || entry.username) || 'Staff user']))
  const teamNames = new Map(scope.teams.map((team) => [team.id, team.name]))
  const now = Date.now()
  const history = scopedHistory.map(({ storage_path: storagePath, ...batch }) => {
    const batchTeamIds = batch.authorized_team_ids || []
    const scopedNames = batchTeamIds.map((id) => teamNames.get(id)).filter(Boolean)
    const clubWide = scope.isClubWideScope && ['super_admin', 'admin'].includes(batch.actor_role) && batchTeamIds.length === scope.teams.length
    const scopeLabel = clubWide ? 'Club-wide' : scopedNames.join(', ') || 'Authorized teams'
    return {
      ...batch,
      actor_name: actorNames.get(batch.actor_id) || 'Staff user',
      scope_label: scopeLabel,
      raw_available: Boolean(storagePath) && Number.isFinite(Date.parse(batch.raw_expires_at)) && Date.parse(batch.raw_expires_at) > now,
    }
  })
  return response(200, { success: true, history })
}

async function handleDetails(actor, body) {
  const { batch } = await loadBatchForActor(actor, text(body.batchId))
  const [{ data: rows, error }, { data: importRecords, error: recordsError }] = await Promise.all([
    supabaseAdmin.from('data_transfer_row_results').select('sheet_name, source_row, entity_type, transfer_reference, outcome, codes, explanation, proposed_changes').eq('batch_id', batch.id).order('id'),
    supabaseAdmin.from('data_transfer_import_records').select('entity_type, entity_id, action, before_data, after_data').eq('batch_id', batch.id).order('id'),
  ])
  if (error) throw error
  if (recordsError) throw recordsError
  const referenceById = new Map()
  for (const entityType of ['teams', 'players', 'guardians']) {
    for (const item of batch.plan?.[entityType] || []) {
      if (item.entity_id && item.values?.transfer_reference) referenceById.set(item.entity_id, item.values.transfer_reference)
    }
  }
  for (const record of importRecords || []) {
    const reference = text(record.after_data?.transfer_reference || record.before_data?.transfer_reference)
    if (record.entity_id && reference) referenceById.set(record.entity_id, reference)
  }
  const affectedRecords = (importRecords || []).map((record) => {
    let reference = text(record.after_data?.transfer_reference || record.before_data?.transfer_reference)
    if (record.entity_type === 'link') {
      const playerReference = referenceById.get(record.after_data?.player_id) || 'Player relationship'
      const guardianReference = referenceById.get(record.after_data?.guardian_id) || 'guardian relationship'
      reference = `${playerReference} to ${guardianReference}`
    }
    return { entityType: record.entity_type, action: record.action, reference: reference || 'No public reference', rollbackState: batch.state === 'rolled_back' ? 'rolled_back' : batch.state === 'rollback_blocked' ? 'manual_review' : 'retained' }
  })
  return response(200, { success: true, batch: { id: batch.id, state: batch.state, counts: batch.counts, warnings: batch.warnings, errors: batch.error_summary, createdAt: batch.created_at, completedAt: batch.completed_at, rollbackBlockedReason: batch.rollback_blocked_reason }, preview: rows || [], affectedRecords })
}

async function handleErrorReport(actor, body) {
  const { batch, scope } = await loadBatchForActor(actor, text(body.batchId))
  const { data: rows, error: rowsError } = await supabaseAdmin.from('data_transfer_row_results').select('sheet_name, source_row, transfer_reference, outcome').eq('batch_id', batch.id)
  if (rowsError) throw rowsError
  const rowLookup = new Map((rows || []).map((row) => [`${row.sheet_name}|${row.source_row}`, row]))
  const toReportEntry = (entry, status) => {
    const sheet = text(entry.sheet || entry.sheet_name)
    const rowNumber = Number(entry.row || entry.source_row || 0)
    const rowResult = rowLookup.get(`${sheet}|${rowNumber}`)
    return {
      sheet,
      row: rowNumber,
      reference: text(entry.reference || entry.transfer_reference || rowResult?.transfer_reference),
      status: status || text(entry.status || rowResult?.outcome || 'Error'),
      column: text(entry.column),
      code: text(entry.code || 'WORKBOOK_ERROR'),
      message: text(entry.message || entry.explanation || 'Review this row.'),
      suggestedCorrection: text(entry.suggestedCorrection || entry.suggested_correction),
    }
  }
  const reportEntries = [
    ...(batch.error_summary || []).map((entry) => toReportEntry(entry, 'Error')),
    ...(batch.warnings || []).map((entry) => toReportEntry(entry, 'Warning')),
  ]
  const buffer = await buildErrorWorkbook(reportEntries)
  await insertAudit({ action: 'data_transfer_error_report_downloaded', actor, batchId: batch.id, scope, metadata: { errorCount: batch.error_summary?.length || 0, warningCount: batch.warnings?.length || 0 } })
  return workbookResponse(buffer, `footballplayer-online-import-errors-${batch.id}.xlsx`)
}

async function handleRawWorkbook(actor, body) {
  const { batch, scope } = await loadBatchForActor(actor, text(body.batchId))
  if (!batch.storage_path) throw statusError('The retained raw workbook is no longer available.', 410, 'RAW_WORKBOOK_EXPIRED')
  const expiresAt = Date.parse(batch.raw_expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw statusError('The retained raw workbook has expired.', 410, 'RAW_WORKBOOK_EXPIRED')
  const { data, error } = await supabaseAdmin.storage.from(PRIVATE_BUCKET).download(batch.storage_path)
  if (error || !data) throw statusError('The retained raw workbook could not be downloaded.', 404, 'RAW_WORKBOOK_NOT_FOUND')
  const buffer = Buffer.from(await data.arrayBuffer())
  if (sha256(buffer) !== batch.workbook_sha256) throw statusError('The retained raw workbook failed its integrity check.', 409, 'RAW_WORKBOOK_INTEGRITY_FAILED')
  await insertAudit({ action: 'data_transfer_raw_workbook_downloaded', actor, batchId: batch.id, scope, metadata: { workbookSha256: batch.workbook_sha256, rawExpiresAt: batch.raw_expires_at } })
  return workbookResponse(buffer, batch.workbook_name || DATA_TRANSFER_FILENAME)
}

async function handleRollback(actor, body) {
  const { batch, scope } = await loadBatchForActor(actor, text(body.batchId))
  if (batch.transfer_type !== 'import') throw statusError('Only a confirmed import can be rolled back.', 409, 'ROLLBACK_NOT_AVAILABLE')
  const { data, error } = await supabaseAdmin.rpc('rollback_data_transfer_import', { batch_id_value: batch.id })
  if (error) throw error
  if (data?.state === 'rollback_blocked') throw statusError(data.reason || 'Rollback was blocked because later changes or dependencies were found.', 409, 'ROLLBACK_BLOCKED')
  await insertAudit({ action: data?.idempotent ? 'data_transfer_rollback_retried' : 'data_transfer_rollback_requested', actor, batchId: batch.id, scope, metadata: { idempotent: Boolean(data?.idempotent) } })
  return response(200, { success: true, result: data })
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, { success: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' })
  let operation = 'unknown'
  try {
    const body = parseBody(event)
    operation = text(body.operation)
    const actor = await authenticate(event)
    if (operation === 'scope') return handleScope(actor, body)
    if (operation === 'blank') return handleDownload(actor, body, 'blank')
    if (operation === 'export') return handleDownload(actor, body, 'export')
    if (operation === 'inspect') return handleInspect(actor, body)
    if (operation === 'confirm') return handleConfirm(actor, body)
    if (operation === 'history') return handleHistory(actor, body)
    if (operation === 'details') return handleDetails(actor, body)
    if (operation === 'error-report') return handleErrorReport(actor, body)
    if (operation === 'raw-workbook') return handleRawWorkbook(actor, body)
    if (operation === 'rollback') return handleRollback(actor, body)
    throw statusError('Unknown Data Transfer operation.', 400, 'UNKNOWN_OPERATION')
  } catch (error) {
    console.error('Data Transfer request failed', { operation, code: error.code || 'UNEXPECTED_ERROR', statusCode: error.statusCode || 500 })
    return response(error.statusCode || 500, { success: false, code: error.code || 'DATA_TRANSFER_FAILED', message: error.message || 'Data Transfer could not complete the request.' })
  }
}
