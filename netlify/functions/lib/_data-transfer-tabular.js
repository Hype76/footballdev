import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import ExcelJS from 'exceljs'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

export const SIMPLE_TRANSFER_TEMPLATE_VERSION = 'FP-V1-PLAYER-PARENT-2'
export const SIMPLE_TRANSFER_SHEET_NAME = 'Players and Parents'
export const TABULAR_MAX_BYTES = 4 * 1024 * 1024
export const TABULAR_MAX_ROWS = 5000
export const TABULAR_MAX_COLUMNS = 100

export const TABULAR_FORMATS = {
  csv: {
    extension: '.csv',
    mimeType: 'text/csv;charset=utf-8',
    acceptedMimeTypes: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  },
  tsv: {
    extension: '.tsv',
    mimeType: 'text/tab-separated-values;charset=utf-8',
    acceptedMimeTypes: ['text/tab-separated-values', 'text/tsv', 'text/plain'],
  },
  xlsx: {
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    acceptedMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/octet-stream', 'application/zip'],
  },
  ods: {
    extension: '.ods',
    mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
    acceptedMimeTypes: ['application/vnd.oasis.opendocument.spreadsheet', 'application/octet-stream', 'application/zip'],
  },
}

export const SIMPLE_IMPORT_FIELDS = [
  { key: 'player_first_name', label: 'Player First Name', aliases: ['player first name', 'player forename', 'first name', 'forename'] },
  { key: 'player_last_name', label: 'Player Last Name', aliases: ['player last name', 'player surname', 'last name', 'surname'] },
  { key: 'player_full_name', label: 'Player Full Name', aliases: ['player name', 'full name', 'player full name'], transformation: 'split_name' },
  { key: 'preferred_name', label: 'Preferred Name', aliases: ['preferred name', 'known as', 'nickname'] },
  { key: 'date_of_birth', label: 'Date of Birth', aliases: ['date of birth', 'dob', 'birth date', 'birthday'], transformation: 'parse_date' },
  { key: 'gender', label: 'Gender', aliases: ['gender', 'sex'] },
  { key: 'team_name', label: 'Team', aliases: ['team', 'team name', 'squad', 'squad name'] },
  { key: 'section', label: 'Section', aliases: ['section', 'player section', 'registration type', 'trial or squad'] },
  { key: 'shirt_number', label: 'Shirt Number', aliases: ['shirt number', 'squad number', 'jersey number', 'number'] },
  { key: 'positions', label: 'Positions', aliases: ['position', 'positions', 'playing position'], transformation: 'split_positions' },
  { key: 'guardian1_first_name', label: 'Parent or Guardian 1 First Name', aliases: ['parent first name', 'guardian first name', 'parent 1 first name', 'guardian 1 first name'] },
  { key: 'guardian1_last_name', label: 'Parent or Guardian 1 Last Name', aliases: ['parent last name', 'parent surname', 'guardian last name', 'guardian surname', 'parent 1 last name', 'guardian 1 last name'] },
  { key: 'guardian1_email', label: 'Parent or Guardian 1 Email', aliases: ['parent email', 'guardian email', 'parent 1 email', 'guardian 1 email'], transformation: 'normalize_email' },
  { key: 'guardian1_phone', label: 'Parent or Guardian 1 Phone', aliases: ['parent phone', 'parent mobile', 'guardian phone', 'guardian mobile', 'parent 1 phone', 'guardian 1 phone'], transformation: 'normalize_phone' },
  { key: 'guardian1_relationship', label: 'Parent or Guardian 1 Relationship', aliases: ['parent relationship', 'guardian relationship', 'parent 1 relationship', 'guardian 1 relationship'] },
  { key: 'guardian1_primary_contact', label: 'Parent or Guardian 1 Primary Contact', aliases: ['parent primary contact', 'guardian primary contact', 'parent 1 primary contact'], transformation: 'boolean' },
  { key: 'guardian1_receives_communications', label: 'Parent or Guardian 1 Receives Communications', aliases: ['parent receives communications', 'guardian receives communications', 'parent 1 receives communications'], transformation: 'boolean' },
  { key: 'guardian1_emergency_contact', label: 'Parent or Guardian 1 Emergency Contact', aliases: ['parent emergency contact', 'guardian emergency contact', 'parent 1 emergency contact'], transformation: 'boolean' },
  { key: 'guardian2_first_name', label: 'Parent or Guardian 2 First Name', aliases: ['parent 2 first name', 'guardian 2 first name'] },
  { key: 'guardian2_last_name', label: 'Parent or Guardian 2 Last Name', aliases: ['parent 2 last name', 'guardian 2 last name'] },
  { key: 'guardian2_email', label: 'Parent or Guardian 2 Email', aliases: ['parent 2 email', 'guardian 2 email'], transformation: 'normalize_email' },
  { key: 'guardian2_phone', label: 'Parent or Guardian 2 Phone', aliases: ['parent 2 phone', 'parent 2 mobile', 'guardian 2 phone', 'guardian 2 mobile'], transformation: 'normalize_phone' },
  { key: 'guardian2_relationship', label: 'Parent or Guardian 2 Relationship', aliases: ['parent 2 relationship', 'guardian 2 relationship'] },
  { key: 'guardian2_primary_contact', label: 'Parent or Guardian 2 Primary Contact', aliases: ['parent 2 primary contact', 'guardian 2 primary contact'], transformation: 'boolean' },
  { key: 'guardian2_receives_communications', label: 'Parent or Guardian 2 Receives Communications', aliases: ['parent 2 receives communications', 'guardian 2 receives communications'], transformation: 'boolean' },
  { key: 'guardian2_emergency_contact', label: 'Parent or Guardian 2 Emergency Contact', aliases: ['parent 2 emergency contact', 'guardian 2 emergency contact'], transformation: 'boolean' },
]

export const SIMPLE_TEMPLATE_COLUMNS = SIMPLE_IMPORT_FIELDS
  .filter((field) => field.key !== 'player_full_name')
  .map((field) => field.label)

