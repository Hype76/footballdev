import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { Buffer } from 'node:buffer'
import {
  DATA_TRANSFER_FORMATS,
  DATA_TRANSFER_MAX_BYTES as FORMAT_MAX_BYTES,
} from '../../../src/lib/data-transfer-formats.js'

export const DATA_TRANSFER_TEMPLATE_VERSION = 'FP-V1-ONBOARDING-1'
export const DATA_TRANSFER_FILENAME = 'footballplayer-online-portable-transfer-v1.xlsx'
export const DATA_TRANSFER_MIME = DATA_TRANSFER_FORMATS.xlsx.responseMimeType
export const DATA_TRANSFER_MAX_BYTES = FORMAT_MAX_BYTES
export const DATA_TRANSFER_RAW_RETENTION_DAYS = 7

const PORTABLE_WORKBOOK_METADATA = {
  creator: 'Football Player',
  company: 'Jeluma Labs',
  subject: 'Controlled club onboarding data transfer',
}
const PORTABLE_WORKBOOK_TITLE = 'Footballplayer.online Portable Transfer'
const PORTABLE_VERSION_LABEL = 'Template Version'
const SYSTEM_REFERENCE_COLUMN_KEYS = new Set([
  'guardian_reference',
  'player_reference',
  'team_reference',
  'transfer_reference',
])

export const SHEET_DEFINITIONS = [
  {
    name: 'Club Details',
    limit: 1,
    columns: [
      ['Club Reference', 'transfer_reference', true], ['Club Name', 'name', true],
      ['FA Affiliation Number', 'fa_affiliation_number'], ['Address Line 1', 'address_line_1'],
      ['Address Line 2', 'address_line_2'], ['Town or City', 'town_city'], ['County', 'county'],
      ['Postcode', 'postcode'], ['Country', 'country'], ['Primary Contact Name', 'primary_contact_name'],
      ['Primary Contact Email', 'primary_contact_email'], ['Primary Contact Phone', 'primary_contact_phone'],
      ['Website', 'website'], ['Season', 'season'],
    ],
  },
  {
    name: 'Teams',
    limit: 250,
    columns: [
      ['Team Reference', 'transfer_reference', true], ['Team Name', 'name', true], ['Age Group', 'age_group'],
      ['Category', 'category'], ['Season', 'season'], ['League', 'league'], ['Division', 'division'],
      ['Home Ground', 'home_ground'], ['Training Day', 'training_day'], ['Training Time', 'training_time'],
      ['Status', 'status'],
    ],
  },
  {
    name: 'Players',
    limit: 5000,
    columns: [
      ['Player Reference', 'transfer_reference', true], ['Team Reference', 'team_reference', true],
      ['First Name', 'first_name', true], ['Last Name', 'last_name', true], ['Preferred Name', 'preferred_name'],
      ['Date of Birth', 'date_of_birth'], ['Gender', 'gender'], ['Section', 'section'],
      ['Shirt Number', 'shirt_number'], ['Positions', 'positions'], ['Status', 'status'],
    ],
  },
  {
    name: 'Guardians',
    limit: 7500,
    columns: [
      ['Guardian Reference', 'transfer_reference', true], ['First Name', 'first_name', true],
      ['Last Name', 'last_name', true], ['Email', 'email'], ['Phone', 'phone'],
      ['Address Line 1', 'address_line_1'], ['Address Line 2', 'address_line_2'],
      ['Town or City', 'town_city'], ['County', 'county'], ['Postcode', 'postcode'], ['Country', 'country'],
      ['Status', 'status'],
    ],
  },
  {
    name: 'Player-Guardian Links',
    limit: 10000,
    columns: [
      ['Player Reference', 'player_reference', true], ['Guardian Reference', 'guardian_reference', true],
      ['Relationship', 'relationship', true], ['Primary Contact', 'primary_contact'],
      ['Receives Communications', 'receives_communications'], ['Emergency Contact', 'emergency_contact'],
    ],
  },
]

export const WORKBOOK_SHEET_ORDER = ['Instructions', ...SHEET_DEFINITIONS.map((sheet) => sheet.name), 'Lists']

