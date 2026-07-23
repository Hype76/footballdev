import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  buildSimpleTransferTemplate,
  detectSpreadsheetFormat,
  inspectSpreadsheetSource,
  mapSpreadsheetToTransferRows,
  SIMPLE_TEMPLATE_COLUMNS,
  SIMPLE_TRANSFER_SHEET_NAME,
  SIMPLE_TRANSFER_TEMPLATE_VERSION,
} from '../netlify/functions/lib/_data-transfer-tabular.js'

const scope = {
  authorizedTeamIds: ['team-u12'],
  canManageTeams: true,
  clubId: 'club-qa',
  isClubWideScope: true,
}

const existing = {
  club: { id: 'club-qa', name: 'Jeluma QA FC', transfer_reference: 'CLUB-QA' },
  teams: [{ id: 'team-u12', name: 'Jeluma QA U12', transfer_reference: 'TEAM-U12', season: '2026/27', status: 'active' }],
  players: [],
  guardians: [],
  links: [],
}

function csvBuffer(rows, delimiter = ',') {
  const quote = (value) => {
    const text = String(value ?? '')
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return Buffer.from(`\uFEFF${rows.map((row) => row.map(quote).join(delimiter)).join('\r\n')}\r\n`, 'utf8')
}

function mappingFromInspection(source, sheetName = source.suggestedSheet) {
  const sheet = source.sheets.find((candidate) => candidate.name === sheetName)
  return {
    sheetName,
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

function simpleTemplateValues() {
  const values = {
    'Player First Name': 'Alex',
    'Player Last Name': 'Roundtrip',
    'Preferred Name': 'Lex',
    'Date of Birth': '2014-01-20',
    Team: 'Jeluma QA U12',
    Gender: 'Prefer not to say',
    Section: 'Squad',
    'Shirt Number': '007',
    Positions: 'Defender, Midfielder',
    'Parent or Guardian 1 First Name': 'Pat',
    'Parent or Guardian 1 Last Name': 'Roundtrip',
    'Parent or Guardian 1 Email': 'roundtrip-parent@example.test',
    'Parent or Guardian 1 Phone': '07123 000001',
    'Parent or Guardian 1 Relationship': 'Parent',
    'Parent or Guardian 1 Primary Contact': 'Yes',
    'Parent or Guardian 1 Receives Communications': 'No',
    'Parent or Guardian 1 Emergency Contact': 'Yes',
  }
  return SIMPLE_TEMPLATE_COLUMNS.map((heading) => values[heading] || '')
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

async function fillSimpleTemplate(format) {
  const template = await buildSimpleTransferTemplate(format, { scopeLabel: 'Jeluma QA FC' })
  const values = simpleTemplateValues()
  if (format === 'csv') {
    const quote = (value) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
    const lines = template.buffer.toString('utf8').split(/\r?\n/)
    lines[1] = values.map(quote).join(',')
    return { ...template, buffer: Buffer.from(lines.join('\r\n'), 'utf8') }
  }
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(template.buffer)
    const row = workbook.getWorksheet(SIMPLE_TRANSFER_SHEET_NAME).getRow(2)
    values.forEach((value, index) => { row.getCell(index + 1).value = value })
    return { ...template, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }
  }
  const zip = await JSZip.loadAsync(template.buffer)
  const content = await zip.file('content.xml').async('string')
  const replacement = `<table:table-row>${values.map((value) => `<table:table-cell office:value-type="string"><text:p>${escapeXml(value)}</text:p></table:table-cell>`).join('')}</table:table-row>`
  const tablePattern = new RegExp(`(<table:table table:name="${SIMPLE_TRANSFER_SHEET_NAME}">[\\s\\S]*?<table:table-row>[\\s\\S]*?</table:table-row>)<table:table-row>[\\s\\S]*?</table:table-row>(</table:table>)`)
  zip.file('content.xml', content.replace(tablePattern, `$1${replacement}$2`))
  return { ...template, buffer: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })) }
}