const FIELD_BY_KEY = new Map(SIMPLE_IMPORT_FIELDS.map((field) => [field.key, field]))
const ALIAS_LOOKUP = new Map()
for (const field of SIMPLE_IMPORT_FIELDS) {
  for (const alias of [field.label, ...field.aliases]) {
    ALIAS_LOOKUP.set(normalizeHeader(alias), field)
  }
}

const ALLOWED_TRANSFORMATIONS = new Set([
  'trim',
  'normalize_email',
  'normalize_phone',
  'parse_date',
  'split_name',
  'split_positions',
  'boolean',
])

function dataError(message, code) {
  return Object.assign(new Error(message), { code })
}

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeText(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (value && typeof value === 'object') {
    if ('text' in value) return String(value.text ?? '').trim()
    if ('result' in value) return normalizeText(value.result)
    if (Array.isArray(value.richText)) return value.richText.map((entry) => entry.text || '').join('').trim()
  }
  return String(value ?? '').trim()
}

function safeSpreadsheetText(value) {
  const text = normalizeText(value)
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function stableReference(prefix, values) {
  const digest = createHash('sha256').update(values.map((value) => normalizeHeader(value)).join('|')).digest('hex').slice(0, 12).toUpperCase()
  return `${prefix}-${digest}`
}

function extensionOf(fileName) {
  const match = String(fileName || '').toLowerCase().match(/(\.[a-z0-9]+)$/)
  return match?.[1] || ''
}

function isZip(buffer) {
  return buffer?.[0] === 0x50 && buffer?.[1] === 0x4b
}

async function loadSafeZip(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw dataError('Choose a non-empty spreadsheet file.', 'EMPTY_SPREADSHEET')
  if (buffer.length > TABULAR_MAX_BYTES) throw dataError('The spreadsheet exceeds the 4 MB upload limit.', 'WORKBOOK_TOO_LARGE')
  if (!isZip(buffer)) throw dataError('The workbook is not a valid ZIP-based spreadsheet.', 'INVALID_ZIP_SIGNATURE')
  let zip
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false })
  } catch {
    throw dataError('The workbook package is damaged or encrypted.', 'INVALID_WORKBOOK_PACKAGE')
  }
  const entries = Object.values(zip.files)
  if (entries.length > 250) throw dataError('The workbook contains too many package entries.', 'ZIP_ENTRY_LIMIT')
  let expandedBytes = 0
  for (const entry of entries) {
    if (entry.dir) continue
    const content = await entry.async('uint8array')
    expandedBytes += content.byteLength
    if (expandedBytes > 24 * 1024 * 1024) throw dataError('The expanded workbook exceeds the safe processing limit.', 'ZIP_EXPANSION_LIMIT')
  }
  return { entries, expandedBytes, zip }
}

async function detectZipFormat(buffer) {
  const { zip } = await loadSafeZip(buffer)
  const odsMime = normalizeText(await zip.file('mimetype')?.async('string'))
  if (odsMime === TABULAR_FORMATS.ods.mimeType) return 'ods'
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string')
  if (/spreadsheetml/i.test(contentTypes || '') && zip.file('xl/workbook.xml')) return 'xlsx'
  throw dataError('The ZIP package is not a supported XLSX or ODS spreadsheet.', 'UNSUPPORTED_ZIP_SPREADSHEET')
}

export async function detectSpreadsheetFormat(buffer, { fileName = '', mimeType = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw dataError('Choose a non-empty spreadsheet file.', 'EMPTY_SPREADSHEET')
  if (buffer.length > TABULAR_MAX_BYTES) throw dataError('The spreadsheet exceeds the 4 MB upload limit.', 'WORKBOOK_TOO_LARGE')
  const extension = extensionOf(fileName)
  if (!['.csv', '.tsv', '.xlsx', '.ods'].includes(extension)) {
    throw dataError('Choose a CSV, TSV, XLSX, or ODS spreadsheet.', 'UNSUPPORTED_FILE_EXTENSION')
  }
  const detected = isZip(buffer) ? await detectZipFormat(buffer) : extension === '.tsv' ? 'tsv' : 'csv'
  if (TABULAR_FORMATS[detected].extension !== extension) {
    throw dataError(`The file content is ${detected.toUpperCase()} but the filename uses ${extension || 'no supported extension'}.`, 'FILE_TYPE_MISMATCH')
  }
  const suppliedMime = String(mimeType || '').toLowerCase().split(';')[0].trim()
  const allowedMimes = TABULAR_FORMATS[detected].acceptedMimeTypes
  if (suppliedMime && !allowedMimes.includes(suppliedMime)) {
    throw dataError('The browser-reported file type does not match the selected spreadsheet format.', 'MIME_TYPE_MISMATCH')
  }
  return detected
}

function decodeUtf8(buffer) {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    if (decoded.includes('\0')) throw new Error('null byte')
    return decoded.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  } catch {
    throw dataError('CSV and TSV files must contain valid UTF-8 text.', 'INVALID_UTF8')
  }
}

function countDelimiter(line, delimiter) {
  let count = 0
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') index += 1
      else quoted = !quoted
    } else if (!quoted && character === delimiter) count += 1
  }
  return count
}

function detectDelimiter(text, format) {
  if (format === 'tsv') return '\t'
  const lines = text.split('\n').filter((line) => line.trim()).slice(0, 8)
  const candidates = [',', ';', '\t']
  const scores = candidates.map((delimiter) => {
    const counts = lines.map((line) => countDelimiter(line, delimiter))
    const positive = counts.filter((count) => count > 0)
    const consistency = positive.length && positive.every((count) => count === positive[0]) ? 1000 : 0
    return { delimiter, score: consistency + positive.reduce((total, count) => total + count, 0) }
  })
  scores.sort((left, right) => right.score - left.score)
  if (!scores[0].score) throw dataError('The CSV delimiter could not be identified.', 'CSV_DELIMITER_UNKNOWN')
  return scores[0].delimiter
}