export const WORKBOOK_LIST_VALUES = {
  Category: ['Boys', 'Girls', 'Mixed', 'Mens', 'Womens', 'Other'],
  Gender: ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other'],
  Section: ['Trial', 'Squad'],
  Status: ['active', 'inactive'],
  Relationship: ['Parent', 'Guardian', 'Carer', 'Grandparent', 'Other'],
  YesNo: ['Yes', 'No'],
}

function normalizeText(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  if (value && typeof value === 'object') {
    if ('text' in value) return String(value.text ?? '').trim()
    if ('result' in value) return normalizeText(value.result)
    if (Array.isArray(value.richText)) return value.richText.map((entry) => entry.text || '').join('').trim()
  }

  return String(value ?? '').trim()
}

function worksheetHeaders(sheet, limit = 100) {
  if (!sheet) return []
  const columnCount = Math.min(Math.max(sheet.actualColumnCount, 1), limit)
  const headers = []
  for (let index = 1; index <= columnCount; index += 1) {
    headers.push(normalizeText(sheet.getCell(1, index).value))
  }
  while (headers.length && !headers.at(-1)) headers.pop()
  return headers
}

function headersMatch(sheet, expected) {
  const actual = worksheetHeaders(sheet, expected.length + 1)
  return actual.length === expected.length
    && actual.every((header, index) => header === expected[index])
}

function portableWorkbookMetadataMatches(workbook) {
  return normalizeText(workbook.creator) === PORTABLE_WORKBOOK_METADATA.creator
    && normalizeText(workbook.company) === PORTABLE_WORKBOOK_METADATA.company
    && normalizeText(workbook.subject) === PORTABLE_WORKBOOK_METADATA.subject
}

async function loadSafeTransferWorkbook(buffer) {
  const container = await inspectXlsxContainer(buffer)
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations'] })
  } catch {
    throw Object.assign(new Error('The workbook could not be read. Confirm it is an unencrypted XLSX file.'), { code: 'UNREADABLE_WORKBOOK' })
  }
  return { container, workbook }
}

function portableSheetSummary(sheet) {
  return {
    name: sheet.name,
    headers: worksheetHeaders(sheet),
    mappings: [],
    rowCount: Math.max(0, sheet.actualRowCount - 1),
    ambiguousDateSamples: [],
    teamValues: [],
    mappingScore: 0,
  }
}

export async function inspectTransferWorkbookMode(buffer) {
  const { container, workbook } = await loadSafeTransferWorkbook(buffer)
  const instructions = workbook.getWorksheet('Instructions')
  const lists = workbook.getWorksheet('Lists')
  const actualOrder = workbook.worksheets.map((sheet) => sheet.name)
  const expectedSheetCoverage = WORKBOOK_SHEET_ORDER.filter((name) => workbook.getWorksheet(name)).length
  const dataHeaderMatches = SHEET_DEFINITIONS.filter((definition) => (
    headersMatch(workbook.getWorksheet(definition.name), definition.columns.map(([label]) => label))
  )).length
  const referenceHeaderChecks = [
    ['Club Details', 1, 'Club Reference'],
    ['Teams', 1, 'Team Reference'],
    ['Players', 1, 'Player Reference'],
    ['Players', 2, 'Team Reference'],
    ['Guardians', 1, 'Guardian Reference'],
  ]
  const referenceHeaderMatches = referenceHeaderChecks.filter(([sheetName, column, label]) => (
    normalizeText(workbook.getWorksheet(sheetName)?.getCell(1, column).value) === label
  )).length
  const relationshipHeaders = ['Player Reference', 'Guardian Reference', 'Relationship']
  const relationshipStructureMatches = relationshipHeaders.every((label, index) => (
    normalizeText(workbook.getWorksheet('Player-Guardian Links')?.getCell(1, index + 1).value) === label
  ))
  const listHeaders = Object.keys(WORKBOOK_LIST_VALUES)
  const listsStructureMatches = headersMatch(lists, listHeaders)
  const metadataMatches = portableWorkbookMetadataMatches(workbook)
  const titleMatches = normalizeText(instructions?.getCell('A1').value) === PORTABLE_WORKBOOK_TITLE
  const versionLabelMatches = normalizeText(instructions?.getCell('A2').value) === PORTABLE_VERSION_LABEL
  const version = normalizeText(instructions?.getCell('B2').value)
  const versionMatches = version === DATA_TRANSFER_TEMPLATE_VERSION
  const exactSheetOrder = JSON.stringify(actualOrder) === JSON.stringify(WORKBOOK_SHEET_ORDER)
  const structuralSignals = [
    expectedSheetCoverage >= 5,
    dataHeaderMatches >= 3,
    referenceHeaderMatches >= 4,
    relationshipStructureMatches,
    listsStructureMatches,
    exactSheetOrder,
  ].filter(Boolean).length
  const portable = metadataMatches
    && titleMatches
    && versionLabelMatches
    && expectedSheetCoverage >= 5
    && structuralSignals >= 3

  return {
    container,
    format: 'xlsx',
    importMode: portable ? 'portable' : 'ordinary',
    portable,
    modeDetection: {
      mode: portable ? 'portable' : 'ordinary',
      signature: {
        dataHeaderMatches,
        exactSheetOrder,
        expectedSheetCoverage,
        listsStructureMatches,
        metadataMatches,
        referenceHeaderMatches,
        relationshipStructureMatches,
        structuralSignals,
        titleMatches,
        version,
        versionLabelMatches,
        versionMatches,
      },
    },
    sheets: workbook.worksheets.map(portableSheetSummary),
    suggestedSheet: workbook.getWorksheet('Players') ? 'Players' : '',
  }
}