test('simple CSV, XLSX, and ODS templates contain familiar columns and no platform references', async () => {
  for (const format of ['csv', 'xlsx', 'ods']) {
    const template = await buildSimpleTransferTemplate(format, { scopeLabel: 'Jeluma QA FC' })
    assert.equal(template.filename, `footballplayer-online-player-parent-template.${format}`)
    assert.doesNotMatch(template.buffer.toString('utf8'), /transfer_reference|internal id|CLUB-|TEAM-|PLAYER-|GUARDIAN-/i)
    const inspected = await inspectSpreadsheetSource(template.buffer, { fileName: template.filename, mimeType: template.mimeType })
    const sheet = inspected.sheets.find((candidate) => candidate.name === SIMPLE_TRANSFER_SHEET_NAME || candidate.name === 'CSV Data')
    assert.ok(sheet)
    assert.deepEqual(sheet.headers, SIMPLE_TEMPLATE_COLUMNS)
    assert.equal(inspected.format, format)
  }
  assert.equal(SIMPLE_TRANSFER_TEMPLATE_VERSION, 'FP-V1-PLAYER-PARENT-2')
})

test('filled simple CSV, XLSX, and ODS templates round trip through mapping without references or duplicate rows', async () => {
  for (const format of ['csv', 'xlsx', 'ods']) {
    const template = await fillSimpleTemplate(format)
    const inspected = await inspectSpreadsheetSource(template.buffer, { fileName: template.filename, mimeType: template.mimeType })
    const result = await mapSpreadsheetToTransferRows(template.buffer, {
      existing,
      fileName: template.filename,
      importOptions: { season: '2026/27' },
      mapping: mappingFromInspection(inspected),
      mimeType: template.mimeType,
      scope,
    })
    assert.deepEqual(result.errors, [], `${format}: ${JSON.stringify(result.errors)}`)
    assert.equal(result.rowsBySheet.Players.length, 1)
    assert.equal(result.rowsBySheet.Guardians.length, 1)
    assert.equal(result.rowsBySheet['Player-Guardian Links'].length, 1)
    assert.match(result.rowsBySheet.Players[0].transfer_reference, /^PLAYER-/)
    assert.equal(result.rowsBySheet.Guardians[0].email, 'roundtrip-parent@example.test')
  }
})

test('CSV and TSV parsing preserves quoted newlines, leading zeros, semicolons, and UTF-8 BOM data', async () => {
  const headers = ['Player First Name', 'Player Last Name', 'Date of Birth', 'Team', 'Shirt Number', 'Parent Email']
  const comma = csvBuffer([headers, ['Zo?', 'Example', '01/02/2014', 'Jeluma QA U12', '007', 'parent@example.test'], ['Alex', 'Line\nBreak', '2014-03-04', 'Jeluma QA U12', '008', '']])
  const commaInspected = await inspectSpreadsheetSource(comma, { fileName: 'players.csv', mimeType: 'text/csv' })
  assert.equal(commaInspected.sheets[0].rowCount, 2)
  assert.equal(commaInspected.sheets[0].mappings.find((entry) => entry.sourceColumn === 'Shirt Number').samples[0], '007')
  assert.equal(commaInspected.sheets[0].ambiguousDateSamples[0], '01/02/2014')

  const semicolon = csvBuffer([headers, ['Alex', 'Example', '2014-03-04', 'Jeluma QA U12', '009', 'parent@example.test']], ';')
  assert.equal((await inspectSpreadsheetSource(semicolon, { fileName: 'players.csv', mimeType: 'text/csv' })).sheets[0].rowCount, 1)

  const tsv = csvBuffer([headers, ['Alex', 'Example', '2014-03-04', 'Jeluma QA U12', '010', 'parent@example.test']], '\t')
  assert.equal(await detectSpreadsheetFormat(tsv, { fileName: 'players.tsv', mimeType: 'text/tab-separated-values' }), 'tsv')
})

