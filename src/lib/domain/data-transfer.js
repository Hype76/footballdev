import { supabase } from '../supabase-client.js'

export const DATA_TRANSFER_MAX_BYTES = 4 * 1024 * 1024
export const DATA_TRANSFER_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const DATA_TRANSFER_TEMPLATE_VERSION = 'FP-V1-ONBOARDING-1'
const DATA_TRANSFER_BROWSER_FIXTURES_ENABLED = import.meta.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES === 'true'

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
  downloadBlob(blob, 'footballplayer-online-onboarding-v1.xlsx')
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
  if (!file) throw new Error('Choose an XLSX workbook first.')
  if (!String(file.name || '').toLowerCase().endsWith('.xlsx')) throw new Error('Choose a file with the .xlsx extension.')
  if (file.type && file.type !== DATA_TRANSFER_MIME) throw new Error('Only an XLSX workbook is supported.')
  if (file.size > DATA_TRANSFER_MAX_BYTES) throw new Error('The workbook exceeds the 4 MB upload limit.')
  return dataTransferRequest('inspect', {
    ...scope,
    fileName: file.name,
    mimeType: file.type || DATA_TRANSFER_MIME,
    workbookBase64: await fileToBase64(file),
  })
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
  const safeFilename = String(filename || 'footballplayer-online-onboarding-v1.xlsx').replace(/[^a-z0-9._ -]/gi, '-').slice(0, 180)
  downloadBlob(blob, safeFilename || 'footballplayer-online-onboarding-v1.xlsx')
}

export async function rollbackDataTransfer(batchId, scope = {}) {
  return dataTransferRequest('rollback', { ...scope, batchId })
}