function parseDelimitedText(text, delimiter) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let index = 0; index <= text.length; index += 1) {
    const character = index === text.length ? '\n' : text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        value += character
      }
      continue
    }
    if (character === '"' && value === '') {
      quoted = true
    } else if (character === delimiter) {
      row.push(value)
      value = ''
    } else if (character === '\n') {
      row.push(value)
      value = ''
      if (row.some((cell) => String(cell).trim())) rows.push(row)
      row = []
      if (rows.length > TABULAR_MAX_ROWS + 1) throw dataError(`The selected sheet supports at most ${TABULAR_MAX_ROWS} data rows.`, 'ROW_LIMIT_EXCEEDED')
    } else {
      value += character
    }
  }
  if (quoted) throw dataError('The delimited file contains an unclosed quoted value.', 'UNCLOSED_QUOTED_VALUE')
  return rows
}

function normalizedRowsToSheet(name, rows) {
  const headers = (rows[0] || []).map((value) => normalizeText(value))
  while (headers.length && !headers.at(-1)) headers.pop()
  if (!headers.length) throw dataError(`The sheet ${name} has no column headings.`, 'HEADERS_REQUIRED')
  if (headers.length > TABULAR_MAX_COLUMNS) throw dataError(`The sheet ${name} exceeds the ${TABULAR_MAX_COLUMNS}-column limit.`, 'COLUMN_LIMIT_EXCEEDED')
  const normalizedHeaderKeys = headers.map(normalizeHeader)
  if (normalizedHeaderKeys.some((header) => !header)) throw dataError(`The sheet ${name} contains a blank column heading.`, 'BLANK_HEADER')
  if (new Set(normalizedHeaderKeys).size !== normalizedHeaderKeys.length) throw dataError(`The sheet ${name} contains duplicate column headings.`, 'DUPLICATE_HEADER')
  const dataRows = rows.slice(1)
    .filter((row) => row.some((cell) => normalizeText(cell)))
    .map((row) => headers.map((_, index) => row[index] ?? ''))
  if (dataRows.length > TABULAR_MAX_ROWS) throw dataError(`The sheet ${name} supports at most ${TABULAR_MAX_ROWS} data rows.`, 'ROW_LIMIT_EXCEEDED')
  return { name, headers, rows: dataRows, rowCount: dataRows.length }
}

async function inspectDelimited(buffer, format) {
  const text = decodeUtf8(buffer)
  if (/^\s*</.test(text) && /<(?:html|script|xml|office:document)/i.test(text.slice(0, 500))) {
    throw dataError('The text file contains markup instead of spreadsheet rows.', 'UNSAFE_TEXT_CONTENT')
  }
  const delimiter = detectDelimiter(text, format)
  const rows = parseDelimitedText(text, delimiter)
  return { format, sheets: [normalizedRowsToSheet(format === 'tsv' ? 'TSV Data' : 'CSV Data', rows)] }
}

async function inspectXlsx(buffer) {
  const { entries, expandedBytes, zip } = await loadSafeZip(buffer)
  const forbidden = entries.find((entry) => /(^|\/)(vbaProject\.bin|externalLinks|embeddings|oleObject|encryptedPackage)/i.test(entry.name))
  if (forbidden) throw dataError('Macros, external links, embedded objects, and encrypted packages are not supported.', 'UNSAFE_XLSX_CONTENT')
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string')
  if (/macroEnabled|vbaProject/i.test(contentTypes || '')) throw dataError('Macro-enabled workbooks are not supported.', 'MACRO_WORKBOOK')
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations'] })
  } catch {
    throw dataError('The XLSX workbook could not be read. Confirm it is unencrypted and not corrupt.', 'UNREADABLE_XLSX')
  }
  const sheets = []
  for (const worksheet of workbook.worksheets) {
    const rows = []
    for (let rowNumber = 1; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
      const sourceRow = worksheet.getRow(rowNumber)
      const values = []
      const maxColumns = Math.min(worksheet.actualColumnCount, TABULAR_MAX_COLUMNS + 1)
      for (let column = 1; column <= maxColumns; column += 1) {
        const cell = sourceRow.getCell(column)
        if (cell.type === ExcelJS.ValueType.Formula || (cell.value && typeof cell.value === 'object' && 'formula' in cell.value)) {
          throw dataError(`Formulas are not allowed in ${worksheet.name}.`, 'FORMULA_NOT_ALLOWED')
        }
        if (cell.value && typeof cell.value === 'object' && 'hyperlink' in cell.value) {
          throw dataError(`Hyperlinks are not allowed in ${worksheet.name}.`, 'EXTERNAL_LINK_NOT_ALLOWED')
        }
        values.push(cell.value ?? '')
      }
      if (values.some((value) => normalizeText(value))) rows.push(values)
      if (rows.length > TABULAR_MAX_ROWS + 1) throw dataError(`The sheet ${worksheet.name} exceeds the row limit.`, 'ROW_LIMIT_EXCEEDED')
    }
    if (rows.length) sheets.push(normalizedRowsToSheet(worksheet.name, rows))
  }
  if (!sheets.length) throw dataError('The XLSX workbook contains no readable data sheets.', 'NO_DATA_SHEETS')
  return { format: 'xlsx', sheets, container: { entries: entries.length, expandedBytes } }
}

function collectOdsText(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(collectOdsText).join('')
  if (typeof node === 'object') {
    return Object.entries(node)
      .filter(([key]) => !key.startsWith('@_'))
      .map(([, value]) => collectOdsText(value))
      .join('')
  }
  return ''
}

function odsCellValue(cell) {
  if (!cell || typeof cell !== 'object') return ''
  if (cell['@_formula']) throw dataError('Formulas are not allowed in ODS data sheets.', 'FORMULA_NOT_ALLOWED')
  const valueType = cell['@_value-type']
  if (valueType === 'date') return normalizeText(cell['@_date-value'])
  if (valueType === 'boolean') return cell['@_boolean-value'] === true || cell['@_boolean-value'] === 'true' ? 'Yes' : 'No'
  if (['float', 'currency', 'percentage'].includes(valueType) && cell['@_value'] !== undefined) return normalizeText(cell['@_value'])
  return normalizeText(collectOdsText(cell.p))
}

