import { createHash } from 'node:crypto'
import { createPublicTransferReference, SHEET_DEFINITIONS } from './_data-transfer-workbook.js'

const ENTITY_CONFIG = {
  'Club Details': { key: 'club', entityType: 'club', prefix: 'CLUB' },
  Teams: { key: 'teams', entityType: 'team', prefix: 'TEAM' },
  Players: { key: 'players', entityType: 'player', prefix: 'PLAYER' },
  Guardians: { key: 'guardians', entityType: 'guardian', prefix: 'GUARDIAN' },
  'Player-Guardian Links': { key: 'links', entityType: 'link', prefix: 'LINK' },
}

function normalizeScalar(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(normalizeScalar).filter(Boolean)
  return String(value).trim()
}

function normalizeReference(value) {
  return normalizeScalar(value).toLowerCase()
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256Json(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function publicRef(entity, prefix) {
  return normalizeScalar(entity?.transfer_reference) || createPublicTransferReference(prefix, entity?.id)
}

function valuesForSheet(sheetName, source) {
  const definition = SHEET_DEFINITIONS.find((candidate) => candidate.name === sheetName)
  const values = {}
  for (const [, key] of definition.columns) {
    let value = source?.[key]
    if (key === 'team_reference' && !value) value = source?.teamReference
    if (key === 'player_reference' && !value) value = source?.playerReference
    if (key === 'guardian_reference' && !value) value = source?.guardianReference
    if (key === 'positions') value = Array.isArray(value) ? value : normalizeScalar(value).split(',').map((entry) => entry.trim()).filter(Boolean)
    values[key] = normalizeScalar(value)
  }
  return values
}

function isBlank(value) {
  return Array.isArray(value) ? value.length === 0 : value === '' || value === null || value === undefined
}

function createFieldChanges(values) {
  return Object.entries(values).filter(([, value]) => !isBlank(value)).map(([field, value]) => ({
    field,
    platform_value: '',
    workbook_value: value,
    proposed_action: 'create',
  }))
}

function reviewExistingFields(sheetName, incoming, existing, options) {
  const workbookValues = valuesForSheet(sheetName, incoming)
  const platformValues = valuesForSheet(sheetName, existing)
  const finalValues = { ...platformValues }
  const fieldChanges = []
  let approvedChanges = 0
  let blockedChanges = 0

  for (const [field, workbookValue] of Object.entries(workbookValues)) {
    const platformValue = platformValues[field]
    if (stableStringify(workbookValue) === stableStringify(platformValue)) continue
    if (isBlank(workbookValue) && !isBlank(platformValue)) {
      fieldChanges.push({ field, platform_value: platformValue, workbook_value: workbookValue, proposed_action: 'keep_platform_value' })
      continue
    }
    const platformBlank = isBlank(platformValue)
    const approved = platformBlank ? options.fillBlankFields : options.updateConflicts
    fieldChanges.push({
      field,
      platform_value: platformValue,
      workbook_value: workbookValue,
      proposed_action: approved ? 'use_workbook_value' : platformBlank ? 'confirm_fill_blank' : 'confirm_populated_update',
    })
    if (approved) {
      finalValues[field] = workbookValue
      approvedChanges += 1
    } else {
      blockedChanges += 1
    }
  }

  return { workbookValues, finalValues, fieldChanges, approvedChanges, blockedChanges }
}

function rowResult({ action, codes = [], explanation = '', fieldChanges = [], row, sheetName, sourceValues, values }) {
  const transferReference = values.transfer_reference || `${values.player_reference || ''}|${values.guardian_reference || ''}`
  return {
    sheet_name: sheetName,
    source_row: row._sourceRow,
    entity_type: ENTITY_CONFIG[sheetName].entityType,
    transfer_reference: transferReference,
    outcome: action,
    codes,
    explanation,
    proposed_changes: { final_values: values, fields: fieldChanges },
    row_sha256: sha256Json(sourceValues || values),
  }
}

function addError(state, { code, message, row, sheetName, column = '' }) {
  state.errors.push({ sheet: sheetName, row: row?._sourceRow || 0, column, code, message })
}

function mapExisting(entities, prefix) {
  return new Map((entities || []).map((entity) => [normalizeReference(publicRef(entity, prefix)), entity]))
}

function mapIncomingPlan(planItems) {
  const mapped = new Map()
  for (const item of planItems) {
    for (const key of [item.planning_handle, item.values.transfer_reference]) {
      const normalized = normalizeReference(key)
      if (normalized) mapped.set(normalized, item)
    }
  }
  return mapped
}

function findExistingById(entities, id) {
  const normalizedId = normalizeScalar(id)
  if (!normalizedId) return null
  return (entities || []).find((entity) => entity.id === normalizedId) || null
}

export function buildImportPlan({ actorScope, existing, importOptions = {}, rowsBySheet }) {
  const state = { errors: [], warnings: [], rowResults: [] }
  const scopeCoversAllTeams = actorScope.isClubWideScope ?? actorScope.canManageAllTeams
  const authorizedTeamIds = new Set(actorScope.authorizedTeamIds || [])
  const options = {
    allowTeamCreation: importOptions.allowTeamCreation === true,
    createPossibleDuplicates: importOptions.createPossibleDuplicates === true,
    fillBlankFields: importOptions.fillBlankFields === true,
    importMode: 'additive',
    planningMode: importOptions.planningMode === 'ordinary' ? 'ordinary' : 'portable',
    season: normalizeScalar(importOptions.season),
    updateConflicts: importOptions.updateConflicts === true,
  }
  const ordinaryMode = options.planningMode === 'ordinary'
  const plan = {
    context: {
      planning_mode: options.planningMode,
      selected_season: options.season,
    },
    club: null,
    teams: [],
    players: [],
    guardians: [],
    links: [],
  }

  const clubRows = rowsBySheet['Club Details'] || []
  if (clubRows.length !== 1) {
    addError(state, { code: 'CLUB_DETAILS_REQUIRED', message: 'Exactly one Club Details row is required.', row: clubRows[0], sheetName: 'Club Details' })
  } else {
    const row = clubRows[0]
    if (!options.season) addError(state, { code: 'IMPORT_SEASON_REQUIRED', message: 'Confirm the target season before inspection.', row, sheetName: 'Club Details', column: 'Season' })
    const current = {
      ...existing.club,
      transfer_reference: ordinaryMode ? normalizeScalar(existing.club?.transfer_reference) : publicRef(existing.club, 'CLUB'),
    }
    const sourceValues = valuesForSheet('Club Details', ordinaryMode ? current : row)
    const workbookValues = ordinaryMode
      ? sourceValues
      : { ...sourceValues, season: normalizeScalar(current.season) }
    const anchorSeasonConflict = !ordinaryMode
      && !isBlank(sourceValues.season)
      && sourceValues.season !== normalizeScalar(current.season)
    let action = 'unchanged'
    let explanation = ordinaryMode ? 'The selected club is an immutable authorised scope anchor for this ordinary import.' : 'No club changes.'
    let fieldChanges = []
    let finalValues = valuesForSheet('Club Details', current)
    if (!ordinaryMode) {
      if (row.season && options.season && normalizeScalar(row.season) !== options.season) addError(state, { code: 'IMPORT_SEASON_MISMATCH', message: `The workbook season ${normalizeScalar(row.season)} does not match the confirmed season ${options.season}.`, row, sheetName: 'Club Details', column: 'Season' })
      const review = reviewExistingFields('Club Details', workbookValues, current, options)
      action = review.blockedChanges ? 'conflict' : review.approvedChanges ? 'update' : 'unchanged'
      explanation = review.blockedChanges ? 'Club field changes need the matching import decision before they can be confirmed.' : review.approvedChanges ? 'Apply the reviewed club field changes.' : 'No club changes.'
      fieldChanges = review.fieldChanges
      finalValues = review.finalValues
      if (review.blockedChanges) addError(state, { code: 'FIELD_CONFLICT_REQUIRES_CONFIRMATION', message: explanation, row, sheetName: 'Club Details' })
      if (anchorSeasonConflict) {
        action = 'conflict'
        explanation = 'The selected club season is an immutable scope anchor for this import.'
        addError(state, { code: 'CLUB_ANCHOR_SEASON_IMMUTABLE', message: explanation, row, sheetName: 'Club Details', column: 'Season' })
      }
      if ((review.blockedChanges || review.approvedChanges) && !actorScope.canManageClub) {
        action = 'conflict'
        explanation = 'This role cannot change club details.'
        addError(state, { code: 'CLUB_CHANGE_NOT_AUTHORIZED', message: explanation, row, sheetName: 'Club Details' })
      }
    }
    plan.club = { action, entity_id: existing.club.id, expected_updated_at: existing.club.updated_at || '', source_row: row._sourceRow, values: finalValues }
    state.rowResults.push(rowResult({ action, explanation, fieldChanges, row, sheetName: 'Club Details', sourceValues, values: finalValues }))
  }

  const existingTeamList = existing.teams || []
  const existingTeams = mapExisting(existingTeamList, 'TEAM')
  const teamNameMap = new Map(existingTeamList.map((team) => [normalizeReference(team.name), team]))
  for (const row of rowsBySheet.Teams || []) {
    const sourceValues = valuesForSheet('Teams', { ...row, season: row.season || options.season })
    const resolvedEntityId = ordinaryMode ? normalizeScalar(row._resolvedEntityId) : ''
    const resolvedById = findExistingById(existingTeamList, resolvedEntityId)
    const resolvedIdentityDenied = Boolean(resolvedEntityId) && (
      !resolvedById
      || (!scopeCoversAllTeams && !authorizedTeamIds.has(resolvedEntityId))
    )
    const current = resolvedIdentityDenied
      ? null
      : resolvedById || existingTeams.get(normalizeReference(sourceValues.transfer_reference))
    const immutableScopeTeam = ordinaryMode && current
    if (!ordinaryMode && row.season && options.season && normalizeScalar(row.season) !== options.season) addError(state, { code: 'IMPORT_SEASON_MISMATCH', message: `The workbook season ${normalizeScalar(row.season)} does not match the confirmed season ${options.season}.`, row, sheetName: 'Teams', column: 'Season' })
    const currentWithReference = current ? {
      ...current,
      transfer_reference: ordinaryMode ? normalizeScalar(current.transfer_reference) : publicRef(current, 'TEAM'),
    } : null
    const currentValues = current ? valuesForSheet('Teams', currentWithReference) : null
    const reviewSourceValues = current
      ? { ...sourceValues, season: normalizeScalar(current.season) }
      : sourceValues
    const anchorSeasonConflict = !ordinaryMode
      && current
      && !isBlank(normalizeScalar(row.season))
      && normalizeScalar(row.season) !== normalizeScalar(current.season)
    const review = current && !immutableScopeTeam ? reviewExistingFields('Teams', reviewSourceValues, currentWithReference, options) : null
    const values = immutableScopeTeam ? currentValues : review?.finalValues || sourceValues
    const fieldChanges = immutableScopeTeam ? [] : review?.fieldChanges || createFieldChanges(values)
    let action = current ? (immutableScopeTeam ? 'unchanged' : review.blockedChanges ? 'conflict' : review.approvedChanges ? 'update' : 'unchanged') : 'create'
    let explanation = immutableScopeTeam ? 'The selected existing team is an immutable authorised scope anchor for this ordinary import.' : action === 'create' ? 'Create team.' : action === 'update' ? 'Apply the reviewed team field changes.' : action === 'conflict' ? 'Team field changes need the matching import decision before they can be confirmed.' : 'No team changes.'
    if (review?.blockedChanges) addError(state, { code: 'FIELD_CONFLICT_REQUIRES_CONFIRMATION', message: explanation, row, sheetName: 'Teams' })
    if (anchorSeasonConflict) {
      action = 'conflict'
      explanation = 'The selected existing team season is an immutable scope anchor for this import.'
      addError(state, { code: 'TEAM_ANCHOR_SEASON_IMMUTABLE', message: explanation, row, sheetName: 'Teams', column: 'Season' })
    }
    if (resolvedIdentityDenied) {
      action = 'conflict'
      explanation = 'The resolved team identity is outside the authorised team scope.'
      addError(state, { code: 'TEAM_SCOPE_DENIED', message: explanation, row, sheetName: 'Teams' })
    }
    const nameCandidate = !current && !resolvedEntityId ? teamNameMap.get(normalizeReference(sourceValues.name)) : null
    if (nameCandidate && !options.createPossibleDuplicates) {
      action = 'possible_duplicate'
      explanation = `A team with this name exists as ${publicRef(nameCandidate, 'TEAM')}. Use that reference to link it, or explicitly allow a separate record.`
      addError(state, { code: 'POSSIBLE_DUPLICATE_TEAM', message: explanation, row, sheetName: 'Teams', column: 'Team Name' })
    } else if (nameCandidate) {
      explanation = `Create a separate team after explicit duplicate review of ${publicRef(nameCandidate, 'TEAM')}.`
    }
    if (!current && action === 'create' && !options.allowTeamCreation) {
      action = 'conflict'
      explanation = 'Team creation was not explicitly confirmed for this import.'
      addError(state, { code: 'TEAM_CREATION_NOT_CONFIRMED', message: explanation, row, sheetName: 'Teams' })
    }
    if (!current && action === 'create' && !scopeCoversAllTeams) {
      action = 'conflict'
      explanation = 'Creating a new team requires explicitly confirmed club-wide scope.'
      addError(state, { code: 'TEAM_CREATION_SCOPE_DENIED', message: explanation, row, sheetName: 'Teams' })
    }
    if (current && !scopeCoversAllTeams && !authorizedTeamIds.has(current.id)) {
      action = 'conflict'
      explanation = 'This team is outside the authorized team scope.'
      addError(state, { code: 'TEAM_SCOPE_DENIED', message: explanation, row, sheetName: 'Teams' })
    }
    if ((!current || review?.approvedChanges) && !actorScope.canManageTeams) {
      action = 'conflict'
      explanation = 'This role can use existing authorized teams but cannot create or change teams.'
      addError(state, { code: 'TEAM_CHANGE_NOT_AUTHORIZED', message: explanation, row, sheetName: 'Teams' })
    }
    const item = {
      action,
      entity_id: current?.id || '',
      expected_updated_at: current?.updated_at || '',
      planning_handle: normalizeScalar(row._planningHandle) || sourceValues.transfer_reference,
      source_row: row._sourceRow,
      values,
    }
    plan.teams.push(item)
    state.rowResults.push(rowResult({ action, explanation, fieldChanges, row, sheetName: 'Teams', sourceValues, values }))
  }

  const plannedTeams = mapIncomingPlan(plan.teams)
  const existingPlayerList = existing.players || []
  const existingPlayers = mapExisting(existingPlayerList, 'PLAYER')
  const restrictedPlayerReferences = new Set((existing.restrictedPlayerReferences || []).map(normalizeReference))
  const playerIdentityMap = new Map((existing.players || []).map((player) => [
    [normalizeReference(player.first_name || player.player_name), normalizeReference(player.last_name), normalizeScalar(player.date_of_birth)].join('|'),
    player,
  ]))
  for (const row of rowsBySheet.Players || []) {
    const workbookValues = valuesForSheet('Players', row)
    const teamPlan = plannedTeams.get(normalizeReference(row._teamPlanningHandle || workbookValues.team_reference))
    const teamCurrent = teamPlan?.entity_id ? (existing.teams || []).find((team) => team.id === teamPlan.entity_id) : null
    const teamUnavailable = !teamPlan || ['conflict', 'possible_duplicate'].includes(teamPlan.action)
    if (teamUnavailable) {
      addError(state, { code: 'PLAYER_TEAM_UNAVAILABLE', message: 'The player team is not available in the confirmed plan.', row, sheetName: 'Players', column: 'Team Reference' })
    }
    if (teamCurrent && !scopeCoversAllTeams && !authorizedTeamIds.has(teamCurrent.id)) {
      addError(state, { code: 'PLAYER_TEAM_SCOPE_DENIED', message: 'The player belongs to a team outside the authorized scope.', row, sheetName: 'Players', column: 'Team Reference' })
    }
    const resolvedEntityId = ordinaryMode ? normalizeScalar(row._resolvedEntityId) : ''
    const resolvedById = findExistingById(existingPlayerList, resolvedEntityId)
    const resolvedIdentityDenied = Boolean(resolvedEntityId) && !resolvedById
    const current = resolvedIdentityDenied
      ? null
      : resolvedById || existingPlayers.get(normalizeReference(workbookValues.transfer_reference))
    const currentTeam = current ? (existing.teams || []).find((team) => team.id === current.team_id) : null
    const comparableCurrent = current ? {
      ...current,
      transfer_reference: ordinaryMode ? normalizeScalar(current.transfer_reference) : publicRef(current, 'PLAYER'),
      team_reference: currentTeam
        ? ordinaryMode ? normalizeScalar(currentTeam.transfer_reference) : publicRef(currentTeam, 'TEAM')
        : '',
    } : null
    const review = current ? reviewExistingFields('Players', workbookValues, comparableCurrent, options) : null
    const values = review?.finalValues || workbookValues
    const fieldChanges = review?.fieldChanges || createFieldChanges(values)
    let action = current ? (review.blockedChanges ? 'conflict' : review.approvedChanges ? 'update' : 'unchanged') : 'create'
    let explanation = action === 'create' ? 'Create player.' : action === 'update' ? 'Apply the reviewed player field changes.' : action === 'conflict' ? 'Player field changes need the matching import decision before they can be confirmed.' : 'No player changes.'
    if (review?.blockedChanges) addError(state, { code: 'FIELD_CONFLICT_REQUIRES_CONFIRMATION', message: explanation, row, sheetName: 'Players' })
    if (teamUnavailable) {
      action = 'conflict'
      explanation = 'The player team is not available in the confirmed plan.'
    }
    if (resolvedIdentityDenied) {
      action = 'conflict'
      explanation = 'The resolved player identity is outside the authorised team scope.'
      addError(state, { code: 'PLAYER_SCOPE_DENIED', message: explanation, row, sheetName: 'Players' })
    }
    if (!current && restrictedPlayerReferences.has(normalizeReference(workbookValues.transfer_reference))) {
      action = 'conflict'
      explanation = 'This player reference belongs to a player outside the authorized team scope.'
      addError(state, { code: 'PLAYER_SCOPE_DENIED', message: explanation, row, sheetName: 'Players' })
    }
    if (current && !scopeCoversAllTeams && !authorizedTeamIds.has(current.team_id)) {
      action = 'conflict'
      explanation = 'This player is outside the authorized team scope.'
      addError(state, { code: 'PLAYER_SCOPE_DENIED', message: explanation, row, sheetName: 'Players' })
    }
    if (!current && !resolvedEntityId) {
      const identity = [normalizeReference(workbookValues.first_name), normalizeReference(workbookValues.last_name), normalizeScalar(workbookValues.date_of_birth)].join('|')
      const identityCandidate = playerIdentityMap.get(identity)
      if (identityCandidate && !options.createPossibleDuplicates) {
        action = 'possible_duplicate'
        explanation = `A possible duplicate player exists as ${publicRef(identityCandidate, 'PLAYER')}. Use that reference to link it, or explicitly allow a separate record.`
        addError(state, { code: 'POSSIBLE_DUPLICATE_PLAYER', message: explanation, row, sheetName: 'Players' })
      } else if (identityCandidate) {
        explanation = `Create a separate player after explicit duplicate review of ${publicRef(identityCandidate, 'PLAYER')}.`
      }
    }
    const item = {
      action,
      entity_id: current?.id || '',
      expected_updated_at: current?.updated_at || '',
      planning_handle: normalizeScalar(row._planningHandle) || workbookValues.transfer_reference,
      source_row: row._sourceRow,
      team_entity_id: teamPlan?.entity_id || '',
      values,
    }
    plan.players.push(item)
    state.rowResults.push(rowResult({ action, explanation, fieldChanges, row, sheetName: 'Players', sourceValues: workbookValues, values }))
  }

  const existingGuardianList = existing.guardians || []
  const existingGuardians = mapExisting(existingGuardianList, 'GUARDIAN')
  const restrictedGuardianReferences = new Set((existing.restrictedGuardianReferences || []).map(normalizeReference))
  const restrictedGuardianEmails = new Set((existing.restrictedGuardianEmails || []).map(normalizeReference))
  const legacyGuardianEmails = new Set((existing.legacyGuardianEmails || []).map(normalizeReference))
  const guardianEmailMap = new Map(existingGuardianList.filter((guardian) => guardian.email).map((guardian) => [normalizeReference(guardian.email), guardian]))
  for (const row of rowsBySheet.Guardians || []) {
    const workbookValues = valuesForSheet('Guardians', row)
    const resolvedEntityId = ordinaryMode ? normalizeScalar(row._resolvedEntityId) : ''
    const resolvedById = findExistingById(existingGuardianList, resolvedEntityId)
    const resolvedIdentityDenied = Boolean(resolvedEntityId) && !resolvedById
    const current = resolvedIdentityDenied
      ? null
      : resolvedById || existingGuardians.get(normalizeReference(workbookValues.transfer_reference))
    const currentWithReference = current ? {
      ...current,
      transfer_reference: ordinaryMode ? normalizeScalar(current.transfer_reference) : publicRef(current, 'GUARDIAN'),
    } : null
    const review = current ? reviewExistingFields('Guardians', workbookValues, currentWithReference, options) : null
    const values = review?.finalValues || workbookValues
    const fieldChanges = review?.fieldChanges || createFieldChanges(values)
    let action = current ? (review.blockedChanges ? 'conflict' : review.approvedChanges ? 'update' : 'unchanged') : 'create'
    let explanation = action === 'create' ? 'Create guardian contact without an invitation.' : action === 'update' ? 'Apply the reviewed guardian field changes without sending communication.' : action === 'conflict' ? 'Guardian field changes need the matching import decision before they can be confirmed.' : 'No guardian changes.'
    if (review?.blockedChanges) addError(state, { code: 'FIELD_CONFLICT_REQUIRES_CONFIRMATION', message: explanation, row, sheetName: 'Guardians' })
    if (resolvedIdentityDenied) {
      action = 'conflict'
      explanation = 'The resolved guardian identity is outside the authorised team scope.'
      addError(state, { code: 'GUARDIAN_SCOPE_DENIED', message: explanation, row, sheetName: 'Guardians' })
    }
    if (!current && restrictedGuardianReferences.has(normalizeReference(workbookValues.transfer_reference))) {
      action = 'conflict'
      explanation = 'This guardian reference is outside the authorized team scope.'
      addError(state, { code: 'GUARDIAN_SCOPE_DENIED', message: explanation, row, sheetName: 'Guardians' })
    }
    if (!current && workbookValues.email && restrictedGuardianEmails.has(normalizeReference(workbookValues.email))) {
      action = 'conflict'
      explanation = 'A guardian with this email exists outside the authorized team scope.'
      addError(state, { code: 'GUARDIAN_SCOPE_DENIED', message: explanation, row, sheetName: 'Guardians', column: 'Email' })
    }
    const guardianCandidate = !current && !resolvedEntityId && workbookValues.email ? guardianEmailMap.get(normalizeReference(workbookValues.email)) : null
    if (guardianCandidate && !options.createPossibleDuplicates) {
      action = 'possible_duplicate'
      explanation = `A guardian with this email exists as ${publicRef(guardianCandidate, 'GUARDIAN')}. Use that reference to link it, or explicitly allow a separate record.`
      addError(state, { code: 'POSSIBLE_DUPLICATE_GUARDIAN', message: explanation, row, sheetName: 'Guardians', column: 'Email' })
    } else if (guardianCandidate) {
      explanation = `Create a separate guardian after explicit duplicate review of ${publicRef(guardianCandidate, 'GUARDIAN')}.`
    }
    if (!current && workbookValues.email && legacyGuardianEmails.has(normalizeReference(workbookValues.email))) {
      action = 'conflict'
      explanation = 'An existing parent relationship uses this email and requires review before a guardian record can be created.'
      addError(state, { code: 'POSSIBLE_DUPLICATE_GUARDIAN', message: explanation, row, sheetName: 'Guardians', column: 'Email' })
    }
    const item = {
      action,
      entity_id: current?.id || '',
      expected_updated_at: current?.updated_at || '',
      planning_handle: normalizeScalar(row._planningHandle) || workbookValues.transfer_reference,
      source_row: row._sourceRow,
      values,
    }
    plan.guardians.push(item)
    state.rowResults.push(rowResult({ action, explanation, fieldChanges, row, sheetName: 'Guardians', sourceValues: workbookValues, values }))
  }

  const playerPlan = mapIncomingPlan(plan.players)
  const guardianPlan = mapIncomingPlan(plan.guardians)
  const existingLinkKeys = new Set((existing.links || []).map((link) => `${link.player_id}|${link.guardian_id}`))
  const existingLinkEmailKeys = new Set((existing.links || []).filter((link) => link.email).map((link) => `${link.player_id}|${normalizeReference(link.email)}`))
  for (const row of rowsBySheet['Player-Guardian Links'] || []) {
    const values = valuesForSheet('Player-Guardian Links', row)
    const player = playerPlan.get(normalizeReference(row._playerPlanningHandle || values.player_reference))
    const guardian = guardianPlan.get(normalizeReference(row._guardianPlanningHandle || values.guardian_reference))
    let action = 'link'
    let explanation = 'Create an uninvited player and guardian relationship.'
    if (!player || !guardian || ['conflict', 'error', 'possible_duplicate'].includes(player?.action) || ['conflict', 'error', 'possible_duplicate'].includes(guardian?.action)) {
      action = 'conflict'
      explanation = 'The linked player or guardian is unavailable in the plan.'
      addError(state, { code: 'LINK_REFERENCE_UNAVAILABLE', message: explanation, row, sheetName: 'Player-Guardian Links' })
    } else if (player.entity_id && guardian.entity_id && existingLinkKeys.has(`${player.entity_id}|${guardian.entity_id}`)) {
      action = 'unchanged'
      explanation = 'This player and guardian relationship already exists.'
    } else if (player.entity_id && guardian.values.email && existingLinkEmailKeys.has(`${player.entity_id}|${normalizeReference(guardian.values.email)}`)) {
      action = 'possible_duplicate'
      explanation = 'An existing parent relationship uses this player and email and requires review before linking.'
      addError(state, { code: 'POSSIBLE_EXISTING_PARENT_LINK', message: explanation, row, sheetName: 'Player-Guardian Links' })
    }
    plan.links.push({ action, entity_id: '', guardian_entity_id: guardian?.entity_id || '', player_entity_id: player?.entity_id || '', source_row: row._sourceRow, values })
    state.rowResults.push(rowResult({ action, explanation, fieldChanges: action === 'link' ? createFieldChanges(values) : [], row, sheetName: 'Player-Guardian Links', values }))
  }

  for (const result of state.rowResults) {
    result.codes = state.errors.filter((error) => error.sheet === result.sheet_name && error.row === result.source_row).map((error) => error.code)
  }

  const counts = state.rowResults.reduce((result, row) => {
    result[row.outcome] = (result[row.outcome] || 0) + 1
    result.total = (result.total || 0) + 1
    return result
  }, { total: 0, create: 0, update: 0, link: 0, unchanged: 0, possible_duplicate: 0, skip: 0, conflict: 0, error: 0, warning: 0 })

  return { ...state, options, plan, planSha256: sha256Json(plan), counts }
}

export function toWorkbookExportData(existing, actorScope) {
  const authorizedTeamIds = new Set(actorScope.authorizedTeamIds || [])
  const scopeCoversAllTeams = actorScope.isClubWideScope ?? actorScope.canManageAllTeams
  const teams = (existing.teams || []).filter((team) => scopeCoversAllTeams || authorizedTeamIds.has(team.id))
  const teamIds = new Set(teams.map((team) => team.id))
  const players = (existing.players || []).filter((player) => teamIds.has(player.team_id))
  const playerIds = new Set(players.map((player) => player.id))
  const links = (existing.links || []).filter((link) => playerIds.has(link.player_id) && link.guardian_id)
  const guardianIds = new Set(links.map((link) => link.guardian_id))
  const guardians = (existing.guardians || []).filter((guardian) => guardianIds.has(guardian.id))
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const playerById = new Map(players.map((player) => [player.id, player]))
  const guardianById = new Map(guardians.map((guardian) => [guardian.id, guardian]))

  return {
    'Club Details': [{
      ...(actorScope.canManageClub ? existing.club : { name: existing.club.name, season: existing.club.season }),
      transfer_reference: publicRef(existing.club, 'CLUB'),
    }],
    Teams: teams.map((team) => ({ ...team, transfer_reference: publicRef(team, 'TEAM') })),
    Players: players.map((player) => ({
      ...player,
      transfer_reference: publicRef(player, 'PLAYER'),
      team_reference: publicRef(teamById.get(player.team_id), 'TEAM'),
    })),
    Guardians: guardians.map((guardian) => ({ ...guardian, transfer_reference: publicRef(guardian, 'GUARDIAN') })),
    'Player-Guardian Links': links.map((link) => ({
      ...link,
      player_reference: publicRef(playerById.get(link.player_id), 'PLAYER'),
      guardian_reference: publicRef(guardianById.get(link.guardian_id), 'GUARDIAN'),
    })),
  }
}
