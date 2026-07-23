import {
  DATA_TRANSFER_STORAGE_MIME_ALLOWLIST,
  dataTransferStorageMimeType,
} from '../../../src/lib/data-transfer-formats.js'

export { DATA_TRANSFER_STORAGE_MIME_ALLOWLIST }

export async function uploadDataTransferRawFile({
  bucketName,
  buffer,
  format,
  path,
  storage,
}) {
  if (!storage || typeof storage.from !== 'function') {
    throw new TypeError('A Supabase Storage client is required.')
  }
  const contentType = dataTransferStorageMimeType(format)
  const result = await storage.from(bucketName).upload(path, buffer, {
    contentType,
    upsert: false,
  })
  return { ...result, contentType }
}