async function inspectOds(buffer) {
  const { entries, expandedBytes, zip } = await loadSafeZip(buffer)
  const mimeType = normalizeText(await zip.file('mimetype')?.async('string'))
  if (mimeType !== TABULAR_FORMATS.ods.mimeType) throw dataError('The file is not an OpenDocument Spreadsheet.', 'INVALID_ODS_MIME')
  const manifest = await zip.file('META-INF/manifest.xml')?.async('string')
  if (!manifest) throw dataError('The ODS package has no manifest.', 'INVALID_ODS_PACKAGE')
  if (/encryption-data|office:script|script:event-listener|draw:(?:object|plugin)|xlink:href\s*=\s*["'](?:https?:|file:)/i.test(manifest)) {
    throw dataError('Encrypted files, scripts, plugins, and external links are not supported.', 'UNSAFE_ODS_CONTENT')
  }
  const content = await zip.file('content.xml')?.async('string')
  if (!content) throw dataError('The ODS package has no spreadsheet content.', 'INVALID_ODS_PACKAGE')
  if (/office:script|script:event-listener|draw:(?:object|plugin)|xlink:href\s*=\s*["'](?:https?:|file:)|table:formula\s*=/i.test(content)) {
    throw dataError('Formulas, scripts, plugins, and external links are not supported.', 'UNSAFE_ODS_CONTENT')
  }
  let parsed
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      processEntities: false,
      parseTagValue: false,
      trimValues: false,
      isArray: (name) => ['table', 'table-row', 'table-cell', 'covered-table-cell', 'p', 'span'].includes(name),
    }).parse(content)
  } catch {
    throw dataError('The ODS spreadsheet XML is corrupt.', 'UNREADABLE_ODS')
  }
  const tables = parsed?.['document-content']?.body?.spreadsheet?.table || []
  const sheets = []
  for (const table of tables) {
    const rows = []
    const sourceRows = table['table-row'] || []
    for (const sourceRow of sourceRows) {
      const requestedRowRepeat = Number(sourceRow?.['@_number-rows-repeated'] || 1)
      if (!Number.isSafeInteger(requestedRowRepeat) || requestedRowRepeat < 1) {
        throw dataError('The ODS spreadsheet contains an invalid repeated-row count.', 'INVALID_ODS_REPETITION')
      }
      const rowRepeat = Math.min(requestedRowRepeat, TABULAR_MAX_ROWS + 1)
      const cells = []
      for (const cell of sourceRow?.['table-cell'] || []) {
        const requestedColumnRepeat = Number(cell?.['@_number-columns-repeated'] || 1)
        if (!Number.isSafeInteger(requestedColumnRepeat) || requestedColumnRepeat < 1) {
          throw dataError('The ODS spreadsheet contains an invalid repeated-column count.', 'INVALID_ODS_REPETITION')
        }
        const repeat = Math.min(requestedColumnRepeat, TABULAR_MAX_COLUMNS + 1)
        for (let count = 0; count < repeat; count += 1) cells.push(odsCellValue(cell))
        if (cells.length > TABULAR_MAX_COLUMNS) throw dataError(`The sheet ${table['@_name'] || 'ODS Data'} exceeds the column limit.`, 'COLUMN_LIMIT_EXCEEDED')
      }
      for (let count = 0; count < rowRepeat; count += 1) {
        if (cells.some((value) => normalizeText(value))) rows.push([...cells])
        if (rows.length > TABULAR_MAX_ROWS + 1) throw dataError(`The sheet ${table['@_name'] || 'ODS Data'} exceeds the row limit.`, 'ROW_LIMIT_EXCEEDED')
      }
    }
    if (rows.length) sheets.push(normalizedRowsToSheet(normalizeText(table['@_name']) || `Sheet ${sheets.length + 1}`, rows))
  }
  if (!sheets.length) throw dataError('The ODS workbook contains no readable data sheets.', 'NO_DATA_SHEETS')
  return { format: 'ods', sheets, container: { entries: entries.length, expandedBytes } }
}

function mappingSuggestion(header, samples) {
  const normalized = normalizeHeader(header)
  let field = ALIAS_LOOKUP.get(normalized)
  let confidence = field ? (normalizeHeader(field.label) === normalized ? 'high' : 'medium') : 'unmapped'
  if (!field) {
    const partial = SIMPLE_IMPORT_FIELDS.filter((candidate) => candidate.aliases.some((alias) => {
      const normalizedAlias = normalizeHeader(alias)
      return normalizedAlias.length > 4 && (normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized))
    }))
    if (partial.length === 1) {
      field = partial[0]
      confidence = 'low'
    }
  }
  return {
    sourceColumn: header,
    samples: samples.filter(Boolean).slice(0, 4),
    suggestedField: field?.key || '',
    suggestedLabel: field?.label || 'Ignore',
    confidence,
    transformation: field?.transformation || 'trim',
  }
}

function isAmbiguousDate(value) {
  const match = normalizeText(value).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  return Boolean(match && Number(match[1]) >= 1 && Number(match[1]) <= 12 && Number(match[2]) >= 1 && Number(match[2]) <= 12)
}

