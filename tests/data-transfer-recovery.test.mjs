import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  DATA_TRANSFER_FORMATS,
  DATA_TRANSFER_STORAGE_MIME_ALLOWLIST,
  dataTransferStorageMimeType,
  normalizeDataTransferMimeType,
} from '../src/lib/data-transfer-formats.js'
import {
  buildSimpleTransferTemplate,
  detectSpreadsheetFormat,
  inspectSpreadsheetSource,
  mapSpreadsheetToTransferRows,
  SIMPLE_TEMPLATE_COLUMNS,
  SIMPLE_TRANSFER_SHEET_NAME,
  TABULAR_FORMATS,
} from '../netlify/functions/lib/_data-transfer-tabular.js'
import { uploadDataTransferRawFile } from '../netlify/functions/lib/_data-transfer-storage.js'
import { buildImportPlan } from '../netlify/functions/lib/_data-transfer-plan.js'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local-test-service-role-key'

const {
  createDataTransferHandler,
  statusError,
} = await import('../netlify/functions/data-transfer.js')

function strictProductionStorage() {
  const uploads = []
  const storage = {
    from(bucketName) {
      assert.equal(bucketName, 'data-transfer-private')
      return {
        async upload(path, buffer, options) {
          assert.ok(Buffer.isBuffer(buffer))
          assert.ok(DATA_TRANSFER_STORAGE_MIME_ALLOWLIST.includes(options.contentType), `Production bucket rejects ${options.contentType}`)
          assert.equal(options.upsert, false)
          uploads.push({ options, path })
          return { data: { path }, error: null }
        },
      }
    },
  }
  return { storage, uploads }
}

function quoteDelimited(value, delimiter) {
  const text = String(value ?? '')
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function filledValues(format) {
  const values = {
    'Player First Name': 'Alex',
    'Player Last Name': `Recovery ${format.toUpperCase()}`,
    'Preferred Name': 'Lex',
    'Date of Birth': '2014-01-20',
    Team: 'FP TEST - U99 Smoke Team',
    Section: 'Squad',
    Positions: 'Defender, Midfielder',
    'Parent or Guardian 1 First Name': 'Pat',
    'Parent or Guardian 1 Last Name': `Recovery ${format.toUpperCase()}`,
    'Parent or Guardian 1 Email': `fp-test-recovery-${format}@example.invalid`,
    'Parent or Guardian 1 Relationship': 'Parent',
    'Parent or Guardian 1 Primary Contact': 'Yes',
    'Parent or Guardian 1 Receives Communications': 'No',
    'Parent or Guardian 1 Emergency Contact': 'Yes',
  }
  return SIMPLE_TEMPLATE_COLUMNS.map((heading) => values[heading] || '')
}

async function filledTemplate(format) {
  const values = filledValues(format)
  if (format === 'tsv') {
    const text = [
      SIMPLE_TEMPLATE_COLUMNS.map((value) => quoteDelimited(value, '\t')).join('\t'),
      values.map((value) => quoteDelimited(value, '\t')).join('\t'),
    ].join('\r\n')
    return {
      buffer: Buffer.from(text, 'utf8'),
      filename: 'recovery.tsv',
      mimeType: DATA_TRANSFER_FORMATS.tsv.responseMimeType,
    }
  }
  const template = await buildSimpleTransferTemplate(format, { scopeLabel: 'FP TEST controlled local recovery' })
  if (format === 'csv') {
    const lines = template.buffer.toString('utf8').split(/\r?\n/)
    lines[1] = values.map((value) => quoteDelimited(value, ',')).join(',')
    return { ...template, buffer: Buffer.from(lines.join('\r\n'), 'utf8') }
  }
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(template.buffer)
    const row = workbook.getWorksheet(SIMPLE_TRANSFER_SHEET_NAME).getRow(2)
    values.forEach((value, index) => {
      row.getCell(index + 1).value = value
    })
    return { ...template, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }
  }
  const zip = await JSZip.loadAsync(template.buffer)
  const content = await zip.file('content.xml').async('string')
  const replacement = `<table:table-row>${values.map((value) => `<table:table-cell office:value-type="string"><text:p>${escapeXml(value)}</text:p></table:table-cell>`).join('')}</table:table-row>`
  const tablePattern = new RegExp(`(<table:table table:name="${SIMPLE_TRANSFER_SHEET_NAME}">[\\s\\S]*?<table:table-row>[\\s\\S]*?</table:table-row>)<table:table-row>[\\s\\S]*?</table:table-row>(</table:table>)`)
  const nextContent = content.replace(tablePattern, `$1${replacement}$2`)
  assert.notEqual(nextContent, content)
  zip.file('content.xml', nextContent)
  return { ...template, buffer: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })) }
}

