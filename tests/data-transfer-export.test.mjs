import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  buildOrdinaryDataExport,
  buildOrdinaryExportRows,
  ORDINARY_EXPORT_DATASETS,
  ORDINARY_EXPORT_VERSION,
  safeOrdinaryExportText,
} from '../netlify/functions/lib/_data-transfer-export.js'
import {
  inspectSpreadsheetSource,
  mapSpreadsheetToTransferRows,
} from '../netlify/functions/lib/_data-transfer-tabular.js'

const scope = {
  authorizedTeamIds: ['team-u12'],
  canManageAllTeams: false,
  clubId: 'club-qa',
  isClubWideScope: false,
}

function fixture() {
  return {
    club: { id: 'club-qa', name: 'Jeluma QA FC', season: '2026/27' },
    teams: [
      { id: 'team-u12', club_id: 'club-qa', name: 'Jeluma QA U12', age_group: 'U12', category: 'Mixed', season: '2026/27', status: 'active' },
      { id: 'team-u14', club_id: 'club-qa', name: 'Private U14', age_group: 'U14', season: '2026/27', status: 'active' },
      { id: 'team-old', club_id: 'club-qa', name: 'Inactive U10', age_group: 'U10', season: '2025/26', status: 'inactive' },
      { id: 'cross-club', club_id: 'other-club', name: 'Other Club', season: '2026/27', status: 'active' },
    ],
    players: [
      { id: 'player-1', club_id: 'club-qa', team_id: 'team-u12', first_name: 'Zoë', last_name: 'Example', preferred_name: 'Z', date_of_birth: '2014-01-20', gender: 'Female', section: 'Squad', shirt_number: '007', positions: ['Defender', 'Midfielder'], status: 'active' },
      { id: 'player-inactive', club_id: 'club-qa', team_id: 'team-u12', first_name: 'Inactive', last_name: 'Player', date_of_birth: '2013-02-03', status: 'inactive' },
      { id: 'player-private', club_id: 'club-qa', team_id: 'team-u14', first_name: 'Private', last_name: 'Player', status: 'active' },
      { id: 'player-cross', club_id: 'other-club', team_id: 'cross-club', first_name: 'Cross', last_name: 'Club', status: 'active' },
    ],
    guardians: [
      { id: 'guardian-1', club_id: 'club-qa', first_name: 'Pat', last_name: 'Example', email: 'pat@example.test', phone: '07123 000001', status: 'active' },
      { id: 'guardian-2', club_id: 'club-qa', first_name: 'Sam', last_name: 'Example', email: 'sam@example.test', phone: '07123 000002', status: 'active' },
      { id: 'guardian-private', club_id: 'club-qa', first_name: 'Private', last_name: 'Parent', email: 'private@example.test', status: 'active' },
    ],
    links: [
      { id: 'link-1', club_id: 'club-qa', team_id: 'team-u12', player_id: 'player-1', guardian_id: 'guardian-1', relationship: 'Parent', primary_contact: true, receives_communications: true, emergency_contact: true },
      { id: 'link-2', club_id: 'club-qa', team_id: 'team-u12', player_id: 'player-1', guardian_id: 'guardian-2', relationship: 'Guardian', primary_contact: false, receives_communications: false, emergency_contact: false },
      { id: 'link-private', club_id: 'club-qa', team_id: 'team-u14', player_id: 'player-private', guardian_id: 'guardian-private', relationship: 'Parent', primary_contact: true },
    ],
  }
}

function mappingFromInspection(source) {
  const sheet = source.sheets.find((candidate) => candidate.name === source.suggestedSheet)
  return {
    sheetName: source.suggestedSheet,
    columns: sheet.mappings.map((entry) => ({
      sourceColumn: entry.sourceColumn,
      targetField: entry.suggestedField,
      transformation: entry.transformation,
      defaultValue: '',
    })),
    dateConvention: 'dmy',
    teamMappings: [],
  }
}

test('ordinary export rows enforce team, club, season, status, and guardian visibility', () => {
  const existing = fixture()
  existing.guardians.push({ id: 'guardian-3', club_id: 'club-qa', first_name: 'Taylor', last_name: 'Example', email: 'taylor@example.test', phone: '07123 000003', status: 'active' })
  existing.links.push({ id: 'link-3', club_id: 'club-qa', team_id: 'team-u12', player_id: 'player-1', guardian_id: 'guardian-3', relationship: 'Carer', primary_contact: false, receives_communications: false, emergency_contact: true })
  const players = buildOrdinaryExportRows(existing, { dataset: 'players', recordStatus: 'active', scope, season: '2026/27' })
  assert.deepEqual(players.map((row) => row.player_first_name), ['Zoë'])
  assert.equal(players[0].shirt_number, '007')
  assert.equal(players[0].team_name, 'Jeluma QA U12')
  assert.ok(!Object.keys(players[0]).some((key) => /(?:^id$|_id$|reference)/i.test(key)))

  assert.throws(
    () => buildOrdinaryExportRows(existing, { dataset: 'players_and_guardians', includeGuardianContacts: false, recordStatus: 'active', scope, season: 'all' }),
    (error) => error.code === 'GUARDIAN_EXPORT_DENIED',
  )
  const withGuardians = buildOrdinaryExportRows(existing, { dataset: 'players_and_guardians', includeGuardianContacts: true, recordStatus: 'active', scope, season: 'all' })
  assert.equal(withGuardians.length, 1)
  assert.equal(withGuardians[0].guardian1_email, 'pat@example.test')
  assert.equal(withGuardians[0].guardian2_email, 'sam@example.test')
  assert.match(withGuardians[0].additional_guardian_contacts, /Taylor Example \| Carer \| taylor@example\.test \| 07123 000003 \| Emergency contact/)
  assert.doesNotMatch(JSON.stringify(withGuardians), /private@example\.test|Cross Club|PLAYER-|GUARDIAN-|TEAM-/)
})