export async function inspectSpreadsheetSource(buffer, options = {}) {
  const format = await detectSpreadsheetFormat(buffer, options)
  const inspected = format === 'xlsx'
    ? await inspectXlsx(buffer)
    : format === 'ods'
      ? await inspectOds(buffer)
      : await inspectDelimited(buffer, format)
  const sheets = inspected.sheets.map((sheet) => {
    const mappings = sheet.headers.map((header, index) => mappingSuggestion(header, sheet.rows.map((row) => normalizeText(row[index]))))
    const mappedDateIndexes = mappings
      .map((mapping, index) => mapping.suggestedField === 'date_of_birth' ? index : -1)
      .filter((index) => index >= 0)
    const ambiguousDateSamples = [...new Set(mappedDateIndexes.flatMap((index) => sheet.rows.map((row) => row[index]).filter(isAmbiguousDate).map(normalizeText)))].slice(0, 5)
    const mappedTeamIndexes = mappings
      .map((mapping, index) => mapping.suggestedField === 'team_name' ? index : -1)
      .filter((index) => index >= 0)
    const teamValues = [...new Set(mappedTeamIndexes.flatMap((index) => sheet.rows.map((row) => normalizeText(row[index])).filter(Boolean)))].sort((left, right) => left.localeCompare(right))
    const mappingScore = mappings.filter((mapping) => mapping.suggestedField).length
    return {
      name: sheet.name,
      headers: sheet.headers,
      mappings,
      rowCount: sheet.rowCount,
      ambiguousDateSamples,
      teamValues,
      mappingScore,
    }
  })
  const likelySheets = sheets.filter((sheet) => !/^(instructions?|lists?)$/i.test(sheet.name))
  const suggestedSheet = [...(likelySheets.length ? likelySheets : sheets)].sort((left, right) => right.mappingScore - left.mappingScore || right.rowCount - left.rowCount)[0]?.name || ''
  return { ...inspected, sheets, suggestedSheet }
}

function parseDate(value, convention, location, errors) {
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
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (iso) [, year, month, day] = iso
  else if (local) {
    const first = Number(local[1])
    const second = Number(local[2])
    year = local[3]
    if (first <= 12 && second <= 12 && !convention) {
      errors.push({ ...location, code: 'AMBIGUOUS_DATE_CONVENTION', message: `Confirm whether ${text} uses day/month/year or month/day/year.` })
      return text
    }
    if (convention === 'mdy') {
      month = local[1]
      day = local[2]
    } else {
      day = local[1]
      month = local[2]
    }
  }
  if (year) {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    if (date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)) {
      return date.toISOString().slice(0, 10)
    }
  }
  errors.push({ ...location, code: 'INVALID_DATE', message: 'Enter a real date and confirm the file date convention where required.' })
  return text
}

function parseBoolean(value, location, errors) {
  const normalized = normalizeHeader(value)
  if (!normalized) return false
  if (['yes', 'true', '1', 'y'].includes(normalized)) return true
  if (['no', 'false', '0', 'n'].includes(normalized)) return false
  errors.push({ ...location, code: 'INVALID_BOOLEAN', message: 'Use Yes or No.' })
  return false
}

function applyTransformation(value, transformation, context) {
  if (value === null || value === undefined) return ''
  if (transformation === 'parse_date') return parseDate(value, context.dateConvention, context.location, context.errors)
  const text = normalizeText(value)
  if (!text) return ''
  if (transformation === 'normalize_email') return text.toLowerCase()
  if (transformation === 'normalize_phone') return text.replace(/[^\d+().\s-]/g, '').trim()
  if (transformation === 'split_positions') return text.split(',').map((entry) => entry.trim()).filter(Boolean)
  if (transformation === 'boolean') return parseBoolean(text, context.location, context.errors)
  return text
}

function existingReference(entity, prefix) {
  return normalizeText(entity?.transfer_reference) || stableReference(prefix, [entity?.id])
}

function buildMappingMap(sheet, mapping, errors) {
  const headerIndexes = new Map(sheet.headers.map((header, index) => [header, index]))
  const mappedTargets = new Set()
  const result = []
  for (const entry of mapping?.columns || []) {
    const sourceColumn = normalizeText(entry.sourceColumn)
    const targetField = normalizeText(entry.targetField)
    if (!sourceColumn || !headerIndexes.has(sourceColumn)) {
      errors.push({ sheet: sheet.name, row: 1, column: sourceColumn, code: 'SOURCE_COLUMN_UNKNOWN', message: 'Choose a source column from the selected sheet.' })
      continue
    }
    if (!targetField) continue
    if (!FIELD_BY_KEY.has(targetField)) {
      errors.push({ sheet: sheet.name, row: 1, column: sourceColumn, code: 'PROTECTED_OR_UNKNOWN_FIELD', message: 'This field cannot be mapped.' })
      continue
    }
    if (mappedTargets.has(targetField)) {
      errors.push({ sheet: sheet.name, row: 1, column: sourceColumn, code: 'TARGET_FIELD_DUPLICATE', message: 'A Footballplayer.online field can be mapped only once.' })
      continue
    }
    const transformation = normalizeText(entry.transformation) || FIELD_BY_KEY.get(targetField).transformation || 'trim'
    if (!ALLOWED_TRANSFORMATIONS.has(transformation)) {
      errors.push({ sheet: sheet.name, row: 1, column: sourceColumn, code: 'TRANSFORMATION_UNSUPPORTED', message: 'Choose a supported V1 transformation.' })
      continue
    }
    if (targetField === 'player_full_name' && transformation !== 'split_name') {
      errors.push({ sheet: sheet.name, row: 1, column: sourceColumn, code: 'FULL_NAME_SPLIT_REQUIRED', message: 'Confirm the full-name split transformation.' })
      continue
    }
    mappedTargets.add(targetField)
    result.push({
      sourceColumn,
      sourceIndex: headerIndexes.get(sourceColumn),
      targetField,
      transformation,
      defaultValue: normalizeText(entry.defaultValue),
    })
  }
  if (!mappedTargets.has('player_full_name') && (!mappedTargets.has('player_first_name') || !mappedTargets.has('player_last_name'))) {
    errors.push({ sheet: sheet.name, row: 1, column: '', code: 'PLAYER_NAME_MAPPING_REQUIRED', message: 'Map Player First Name and Player Last Name, or map Player Full Name and confirm the split.' })
  }
  return result
}

