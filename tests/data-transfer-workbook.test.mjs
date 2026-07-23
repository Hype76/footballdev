import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  buildErrorWorkbook,
  buildTransferWorkbook,
  DATA_TRANSFER_FILENAME,
  DATA_TRANSFER_TEMPLATE_VERSION,
  inspectTransferWorkbookMode,
  inspectXlsxContainer,
  parseTransferWorkbook,
  WORKBOOK_SHEET_ORDER,
} from '../netlify/functions/lib/_data-transfer-workbook.js'
import { toWorkbookExportData } from '../netlify/functions/lib/_data-transfer-plan.js'
import { inspectDataTransferSource } from '../netlify/functions/lib/_data-transfer-source.js'

const sampleData = {
  'Club Details': [{ transfer_reference: 'CLUB-QA', name: 'Jeluma QA FC', primary_contact_email: 'support@jelumalabs.com', season: '2026/27' }],
  Teams: [{ transfer_reference: 'TEAM-U12', name: 'Jeluma QA U12', age_group: 'U12', category: 'Mixed', status: 'active' }],
  Players: [{ transfer_reference: 'PLAYER-1', team_reference: 'TEAM-U12', first_name: 'Alex', last_name: 'Example', date_of_birth: '2014-01-20', section: 'Squad', positions: ['Defender', 'Midfielder'], status: 'active' }],
  Guardians: [{ transfer_reference: 'GUARDIAN-1', first_name: 'Pat', last_name: 'Example', email: 'support@jelumalabs.com', status: 'active' }],
  'Player-Guardian Links': [{ player_reference: 'PLAYER-1', guardian_reference: 'GUARDIAN-1', relationship: 'Parent', primary_contact: true, receives_communications: false, emergency_contact: true }],
}

async function editPortableWorkbook(edit) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await buildTransferWorkbook({ data: sampleData, mode: 'export', scopeLabel: 'Jeluma QA FC' }))
  await edit(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

test('fixed V1 workbook round trips with the exact sheet order and values', async () => {
  const buffer = await buildTransferWorkbook({ data: sampleData, mode: 'export', scopeLabel: 'Jeluma QA FC' })
  const detected = await inspectDataTransferSource(buffer, {
    fileName: DATA_TRANSFER_FILENAME,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const parsed = await parseTransferWorkbook(buffer)
  assert.equal(DATA_TRANSFER_FILENAME, 'footballplayer-online-portable-transfer-v1.xlsx')
  assert.equal(detected.importMode, 'portable')
  assert.equal(detected.portable, true)
  assert.equal(detected.modeDetection.signature.metadataMatches, true)
  assert.equal(detected.modeDetection.signature.exactSheetOrder, true)
  assert.equal(detected.modeDetection.signature.dataHeaderMatches, 5)
  assert.equal(detected.modeDetection.signature.referenceHeaderMatches, 5)
  assert.equal(detected.modeDetection.signature.relationshipStructureMatches, true)
  assert.equal(detected.modeDetection.signature.listsStructureMatches, true)
  assert.equal(parsed.templateVersion, DATA_TRANSFER_TEMPLATE_VERSION)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.rowsBySheet.Players[0].team_reference, 'TEAM-U12')
  assert.deepEqual(parsed.rowsBySheet.Players[0].positions, ['Defender', 'Midfielder'])
  assert.equal(parsed.rowsBySheet['Player-Guardian Links'][0].primary_contact, true)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), WORKBOOK_SHEET_ORDER)
  assert.equal(workbook.getWorksheet('Lists').state, 'veryHidden')
  assert.equal(workbook.getWorksheet('Player-Guardian Links').state, 'veryHidden')
  assert.equal(workbook.getWorksheet('Club Details').getColumn(1).hidden, true)
  assert.equal(workbook.getWorksheet('Teams').getColumn(1).hidden, true)
  assert.equal(workbook.getWorksheet('Players').getColumn(1).hidden, true)
  assert.equal(workbook.getWorksheet('Players').getColumn(2).hidden, true)
  assert.equal(workbook.getWorksheet('Guardians').getColumn(1).hidden, true)
  assert.equal(workbook.views[0].activeTab, WORKBOOK_SHEET_ORDER.indexOf('Players'))
  assert.equal(workbook.getWorksheet('Players').views[0].state, 'frozen')
  assert.ok(workbook.getWorksheet('Players').autoFilter)
  assert.equal(workbook.getWorksheet('Players').sheetProtection.sheet, true)
  assert.equal(workbook.getWorksheet('Players').getCell('A5001').protection.locked, false)
  assert.equal(workbook.getWorksheet('Players').getCell('G5001').dataValidation.type, 'list')
  assert.equal(workbook.getWorksheet('Player-Guardian Links').getCell('C10001').dataValidation.type, 'list')
  const instructions = workbook.getWorksheet('Instructions')
  assert.equal(instructions.getCell('A1').value, 'Footballplayer.online Portable Transfer')
  assert.match(String(instructions.getCell('B6').value), /manages the hidden relationship data/)
  assert.match(String(instructions.getCell('B6').value), /do not need to enter, copy, invent or edit system references/)
})

test('portable export derives legacy first and last names before self-reimport validation', async () => {
  const existing = {
    club: { id: 'club-legacy', name: 'Legacy FC', season: '2026/27' },
    teams: [{ id: 'team-legacy', name: 'Legacy U13', season: '2026/27', status: 'active' }],
    players: [{
      id: 'player-legacy',
      team_id: 'team-legacy',
      player_name: 'Alex Legacy',
      first_name: null,
      last_name: null,
      section: 'Squad',
      positions: [],
      status: 'active',
    }],
    guardians: [],
    links: [],
  }
  const data = toWorkbookExportData(existing, {
    authorizedTeamIds: ['team-legacy'],
    canManageAllTeams: false,
    canManageClub: false,
  })
  assert.equal(data.Players[0].first_name, 'Alex')
  assert.equal(data.Players[0].last_name, 'Legacy')

  const parsed = await parseTransferWorkbook(await buildTransferWorkbook({
    data,
    mode: 'export',
    scopeLabel: 'Legacy FC | Legacy U13',
  }))
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.rowsBySheet.Players[0].first_name, 'Alex')
  assert.equal(parsed.rowsBySheet.Players[0].last_name, 'Legacy')
})

