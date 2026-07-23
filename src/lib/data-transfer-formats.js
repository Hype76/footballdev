export const DATA_TRANSFER_MAX_BYTES = 4 * 1024 * 1024
export const DATA_TRANSFER_MAX_ROWS = 5000
export const DATA_TRANSFER_MAX_COLUMNS = 100

export const DATA_TRANSFER_FORMATS = Object.freeze({
  csv: Object.freeze({
    key: 'csv',
    extension: '.csv',
    browserAcceptValues: Object.freeze(['.csv', 'text/csv', 'application/csv']),
    recognizedMimeAliases: Object.freeze(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']),
    storageMimeType: 'text/csv',
    responseMimeType: 'text/csv; charset=utf-8',
    maximumBytes: DATA_TRANSFER_MAX_BYTES,
    maximumRows: DATA_TRANSFER_MAX_ROWS,
    maximumColumns: DATA_TRANSFER_MAX_COLUMNS,
  }),
  tsv: Object.freeze({
    key: 'tsv',
    extension: '.tsv',
    browserAcceptValues: Object.freeze(['.tsv', 'text/tab-separated-values', 'text/tsv']),
    recognizedMimeAliases: Object.freeze(['text/tab-separated-values', 'text/tsv', 'text/plain']),
    storageMimeType: 'text/tab-separated-values',
    responseMimeType: 'text/tab-separated-values; charset=utf-8',
    maximumBytes: DATA_TRANSFER_MAX_BYTES,
    maximumRows: DATA_TRANSFER_MAX_ROWS,
    maximumColumns: DATA_TRANSFER_MAX_COLUMNS,
  }),
  xlsx: Object.freeze({
    key: 'xlsx',
    extension: '.xlsx',
    browserAcceptValues: Object.freeze(['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
    recognizedMimeAliases: Object.freeze([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
      'application/zip',
    ]),
    storageMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    responseMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    maximumBytes: DATA_TRANSFER_MAX_BYTES,
    maximumRows: DATA_TRANSFER_MAX_ROWS,
    maximumColumns: DATA_TRANSFER_MAX_COLUMNS,
  }),
  ods: Object.freeze({
    key: 'ods',
    extension: '.ods',
    browserAcceptValues: Object.freeze(['.ods', 'application/vnd.oasis.opendocument.spreadsheet']),
    recognizedMimeAliases: Object.freeze([
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/octet-stream',
      'application/zip',
    ]),
    storageMimeType: 'application/vnd.oasis.opendocument.spreadsheet',
    responseMimeType: 'application/vnd.oasis.opendocument.spreadsheet',
    maximumBytes: DATA_TRANSFER_MAX_BYTES,
    maximumRows: DATA_TRANSFER_MAX_ROWS,
    maximumColumns: DATA_TRANSFER_MAX_COLUMNS,
  }),
})

export const DATA_TRANSFER_ACCEPT = Object.values(DATA_TRANSFER_FORMATS)
  .flatMap((format) => format.browserAcceptValues)
  .filter((value, index, values) => values.indexOf(value) === index)
  .join(',')

export const DATA_TRANSFER_STORAGE_MIME_ALLOWLIST = Object.freeze(
  Object.values(DATA_TRANSFER_FORMATS).map((format) => format.storageMimeType),
)

export function normalizeDataTransferMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase()
}

export function dataTransferFormatForExtension(extension) {
  const normalized = String(extension || '').trim().toLowerCase()
  return Object.values(DATA_TRANSFER_FORMATS).find((format) => format.extension === normalized) || null
}

export function dataTransferFormatForFilename(filename) {
  const match = String(filename || '').trim().toLowerCase().match(/(\.[a-z0-9]+)$/)
  return dataTransferFormatForExtension(match?.[1] || '')
}

export function dataTransferStorageMimeType(formatKey) {
  const format = DATA_TRANSFER_FORMATS[String(formatKey || '').trim().toLowerCase()]
  if (!format) {
    throw Object.assign(new Error('The spreadsheet format is not approved for Data Transfer storage.'), {
      code: 'UNSUPPORTED_STORAGE_FORMAT',
      statusCode: 415,
    })
  }
  if (!DATA_TRANSFER_STORAGE_MIME_ALLOWLIST.includes(format.storageMimeType)) {
    throw Object.assign(new Error('The spreadsheet MIME type is not approved for Data Transfer storage.'), {
      code: 'UNSUPPORTED_STORAGE_MIME',
      statusCode: 415,
    })
  }
  return format.storageMimeType
}