export function safeSpreadsheetText(value) {
  const text = normalizeText(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

export function createPublicTransferReference(prefix, id) {
  const compact = String(id ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  return `${prefix}-${compact.slice(0, 12) || 'NEW'}`
}

function styleHeader(row) {
  row.height = 30
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF065F46' } } }
    cell.protection = { locked: true }
  })
}

function styleDataSheet(sheet, definition) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: definition.columns.length } }
  sheet.properties.defaultRowHeight = 22

  definition.columns.forEach(([label, key], index) => {
    const column = sheet.getColumn(index + 1)
    column.width = Math.min(34, Math.max(15, label.length + 4))
    column.hidden = SYSTEM_REFERENCE_COLUMN_KEYS.has(key)
    column.protection = { locked: false }
    column.alignment = { vertical: 'top', wrapText: true }
  })
  styleHeader(sheet.getRow(1))

  void sheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertRows: true,
    deleteRows: true,
    sort: true,
    autoFilter: true,
  })
}

function addListValidation(sheet, columnKey, listName, maxRow) {
  const definition = SHEET_DEFINITIONS.find((candidate) => candidate.name === sheet.name)
  const columnIndex = definition?.columns.findIndex(([, key]) => key === columnKey) ?? -1
  if (columnIndex < 0) return
  const listIndex = Object.keys(WORKBOOK_LIST_VALUES).indexOf(listName) + 1
  const listLength = WORKBOOK_LIST_VALUES[listName].length
  const letter = String.fromCharCode(64 + listIndex)
  const targetLetter = sheet.getColumn(columnIndex + 1).letter
  sheet.dataValidations.add(`${targetLetter}2:${targetLetter}${maxRow + 1}`, {
    type: 'list',
    allowBlank: true,
    formulae: [`'Lists'!$${letter}$2:$${letter}$${listLength + 1}`],
    showErrorMessage: true,
    errorTitle: 'Choose a listed value',
    error: 'Use one of the values provided in this template.',
  })
}

