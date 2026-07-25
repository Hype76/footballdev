import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import {
  applyDataTransferExportFieldPolicy,
  assertDataTransferExportRequestAllowed,
  buildDataTransferDenialAuditMetadata,
  getDataTransferEntitlementDecision,
  getDataTransferFieldPolicy,
  resolveDataTransferTeamSelection,
} from '../netlify/functions/lib/_data-transfer-access.js'
import {
  buildOrdinaryDataExport,
} from '../netlify/functions/lib/_data-transfer-export.js'
import {
  buildTransferWorkbook,
  inspectTransferWorkbookMode,
  parseTransferWorkbook,
} from '../netlify/functions/lib/_data-transfer-workbook.js'
import {
  buildImportPlan,
  toWorkbookExportData,
} from '../netlify/functions/lib/_data-transfer-plan.js'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-test-service-role-key'

const {
  createDataTransferHandler,
  statusError,
} = await import('../netlify/functions/data-transfer.js')

const IDS = Object.freeze({
  actor: '10000000-0000-4000-8000-000000000001',
  clubA: '20000000-0000-4000-8000-000000000001',
  clubB: '20000000-0000-4000-8000-000000000002',
  teamA: '30000000-0000-4000-8000-000000000001',
  teamB: '30000000-0000-4000-8000-000000000002',
  teamC: '30000000-0000-4000-8000-000000000003',
  player: '40000000-0000-4000-8000-000000000001',
  guardian: '50000000-0000-4000-8000-000000000001',
  link: '60000000-0000-4000-8000-000000000001',
})

const activeClub = Object.freeze({
  id: IDS.clubA,
  is_plan_comped: false,
  plan_key: 'small_club',
  plan_status: 'active',
  status: 'active',
  tester_access_expires_at: null,
})

function actor(role, roleRank, overrides = {}) {
  return {
    clubId: IDS.clubA,
    email: `${role}@example.invalid`,
    id: IDS.actor,
    role,
    roleRank,
    ...overrides,
  }
}

function team(id, clubId = IDS.clubA, name = id) {
  return { club_id: clubId, id, name, season: '2026/27', status: 'active' }
}

function existingDataset() {
  return {
    club: {
      id: IDS.clubA,
      name: 'FP TEST Scope Club',
      season: '2026/27',
      transfer_reference: 'CLUB-FPTEST',
    },
    teams: [{
      ...team(IDS.teamA, IDS.clubA, 'FP TEST U14'),
      transfer_reference: 'TEAM-FPTEST',
      age_group: 'U14',
    }],
    players: [{
      club_id: IDS.clubA,
      date_of_birth: '2012-04-03',
      first_name: 'Alex',
      id: IDS.player,
      last_name: 'Scope',
      player_name: 'Alex Scope',
      section: 'Squad',
      status: 'active',
      team: 'FP TEST U14',
      team_id: IDS.teamA,
      transfer_reference: 'PLAYER-FPTEST',
    }],
    guardians: [{
      address_line_1: '99 Protected Street',
      address_line_2: 'Private Building',
      club_id: IDS.clubA,
      country: 'United Kingdom',
      county: 'Cambridgeshire',
      email: 'guardian-scope@example.invalid',
      first_name: 'Pat',
      id: IDS.guardian,
      last_name: 'Scope',
      phone: '07000000000',
      postcode: 'ZZ99 9ZZ',
      status: 'active',
      town_city: 'Protected Town',
      transfer_reference: 'GUARDIAN-FPTEST',
    }],
    links: [{
      club_id: IDS.clubA,
      emergency_contact: true,
      email: 'guardian-scope@example.invalid',
      guardian_id: IDS.guardian,
      id: IDS.link,
      player_id: IDS.player,
      primary_contact: true,
      receives_communications: true,
      relationship: 'Parent',
      status: 'active',
      team_id: IDS.teamA,
    }],
    restrictedGuardianEmails: [],
    restrictedGuardianReferences: [],
    restrictedPlayerReferences: [],
  }
}

const teamScope = Object.freeze({
  authorizedTeamIds: [IDS.teamA],
  canManageAllTeams: false,
  canManageClub: false,
  canManageTeams: false,
  clubId: IDS.clubA,
  clubName: 'FP TEST Scope Club',
  isClubWideScope: false,
  teams: [team(IDS.teamA, IDS.clubA, 'FP TEST U14')],
})

