import assert from 'node:assert/strict'
import test from 'node:test'
import { buildImportPlan, sha256Json, toWorkbookExportData } from '../netlify/functions/lib/_data-transfer-plan.js'

const approvedImportOptions = { allowTeamCreation: true, fillBlankFields: true, season: '2026/27', updateConflicts: true }

function fixture() {
  const existing = {
    club: { id: 'club-1', name: 'Fixture FC', transfer_reference: 'CLUB-1', primary_contact_email: 'private-club@example.test', season: '2026/27' },
    teams: [
      { id: 'team-1', club_id: 'club-1', name: 'U12', transfer_reference: 'TEAM-1', season: '2026/27', status: 'active' },
      { id: 'team-2', club_id: 'club-1', name: 'U14', transfer_reference: 'TEAM-2', season: '2026/27', status: 'active' },
    ],
    players: [{ id: 'player-1', club_id: 'club-1', team_id: 'team-1', transfer_reference: 'PLAYER-1', first_name: 'Alex', last_name: 'Example', date_of_birth: '2014-01-20', section: 'Squad', positions: [], status: 'active' }],
    guardians: [{ id: 'guardian-1', club_id: 'club-1', transfer_reference: 'GUARDIAN-1', first_name: 'Pat', last_name: 'Example', email: 'pat@example.test', status: 'active' }],
    links: [{ id: 'link-1', player_id: 'player-1', guardian_id: 'guardian-1', email: 'pat@example.test' }],
  }
  const rowsBySheet = {
    'Club Details': [{ _sourceRow: 2, transfer_reference: 'CLUB-1', name: 'Fixture FC', season: '2026/27' }],
    Teams: [{ _sourceRow: 2, transfer_reference: 'TEAM-1', name: 'U12', season: '2026/27', status: 'active' }],
    Players: [{ _sourceRow: 2, transfer_reference: 'PLAYER-1', team_reference: 'TEAM-1', first_name: 'Alex', last_name: 'Example', date_of_birth: '2014-01-20', section: 'Squad', positions: [], status: 'active' }],
    Guardians: [{ _sourceRow: 2, transfer_reference: 'GUARDIAN-1', first_name: 'Pat', last_name: 'Example', email: 'pat@example.test', status: 'active' }],
    'Player-Guardian Links': [{ _sourceRow: 2, player_reference: 'PLAYER-1', guardian_reference: 'GUARDIAN-1', relationship: 'Parent', primary_contact: true, receives_communications: false, emergency_contact: false }],
  }
  return { existing, rowsBySheet }
}

test('same scoped plan is deterministic and labels unchanged records', () => {
  const { existing, rowsBySheet } = fixture()
  const scope = { authorizedTeamIds: ['team-1'], canManageAllTeams: false, canManageClub: false, canManageTeams: false }
  const first = buildImportPlan({ actorScope: scope, existing, importOptions: approvedImportOptions, rowsBySheet })
  const second = buildImportPlan({ actorScope: scope, existing, importOptions: approvedImportOptions, rowsBySheet })
  assert.deepEqual(first.errors, [])
  assert.equal(first.planSha256, second.planSha256)
  assert.equal(first.plan.teams[0].action, 'unchanged')
  assert.equal(first.plan.links[0].action, 'unchanged')
  assert.equal(sha256Json(first.plan), first.planSha256)
})

test('manager cannot create teams or target a cross-team player', () => {
  const { existing, rowsBySheet } = fixture()
  rowsBySheet.Teams.push({ _sourceRow: 3, transfer_reference: 'TEAM-NEW', name: 'New Team', status: 'active' })
  rowsBySheet.Teams.push({ _sourceRow: 4, transfer_reference: 'TEAM-2', name: 'U14', status: 'active' })
  rowsBySheet.Players.push({ _sourceRow: 3, transfer_reference: 'PLAYER-2', team_reference: 'TEAM-2', first_name: 'Cross', last_name: 'Team', section: 'Squad', positions: [], status: 'active' })
  const result = buildImportPlan({ actorScope: { authorizedTeamIds: ['team-1'], canManageAllTeams: false, canManageClub: false, canManageTeams: false }, existing, importOptions: approvedImportOptions, rowsBySheet })
  assert.ok(result.errors.some((error) => error.code === 'TEAM_CHANGE_NOT_AUTHORIZED'))
  assert.ok(result.errors.some((error) => error.code === 'PLAYER_TEAM_SCOPE_DENIED'))
})