function addInstructions(workbook, mode, scopeLabel) {
  const sheet = workbook.addWorksheet('Instructions', { properties: { tabColor: { argb: 'FF047857' } } })
  sheet.columns = [{ width: 28 }, { width: 88 }]
  sheet.addRow(['Footballplayer.online portable transfer', 'Use this advanced workbook for a Footballplayer.online backup, migration, reimport, or support-assisted transfer. Use the ordinary spreadsheet export when you only need a readable file.'])
  sheet.addRow(['Template Version', DATA_TRANSFER_TEMPLATE_VERSION])
  sheet.addRow(['Workbook Mode', mode === 'export' ? 'Platform-generated portable transfer' : 'Blank support-assisted portable structure'])
  sheet.addRow(['Authorized Scope', scopeLabel || 'Select scope in Footballplayer.online before import.'])
  sheet.addRow(['Required order', WORKBOOK_SHEET_ORDER.join(', ')])
  sheet.addRow(['System relationship data', 'Footballplayer.online manages the hidden relationship data in this workbook automatically. You do not need to enter, copy, invent or edit system references.'])
  sheet.addRow(['Dates', 'Use DD/MM/YYYY or ISO YYYY-MM-DD. Real Excel date cells are also supported.'])
  sheet.addRow(['Positions', 'Separate multiple positions with commas.'])
  sheet.addRow(['Boolean fields', 'Use Yes or No.'])
  sheet.addRow(['Important', 'Uploading only validates and previews. No records are written until a separate final confirmation.'])
  sheet.addRow(['Invitations', 'Imported guardians remain uninvited. Invitations are a separate action after review.'])
  sheet.addRow(['Formula safety', 'Do not use formulas, macros, external links, embedded objects, or password protection.'])
  sheet.getRow(1).height = 36
  sheet.mergeCells('A1:B1')
  sheet.getCell('A1').value = 'Footballplayer.online Portable Transfer'
  sheet.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }
  sheet.getCell('A1').alignment = { vertical: 'middle' }
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    sheet.getCell(rowNumber, 1).font = { bold: true, color: { argb: 'FF065F46' } }
    sheet.getCell(rowNumber, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }
    sheet.getCell(rowNumber, 2).alignment = { wrapText: true, vertical: 'top' }
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

function addLists(workbook) {
  const sheet = workbook.addWorksheet('Lists')
  Object.entries(WORKBOOK_LIST_VALUES).forEach(([name, values], columnIndex) => {
    const column = sheet.getColumn(columnIndex + 1)
    column.width = Math.max(18, name.length + 4)
    sheet.getCell(1, columnIndex + 1).value = name
    values.forEach((value, valueIndex) => {
      sheet.getCell(valueIndex + 2, columnIndex + 1).value = value
    })
  })
  styleHeader(sheet.getRow(1))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.state = 'veryHidden'
}

function writeRows(sheet, definition, rows) {
  for (const sourceRow of rows || []) {
    const values = definition.columns.map(([, key]) => {
      const value = sourceRow?.[key]
      if (Array.isArray(value)) return safeSpreadsheetText(value.join(', '))
      if (typeof value === 'boolean') return value ? 'Yes' : 'No'
      return safeSpreadsheetText(value)
    })
    sheet.addRow(values)
  }
}