test('server entitlement uses the existing bulk import capability and fails closed by role and plan', () => {
  for (const [role, roleRank] of [
    ['admin', 90],
    ['head_manager', 70],
    ['manager', 50],
    ['coach', 20],
  ]) {
    assert.equal(getDataTransferEntitlementDecision({ actor: actor(role, roleRank), club: activeClub }).allowed, true, role)
  }

  assert.equal(getDataTransferEntitlementDecision({
    actor: actor('super_admin', 100, { clubId: '', email: 'platform@example.invalid' }),
    club: null,
  }).accessReason, 'platform_admin_override')
  assert.equal(getDataTransferEntitlementDecision({ actor: actor('parent_portal', 0), club: activeClub }).code, 'ROLE_NOT_ALLOWED')
  assert.equal(getDataTransferEntitlementDecision({ actor: actor('player', 0), club: activeClub }).code, 'ROLE_NOT_ALLOWED')
  assert.equal(getDataTransferEntitlementDecision({ actor: actor('assistant_coach', 20), club: activeClub }).code, 'ROLE_NOT_ALLOWED')
  assert.equal(getDataTransferEntitlementDecision({ actor: actor('coach', 10), club: activeClub }).code, 'ROLE_NOT_ALLOWED')
  assert.equal(getDataTransferEntitlementDecision({
    actor: actor('coach', 20, { email: 'demo@playerfeedback.online' }),
    club: activeClub,
  }).code, 'FEATURE_NOT_AVAILABLE')
})

test('server entitlement distinguishes active, inactive, expired, missing, comped, and tester access', () => {
  const coach = actor('coach', 20, {
    planKey: 'small_club',
    planStatus: 'active',
  })
  assert.equal(getDataTransferEntitlementDecision({
    actor: coach,
    club: { ...activeClub, plan_status: 'past_due' },
  }).code, 'PLAN_INACTIVE')
  assert.equal(getDataTransferEntitlementDecision({
    actor: coach,
    club: { ...activeClub, plan_status: 'expired' },
  }).code, 'PLAN_EXPIRED')
  assert.equal(getDataTransferEntitlementDecision({
    actor: coach,
    club: { ...activeClub, plan_key: 'single_team' },
  }).code, 'FEATURE_NOT_AVAILABLE')
  assert.equal(getDataTransferEntitlementDecision({
    actor: coach,
    club: { ...activeClub, is_plan_comped: true, plan_status: '' },
  }).allowed, true)
  assert.equal(getDataTransferEntitlementDecision({
    actor: coach,
    club: {
      ...activeClub,
      is_plan_comped: true,
      plan_status: '',
      tester_access_expires_at: '2099-01-01T00:00:00.000Z',
    },
  }).allowed, true)
  assert.equal(getDataTransferEntitlementDecision({
    actor: coach,
    club: {
      ...activeClub,
      is_plan_comped: true,
      tester_access_expires_at: '2020-01-01T00:00:00.000Z',
    },
  }).code, 'PLAN_EXPIRED')
  assert.equal(getDataTransferEntitlementDecision({
    actor: coach,
    club: { ...activeClub, plan_status: 'past_due' },
  }).allowed, false, 'A client-side active claim cannot override the server club row')
})

test('team-scoped roles receive one explicitly assigned team while club roles keep approved scope', () => {
  const allTeams = [
    team(IDS.teamA, IDS.clubA, 'Assigned A'),
    team(IDS.teamB, IDS.clubA, 'Assigned B'),
    team(IDS.teamC, IDS.clubA, 'Unassigned'),
  ]
  for (const [role, roleRank] of [
    ['head_manager', 70],
    ['manager', 50],
    ['coach', 20],
  ]) {
    const currentActor = actor(role, roleRank)
    const assigned = [IDS.teamA, IDS.teamB]
    const allowed = resolveDataTransferTeamSelection({
      actor: currentActor,
      allTeams,
      assignedTeamIds: assigned,
      body: { teamIds: [IDS.teamA] },
      requireSelection: true,
    })
    assert.deepEqual(allowed.authorizedTeams.map((entry) => entry.id), [IDS.teamA])
    assert.equal(allowed.requiresSingleTeamSelection, true)
    assert.throws(() => resolveDataTransferTeamSelection({
      actor: currentActor,
      allTeams,
      assignedTeamIds: assigned,
      body: { teamIds: [IDS.teamA, IDS.teamB] },
      requireSelection: true,
    }), { code: 'TEAM_SCOPE_DENIED' })
    assert.throws(() => resolveDataTransferTeamSelection({
      actor: currentActor,
      allTeams,
      assignedTeamIds: assigned,
      body: { teamIds: [IDS.teamC] },
      requireSelection: true,
    }), { code: 'TEAM_SCOPE_DENIED' })
    assert.throws(() => resolveDataTransferTeamSelection({
      actor: currentActor,
      allTeams,
      assignedTeamIds: assigned,
      body: { clubWideScope: true },
      requireSelection: true,
    }), { code: 'TEAM_SCOPE_DENIED' })
    assert.throws(() => resolveDataTransferTeamSelection({
      actor: currentActor,
      allTeams,
      assignedTeamIds: assigned,
      body: { teamTransferReference: 'TEAM-GUESSED' },
      requireSelection: true,
    }), { code: 'TEAM_SCOPE_DENIED' })
  }

  const clubAdminScope = resolveDataTransferTeamSelection({
    actor: actor('admin', 90),
    allTeams,
    body: { teamIds: [IDS.teamA, IDS.teamB] },
    requireSelection: true,
  })
  assert.deepEqual(clubAdminScope.authorizedTeams.map((entry) => entry.id), [IDS.teamA, IDS.teamB])

  const platformScope = resolveDataTransferTeamSelection({
    actor: actor('super_admin', 100),
    allTeams,
    body: { clubWideScope: true },
    requireSelection: true,
  })
  assert.equal(platformScope.isClubWideScope, true)
})

