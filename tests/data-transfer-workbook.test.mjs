import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  buildErrorWorkbook,
  buildTransferWorkbook,
  DATA_TRANSFER_FILENAME,
  DATA_TRANSFER_TEMPLATE_VERSION,
  inspectXlsxContainer,
  parseTransferWorkbook,
  WORKBOOK_SHEET_ORDER,
} from '../netlify/functions/lib/_data-transfer-workbook.js'

const sampleData = {
  'Club Details': [{ transfer_reference: 'CLUB-QA', name: 'Jeluma QA FC', primary_contact_email: 'support@jelumalabs.com', season: '2026/27' }],
  Teams: [{ transfer_reference: 'TEAM-U12', name: 'Jeluma QA U12', age_group: 'U12', category: 'Mixed', status: 'active' }],
  Players: [{ transfer_reference: 'PLAYER-1', team_reference: 'TEAM-U12', first_name: 'Alex', last_name: 'Example', date_of_birth: '2014-01-20', section: 'Squad', positions: ['Defender', 'Midfielder'], status: 'active' }],
  Guardians: [{ transfer_reference: 'GUARDIAN-1', first_name: 'Pat', last_name: 'Example', email: 'support@jelumalabs.com', status: 'active' }],
  'Player-Guardian Links': [{ player_reference: 'PLAYER-1', guardian_reference: 'GUARDIAN-1', relationship: 'Parent', primary_contact: true, receives_communications: false, emergency_contact: true }],
}

test('fixed V1 workbook round trips with the exact sheet order and values', async () => {
  const buffer = await buildTransferWorkbook({ data: sampleData, mode: 'export', scopeLabel: 'Jeluma QA FC' })
  const parsed = await parseTransferWorkbook(buffer)
  assert.equal(DATA_TRANSFER_FILENAME, 'footballplayer-online-portable-transfer-v1.xlsx')
  assert.equal(parsed.templateVersion, DATA_TRANSFER_TEMPLATE_VERSION)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.rowsBySheet.Players[0].team_reference, 'TEAM-U12')
  assert.deepEqual(parsed.rowsBySheet.Players[0].positions, ['Defender', 'Midfielder'])
  assert.equal(parsed.rowsBySheet['Player-Guardian Links'][0].primary_contact, true)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), WORKBOOK_SHEET_ORDER)
  assert.equal(workbook.getWorksheet('Lists').state, 'veryHidden')
  assert.equal(workbook.getWorksheet('Players').views[0].state, 'frozen')
  assert.ok(workbook.getWorksheet('Players').autoFilter)
  assert.equal(workbook.getWorksheet('Players').sheetProtection.sheet, true)
  assert.equal(workbook.getWorksheet('Players').getCell('A5001').protection.locked, false)
  assert.equal(workbook.getWorksheet('Players').getCell('G5001').dataValidation.type, 'list')
  assert.equal(workbook.getWorksheet('Player-Guardian Links').getCell('C10001').dataValidation.type, 'list')
  const instructions = workbook.getWorksheet('Instructions')
  assert.equal(instructions.getCell('A1').value, 'Footballplayer.online Portable Transfer')
  assert.match(String(instructions.getCell('B6').value), /Footballplayer\.online generates public transfer references/)
  assert.match(String(instructions.getCell('B6').value), /Do not invent or edit them/)
})

test('documented UK, ISO, Excel-cell, and serial dates parse without guessing', async () => {
  const ukData = structuredClone(sampleData)
  ukData.Players[0].date_of_birth = '20/01/2014'
  const ukParsed = await parseTransferWorkbook(await buildTransferWorkbook({ data: ukData }))
  assert.equal(ukParsed.rowsBySheet.Players[0].date_of_birth, '2014-01-20')
  assert.deepEqual(ukParsed.errors, [])

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await buildTransferWorkbook({ data: sampleData }))
  const excelSerial = (Date.UTC(2014, 0, 20) - Date.UTC(1899, 11, 30)) / 86400000
  workbook.getWorksheet('Players').getCell('F2').value = excelSerial
  const serialParsed = await parseTransferWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))
  assert.equal(serialParsed.rowsBySheet.Players[0].date_of_birth, '2014-01-20')
})

test('invalid dates, unsupported lists, phone values, and protected columns fail closed', async () => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await buildTransferWorkbook({ data: sampleData }))
  workbook.getWorksheet('Players').getCell('F2').value = '31/02/2014'
  workbook.getWorksheet('Teams').getCell('D2').value = 'Unknown category'
  workbook.getWorksheet('Guardians').getCell('E2').value = 'not a phone'
  workbook.getWorksheet('Club Details').getCell('O1').value = 'Administrator Role'
  const parsed = await parseTransferWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))
  assert.ok(parsed.errors.some((error) => error.code === 'INVALID_DATE'))
  assert.ok(parsed.errors.some((error) => error.code === 'UNSUPPORTED_VALUE'))
  assert.ok(parsed.errors.some((error) => error.code === 'INVALID_PHONE'))
  assert.ok(parsed.errors.some((error) => error.code === 'UNEXPECTED_COLUMN'))
})

test('formula cells are rejected without evaluating them', async () => {
  const buffer = await buildTransferWorkbook({ data: sampleData })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  workbook.getWorksheet('Players').getCell('C2').value = { formula: 'HYPERLINK("https://example.invalid")', result: 'Alex' }
  const unsafe = Buffer.from(await workbook.xlsx.writeBuffer())
  const parsed = await parseTransferWorkbook(unsafe)
  assert.ok(parsed.errors.some((error) => error.code === 'FORMULA_NOT_ALLOWED'))
})

test('macros and excessive ZIP expansion are rejected before workbook parsing', async () => {
  const buffer = await buildTransferWorkbook({ data: sampleData })
  const zip = await JSZip.loadAsync(buffer)
  zip.file('xl/vbaProject.bin', Buffer.from('unsafe'))
  const macroWorkbook = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
  await assert.rejects(() => inspectXlsxContainer(macroWorkbook), (error) => error.code === 'UNSAFE_XLSX_CONTENT')
})

test('cross-sheet reference errors and duplicate links are precise', async () => {
  const data = structuredClone(sampleData)
  data.Players[0].team_reference = 'TEAM-MISSING'
  data['Player-Guardian Links'].push({ ...data['Player-Guardian Links'][0] })
  const parsed = await parseTransferWorkbook(await buildTransferWorkbook({ data }))
  assert.ok(parsed.errors.some((error) => error.code === 'UNKNOWN_TEAM_REFERENCE'))
  assert.ok(parsed.errors.some((error) => error.code === 'DUPLICATE_LINK'))
})

test('error report is a valid formula-safe XLSX', async () => {
  const buffer = await buildErrorWorkbook([{ sheet: 'Players', row: 2, reference: 'PLAYER-1', status: 'Error', column: 'First Name', code: 'INVALID', message: '=unsafe', suggestedCorrection: '=fix' }])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Errors'])
  const sheet = workbook.getWorksheet('Errors')
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Source Sheet', 'Source Row', 'Record Reference', 'Status', 'Column', 'Error or Warning Code', 'Plain-English Explanation', 'Suggested Correction'])
  assert.equal(sheet.getCell('C2').value, 'PLAYER-1')
  assert.equal(sheet.getCell('G2').value, "'=unsafe")
  assert.equal(sheet.getCell('H2').value, "'=fix")
})