test('club admin can create a team and possible duplicate records fail closed', () => {
  const { existing, rowsBySheet } = fixture()
  rowsBySheet.Teams.push({ _sourceRow: 3, transfer_reference: 'DIFFERENT-REF', name: 'U14', status: 'active' })
  const result = buildImportPlan({ actorScope: { authorizedTeamIds: ['team-1', 'team-2'], canManageAllTeams: true, canManageClub: true, canManageTeams: true }, existing, importOptions: approvedImportOptions, rowsBySheet })
  assert.ok(result.errors.some((error) => error.code === 'POSSIBLE_DUPLICATE_TEAM'))
  assert.equal(result.plan.teams[1].action, 'possible_duplicate')
})

test('export contains only authorized teams and their related records', () => {
  const { existing } = fixture()
  const exported = toWorkbookExportData(existing, { authorizedTeamIds: ['team-1'], canManageAllTeams: false })
  assert.deepEqual(exported.Teams.map((team) => team.transfer_reference), ['TEAM-1'])
  assert.deepEqual(exported.Players.map((player) => player.transfer_reference), ['PLAYER-1'])
  assert.deepEqual(exported.Guardians.map((guardian) => guardian.transfer_reference), ['GUARDIAN-1'])
  assert.equal(exported['Club Details'][0].primary_contact_email, undefined)
})

test('a club administrator selected-team scope stays narrow despite club-wide capability', () => {
  const { existing, rowsBySheet } = fixture()
  rowsBySheet.Teams = [{ _sourceRow: 2, transfer_reference: 'TEAM-2', name: 'U14', season: '2026/27', status: 'active' }]
  const actorScope = { authorizedTeamIds: ['team-1'], canManageAllTeams: true, canManageClub: true, canManageTeams: true, isClubWideScope: false }
  const result = buildImportPlan({ actorScope, existing, importOptions: approvedImportOptions, rowsBySheet })
  assert.ok(result.errors.some((error) => error.code === 'TEAM_SCOPE_DENIED'))
  assert.equal(result.plan.teams[0].action, 'conflict')
  const exported = toWorkbookExportData(existing, actorScope)
  assert.deepEqual(exported.Teams.map((team) => team.transfer_reference), ['TEAM-1'])
})

test('selected-team scope cannot create an unselected new team', () => {
  const { existing, rowsBySheet } = fixture()
  rowsBySheet.Teams = [{ _sourceRow: 2, transfer_reference: 'TEAM-NEW', name: 'U16', season: '2026/27', status: 'active' }]
  const actorScope = { authorizedTeamIds: ['team-1'], canManageAllTeams: true, canManageClub: true, canManageTeams: true, isClubWideScope: false }
  const result = buildImportPlan({ actorScope, existing, importOptions: approvedImportOptions, rowsBySheet })
  assert.ok(result.errors.some((error) => error.code === 'TEAM_CREATION_SCOPE_DENIED'))
  assert.equal(result.plan.teams[0].action, 'conflict')
})