test('one shared export field policy protects guardian contact and postal fields by role', () => {
  const policies = {
    admin: getDataTransferFieldPolicy(actor('admin', 90)),
    coach: getDataTransferFieldPolicy(actor('coach', 20)),
    headManager: getDataTransferFieldPolicy(actor('head_manager', 70)),
    manager: getDataTransferFieldPolicy(actor('manager', 50)),
    platform: getDataTransferFieldPolicy(actor('super_admin', 100)),
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(policies).map(([key, policy]) => [
      key,
      [policy.guardianContactFields, policy.guardianPostalFields],
    ])),
    {
      admin: [true, true],
      coach: [false, false],
      headManager: [true, false],
      manager: [true, false],
      platform: [true, true],
    },
  )

  const source = existingDataset()
  const managerData = applyDataTransferExportFieldPolicy(source, policies.manager)
  const coachData = applyDataTransferExportFieldPolicy(source, policies.coach)
  assert.equal(managerData.guardians[0].email, 'guardian-scope@example.invalid')
  assert.equal(managerData.guardians[0].postcode, undefined)
  assert.equal(coachData.guardians[0].first_name, 'Pat')
  assert.equal(coachData.guardians[0].email, undefined)
  assert.equal(coachData.guardians[0].phone, undefined)
  assert.equal(coachData.guardians[0].address_line_1, undefined)
  assert.throws(() => assertDataTransferExportRequestAllowed({
    body: { includeGuardianContacts: true },
    fieldPolicy: policies.coach,
  }), { code: 'FIELD_DENIED' })
  assert.throws(() => assertDataTransferExportRequestAllowed({
    body: { requestedFields: ['postcode'] },
    fieldPolicy: policies.manager,
  }), { code: 'FIELD_DENIED' })
  assert.throws(() => assertDataTransferExportRequestAllowed({
    body: {},
    fieldPolicy: policies.coach,
    ordinaryDataset: 'players_and_guardians',
  }), { code: 'FIELD_DENIED' })
})