test('portable detection runs before ordinary header validation and skips ordinary support-sheet rules', async () => {
  const buffer = await buildTransferWorkbook({ data: sampleData, mode: 'export' })
  const source = await inspectDataTransferSource(buffer, {
    fileName: DATA_TRANSFER_FILENAME,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  assert.equal(source.importMode, 'portable')
  assert.equal(source.portable, true)
  assert.ok(source.sheets.some((sheet) => sheet.name === 'Instructions'))
  assert.ok(source.sheets.some((sheet) => sheet.name === 'Lists'))
  assert.equal(source.sheets.find((sheet) => sheet.name === 'Instructions').mappings.length, 0)
  assert.equal(source.sheets.find((sheet) => sheet.name === 'Lists').mappings.length, 0)
})

test('sheet names alone cannot trigger portable routing', async () => {
  const workbook = new ExcelJS.Workbook()
  for (const name of WORKBOOK_SHEET_ORDER) {
    workbook.addWorksheet(name).addRow(['Fake heading'])
  }
  const detected = await inspectTransferWorkbookMode(Buffer.from(await workbook.xlsx.writeBuffer()))
  assert.equal(detected.importMode, 'ordinary')
  assert.equal(detected.portable, false)
  assert.equal(detected.modeDetection.signature.expectedSheetCoverage, WORKBOOK_SHEET_ORDER.length)
  assert.equal(detected.modeDetection.signature.metadataMatches, false)
  assert.equal(detected.modeDetection.signature.titleMatches, false)
})

test('partial portable structures route to the portable validator and fail with a sheet error', async () => {
  const buffer = await editPortableWorkbook((workbook) => {
    workbook.removeWorksheet(workbook.getWorksheet('Lists').id)
  })
  const detected = await inspectTransferWorkbookMode(buffer)
  assert.equal(detected.importMode, 'portable')
  assert.equal(detected.modeDetection.signature.expectedSheetCoverage, WORKBOOK_SHEET_ORDER.length - 1)
  await assert.rejects(() => parseTransferWorkbook(buffer), (error) => error.code === 'SHEET_STRUCTURE_MISMATCH')
})

test('unsupported portable versions route correctly and fail with a version error', async () => {
  const buffer = await editPortableWorkbook((workbook) => {
    workbook.getWorksheet('Instructions').getCell('B2').value = 'FP-V1-ONBOARDING-999'
  })
  const detected = await inspectTransferWorkbookMode(buffer)
  assert.equal(detected.importMode, 'portable')
  assert.equal(detected.modeDetection.signature.versionMatches, false)
  await assert.rejects(() => parseTransferWorkbook(buffer), (error) => error.code === 'TEMPLATE_VERSION_MISMATCH')
})

test('forged and duplicate portable headers fail closed after portable routing', async () => {
  for (const [cell, value] of [['C1', 'Forged First Name'], ['B1', 'Player Reference']]) {
    const buffer = await editPortableWorkbook((workbook) => {
      workbook.getWorksheet('Players').getCell(cell).value = value
    })
    const detected = await inspectTransferWorkbookMode(buffer)
    assert.equal(detected.importMode, 'portable')
    const parsed = await parseTransferWorkbook(buffer)
    assert.ok(parsed.errors.some((error) => error.code === 'HEADER_MISMATCH'))
  }
})

test('forged references and cross-scope link references fail closed in portable validation', async () => {
  const forgedReference = await editPortableWorkbook((workbook) => {
    workbook.getWorksheet('Players').getCell('B2').value = 'TEAM-FORGED'
  })
  assert.equal((await inspectTransferWorkbookMode(forgedReference)).importMode, 'portable')
  const forgedParsed = await parseTransferWorkbook(forgedReference)
  assert.ok(forgedParsed.errors.some((error) => error.code === 'UNKNOWN_TEAM_REFERENCE'))

  const crossScopeLink = await editPortableWorkbook((workbook) => {
    workbook.getWorksheet('Player-Guardian Links').getCell('B2').value = 'GUARDIAN-OTHER-CLUB'
  })
  assert.equal((await inspectTransferWorkbookMode(crossScopeLink)).importMode, 'portable')
  const linkParsed = await parseTransferWorkbook(crossScopeLink)
  assert.ok(linkParsed.errors.some((error) => error.code === 'UNKNOWN_GUARDIAN_REFERENCE'))
})

test('portable Instructions and Lists use portable safety rules without ordinary header validation', async () => {
  const buffer = await editPortableWorkbook((workbook) => {
    workbook.getWorksheet('Instructions').getCell('B3').value = { formula: '1+1', result: 2 }
    workbook.getWorksheet('Lists').getCell('B1').value = 'Category'
  })
  assert.equal((await inspectTransferWorkbookMode(buffer)).importMode, 'portable')
  const parsed = await parseTransferWorkbook(buffer)
  assert.ok(parsed.errors.some((error) => error.sheet === 'Instructions' && error.code === 'FORMULA_NOT_ALLOWED'))
  assert.ok(parsed.errors.some((error) => error.sheet === 'Lists' && error.code === 'LISTS_STRUCTURE_MISMATCH'))
  assert.ok(!parsed.errors.some((error) => error.code === 'DUPLICATE_HEADER'))
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