test('multi-sheet XLSX inspection suggests the populated player sheet and rejects formulas', async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Instructions').addRow(['Read me'])
  const players = workbook.addWorksheet('Registrations')
  players.addRow(['First Name', 'Surname', 'Team'])
  players.addRow(['Alex', 'Example', 'Jeluma QA U12'])
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const inspected = await inspectSpreadsheetSource(buffer, { fileName: 'registrations.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  assert.equal(inspected.suggestedSheet, 'Registrations')
  assert.deepEqual(inspected.sheets.map((sheet) => sheet.name), ['Instructions', 'Registrations'])

  players.getCell('A2').value = { formula: 'HYPERLINK("https://example.invalid")', result: 'Alex' }
  const unsafe = Buffer.from(await workbook.xlsx.writeBuffer())
  await assert.rejects(
    () => inspectSpreadsheetSource(unsafe, { fileName: 'registrations.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    (error) => error.code === 'FORMULA_NOT_ALLOWED',
  )

  players.getCell('A2').value = { text: 'Alex', hyperlink: 'https://example.invalid' }
  const linked = Buffer.from(await workbook.xlsx.writeBuffer())
  await assert.rejects(
    () => inspectSpreadsheetSource(linked, { fileName: 'registrations.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    (error) => error.code === 'EXTERNAL_LINK_NOT_ALLOWED',
  )
})

test('content signatures, extensions, damaged files, macros, and encrypted ODS packages fail closed', async () => {
  const xlsx = await buildSimpleTransferTemplate('xlsx')
  await assert.rejects(
    () => inspectSpreadsheetSource(xlsx.buffer, { fileName: 'players.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' }),
    (error) => error.code === 'FILE_TYPE_MISMATCH',
  )
  await assert.rejects(
    () => inspectSpreadsheetSource(Buffer.from('not a spreadsheet'), { fileName: 'players.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    (error) => error.code === 'FILE_TYPE_MISMATCH',
  )

  const macroZip = await JSZip.loadAsync(xlsx.buffer)
  macroZip.file('xl/vbaProject.bin', 'unsafe')
  const macroBuffer = Buffer.from(await macroZip.generateAsync({ type: 'nodebuffer' }))
  await assert.rejects(
    () => inspectSpreadsheetSource(macroBuffer, { fileName: 'players.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    (error) => error.code === 'UNSAFE_XLSX_CONTENT',
  )

  const ods = await buildSimpleTransferTemplate('ods')
  const encryptedZip = await JSZip.loadAsync(ods.buffer)
  const manifest = await encryptedZip.file('META-INF/manifest.xml').async('string')
  encryptedZip.file('META-INF/manifest.xml', manifest.replace('</manifest:manifest>', '<manifest:encryption-data/></manifest:manifest>'))
  const encryptedBuffer = Buffer.from(await encryptedZip.generateAsync({ type: 'nodebuffer' }))
  await assert.rejects(
    () => inspectSpreadsheetSource(encryptedBuffer, { fileName: 'players.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' }),
    (error) => error.code === 'UNSAFE_ODS_CONTENT',
  )
})

test('ordinary mapping resolves an authorised team, dates, siblings, and a shared guardian without source references', async () => {
  const headers = ['Player First Name', 'Player Last Name', 'Date of Birth', 'Team', 'Parent First Name', 'Parent Last Name', 'Parent Email', 'Parent Phone']
  const buffer = csvBuffer([
    headers,
    ['Alex', 'Example', '01/02/2014', 'Jeluma QA U12', 'Pat', 'Example', 'family@example.test', '07000 000001'],
    ['Sam', 'Example', '03/04/2015', 'Jeluma QA U12', 'Pat', 'Example', 'family@example.test', '07000 000001'],
  ])
  const source = await inspectSpreadsheetSource(buffer, { fileName: 'siblings.csv', mimeType: 'text/csv' })
  const result = await mapSpreadsheetToTransferRows(buffer, {
    existing,
    fileName: 'siblings.csv',
    mimeType: 'text/csv',
    scope,
    importOptions: { season: '2026/27' },
    mapping: mappingFromInspection(source),
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.rowsBySheet.Players.length, 2)
  assert.equal(result.rowsBySheet.Guardians.length, 1)
  assert.equal(result.rowsBySheet['Player-Guardian Links'].length, 2)
  assert.equal(result.rowsBySheet.Players[0].date_of_birth, '2014-02-01')
  assert.equal(result.rowsBySheet.Teams[0].transfer_reference, 'TEAM-U12')
  assert.ok(result.rowsBySheet.Players.every((row) => row.transfer_reference.startsWith('PLAYER-')))
})

test('ambiguous dates, unknown teams, full-name splits, repeated players, and duplicate target mappings require review', async () => {
  const buffer = csvBuffer([
    ['Player Name', 'Date of Birth', 'Team', 'Surname'],
    ['Alex Example', '01/02/2014', 'Unknown U12', 'Example'],
    ['Alex Example', '01/02/2014', 'Unknown U12', 'Example'],
  ])
  const source = await inspectSpreadsheetSource(buffer, { fileName: 'review.csv', mimeType: 'text/csv' })
  const mapping = mappingFromInspection(source)
  mapping.dateConvention = ''
  mapping.columns.find((entry) => entry.sourceColumn === 'Surname').targetField = 'player_last_name'
  mapping.columns.push({ sourceColumn: 'Player Name', targetField: 'player_last_name', transformation: 'trim', defaultValue: '' })
  const result = await mapSpreadsheetToTransferRows(buffer, {
    existing,
    fileName: 'review.csv',
    mimeType: 'text/csv',
    scope,
    importOptions: { season: '2026/27' },
    mapping,
  })
  assert.ok(result.errors.some((error) => error.code === 'TARGET_FIELD_DUPLICATE'))
  assert.ok(result.errors.some((error) => error.code === 'AMBIGUOUS_DATE_CONVENTION'))
  assert.ok(result.errors.some((error) => error.code === 'UNKNOWN_TEAM'))

  const validMapping = mappingFromInspection(source)
  validMapping.teamMappings = [{ sourceValue: 'Unknown U12', teamId: 'team-u12', create: false }]
  const repeated = await mapSpreadsheetToTransferRows(buffer, {
    existing,
    fileName: 'review.csv',
    mimeType: 'text/csv',
    scope,
    importOptions: { season: '2026/27' },
    mapping: validMapping,
  })
  assert.ok(repeated.errors.some((error) => error.code === 'REPEATED_PLAYER_ROW'))
})

test('an explicit authorised team mapping takes precedence over a same-name automatic match', async () => {
  const buffer = csvBuffer([
    ['Player First Name', 'Player Last Name', 'Team'],
    ['Alex', 'Mapped', 'Jeluma QA U12'],
  ])
  const source = await inspectSpreadsheetSource(buffer, { fileName: 'mapped.csv', mimeType: 'text/csv' })
  const mapping = mappingFromInspection(source)
  mapping.teamMappings = [{
    create: false,
    sourceValue: 'Jeluma QA U12',
    teamId: 'team-explicit',
  }]
  const scopedExisting = {
    ...existing,
    teams: [
      ...existing.teams,
      {
        id: 'team-explicit',
        name: 'Explicit Selection',
        transfer_reference: 'TEAM-EXPLICIT',
        season: null,
        status: 'active',
      },
    ],
  }
  const result = await mapSpreadsheetToTransferRows(buffer, {
    existing: scopedExisting,
    fileName: 'mapped.csv',
    importOptions: { season: '2026/27' },
    mapping,
    mimeType: 'text/csv',
    scope: {
      ...scope,
      authorizedTeamIds: ['team-u12', 'team-explicit'],
    },
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.rowsBySheet.Teams[0].transfer_reference, 'TEAM-EXPLICIT')
  assert.equal(result.rowsBySheet.Teams[0].season, '')
})

test('ordinary mapping binds a normalised team name to an authorised null-reference team before creating planning handles', async () => {
  const buffer = csvBuffer([
    ['Player First Name', 'Player Last Name', 'Team'],
    ['Alex', 'Null Reference', '  jeluma   QA u12  '],
  ])
  const source = await inspectSpreadsheetSource(buffer, { fileName: 'null-team-reference.csv', mimeType: 'text/csv' })
  const nullReferenceExisting = {
    ...existing,
    club: {
      ...existing.club,
      season: null,
      transfer_reference: null,
    },
    teams: [{
      ...existing.teams[0],
      season: null,
      transfer_reference: null,
    }],
  }
  const result = await mapSpreadsheetToTransferRows(buffer, {
    existing: nullReferenceExisting,
    fileName: 'null-team-reference.csv',
    importOptions: { season: '2026/27' },
    mapping: mappingFromInspection(source),
    mimeType: 'text/csv',
    scope,
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.rowsBySheet.Teams.length, 1)
  assert.equal(result.rowsBySheet.Teams[0]._resolvedEntityId, 'team-u12')
  assert.match(result.rowsBySheet.Teams[0]._planningHandle, /^PLAN-TEAM-[A-F0-9]{12}$/)
  assert.equal(result.rowsBySheet.Teams[0].transfer_reference, '')
  assert.equal(result.rowsBySheet.Teams[0].season, '')
  assert.equal(result.rowsBySheet.Players[0]._teamPlanningHandle, result.rowsBySheet.Teams[0]._planningHandle)
  assert.equal(result.rowsBySheet.Players[0].team_reference, '')
})

test('normalised team matching fails closed when more than one authorised team is genuinely ambiguous', async () => {
  const buffer = csvBuffer([
    ['Player First Name', 'Player Last Name', 'Team'],
    ['Alex', 'Ambiguous', 'jeluma qa u12'],
  ])
  const source = await inspectSpreadsheetSource(buffer, { fileName: 'ambiguous-team.csv', mimeType: 'text/csv' })
  const ambiguousExisting = {
    ...existing,
    teams: [
      {
        id: 'team-u12',
        name: 'Jeluma QA U12',
        transfer_reference: 'TEAM-U12',
        season: null,
        status: 'active',
      },
      {
        id: 'team-u12-duplicate-name',
        name: 'JELUMA  QA U12',
        transfer_reference: 'TEAM-U12-OTHER',
        season: null,
        status: 'active',
      },
    ],
  }
  const result = await mapSpreadsheetToTransferRows(buffer, {
    existing: ambiguousExisting,
    fileName: 'ambiguous-team.csv',
    importOptions: { season: '2026/27' },
    mapping: mappingFromInspection(source),
    mimeType: 'text/csv',
    scope: {
      ...scope,
      authorizedTeamIds: ['team-u12', 'team-u12-duplicate-name'],
    },
  })
  assert.ok(result.errors.some((error) => error.code === 'TEAM_MATCH_AMBIGUOUS'))
  assert.equal(result.rowsBySheet.Players.length, 0)
  assert.equal(result.rowsBySheet.Teams.length, 0)
})

test('ordinary mapping proposes an explicitly approved missing team only in authorised club-wide scope', async () => {
  const buffer = csvBuffer([
    ['Player First Name', 'Player Last Name', 'Team'],
    ['Alex', 'New Team', 'Jeluma QA U15'],
  ])
  const source = await inspectSpreadsheetSource(buffer, { fileName: 'approved-team-creation.csv', mimeType: 'text/csv' })
  const mapping = mappingFromInspection(source)
  mapping.teamMappings = [{
    create: true,
    sourceValue: 'Jeluma QA U15',
    teamId: '',
  }]
  const result = await mapSpreadsheetToTransferRows(buffer, {
    existing,
    fileName: 'approved-team-creation.csv',
    importOptions: {
      allowTeamCreation: true,
      season: '2026/27',
    },
    mapping,
    mimeType: 'text/csv',
    scope,
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.rowsBySheet.Teams.length, 1)
  assert.equal(result.rowsBySheet.Teams[0]._resolvedEntityId, '')
  assert.match(result.rowsBySheet.Teams[0]._planningHandle, /^PLAN-TEAM-[A-F0-9]{12}$/)
  assert.match(result.rowsBySheet.Teams[0].transfer_reference, /^TEAM-[A-F0-9]{12}$/)
  assert.equal(result.rowsBySheet.Teams[0].name, 'Jeluma QA U15')
})

test('ordinary mapping never resolves a same-name team outside the authorised club scope', async () => {
  const buffer = csvBuffer([
    ['Player First Name', 'Player Last Name', 'Team'],
    ['Alex', 'Cross Club', 'Other Club U12'],
  ])
  const source = await inspectSpreadsheetSource(buffer, { fileName: 'cross-club-team.csv', mimeType: 'text/csv' })
  const crossClubExisting = {
    ...existing,
    teams: [
      ...existing.teams,
      {
        club_id: 'other-club',
        id: 'other-club-team',
        name: 'Other Club U12',
        season: null,
        status: 'active',
        transfer_reference: 'TEAM-OTHER-CLUB',
      },
    ],
  }
  const result = await mapSpreadsheetToTransferRows(buffer, {
    existing: crossClubExisting,
    fileName: 'cross-club-team.csv',
    importOptions: { season: '2026/27' },
    mapping: mappingFromInspection(source),
    mimeType: 'text/csv',
    scope,
  })

  assert.ok(result.errors.some((error) => error.code === 'UNKNOWN_TEAM'))
  assert.equal(result.rowsBySheet.Players.length, 0)
  assert.equal(result.rowsBySheet.Teams.length, 0)
})