test('actual ordinary and portable files apply matching role field rules and remain safely reimportable', async () => {
  const source = existingDataset()
  const managerPolicy = getDataTransferFieldPolicy(actor('manager', 50))
  const coachPolicy = getDataTransferFieldPolicy(actor('coach', 20))
  const managerData = applyDataTransferExportFieldPolicy(source, managerPolicy)
  const coachData = applyDataTransferExportFieldPolicy(source, coachPolicy)

  const ordinary = await buildOrdinaryDataExport({
    dataset: 'players_and_guardians',
    existing: managerData,
    fieldPolicy: managerPolicy,
    format: 'csv',
    recordStatus: 'active',
    scope: teamScope,
    season: 'all',
  })
  const ordinaryText = ordinary.buffer.toString('utf8')
  assert.match(ordinaryText, /guardian-scope@example\.invalid/)
  assert.doesNotMatch(ordinaryText, /99 Protected Street|ZZ99 9ZZ|Protected Town/)
  await assert.rejects(buildOrdinaryDataExport({
    dataset: 'players_and_guardians',
    existing: coachData,
    fieldPolicy: coachPolicy,
    format: 'xlsx',
    recordStatus: 'active',
    scope: teamScope,
    season: 'all',
  }), { code: 'GUARDIAN_EXPORT_DENIED' })

  for (const [label, fieldPolicy, expectedContact] of [
    ['manager', managerPolicy, true],
    ['coach', coachPolicy, false],
  ]) {
    const filtered = applyDataTransferExportFieldPolicy(source, fieldPolicy)
    const workbookData = toWorkbookExportData(filtered, teamScope)
    const buffer = await buildTransferWorkbook({
      data: workbookData,
      fieldPolicy,
      mode: 'export',
      scopeLabel: `${label} selected team`,
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const guardianHeaders = workbook.getWorksheet('Guardians').getRow(1).values.slice(1)
    const prohibitedPostalHeaders = [
      'Address Line 1',
      'Address Line 2',
      'Town or City',
      'County',
      'Postcode',
      'Country',
    ]
    assert.equal(
      prohibitedPostalHeaders.some((header) => guardianHeaders.includes(header)),
      false,
      `${label} portable schema must omit guardian postal fields`,
    )
    if (expectedContact) {
      assert.equal(guardianHeaders.includes('Email'), true)
      assert.equal(guardianHeaders.includes('Phone'), true)
    } else {
      assert.equal(guardianHeaders.includes('Email'), false)
      assert.equal(guardianHeaders.includes('Phone'), false)
    }
    for (const sheet of workbook.worksheets.filter((candidate) => candidate.state !== 'visible')) {
      const hiddenHeaders = sheet.getRow(1).values.slice(1)
      assert.equal(
        prohibitedPostalHeaders.some((header) => hiddenHeaders.includes(header)),
        false,
        `${label} hidden portable sheets must omit guardian postal fields`,
      )
    }
    const allCellText = workbook.worksheets.flatMap((sheet) => {
      const values = []
      sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value ?? ''))))
      return values
    }).join('\n')
    assert.doesNotMatch(allCellText, /99 Protected Street|Private Building|ZZ99 9ZZ|Protected Town|Cambridgeshire/)
    if (expectedContact) {
      assert.match(allCellText, /guardian-scope@example\.invalid|07000000000/)
    } else {
      assert.doesNotMatch(allCellText, /guardian-scope@example\.invalid|07000000000/)
      assert.match(allCellText, /Pat/)
      assert.match(allCellText, /Parent/)
    }

    const mode = await inspectTransferWorkbookMode(buffer)
    assert.equal(mode.importMode, 'portable', `${label} role-filtered workbook must retain its portable signature`)
    const parsed = await parseTransferWorkbook(buffer)
    assert.deepEqual(parsed.errors, [], `${label} portable workbook must parse`)
    const preview = buildImportPlan({
      actorScope: teamScope,
      existing: source,
      importOptions: {
        allowTeamCreation: false,
        createPossibleDuplicates: false,
        fillBlankFields: false,
        importMode: 'additive',
        planningMode: 'portable',
        season: '2026/27',
        updateConflicts: false,
      },
      rowsBySheet: parsed.rowsBySheet,
    })
    assert.deepEqual(preview.errors, [], `${label} portable workbook must remain safely reimportable`)
  }
})

test('denial audit metadata is structured, correlated, and excludes sensitive request payloads', () => {
  const metadata = buildDataTransferDenialAuditMetadata({
    actor: actor('coach', 20),
    body: {
      clubId: IDS.clubB,
      fields: ['postcode'],
      guardianEmail: 'private@example.invalid',
      teamIds: [IDS.teamA, 'not-a-uuid'],
      token: 'secret-token',
      workbookBase64: 'full-workbook-bytes',
    },
    denialCode: 'TEAM_SCOPE_DENIED',
    operation: 'export',
    requestId: 'request-corrective-20',
    resolvedAuthorizedClubId: IDS.clubA,
    resolvedAuthorizedTeamIds: [IDS.teamA],
    timestamp: '2026-07-25T08:00:00.000Z',
  })
  assert.equal(metadata.actorId, IDS.actor)
  assert.equal(metadata.actorRole, 'coach')
  assert.equal(metadata.outcome, 'denied')
  assert.equal(metadata.requestedClubId, IDS.clubB)
  assert.deepEqual(metadata.requestedTeamIds, [IDS.teamA])
  assert.deepEqual(metadata.resolvedAuthorizedTeamIds, [IDS.teamA])
  const serialized = JSON.stringify(metadata)
  assert.doesNotMatch(serialized, /private@example\.invalid|secret-token|full-workbook-bytes|postcode/)
})