test('CSV export is UTF-8, formula-safe, escaped, human-readable, and preserves leading zeroes', async () => {
  const existing = fixture()
  existing.players[0].preferred_name = '=HYPERLINK("https://example.invalid")'
  existing.guardians[0].last_name = 'Example, Senior\nLine two'
  const result = await buildOrdinaryDataExport({
    dataset: 'players_and_guardians',
    existing,
    format: 'csv',
    includeGuardianContacts: true,
    recordStatus: 'active',
    scope,
    season: '2026/27',
  })
  const csv = result.buffer.toString('utf8')
  assert.ok(csv.startsWith('\uFEFF'))
  assert.match(csv, /Player First Name,Player Last Name/)
  assert.match(csv, /'="?"?HYPERLINK|'\=HYPERLINK/)
  assert.match(csv, /"Example, Senior\r?\nLine two"/)
  assert.match(csv, /07123 000001/)
  assert.doesNotMatch(csv, /Reference|Internal ID|player-1|guardian-1|team-u12/i)
  assert.equal(result.filename, 'footballplayer-online-players-and-parents.csv')
  assert.equal(result.mimeType, 'text/csv;charset=utf-8')
  assert.equal(safeOrdinaryExportText('  +SUM(1,2)'), "'+SUM(1,2)")
})

test('XLSX and ODS exports contain readable structures, valid dates, widths, and no executable cells', async () => {
  const existing = fixture()
  for (const format of ['xlsx', 'ods']) {
    const result = await buildOrdinaryDataExport({
      dataset: 'players_and_guardians',
      existing,
      format,
      includeGuardianContacts: true,
      recordStatus: 'active',
      scope,
      season: '2026/27',
    })
    assert.equal(result.filename, `footballplayer-online-players-and-parents.${format}`)
    const inspected = await inspectSpreadsheetSource(result.buffer, { fileName: result.filename, mimeType: result.mimeType })
    assert.equal(inspected.format, format)
    assert.equal(inspected.sheets[0].rowCount, 1)
    assert.deepEqual(inspected.sheets[0].headers, ORDINARY_EXPORT_DATASETS.players_and_guardians.columns.map((column) => column.heading))
    assert.doesNotMatch(inspected.sheets[0].headers.join('|'), /Reference|Internal ID/i)

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(result.buffer)
      const sheet = workbook.getWorksheet('Players and Parents')
      assert.equal(sheet.getCell('D2').value instanceof Date, true)
      assert.equal(sheet.getCell('D2').numFmt, 'dd/mm/yyyy')
      assert.ok(sheet.getColumn(1).width >= 15)
      sheet.eachRow((row) => row.eachCell((cell) => assert.equal(Boolean(cell.formula), false)))
    } else {
      const zip = await JSZip.loadAsync(result.buffer)
      const content = await zip.file('content.xml').async('string')
      assert.match(content, /office:value-type="date" office:date-value="2014-01-20"/)
      assert.match(content, /style:column-width=/)
      assert.doesNotMatch(content, /table:formula|xlink:href|transfer_reference|internal id/i)
    }
  }
})

test('CSV, XLSX, and ODS ordinary player and parent exports safely reimport through Phase 1 mapping', async () => {
  const sourceExisting = fixture()
  const importExisting = {
    club: { id: 'club-qa', name: 'Jeluma QA FC', transfer_reference: 'CLUB-QA', season: '2026/27' },
    teams: [{ id: 'team-u12', club_id: 'club-qa', name: 'Jeluma QA U12', transfer_reference: 'TEAM-U12', season: '2026/27', status: 'active' }],
    players: [],
    guardians: [],
    links: [],
  }
  for (const format of ['csv', 'xlsx', 'ods']) {
    const exported = await buildOrdinaryDataExport({
      dataset: 'players_and_guardians',
      existing: sourceExisting,
      format,
      includeGuardianContacts: true,
      recordStatus: 'active',
      scope,
      season: '2026/27',
    })
    const inspected = await inspectSpreadsheetSource(exported.buffer, { fileName: exported.filename, mimeType: exported.mimeType })
    const mapped = await mapSpreadsheetToTransferRows(exported.buffer, {
      existing: importExisting,
      fileName: exported.filename,
      importOptions: { season: '2026/27' },
      mapping: mappingFromInspection(inspected),
      mimeType: exported.mimeType,
      scope: { ...scope, canManageTeams: false },
    })
    assert.deepEqual(mapped.errors, [], `${format}: ${JSON.stringify(mapped.errors)}`)
    assert.equal(mapped.rowsBySheet.Players.length, 1)
    assert.equal(mapped.rowsBySheet.Guardians.length, 2)
    assert.equal(mapped.rowsBySheet['Player-Guardian Links'].length, 2)
    assert.equal(mapped.rowsBySheet.Players[0].first_name, 'Zoë')
  }
})

test('ordinary export metadata and filename contracts remain stable', async () => {
  assert.equal(ORDINARY_EXPORT_VERSION, 'FP-V1-READABLE-EXPORT-1')
  for (const dataset of Object.keys(ORDINARY_EXPORT_DATASETS)) {
    for (const format of ['csv', 'xlsx', 'ods']) {
      const result = await buildOrdinaryDataExport({
        dataset,
        existing: fixture(),
        format,
        includeGuardianContacts: true,
        recordStatus: 'active',
        scope,
        season: 'all',
      })
      assert.equal(result.format, format)
      assert.ok(result.filename.endsWith(`.${format}`))
      assert.ok(result.buffer.length > 20)
      assert.ok(result.headings.length > 0)
    }
  }
})