function splitFullName(value, location, errors) {
  const parts = normalizeText(value).split(/\s+/).filter(Boolean)
  if (parts.length < 2) {
    errors.push({ ...location, code: 'FULL_NAME_SPLIT_AMBIGUOUS', message: 'Enter at least a first name and last name, or map separate name columns.' })
    return { firstName: normalizeText(value), lastName: '' }
  }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

function normalizeIdentity(...values) {
  return values.map((value) => normalizeHeader(value)).join('|')
}

export async function mapSpreadsheetToTransferRows(buffer, {
  existing,
  fileName = '',
  importOptions = {},
  mapping = {},
  mimeType = '',
  scope,
} = {}) {
  const source = await inspectSpreadsheetSource(buffer, { fileName, mimeType })
  const sheet = source.sheets.find((candidate) => candidate.name === mapping.sheetName)
  if (!sheet) throw dataError('Choose a valid worksheet before preview.', 'SHEET_SELECTION_REQUIRED')
  const parsedSource = source.format === 'xlsx'
    ? await inspectXlsx(buffer)
    : source.format === 'ods'
      ? await inspectOds(buffer)
      : await inspectDelimited(buffer, source.format)
  const dataSheet = parsedSource.sheets.find((candidate) => candidate.name === mapping.sheetName)
  if (!dataSheet) throw dataError('The selected worksheet could not be read.', 'SHEET_SELECTION_REQUIRED')

  const errors = []
  const columnMappings = buildMappingMap(dataSheet, mapping, errors)
  const dateConvention = ['dmy', 'mdy'].includes(mapping.dateConvention) ? mapping.dateConvention : ''
  const teamMappingInput = new Map((mapping.teamMappings || []).map((entry) => [normalizeHeader(entry.sourceValue), {
    create: entry.create === true,
    teamId: normalizeText(entry.teamId),
  }]))
  const existingTeams = existing.teams || []
  const authorizedTeamIds = new Set(scope.authorizedTeamIds || [])
  const existingTeamById = new Map(existingTeams.map((team) => [team.id, team]))
  const existingTeamByName = new Map(existingTeams.map((team) => [normalizeHeader(team.name), team]))
  const defaultTeamId = normalizeText(mapping.defaultTeamId)
  if (defaultTeamId && (!authorizedTeamIds.has(defaultTeamId) || !existingTeamById.has(defaultTeamId))) {
    errors.push({ sheet: dataSheet.name, row: 1, column: 'Team', code: 'DEFAULT_TEAM_SCOPE_DENIED', message: 'The selected default team is outside the authorised scope.' })
  }

  const playerIdentityMap = new Map()
  for (const player of existing.players || []) {
    const key = normalizeIdentity(player.first_name || player.player_name, player.last_name, player.date_of_birth)
    if (!playerIdentityMap.has(key)) playerIdentityMap.set(key, [])
    playerIdentityMap.get(key).push(player)
  }
  const guardianByEmail = new Map()
  for (const guardian of existing.guardians || []) {
    if (guardian.email) guardianByEmail.set(normalizeHeader(guardian.email), guardian)
  }

  const usedTeams = new Map()
  const playerRows = []
  const guardianRows = new Map()
  const linkRows = []
  const seenPlayerKeys = new Map()

  function resolveTeam(value, rowNumber) {
    const sourceTeamName = normalizeText(value)
    if (!sourceTeamName) {
      if (defaultTeamId) return existingTeamById.get(defaultTeamId)
      if (authorizedTeamIds.size === 1) return existingTeamById.get([...authorizedTeamIds][0])
      errors.push({ sheet: dataSheet.name, row: rowNumber, column: 'Team', code: 'TEAM_RESOLUTION_REQUIRED', message: 'Map a team column or choose a default authorised team.' })
      return null
    }
    const direct = existingTeamByName.get(normalizeHeader(sourceTeamName))
    if (direct && authorizedTeamIds.has(direct.id)) return direct
    const decision = teamMappingInput.get(normalizeHeader(sourceTeamName))
    if (decision?.teamId) {
      const selected = existingTeamById.get(decision.teamId)
      if (!selected || !authorizedTeamIds.has(selected.id)) {
        errors.push({ sheet: dataSheet.name, row: rowNumber, column: 'Team', code: 'TEAM_MAPPING_SCOPE_DENIED', message: `${sourceTeamName} is mapped outside the authorised scope.` })
        return null
      }
      return selected
    }
    if (decision?.create) {
      if (!(scope.canManageTeams && scope.isClubWideScope && importOptions.allowTeamCreation === true)) {
        errors.push({ sheet: dataSheet.name, row: rowNumber, column: 'Team', code: 'TEAM_CREATION_NOT_AUTHORIZED', message: `Creating ${sourceTeamName} is not authorised for this import.` })
        return null
      }
      return {
        id: '',
        name: sourceTeamName,
        transfer_reference: stableReference('TEAM', [scope.clubId, sourceTeamName, importOptions.season]),
        season: importOptions.season,
        status: 'active',
        _create: true,
      }
    }
    errors.push({ sheet: dataSheet.name, row: rowNumber, column: 'Team', code: 'UNKNOWN_TEAM', message: `Map ${sourceTeamName} to an authorised team or explicitly approve creation.` })
    return null
  }

  function addGuardian(values, playerReference, teamReference, rowNumber, index) {
    const prefix = `guardian${index}`
    const firstName = normalizeText(values[`${prefix}_first_name`])
    const lastName = normalizeText(values[`${prefix}_last_name`])
    const email = normalizeText(values[`${prefix}_email`]).toLowerCase()
    const phone = normalizeText(values[`${prefix}_phone`])
    if (![firstName, lastName, email, phone].some(Boolean)) return
    if (!firstName || !lastName) {
      errors.push({ sheet: dataSheet.name, row: rowNumber, column: `Parent or Guardian ${index}`, code: 'GUARDIAN_NAME_REQUIRED', message: 'Enter both the guardian first name and last name.' })
      return
    }
    const existingGuardian = email ? guardianByEmail.get(normalizeHeader(email)) : null
    if (existingGuardian && normalizeIdentity(existingGuardian.first_name, existingGuardian.last_name) !== normalizeIdentity(firstName, lastName)) {
      errors.push({ sheet: dataSheet.name, row: rowNumber, column: `Parent or Guardian ${index} Email`, code: 'GUARDIAN_EMAIL_REVIEW_REQUIRED', message: 'This email belongs to a guardian with a different name and requires manual review.' })
      return
    }
    const shareKey = email
      ? `email:${normalizeHeader(email)}:${normalizeIdentity(firstName, lastName)}`
      : phone
        ? `phone:${normalizeHeader(phone)}:${normalizeIdentity(firstName, lastName)}`
        : `row:${rowNumber}:${index}`
    let guardian = guardianRows.get(shareKey)
    if (!guardian) {
      const reference = existingGuardian
        ? existingReference(existingGuardian, 'GUARDIAN')
        : stableReference('GUARDIAN', [scope.clubId, firstName, lastName, email || phone || `${rowNumber}:${index}`])
      guardian = {
        _sourceRow: rowNumber,
        transfer_reference: reference,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        status: 'active',
      }
      guardianRows.set(shareKey, guardian)
    }
    linkRows.push({
      _sourceRow: rowNumber,
      player_reference: playerReference,
      guardian_reference: guardian.transfer_reference,
      relationship: normalizeText(values[`${prefix}_relationship`]) || 'Parent',
      primary_contact: values[`${prefix}_primary_contact`] === true,
      receives_communications: values[`${prefix}_receives_communications`] === true,
      emergency_contact: values[`${prefix}_emergency_contact`] === true,
      team_reference: teamReference,
    })
  }

  dataSheet.rows.forEach((sourceRow, rowIndex) => {
    const rowNumber = rowIndex + 2
    const values = {}
    for (const entry of columnMappings) {
      const sourceValue = sourceRow[entry.sourceIndex]
      const location = { sheet: dataSheet.name, row: rowNumber, column: entry.sourceColumn }
      const rawValue = normalizeText(sourceValue) ? sourceValue : entry.defaultValue
      values[entry.targetField] = applyTransformation(rawValue, entry.transformation, { dateConvention, errors, location })
    }
    if (values.player_full_name) {
      const split = splitFullName(values.player_full_name, { sheet: dataSheet.name, row: rowNumber, column: 'Player Full Name' }, errors)
      values.player_first_name = values.player_first_name || split.firstName
      values.player_last_name = values.player_last_name || split.lastName
    }
    const firstName = normalizeText(values.player_first_name)
    const lastName = normalizeText(values.player_last_name)
    if (!firstName || !lastName) {
      errors.push({ sheet: dataSheet.name, row: rowNumber, column: 'Player Name', code: 'PLAYER_NAME_REQUIRED', message: 'Enter both the player first name and last name.' })
      return
    }
    const team = resolveTeam(values.team_name, rowNumber)
    if (!team) return
    const teamReference = existingReference(team, 'TEAM')
    usedTeams.set(teamReference, {
      _sourceRow: rowNumber,
      transfer_reference: teamReference,
      name: team.name,
      season: team.season || importOptions.season,
      status: team.status || 'active',
    })
    const identity = normalizeIdentity(firstName, lastName, values.date_of_birth)
    const existingCandidates = playerIdentityMap.get(identity) || []
    if (existingCandidates.length > 1) {
      errors.push({ sheet: dataSheet.name, row: rowNumber, column: 'Player Name', code: 'PLAYER_IDENTITY_AMBIGUOUS', message: 'More than one authorised player matches this name and date of birth. Review manually.' })
      return
    }
    const existingPlayer = existingCandidates[0]
    const playerReference = existingPlayer
      ? existingReference(existingPlayer, 'PLAYER')
      : stableReference('PLAYER', [scope.clubId, firstName, lastName, values.date_of_birth, teamReference])
    const duplicateSourceRow = seenPlayerKeys.get(playerReference)
    if (duplicateSourceRow) {
      errors.push({ sheet: dataSheet.name, row: rowNumber, column: 'Player Name', code: 'REPEATED_PLAYER_ROW', message: `This player also appears on source row ${duplicateSourceRow}. Review the repeated registration before import.` })
      return
    }
    seenPlayerKeys.set(playerReference, rowNumber)
    playerRows.push({
      _sourceRow: rowNumber,
      transfer_reference: playerReference,
      team_reference: teamReference,
      first_name: firstName,
      last_name: lastName,
      preferred_name: normalizeText(values.preferred_name),
      date_of_birth: normalizeText(values.date_of_birth),
      gender: normalizeText(values.gender),
      section: normalizeText(values.section) || 'Trial',
      shirt_number: normalizeText(values.shirt_number),
      positions: Array.isArray(values.positions) ? values.positions : normalizeText(values.positions).split(',').map((entry) => entry.trim()).filter(Boolean),
      status: 'active',
    })
    addGuardian(values, playerReference, teamReference, rowNumber, 1)
    addGuardian(values, playerReference, teamReference, rowNumber, 2)
  })

  const clubReference = existingReference(existing.club, 'CLUB')
  return {
    format: source.format,
    templateVersion: SIMPLE_TRANSFER_TEMPLATE_VERSION,
    rowsBySheet: {
      'Club Details': [{
        _sourceRow: 2,
        transfer_reference: clubReference,
        name: existing.club.name,
        season: importOptions.season,
      }],
      Teams: [...usedTeams.values()],
      Players: playerRows,
      Guardians: [...guardianRows.values()],
      'Player-Guardian Links': linkRows,
    },
    errors,
    sourceMetadata: {
      dateConvention: dateConvention || null,
      format: source.format,
      mapping: columnMappings.map(({ sourceColumn, targetField, transformation, defaultValue }) => ({ sourceColumn, targetField, transformation, defaultValue })),
      sheetName: dataSheet.name,
    },
  }
}

function quoteDelimited(value, delimiter = ',') {
  const safe = safeSpreadsheetText(value)
  return safe.includes(delimiter) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function simpleTemplateRows() {
  return [
    SIMPLE_TEMPLATE_COLUMNS,
    SIMPLE_TEMPLATE_COLUMNS.map(() => ''),
  ]
}

function addSimpleInstructionsXlsx(workbook, scopeLabel) {
  const sheet = workbook.addWorksheet('Instructions')
  sheet.columns = [{ width: 27 }, { width: 82 }]
  const rows = [
    ['Footballplayer.online player and parent import', 'Use the Players and Parents sheet. One row represents one player and up to two parent or guardian contacts.'],
    ['Authorised scope', scopeLabel || 'Choose the club, season, and team scope in Footballplayer.online before import.'],
    ['Team', 'Use an existing team name. If one team is selected, the Team cell may be left blank. Unknown teams are resolved during preview and are never created during inspection.'],
    ['Dates', 'Use YYYY-MM-DD or one consistent local date format. Footballplayer.online asks you to confirm ambiguous dates before preview.'],
    ['Positions', 'Separate multiple positions with commas.'],
    ['Parent contacts', 'Parent and guardian contacts stay uninvited. Invitations are a separate action after import review.'],
    ['Safety', 'Uploading and mapping do not change club records. Review the exact preview before a separate final confirmation.'],
    ['Do not include', 'Passwords, billing data, roles, internal IDs, or platform reference codes.'],
  ]
  rows.forEach((row) => sheet.addRow(row))
  sheet.getRow(1).height = 34
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    sheet.getCell(rowNumber, 1).font = { bold: true, color: { argb: 'FF065F46' } }
    sheet.getCell(rowNumber, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }
    sheet.getCell(rowNumber, 2).alignment = { wrapText: true, vertical: 'top' }
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

async function buildSimpleXlsx(scopeLabel) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Football Player'
  workbook.company = 'Jeluma Labs'
  workbook.subject = 'Human-readable player and parent import template'
  workbook.calcProperties.fullCalcOnLoad = false
  addSimpleInstructionsXlsx(workbook, scopeLabel)
  const sheet = workbook.addWorksheet(SIMPLE_TRANSFER_SHEET_NAME)
  sheet.addRow(SIMPLE_TEMPLATE_COLUMNS)
  sheet.getRow(1).height = 34
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  SIMPLE_TEMPLATE_COLUMNS.forEach((label, index) => {
    const column = sheet.getColumn(index + 1)
    column.width = Math.min(38, Math.max(16, label.length + 3))
    column.numFmt = '@'
    column.alignment = { vertical: 'top', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: SIMPLE_TEMPLATE_COLUMNS.length } }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function odsRow(values, styleName = '') {
  const cells = values.map((value) => `<table:table-cell office:value-type="string"${styleName ? ` table:style-name="${styleName}"` : ''}><text:p>${escapeXml(safeSpreadsheetText(value))}</text:p></table:table-cell>`).join('')
  return `<table:table-row>${cells}</table:table-row>`
}

function odsTable(name, rows) {
  return `<table:table table:name="${escapeXml(name)}">${rows.join('')}</table:table>`
}

async function buildSimpleOds(scopeLabel) {
  const zip = new JSZip()
  zip.file('mimetype', TABULAR_FORMATS.ods.mimeType, { compression: 'STORE' })
  const instructionRows = [
    ['Footballplayer.online player and parent import', 'Use the Players and Parents sheet. One row represents one player and up to two parent or guardian contacts.'],
    ['Authorised scope', scopeLabel || 'Choose the club, season, and team scope in Footballplayer.online before import.'],
    ['Team', 'Use an existing team name. If one team is selected, the Team cell may be blank.'],
    ['Dates', 'Use YYYY-MM-DD or one consistent local date format. Confirm ambiguous dates in Footballplayer.online.'],
    ['Parent contacts', 'Contacts stay uninvited. Invitations remain a separate action.'],
    ['Safety', 'Uploading and mapping do not change club records. Confirm only after reviewing the preview.'],
    ['Do not include', 'Passwords, billing data, roles, internal IDs, or platform reference codes.'],
  ]
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
<office:body><office:spreadsheet>
${odsTable('Instructions', instructionRows.map((row, index) => odsRow(row, index === 0 ? 'Header' : '')))}
${odsTable(SIMPLE_TRANSFER_SHEET_NAME, [odsRow(SIMPLE_TEMPLATE_COLUMNS, 'Header'), odsRow(SIMPLE_TEMPLATE_COLUMNS.map(() => ''))])}
</office:spreadsheet></office:body></office:document-content>`
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3">
<office:styles><style:style style:name="Header" style:family="table-cell"><style:text-properties fo:font-weight="bold" fo:color="#ffffff"/><style:table-cell-properties fo:background-color="#047857" fo:padding="0.08in"/></style:style></office:styles>
</office:document-styles>`
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="${TABULAR_FORMATS.ods.mimeType}"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`
  zip.file('content.xml', contentXml)
  zip.file('styles.xml', stylesXml)
  zip.file('META-INF/manifest.xml', manifestXml)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }))
}

export async function buildSimpleTransferTemplate(format, { scopeLabel = '' } = {}) {
  if (!['csv', 'xlsx', 'ods'].includes(format)) throw dataError('Choose CSV, XLSX, or ODS for the simple template.', 'TEMPLATE_FORMAT_UNSUPPORTED')
  const base = 'footballplayer-online-player-parent-template'
  if (format === 'xlsx') {
    return { buffer: await buildSimpleXlsx(scopeLabel), filename: `${base}.xlsx`, mimeType: TABULAR_FORMATS.xlsx.mimeType }
  }
  if (format === 'ods') {
    return { buffer: await buildSimpleOds(scopeLabel), filename: `${base}.ods`, mimeType: TABULAR_FORMATS.ods.mimeType }
  }
  const csv = `\uFEFF${simpleTemplateRows().map((row) => row.map((value) => quoteDelimited(value)).join(',')).join('\r\n')}\r\n`
  return { buffer: Buffer.from(csv, 'utf8'), filename: `${base}.csv`, mimeType: TABULAR_FORMATS.csv.mimeType }
}