test('every authenticated handler denial records exactly one event and audit failure stays closed', async () => {
  const denialCodes = [
    'CLUB_SCOPE_DENIED',
    'TEAM_SCOPE_DENIED',
    'PLAN_INACTIVE',
    'PLAN_EXPIRED',
    'FEATURE_NOT_AVAILABLE',
    'ROLE_NOT_ALLOWED',
    'FIELD_DENIED',
    'ACTOR_BINDING_MISMATCH',
    'CONFIRMATION_PLAN_HASH_MISMATCH',
  ]
  const operationHandlers = Object.fromEntries(denialCodes.map((code) => [
    code,
    async () => {
      throw statusError('Denied.', code === 'CONFIRMATION_PLAN_HASH_MISMATCH' ? 409 : 403, code)
    },
  ]))
  const audits = []
  const handler = createDataTransferHandler({
    auditDeniedRequest: async (entry) => audits.push(entry),
    authenticateRequest: async () => actor('coach', 20),
    authorizeRequest: async () => {},
    logger: { error() {} },
    operationHandlers,
  })
  for (const code of denialCodes) {
    const result = await handler({
      body: JSON.stringify({ operation: code, teamIds: [IDS.teamA] }),
      headers: { 'x-request-id': `request-${code.toLowerCase()}` },
      httpMethod: 'POST',
    })
    assert.equal(JSON.parse(result.body).code, code)
  }
  assert.equal(audits.length, denialCodes.length)
  assert.deepEqual(audits.map((entry) => entry.denialCode), denialCodes)

  const roleAudits = []
  const roleDenied = createDataTransferHandler({
    auditDeniedRequest: async (entry) => roleAudits.push(entry),
    authenticateRequest: async () => actor('parent_portal', 0),
    authorizeRequest: async () => {
      throw statusError('Denied.', 403, 'ROLE_NOT_ALLOWED')
    },
    logger: { error() {} },
    operationHandlers: { export: async () => assert.fail('Role denial must happen before the operation') },
  })
  const roleResult = await roleDenied({
    body: JSON.stringify({ operation: 'export' }),
    headers: {},
    httpMethod: 'POST',
  })
  assert.equal(roleResult.statusCode, 403)
  assert.equal(roleAudits.length, 1)

  const malformedAudits = []
  const malformed = createDataTransferHandler({
    auditDeniedRequest: async (entry) => malformedAudits.push(entry),
    authenticateRequest: async () => actor('coach', 20),
    authorizeRequest: async () => assert.fail('Invalid JSON must fail before entitlement evaluation'),
    logger: { error() {} },
    operationHandlers: {},
  })
  const malformedResult = await malformed({
    body: '{"operation":',
    headers: {},
    httpMethod: 'POST',
  })
  assert.equal(malformedResult.statusCode, 400)
  assert.equal(JSON.parse(malformedResult.body).code, 'INVALID_JSON')
  assert.equal(malformedAudits.length, 1)

  const auditFailure = createDataTransferHandler({
    auditDeniedRequest: async () => {
      throw new Error('audit unavailable')
    },
    authenticateRequest: async () => actor('coach', 20),
    authorizeRequest: async () => {},
    logger: { error() {} },
    operationHandlers: {
      denied: async () => {
        throw statusError('Denied.', 403, 'TEAM_SCOPE_DENIED')
      },
    },
  })
  const failedAuditResult = await auditFailure({
    body: JSON.stringify({ operation: 'denied' }),
    headers: {},
    httpMethod: 'POST',
  })
  assert.equal(failedAuditResult.statusCode, 500)
  assert.equal(JSON.parse(failedAuditResult.body).code, 'DENIAL_AUDIT_FAILED')
})

test('successful handler operations do not create denial events', async () => {
  let auditCount = 0
  const handler = createDataTransferHandler({
    auditDeniedRequest: async () => {
      auditCount += 1
    },
    authenticateRequest: async () => actor('coach', 20),
    authorizeRequest: async () => {},
    logger: { error() {} },
    operationHandlers: {
      scope: async () => ({ body: JSON.stringify({ success: true }), statusCode: 200 }),
    },
  })
  const result = await handler({
    body: JSON.stringify({ operation: 'scope' }),
    headers: {},
    httpMethod: 'POST',
  })
  assert.equal(result.statusCode, 200)
  assert.equal(auditCount, 0)
})
