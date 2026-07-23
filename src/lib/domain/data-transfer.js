import { supabase } from '../supabase-client.js'

export const DATA_TRANSFER_MAX_BYTES = 4 * 1024 * 1024
export const DATA_TRANSFER_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const DATA_TRANSFER_TEMPLATE_VERSION = 'FP-V1-ONBOARDING-1'
export const SIMPLE_DATA_TRANSFER_TEMPLATE_VERSION = 'FP-V1-PLAYER-PARENT-2'
export const DATA_TRANSFER_ACCEPT = '.csv,.tsv,.xlsx,.ods,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet'
const DATA_TRANSFER_BROWSER_FIXTURES_ENABLED = import.meta.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES === 'true'
const SPREADSHEET_FORMATS = {
  csv: { extension: '.csv', mimeType: 'text/csv' },
  tsv: { extension: '.tsv', mimeType: 'text/tab-separated-values' },
  xlsx: { extension: '.xlsx', mimeType: DATA_TRANSFER_MIME },
  ods: { extension: '.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' },
}
const ORDINARY_EXPORT_FILENAMES = {
  players: 'footballplayer-online-players',
  players_and_guardians: 'footballplayer-online-players-and-parents',
  teams: 'footballplayer-online-teams',
}

async function accessToken() {
  if (DATA_TRANSFER_BROWSER_FIXTURES_ENABLED && window.sessionStorage.getItem('auth-access-browser-fixture-email')) {
    return 'fixture-access-token'
  }

  const { data, error } = await supabase.auth.getSession()
  if (error || !data?.session?.access_token) throw new Error('Your login session is required. Sign in again and retry.')
  return data.session.access_token
}

async function dataTransferRequest(operation, payload = {}) {
  const response = await fetch('/.netlify/functions/data-transfer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessToken()}`,
    },
    body: JSON.stringify({ operation, ...payload }),
  })

  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    const result = contentType.includes('application/json') ? await response.json() : null
    const error = new Error(result?.message || 'Data Transfer could not complete the request.')
    error.code = result?.code || 'DATA_TRANSFER_FAILED'
    throw error
  }

  return contentType.includes('application/json') ? response.json() : response.blob()
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function loadDataTransferScope(scope = {}) {
  return dataTransferRequest('scope', scope)
}

export async function downloadDataTransferWorkbook(operation, scope = {}) {
  const blob = await dataTransferRequest(operation, scope)
  downloadBlob(blob, 'footballplayer-online-portable-transfer-v1.xlsx')
}

export async function downloadSimpleDataTransferTemplate(format, scope = {}) {
  if (!['csv', 'xlsx', 'ods'].includes(format)) throw new Error('Choose CSV, XLSX, or ODS.')
  const blob = await dataTransferRequest('simple-template', { ...scope, format })
  downloadBlob(blob, `footballplayer-online-player-parent-template.${format}`)
}

export async function downloadOrdinaryDataTransferExport({ dataset, format, recordStatus, season }, scope = {}) {
  if (!Object.hasOwn(ORDINARY_EXPORT_FILENAMES, dataset)) throw new Error('Choose Players, Players and parent contacts, or Teams.')
  if (!['csv', 'xlsx', 'ods'].includes(format)) throw new Error('Choose CSV, Excel, or OpenDocument.')
  if (!['active', 'inactive', 'all'].includes(recordStatus)) throw new Error('Choose active, inactive, or all records.')
  const blob = await dataTransferRequest('ordinary-export', { ...scope, dataset, format, recordStatus, season: season || 'all' })
  downloadBlob(blob, `${ORDINARY_EXPORT_FILENAMES[dataset]}.${format}`)
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The selected workbook could not be read.'))
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

export async function inspectDataTransferWorkbook(file, scope = {}) {
  validateSpreadsheetFile(file)
  return dataTransferRequest('inspect', {
    ...scope,
    fileName: file.name,
    mimeType: file.type || DATA_TRANSFER_MIME,
    workbookBase64: await fileToBase64(file),
  })
}

export async function inspectDataTransferSource(file, scope = {}) {
  validateSpreadsheetFile(file)
  return dataTransferRequest('source-inspect', {
    ...scope,
    fileName: file.name,
    mimeType: file.type || '',
    workbookBase64: await fileToBase64(file),
  })
}

function validateSpreadsheetFile(file) {
  if (!file) throw new Error('Choose a CSV, TSV, XLSX, or ODS spreadsheet first.')
  const extension = String(file.name || '').toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] || ''
  if (!Object.values(SPREADSHEET_FORMATS).some((format) => format.extension === extension)) {
    throw new Error('Choose a file with a .csv, .tsv, .xlsx, or .ods extension.')
  }
  if (file.size > DATA_TRANSFER_MAX_BYTES) throw new Error('The spreadsheet exceeds the 4 MB upload limit.')
}

export async function confirmDataTransfer(payload) {
  return dataTransferRequest('confirm', payload)
}

export async function loadDataTransferHistory(scope = {}) {
  return dataTransferRequest('history', scope)
}

export async function loadDataTransferDetails(batchId, scope = {}) {
  return dataTransferRequest('details', { ...scope, batchId })
}

export async function downloadDataTransferErrorReport(batchId, scope = {}) {
  const blob = await dataTransferRequest('error-report', { ...scope, batchId })
  downloadBlob(blob, `footballplayer-online-import-errors-${batchId}.xlsx`)
}

export async function downloadDataTransferRawWorkbook(batchId, filename, scope = {}) {
  const blob = await dataTransferRequest('raw-workbook', { ...scope, batchId })
  const safeFilename = String(filename || 'footballplayer-online-portable-transfer-v1.xlsx').replace(/[^a-z0-9._ -]/gi, '-').slice(0, 180)
  downloadBlob(blob, safeFilename || 'footballplayer-online-portable-transfer-v1.xlsx')
}

export async function rollbackDataTransfer(batchId, scope = {}) {
  return dataTransferRequest('rollback', { ...scope, batchId })
}