function mappingFor(source) {
  const sheet = source.sheets.find((candidate) => candidate.name === source.suggestedSheet)
  assert.ok(sheet)
  return {
    columns: sheet.mappings.map((entry) => ({
      defaultValue: '',
      sourceColumn: entry.sourceColumn,
      targetField: entry.suggestedField,
      transformation: entry.transformation || 'trim',
    })),
    dateConvention: 'dmy',
    defaultTeamId: 'team-fptest',
    sheetName: sheet.name,
    teamMappings: (sheet.teamValues || []).map((sourceValue) => ({
      create: false,
      sourceValue,
      teamId: 'team-fptest',
    })),
  }
}

test('central registry separates detected aliases, storage MIME, response MIME, browser accept values, and extensions', () => {
  assert.equal(TABULAR_FORMATS, DATA_TRANSFER_FORMATS)
  assert.equal(DATA_TRANSFER_FORMATS.csv.storageMimeType, 'text/csv')
  assert.equal(DATA_TRANSFER_FORMATS.csv.responseMimeType, 'text/csv; charset=utf-8')
  assert.notEqual(DATA_TRANSFER_FORMATS.csv.storageMimeType, DATA_TRANSFER_FORMATS.csv.responseMimeType)
  assert.equal(DATA_TRANSFER_FORMATS.tsv.storageMimeType, 'text/tab-separated-values')
  assert.equal(DATA_TRANSFER_FORMATS.tsv.responseMimeType, 'text/tab-separated-values; charset=utf-8')
  assert.equal(DATA_TRANSFER_FORMATS.xlsx.storageMimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(DATA_TRANSFER_FORMATS.ods.storageMimeType, 'application/vnd.oasis.opendocument.spreadsheet')
  assert.ok(DATA_TRANSFER_FORMATS.csv.browserAcceptValues.includes('.csv'))
  assert.ok(DATA_TRANSFER_FORMATS.csv.recognizedMimeAliases.includes('application/csv'))
})

test('charset-decorated CSV MIME variants are detected but always stored as canonical text/csv', async () => {
  const csv = Buffer.from('Player First Name,Player Last Name\nAlex,Example\n', 'utf8')
  for (const mimeType of [
    'text/csv;charset=utf-8',
    'text/csv; charset=utf-8',
    ' Text/CSV ; Charset=UTF-8 ',
  ]) {
    assert.equal(normalizeDataTransferMimeType(mimeType), 'text/csv')
    const format = await detectSpreadsheetFormat(csv, { fileName: 'players.csv', mimeType })
    assert.equal(format, 'csv')
    const { storage, uploads } = strictProductionStorage()
    const result = await uploadDataTransferRawFile({
      bucketName: 'data-transfer-private',
      buffer: csv,
      format,
      path: `fixture/${uploads.length}.csv`,
      storage,
    })
    assert.equal(result.contentType, 'text/csv')
    assert.equal(uploads[0].options.contentType, 'text/csv')
    assert.notEqual(uploads[0].options.contentType, DATA_TRANSFER_FORMATS.csv.responseMimeType)
  }
})

test('all supported formats reach the production-equivalent strict storage operation with canonical MIME', async () => {
  for (const format of ['csv', 'tsv', 'xlsx', 'ods']) {
    const { storage, uploads } = strictProductionStorage()
    const result = await uploadDataTransferRawFile({
      bucketName: 'data-transfer-private',
      buffer: Buffer.from(`fixture-${format}`),
      format,
      path: `fixture/data${DATA_TRANSFER_FORMATS[format].extension}`,
      storage,
    })
    assert.equal(result.contentType, DATA_TRANSFER_FORMATS[format].storageMimeType)
    assert.equal(uploads[0].options.contentType, DATA_TRANSFER_FORMATS[format].storageMimeType)
  }
})

test('CSV, TSV, XLSX, and ODS ordinary imports keep authorised null-season scope anchors unchanged', async () => {
  const existing = {
    club: {
      id: 'club-fptest',
      name: 'FP TEST - Season Events Smoke',
      season: null,
      transfer_reference: null,
    },
    guardians: [],
    links: [],
    players: [],
    teams: [{
      id: 'team-fptest',
      club_id: 'club-fptest',
      name: 'FP TEST - U99 Smoke Team',
      season: null,
      status: 'active',
      transfer_reference: null,
    }],
  }
  const scope = {
    authorizedTeamIds: ['team-fptest'],
    canManageTeams: true,
    clubId: 'club-fptest',
    isClubWideScope: false,
  }
  for (const format of ['csv', 'tsv', 'xlsx', 'ods']) {
    const file = await filledTemplate(format)
    const detected = await detectSpreadsheetFormat(file.buffer, {
      fileName: file.filename,
      mimeType: file.mimeType,
    })
    assert.equal(detected, format)
    const { storage, uploads } = strictProductionStorage()
    await uploadDataTransferRawFile({
      bucketName: 'data-transfer-private',
      buffer: file.buffer,
      format: detected,
      path: `club-fptest/recovery${DATA_TRANSFER_FORMATS[format].extension}`,
      storage,
    })
    assert.equal(uploads[0].options.contentType, DATA_TRANSFER_FORMATS[format].storageMimeType)
    const source = await inspectSpreadsheetSource(file.buffer, {
      fileName: file.filename,
      mimeType: file.mimeType,
    })
    const parsed = await mapSpreadsheetToTransferRows(file.buffer, {
      existing,
      fileName: file.filename,
      importOptions: {
        allowTeamCreation: false,
        createPossibleDuplicates: false,
        fillBlankFields: false,
        importMode: 'additive',
        planningMode: 'ordinary',
        season: '2026/27',
        updateConflicts: false,
      },
      mapping: mappingFor(source),
      mimeType: file.mimeType,
      scope,
    })
    assert.deepEqual(parsed.errors, [])
    const parsedTeam = parsed.rowsBySheet.Teams[0]
    const parsedPlayer = parsed.rowsBySheet.Players[0]
    assert.equal(parsedTeam._resolvedEntityId, 'team-fptest')
    assert.match(parsedTeam._planningHandle, /^PLAN-TEAM-[A-F0-9]{12}$/)
    assert.equal(parsedTeam.transfer_reference, '')
    assert.equal(parsedPlayer._teamPlanningHandle, parsedTeam._planningHandle)
    assert.equal(parsedPlayer.team_reference, '')
    const preview = buildImportPlan({
      actorScope: scope,
      existing,
      importOptions: {
        allowTeamCreation: false,
        createPossibleDuplicates: false,
        fillBlankFields: false,
        importMode: 'additive',
        planningMode: 'ordinary',
        season: '2026/27',
        updateConflicts: false,
      },
      rowsBySheet: parsed.rowsBySheet,
    })
    assert.deepEqual(preview.errors, [])
    assert.ok(preview.plan)
    assert.equal(preview.plan.context.planning_mode, 'ordinary')
    assert.equal(preview.plan.context.selected_season, '2026/27')
    assert.equal(preview.plan.club.action, 'unchanged')
    assert.equal(preview.plan.club.values.season, '')
    assert.equal(preview.plan.teams[0].action, 'unchanged')
    assert.equal(preview.plan.teams[0].entity_id, 'team-fptest')
    assert.equal(preview.plan.teams[0].planning_handle, parsedTeam._planningHandle)
    assert.equal(preview.plan.teams[0].values.transfer_reference, '')
    assert.equal(preview.plan.teams[0].values.season, '')
    assert.equal(preview.plan.players[0].team_entity_id, 'team-fptest')
    assert.equal(preview.counts.update, 0)
    assert.equal(preview.counts.possible_duplicate, 0)
    assert.ok(!preview.errors.some((error) => [
      'CLUB_CHANGE_NOT_AUTHORIZED',
      'TEAM_CHANGE_NOT_AUTHORIZED',
      'POSSIBLE_DUPLICATE_TEAM',
      'PLAYER_TEAM_UNAVAILABLE',
      'LINK_REFERENCE_UNAVAILABLE',
    ].includes(error.code)))
    assert.ok(preview.rowResults.some((row) => row.entity_type === 'player' && row.outcome === 'create'))
    assert.ok(preview.rowResults.some((row) => row.entity_type === 'guardian' && row.outcome === 'create'))
    assert.ok(preview.rowResults.some((row) => row.entity_type === 'link' && row.outcome === 'link'))
    assert.equal(existing.players.length, 0)
    assert.equal(existing.guardians.length, 0)
    assert.equal(existing.links.length, 0)
  }
})

test('unsupported storage formats fail before upload', async () => {
  let uploadCalled = false
  const storage = {
    from() {
      return {
        async upload() {
          uploadCalled = true
          return { data: null, error: null }
        },
      }
    },
  }
  assert.throws(() => dataTransferStorageMimeType('pdf'), { code: 'UNSUPPORTED_STORAGE_FORMAT', statusCode: 415 })
  await assert.rejects(
    uploadDataTransferRawFile({
      bucketName: 'data-transfer-private',
      buffer: Buffer.from('not approved'),
      format: 'pdf',
      path: 'fixture/data.pdf',
      storage,
    }),
    { code: 'UNSUPPORTED_STORAGE_FORMAT', statusCode: 415 },
  )
  assert.equal(uploadCalled, false)
})

test('the forward migration uses the exact non-decorated production allowlist fixture', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260723091637_data_transfer_storage_mime_allowlist_team_reference_recovery_06.sql', import.meta.url), 'utf8')
  for (const mimeType of DATA_TRANSFER_STORAGE_MIME_ALLOWLIST) {
    assert.match(migration, new RegExp(`'${mimeType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
  }
  assert.doesNotMatch(migration, /charset/i)
  assert.match(migration, /where id = 'data-transfer-private'/)
  assert.doesNotMatch(migration, /\b(delete|drop|truncate)\b/i)
})

test('known operation failures return every required structured status and never 502', async () => {
  const cases = [
    [400, 'INVALID_MAPPING'],
    [401, 'LOGIN_REQUIRED'],
    [403, 'ROLE_DENIED'],
    [404, 'BATCH_NOT_FOUND'],
    [409, 'BATCH_STATE_INVALID'],
    [413, 'WORKBOOK_TOO_LARGE'],
    [415, 'UNSUPPORTED_FILE_EXTENSION'],
    [422, 'WORKBOOK_DATA_UNPROCESSABLE'],
  ]
  const operationHandlers = Object.fromEntries(cases.map(([statusCode, code]) => [
    code,
    async () => {
      throw statusError(`Safe ${statusCode} rejection.`, statusCode, code)
    },
  ]))
  const logs = []
  const handler = createDataTransferHandler({
    authenticateRequest: async () => ({ id: 'fixture-user' }),
    logger: { error: (...args) => logs.push(args) },
    operationHandlers,
  })
  for (const [statusCode, code] of cases) {
    const result = await handler({
      body: JSON.stringify({ operation: code }),
      headers: {},
      httpMethod: 'POST',
    })
    const body = JSON.parse(result.body)
    assert.equal(result.statusCode, statusCode)
    assert.notEqual(result.statusCode, 502)
    assert.equal(body.ok, false)
    assert.equal(body.success, false)
    assert.equal(body.code, code)
    assert.equal(typeof body.message, 'string')
  }
  assert.equal(logs.length, cases.length)
})

test('asynchronous 403 and 415 rejections are awaited and converted before Netlify can emit 502', async () => {
  const handler = createDataTransferHandler({
    authenticateRequest: async () => ({ id: 'fixture-user' }),
    logger: { error() {} },
    operationHandlers: {
      denied: async () => Promise.reject(statusError('Denied.', 403, 'CROSS_CLUB_SCOPE_DENIED')),
      unsafe: async () => Promise.reject(statusError('Unsafe file.', 415, 'UNSAFE_FILE_TYPE')),
    },
  })
  for (const [operation, statusCode] of [['denied', 403], ['unsafe', 415]]) {
    const result = await handler({ body: JSON.stringify({ operation }), headers: {}, httpMethod: 'POST' })
    assert.equal(result.statusCode, statusCode)
    assert.notEqual(result.statusCode, 502)
  }
})

test('unexpected failures stay safe 500 responses and do not expose internal details', async () => {
  const secret = 'postgres://service-role-secret@internal.example/data'
  const logs = []
  const handler = createDataTransferHandler({
    authenticateRequest: async () => ({ id: 'fixture-user' }),
    logger: { error: (...args) => logs.push(args) },
    operationHandlers: {
      explode: async () => {
        throw new Error(secret)
      },
    },
  })
  const result = await handler({ body: JSON.stringify({ operation: 'explode' }), headers: {}, httpMethod: 'POST' })
  const body = JSON.parse(result.body)
  assert.equal(result.statusCode, 500)
  assert.equal(body.code, 'DATA_TRANSFER_FAILED')
  assert.equal(body.message, 'Data Transfer could not complete the request.')
  assert.doesNotMatch(result.body, /service-role-secret/)
  assert.doesNotMatch(JSON.stringify(logs), /service-role-secret/)
})
