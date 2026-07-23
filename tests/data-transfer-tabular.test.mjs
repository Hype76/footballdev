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

test('CSV and TSV parsing preserves quoted newlines, leading zeros, semicolons, and UTF-8 BOM data', async () => {
  const headers = ['Player First Name', 'Player Last Name', 'Date of Birth', 'Team', 'Shirt Number', 'Parent Email']
  const comma = csvBuffer([headers, ['Zoë', 'Example', '01/02/2014', 'Jeluma QA U12', '007', 'parent@example.test'], ['Alex', 'Line\nBreak', '2014-03-04', 'Jeluma QA U12', '008', '']])
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