export async function buildTransferWorkbook({ data = {}, mode = 'blank', scopeLabel = '' } = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = PORTABLE_WORKBOOK_METADATA.creator
  workbook.company = PORTABLE_WORKBOOK_METADATA.company
  workbook.subject = PORTABLE_WORKBOOK_METADATA.subject
  workbook.created = new Date()
  workbook.modified = new Date()
  workbook.calcProperties.fullCalcOnLoad = false

  addInstructions(workbook, mode, scopeLabel)
  for (const definition of SHEET_DEFINITIONS) {
    const sheet = workbook.addWorksheet(definition.name)
    sheet.addRow(definition.columns.map(([label]) => label))
    writeRows(sheet, definition, data[definition.name] || [])
    styleDataSheet(sheet, definition)
    if (definition.name === 'Player-Guardian Links') {
      sheet.state = 'veryHidden'
    }
  }
  addLists(workbook)
  workbook.views = [{ activeTab: WORKBOOK_SHEET_ORDER.indexOf('Players'), firstSheet: 0, visibility: 'visible' }]

  addListValidation(workbook.getWorksheet('Teams'), 'category', 'Category', 250)
  addListValidation(workbook.getWorksheet('Teams'), 'status', 'Status', 250)
  addListValidation(workbook.getWorksheet('Players'), 'gender', 'Gender', 5000)
  addListValidation(workbook.getWorksheet('Players'), 'section', 'Section', 5000)
  addListValidation(workbook.getWorksheet('Players'), 'status', 'Status', 5000)
  addListValidation(workbook.getWorksheet('Guardians'), 'status', 'Status', 7500)
  addListValidation(workbook.getWorksheet('Player-Guardian Links'), 'relationship', 'Relationship', 10000)
  for (const key of ['primary_contact', 'receives_communications', 'emergency_contact']) {
    addListValidation(workbook.getWorksheet('Player-Guardian Links'), key, 'YesNo', 10000)
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function inspectXlsxContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw Object.assign(new Error('Choose a non-empty XLSX workbook.'), { code: 'EMPTY_WORKBOOK' })
  if (buffer.length > DATA_TRANSFER_MAX_BYTES) throw Object.assign(new Error('The workbook exceeds the 4 MB upload limit.'), { code: 'WORKBOOK_TOO_LARGE' })
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw Object.assign(new Error('The file is not a valid XLSX ZIP package.'), { code: 'INVALID_XLSX_SIGNATURE' })

  let zip
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false })
  } catch {
    throw Object.assign(new Error('The XLSX package is damaged or encrypted.'), { code: 'INVALID_XLSX_PACKAGE' })
  }

  const entries = Object.values(zip.files)
  const forbidden = entries.find((entry) => /(^|\/)(vbaProject\.bin|externalLinks|embeddings|oleObject|encryptedPackage)/i.test(entry.name))
  if (forbidden) throw Object.assign(new Error('Macros, external links, embedded objects, and encrypted packages are not supported.'), { code: 'UNSAFE_XLSX_CONTENT' })
  if (entries.length > 250) throw Object.assign(new Error('The workbook contains too many package entries.'), { code: 'ZIP_ENTRY_LIMIT' })

  let expandedBytes = 0
  for (const entry of entries) {
    if (entry.dir) continue
    const content = await entry.async('uint8array')
    expandedBytes += content.byteLength
    if (expandedBytes > 24 * 1024 * 1024) throw Object.assign(new Error('The expanded workbook exceeds the safe processing limit.'), { code: 'ZIP_EXPANSION_LIMIT' })
  }

  const contentTypes = await zip.file('[Content_Types].xml')?.async('string')
  if (/macroEnabled|vbaProject/i.test(contentTypes || '')) throw Object.assign(new Error('Macro-enabled workbooks are not supported.'), { code: 'MACRO_WORKBOOK' })
  return { entries: entries.length, expandedBytes }
}

function parseBoolean(value, location, errors) {
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return false
  if (['yes', 'true', '1'].includes(normalized)) return true
  if (['no', 'false', '0'].includes(normalized)) return false
  errors.push({ ...location, code: 'INVALID_BOOLEAN', message: 'Use Yes or No.' })
  return false
}

function normalizeDate(value, location, errors) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.trunc(value) * 86400000)
    return date.toISOString().slice(0, 10)
  }
  const text = normalizeText(value)
  if (!text) return ''

  let year
  let month
  let day
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const ukMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (isoMatch) [, year, month, day] = isoMatch
  else if (ukMatch) [, day, month, year] = ukMatch
  if (year) {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    if (date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)) {
      return date.toISOString().slice(0, 10)
    }
  }

  errors.push({ ...location, code: 'INVALID_DATE', message: 'Use a real date in DD/MM/YYYY or YYYY-MM-DD format.' })
  return text
}

function isBlankRow(row, columnCount) {
  for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
    if (normalizeText(row.getCell(columnIndex).value)) return false
  }
  return true
}