test('guessed cross-team player and guardian references fail closed without previewing their records', () => {
  const { existing, rowsBySheet } = fixture()
  existing.restrictedPlayerReferences = ['PLAYER-OTHER-TEAM']
  existing.restrictedGuardianReferences = ['GUARDIAN-OTHER-TEAM']
  existing.restrictedGuardianEmails = ['private@example.test']
  rowsBySheet.Players.push({ _sourceRow: 3, transfer_reference: 'PLAYER-OTHER-TEAM', team_reference: 'TEAM-1', first_name: 'Private', last_name: 'Player', section: 'Squad', positions: [], status: 'active' })
  rowsBySheet.Guardians.push({ _sourceRow: 3, transfer_reference: 'GUARDIAN-OTHER-TEAM', first_name: 'Private', last_name: 'Guardian', email: 'private@example.test', status: 'active' })
  const result = buildImportPlan({ actorScope: { authorizedTeamIds: ['team-1'], canManageAllTeams: false, canManageClub: false, canManageTeams: false }, existing, importOptions: approvedImportOptions, rowsBySheet })
  assert.ok(result.errors.some((error) => error.code === 'PLAYER_SCOPE_DENIED'))
  assert.ok(result.errors.some((error) => error.code === 'GUARDIAN_SCOPE_DENIED'))
  assert.equal(result.plan.players.at(-1).action, 'conflict')
  assert.equal(result.plan.guardians.at(-1).action, 'conflict')
})

test('legacy email-only parent relationships fail closed instead of creating shadow guardians or links', () => {
  const { existing, rowsBySheet } = fixture()
  existing.links = [{ id: 'legacy-link', player_id: 'player-1', guardian_id: null, email: 'pat@example.test' }]
  existing.legacyGuardianEmails = ['legacy@example.test']
  rowsBySheet.Guardians.push({ _sourceRow: 3, transfer_reference: 'GUARDIAN-LEGACY', first_name: 'Legacy', last_name: 'Parent', email: 'legacy@example.test', status: 'active' })
  const result = buildImportPlan({ actorScope: { authorizedTeamIds: ['team-1'], canManageAllTeams: false, canManageClub: false, canManageTeams: false }, existing, importOptions: approvedImportOptions, rowsBySheet })
  assert.ok(result.errors.some((error) => error.code === 'POSSIBLE_DUPLICATE_GUARDIAN'))
  assert.ok(result.errors.some((error) => error.code === 'POSSIBLE_EXISTING_PARENT_LINK'))
  assert.equal(result.plan.guardians.at(-1).action, 'conflict')
  assert.equal(result.plan.links[0].action, 'possible_duplicate')
})

test('populated updates, blank fills, and team creation require explicit import decisions', () => {
  const { existing, rowsBySheet } = fixture()
  rowsBySheet['Club Details'][0].name = 'Workbook Club Name'
  rowsBySheet.Teams.push({ _sourceRow: 3, transfer_reference: 'TEAM-NEW', name: 'New Team', season: '2026/27', status: 'active' })
  rowsBySheet.Guardians[0].phone = '+44 7700 900123'
  const safeDefault = buildImportPlan({
    actorScope: { authorizedTeamIds: ['team-1', 'team-2'], canManageAllTeams: true, canManageClub: true, canManageTeams: true },
    existing,
    importOptions: { season: '2026/27' },
    rowsBySheet,
  })
  assert.ok(safeDefault.errors.some((error) => error.code === 'FIELD_CONFLICT_REQUIRES_CONFIRMATION'))
  assert.ok(safeDefault.errors.some((error) => error.code === 'TEAM_CREATION_NOT_CONFIRMED'))
  assert.equal(safeDefault.plan.club.action, 'conflict')
  assert.equal(safeDefault.plan.guardians[0].action, 'conflict')
  assert.ok(safeDefault.rowResults.find((row) => row.sheet_name === 'Club Details').proposed_changes.fields.some((field) => field.proposed_action === 'confirm_populated_update'))

  const approved = buildImportPlan({
    actorScope: { authorizedTeamIds: ['team-1', 'team-2'], canManageAllTeams: true, canManageClub: true, canManageTeams: true },
    existing,
    importOptions: approvedImportOptions,
    rowsBySheet,
  })
  assert.deepEqual(approved.errors, [])
  assert.equal(approved.plan.club.action, 'update')
  assert.equal(approved.plan.guardians[0].action, 'update')
  assert.equal(approved.plan.teams.at(-1).action, 'create')
})