export async function parseTransferWorkbook(buffer) {
  const { workbook } = await loadSafeTransferWorkbook(buffer)

  const actualOrder = workbook.worksheets.map((sheet) => sheet.name)
  if (JSON.stringify(actualOrder) !== JSON.stringify(WORKBOOK_SHEET_ORDER)) {
    throw Object.assign(new Error(`The workbook sheets must appear exactly as: ${WORKBOOK_SHEET_ORDER.join(', ')}.`), { code: 'SHEET_STRUCTURE_MISMATCH' })
  }
  const instructions = workbook.getWorksheet('Instructions')
  if (!portableWorkbookMetadataMatches(workbook)
    || normalizeText(instructions.getCell('A1').value) !== PORTABLE_WORKBOOK_TITLE
    || normalizeText(instructions.getCell('A2').value) !== PORTABLE_VERSION_LABEL) {
    throw Object.assign(new Error('The workbook does not contain the required Footballplayer.online portable transfer identity.'), { code: 'PORTABLE_SIGNATURE_MISMATCH' })
  }
  if (normalizeText(workbook.getWorksheet('Instructions').getCell('B2').value) !== DATA_TRANSFER_TEMPLATE_VERSION) {
    throw Object.assign(new Error(`Template version ${DATA_TRANSFER_TEMPLATE_VERSION} is required.`), { code: 'TEMPLATE_VERSION_MISMATCH' })
  }

  const errors = []
  const rowsBySheet = {}
  for (const sheet of workbook.worksheets) {
    const definition = SHEET_DEFINITIONS.find((candidate) => candidate.name === sheet.name)
    const expectedColumnCount = sheet.name === 'Instructions'
      ? 2
      : sheet.name === 'Lists'
        ? Object.keys(WORKBOOK_LIST_VALUES).length
        : definition?.columns.length || 0
    if (sheet.actualColumnCount > expectedColumnCount) {
      errors.push({ sheet: sheet.name, row: 1, column: '', code: 'UNEXPECTED_COLUMN', message: 'Unexpected portable workbook columns are not accepted.' })
    }
    for (let rowNumber = 1; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber)
      const columnCount = Math.min(sheet.actualColumnCount, expectedColumnCount)
      for (let column = 1; column <= columnCount; column += 1) {
        const cell = row.getCell(column)
        if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === 'object' && 'formula' in cell.value)) {
          errors.push({ sheet: sheet.name, row: rowNumber, column: cell.address, code: 'FORMULA_NOT_ALLOWED', message: 'Formulas are not allowed in portable transfer workbooks.' })
        }
        if (cell.value && typeof cell.value === 'object' && 'hyperlink' in cell.value) {
          errors.push({ sheet: sheet.name, row: rowNumber, column: cell.address, code: 'EXTERNAL_LINK_NOT_ALLOWED', message: 'Hyperlinks are not allowed in portable transfer workbooks.' })
        }
      }
    }
  }
  const expectedListHeaders = Object.keys(WORKBOOK_LIST_VALUES)
  if (!headersMatch(workbook.getWorksheet('Lists'), expectedListHeaders)) {
    errors.push({ sheet: 'Lists', row: 1, column: '', code: 'LISTS_STRUCTURE_MISMATCH', message: 'The portable list structure was changed.' })
  }
  for (const [listName, expectedValues] of Object.entries(WORKBOOK_LIST_VALUES)) {
    const column = expectedListHeaders.indexOf(listName) + 1
    const actualValues = expectedValues.map((_, index) => normalizeText(workbook.getWorksheet('Lists').getCell(index + 2, column).value))
    if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
      errors.push({ sheet: 'Lists', row: 2, column: listName, code: 'LISTS_VALUES_MISMATCH', message: `The ${listName} portable list was changed.` })
    }
  }
  for (const definition of SHEET_DEFINITIONS) {
    const sheet = workbook.getWorksheet(definition.name)
    const actualHeaders = definition.columns.map((_, index) => normalizeText(sheet.getCell(1, index + 1).value))
    const expectedHeaders = definition.columns.map(([label]) => label)
    const unexpectedHeaders = []
    for (let index = definition.columns.length + 1; index <= sheet.actualColumnCount; index += 1) {
      const header = normalizeText(sheet.getCell(1, index).value)
      if (header) unexpectedHeaders.push(header)
    }
    if (JSON.stringify(actualHeaders) !== JSON.stringify(expectedHeaders) || unexpectedHeaders.length) {
      errors.push({ sheet: definition.name, row: 1, column: '', code: 'HEADER_MISMATCH', message: 'Column headers or order were changed.' })
      if (unexpectedHeaders.length) errors.push({ sheet: definition.name, row: 1, column: unexpectedHeaders.join(', '), code: 'UNEXPECTED_COLUMN', message: 'Unexpected columns are not accepted, including authentication, role, billing, and permission fields.' })
      rowsBySheet[definition.name] = []
      continue
    }

    const parsedRows = []
    for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber)
      if (isBlankRow(row, definition.columns.length)) continue
      if (parsedRows.length >= definition.limit) {
        errors.push({ sheet: definition.name, row: rowNumber, column: '', code: 'ROW_LIMIT_EXCEEDED', message: `This sheet supports at most ${definition.limit} data rows.` })
        continue
      }
      const parsed = { _sourceRow: rowNumber }
      definition.columns.forEach(([label, key, required], index) => {
        const cell = row.getCell(index + 1)
        const location = { sheet: definition.name, row: rowNumber, column: label }
        if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === 'object' && 'formula' in cell.value)) {
          errors.push({ ...location, code: 'FORMULA_NOT_ALLOWED', message: 'Formulas are not allowed in data sheets.' })
        }
        let value = cell.value
        if (key === 'date_of_birth') value = normalizeDate(value, location, errors)
        else if (['primary_contact', 'receives_communications', 'emergency_contact'].includes(key)) value = parseBoolean(value, location, errors)
        else value = normalizeText(value)
        if (key === 'positions') value = normalizeText(value).split(',').map((entry) => entry.trim()).filter(Boolean)
        if (required && !normalizeText(value)) errors.push({ ...location, code: 'REQUIRED_VALUE_MISSING', message: `${label} is required.` })
        parsed[key] = value
      })
      parsedRows.push(parsed)
    }
    rowsBySheet[definition.name] = parsedRows
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  for (const [sheetName, key] of [['Club Details', 'primary_contact_email'], ['Guardians', 'email']]) {
    for (const row of rowsBySheet[sheetName] || []) {
      if (row[key] && !emailPattern.test(row[key])) errors.push({ sheet: sheetName, row: row._sourceRow, column: key, code: 'INVALID_EMAIL', message: 'Enter a valid email address.' })
    }
  }
  const allowedValues = {
    'Teams:category': WORKBOOK_LIST_VALUES.Category,
    'Teams:status': WORKBOOK_LIST_VALUES.Status,
    'Players:gender': WORKBOOK_LIST_VALUES.Gender,
    'Players:section': WORKBOOK_LIST_VALUES.Section,
    'Players:status': WORKBOOK_LIST_VALUES.Status,
    'Guardians:status': WORKBOOK_LIST_VALUES.Status,
    'Player-Guardian Links:relationship': WORKBOOK_LIST_VALUES.Relationship,
  }
  for (const [field, allowed] of Object.entries(allowedValues)) {
    const [sheetName, key] = field.split(':')
    for (const row of rowsBySheet[sheetName] || []) {
      if (row[key] && !allowed.includes(row[key])) errors.push({ sheet: sheetName, row: row._sourceRow, column: key, code: 'UNSUPPORTED_VALUE', message: `Use one of: ${allowed.join(', ')}.` })
    }
  }
  const phonePattern = /^[+()\d\s.-]{7,30}$/
  for (const [sheetName, key] of [['Club Details', 'primary_contact_phone'], ['Guardians', 'phone']]) {
    for (const row of rowsBySheet[sheetName] || []) {
      if (row[key] && (!phonePattern.test(row[key]) || (row[key].match(/\d/g) || []).length < 6)) errors.push({ sheet: sheetName, row: row._sourceRow, column: key, code: 'INVALID_PHONE', message: 'Enter a valid phone number using digits and standard phone punctuation.' })
    }
  }
  const seasonPattern = /^\d{4}(?:\/(?:\d{2}|\d{4}))?$/
  for (const [sheetName, key] of [['Club Details', 'season'], ['Teams', 'season']]) {
    for (const row of rowsBySheet[sheetName] || []) {
      if (row[key] && !seasonPattern.test(row[key])) errors.push({ sheet: sheetName, row: row._sourceRow, column: key, code: 'INVALID_SEASON', message: 'Use a season such as 2026/27 or 2026/2027.' })
    }
  }
  for (const definition of SHEET_DEFINITIONS) {
    const refKey = definition.name === 'Player-Guardian Links' ? '' : 'transfer_reference'
    if (!refKey) continue
    const seen = new Map()
    for (const row of rowsBySheet[definition.name] || []) {
      const ref = normalizeText(row[refKey]).toLowerCase()
      if (!ref) continue
      if (seen.has(ref)) {
        errors.push({ sheet: definition.name, row: row._sourceRow, column: refKey, code: 'DUPLICATE_REFERENCE', message: `Reference duplicates row ${seen.get(ref)}.` })
      } else seen.set(ref, row._sourceRow)
    }
  }

  const teamRefs = new Set((rowsBySheet.Teams || []).map((row) => row.transfer_reference.toLowerCase()))
  const playerRefs = new Set((rowsBySheet.Players || []).map((row) => row.transfer_reference.toLowerCase()))
  const guardianRefs = new Set((rowsBySheet.Guardians || []).map((row) => row.transfer_reference.toLowerCase()))
  for (const row of rowsBySheet.Players || []) {
    if (!teamRefs.has(row.team_reference.toLowerCase())) errors.push({ sheet: 'Players', row: row._sourceRow, column: 'Team Reference', code: 'UNKNOWN_TEAM_REFERENCE', message: 'The team reference is not present in the Teams sheet.' })
  }
  const linkPairs = new Set()
  for (const row of rowsBySheet['Player-Guardian Links'] || []) {
    if (!playerRefs.has(row.player_reference.toLowerCase())) errors.push({ sheet: 'Player-Guardian Links', row: row._sourceRow, column: 'Player Reference', code: 'UNKNOWN_PLAYER_REFERENCE', message: 'The player reference is not present in the Players sheet.' })
    if (!guardianRefs.has(row.guardian_reference.toLowerCase())) errors.push({ sheet: 'Player-Guardian Links', row: row._sourceRow, column: 'Guardian Reference', code: 'UNKNOWN_GUARDIAN_REFERENCE', message: 'The guardian reference is not present in the Guardians sheet.' })
    const pair = `${row.player_reference.toLowerCase()}|${row.guardian_reference.toLowerCase()}`
    if (linkPairs.has(pair)) errors.push({ sheet: 'Player-Guardian Links', row: row._sourceRow, column: '', code: 'DUPLICATE_LINK', message: 'This player and guardian link appears more than once.' })
    linkPairs.add(pair)
  }

  return { templateVersion: DATA_TRANSFER_TEMPLATE_VERSION, rowsBySheet, errors }
}