test('ordinary imports treat authorised null-season club and team records as immutable scope anchors', () => {
  const { existing, rowsBySheet } = fixture()
  existing.club.season = null
  existing.club.transfer_reference = null
  existing.teams[0].season = null
  existing.teams[0].transfer_reference = null
  rowsBySheet['Club Details'][0]._resolvedEntityId = 'club-1'
  rowsBySheet['Club Details'][0].transfer_reference = ''
  rowsBySheet['Club Details'][0].season = '2026/27'
  rowsBySheet.Teams[0]._planningHandle = 'PLAN-TEAM-AUTHORISED'
  rowsBySheet.Teams[0]._resolvedEntityId = 'team-1'
  rowsBySheet.Teams[0].transfer_reference = ''
  rowsBySheet.Teams[0].season = '2026/27'
  rowsBySheet.Players[0]._teamPlanningHandle = 'PLAN-TEAM-AUTHORISED'
  rowsBySheet.Players[0].team_reference = ''
  const result = buildImportPlan({
    actorScope: {
      authorizedTeamIds: ['team-1'],
      canManageAllTeams: false,
      canManageClub: false,
      canManageTeams: false,
      isClubWideScope: false,
    },
    existing,
    importOptions: {
      ...approvedImportOptions,
      planningMode: 'ordinary',
    },
    rowsBySheet,
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.plan.context.planning_mode, 'ordinary')
  assert.equal(result.plan.context.selected_season, '2026/27')
  assert.equal(result.plan.club.action, 'unchanged')
  assert.equal(result.plan.club.values.season, '')
  assert.equal(result.plan.teams[0].action, 'unchanged')
  assert.equal(result.plan.teams[0].entity_id, 'team-1')
  assert.equal(result.plan.teams[0].planning_handle, 'PLAN-TEAM-AUTHORISED')
  assert.equal(result.plan.teams[0].values.transfer_reference, '')
  assert.equal(result.plan.teams[0].values.season, '')
  assert.equal(result.plan.players[0].team_entity_id, 'team-1')
  assert.equal(result.counts.update, 0)
  assert.equal(result.counts.conflict, 0)
  assert.ok(!result.errors.some((error) => [
    'POSSIBLE_DUPLICATE_TEAM',
    'TEAM_CHANGE_NOT_AUTHORIZED',
    'PLAYER_TEAM_UNAVAILABLE',
    'LINK_REFERENCE_UNAVAILABLE',
  ].includes(error.code)))
})

test('portable manager imports use the confirmed season as context without changing null-season anchors', () => {
  const { existing, rowsBySheet } = fixture()
  existing.club.season = null
  existing.teams[0].season = null
  rowsBySheet['Club Details'][0].season = ''
  rowsBySheet.Teams[0].season = ''

  const result = buildImportPlan({
    actorScope: {
      authorizedTeamIds: ['team-1'],
      canManageAllTeams: false,
      canManageClub: false,
      canManageTeams: false,
      isClubWideScope: false,
    },
    existing,
    importOptions: {
      ...approvedImportOptions,
      planningMode: 'portable',
    },
    rowsBySheet,
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.plan.context.selected_season, '2026/27')
  assert.equal(result.plan.club.action, 'unchanged')
  assert.equal(result.plan.club.values.season, '')
  assert.equal(result.plan.teams[0].action, 'unchanged')
  assert.equal(result.plan.teams[0].values.season, '')
  assert.equal(result.counts.update, 0)
  assert.ok(!result.errors.some((error) => [
    'CLUB_CHANGE_NOT_AUTHORIZED',
    'TEAM_CHANGE_NOT_AUTHORIZED',
    'IMPORT_SEASON_REQUIRED',
  ].includes(error.code)))
})

test('portable workbook season changes to existing anchors fail closed even when field updates are approved', () => {
  const { existing, rowsBySheet } = fixture()
  existing.club.season = null
  existing.teams[0].season = null
  rowsBySheet['Club Details'][0].season = '2026/27'
  rowsBySheet.Teams[0].season = '2026/27'

  const result = buildImportPlan({
    actorScope: {
      authorizedTeamIds: ['team-1'],
      canManageAllTeams: true,
      canManageClub: true,
      canManageTeams: true,
      isClubWideScope: false,
    },
    existing,
    importOptions: {
      ...approvedImportOptions,
      planningMode: 'portable',
    },
    rowsBySheet,
  })
  assert.ok(result.errors.some((error) => error.code === 'CLUB_ANCHOR_SEASON_IMMUTABLE'))
  assert.ok(result.errors.some((error) => error.code === 'TEAM_ANCHOR_SEASON_IMMUTABLE'))
  assert.equal(result.plan.club.action, 'conflict')
  assert.equal(result.plan.club.values.season, '')
  assert.equal(result.plan.teams[0].action, 'conflict')
  assert.equal(result.plan.teams[0].values.season, '')
  assert.equal(result.counts.update, 0)
})

test('portable team reference conflicts remain protected from ordinary identity rules', () => {
  const { existing, rowsBySheet } = fixture()
  rowsBySheet.Teams[0].name = 'Conflicting Portable Team'
  const result = buildImportPlan({
    actorScope: {
      authorizedTeamIds: ['team-1'],
      canManageAllTeams: true,
      canManageClub: true,
      canManageTeams: true,
      isClubWideScope: false,
    },
    existing,
    importOptions: {
      planningMode: 'portable',
      season: '2026/27',
    },
    rowsBySheet,
  })

  assert.ok(result.errors.some((error) => error.code === 'FIELD_CONFLICT_REQUIRES_CONFIRMATION'))
  assert.equal(result.plan.teams[0].entity_id, 'team-1')
  assert.equal(result.plan.teams[0].action, 'conflict')
  assert.equal(result.plan.teams[0].values.transfer_reference, 'TEAM-1')
})

test('possible duplicate creation remains blocked until explicitly reviewed', () => {
  const { existing, rowsBySheet } = fixture()
  rowsBySheet.Teams.push({ _sourceRow: 3, transfer_reference: 'TEAM-SEPARATE', name: 'U14', season: '2026/27', status: 'active' })
  const blocked = buildImportPlan({ actorScope: { authorizedTeamIds: ['team-1', 'team-2'], canManageAllTeams: true, canManageClub: true, canManageTeams: true }, existing, importOptions: approvedImportOptions, rowsBySheet })
  assert.ok(blocked.errors.some((error) => error.code === 'POSSIBLE_DUPLICATE_TEAM'))
  const allowed = buildImportPlan({ actorScope: { authorizedTeamIds: ['team-1', 'team-2'], canManageAllTeams: true, canManageClub: true, canManageTeams: true }, existing, importOptions: { ...approvedImportOptions, createPossibleDuplicates: true }, rowsBySheet })
  assert.ok(!allowed.errors.some((error) => error.code === 'POSSIBLE_DUPLICATE_TEAM'))
  assert.equal(allowed.plan.teams.at(-1).action, 'create')
})

test('exact player identity is reviewed across authorised teams instead of within one team only', () => {
  const { existing, rowsBySheet } = fixture()
  rowsBySheet.Players.push({ _sourceRow: 3, transfer_reference: 'PLAYER-SAME-IDENTITY', team_reference: 'TEAM-2', first_name: 'Alex', last_name: 'Example', date_of_birth: '2014-01-20', section: 'Squad', positions: [], status: 'active' })
  const result = buildImportPlan({
    actorScope: { authorizedTeamIds: ['team-1', 'team-2'], canManageAllTeams: true, canManageClub: true, canManageTeams: true },
    existing,
    importOptions: approvedImportOptions,
    rowsBySheet,
  })
  assert.ok(result.errors.some((error) => error.code === 'POSSIBLE_DUPLICATE_PLAYER'))
  assert.equal(result.plan.players.at(-1).action, 'possible_duplicate')
})