export async function buildErrorWorkbook(errors = []) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Football Player'
  const sheet = workbook.addWorksheet('Errors')
  sheet.columns = [
    { header: 'Source Sheet', key: 'sheet', width: 28 }, { header: 'Source Row', key: 'row', width: 12 },
    { header: 'Record Reference', key: 'reference', width: 28 }, { header: 'Status', key: 'status', width: 18 },
    { header: 'Column', key: 'column', width: 28 }, { header: 'Error or Warning Code', key: 'code', width: 32 },
    { header: 'Plain-English Explanation', key: 'message', width: 70 }, { header: 'Suggested Correction', key: 'suggestedCorrection', width: 70 },
  ]
  for (const error of errors) {
    sheet.addRow({
      sheet: safeSpreadsheetText(error.sheet),
      row: Number(error.row || 0) || '',
      reference: safeSpreadsheetText(error.reference),
      status: safeSpreadsheetText(error.status || 'Error'),
      column: safeSpreadsheetText(error.column),
      code: safeSpreadsheetText(error.code || 'WORKBOOK_ERROR'),
      message: safeSpreadsheetText(error.message),
      suggestedCorrection: safeSpreadsheetText(error.suggestedCorrection || 'Correct the source row, upload the workbook again, and inspect a new preview.'),
    })
  }
  styleHeader(sheet.getRow(1))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = 'A1:H1'
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
