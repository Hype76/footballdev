export const RESOURCE_LIBRARY_BUCKET = 'resource-library'
export const RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
export const RESOURCE_LIBRARY_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

const EXTENSION_MIME_TYPES = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['csv', 'text/csv'],
  ['txt', 'text/plain'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
])

const BLOCKED_EXTENSIONS = new Set([
  'bat',
  'cmd',
  'com',
  'dll',
  'docm',
  'exe',
  'html',
  'htm',
  'js',
  'mjs',
  'pptm',
  'ps1',
  'rar',
  'sh',
  'svg',
  'vbs',
  'xlsm',
  'zip',
  '7z',
])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getFileExtension(fileName = '') {
  const parts = normalizeText(fileName).toLowerCase().split('.')
  return parts.length > 1 ? parts.pop() : ''
}

function getSafeFilename(fileName = '') {
  const normalizedName = normalizeText(fileName) || 'resource'
  const safeName = normalizedName
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)

  return safeName || 'resource'
}

export function validateResourceLibraryFile(file) {
  if (!file) {
    throw new Error('Choose a resource file before uploading.')
  }

  const extension = getFileExtension(file.name)

  if (!extension || BLOCKED_EXTENSIONS.has(extension) || !EXTENSION_MIME_TYPES.has(extension)) {
    throw new Error('Upload a PDF, DOCX, XLSX, PPTX, CSV, TXT, PNG, JPG, JPEG, GIF, or WebP file.')
  }

  const browserMimeType = normalizeText(file.type).toLowerCase()
  const expectedMimeType = EXTENSION_MIME_TYPES.get(extension)
  const mimeType = browserMimeType || expectedMimeType

  if (!RESOURCE_LIBRARY_ALLOWED_MIME_TYPES.has(mimeType) || mimeType !== expectedMimeType) {
    throw new Error('That file type is not allowed for the Resource Library.')
  }

  if (Number(file.size ?? 0) <= 0 || Number(file.size ?? 0) > RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES) {
    throw new Error('Resource files must be 20 MB or smaller.')
  }

  return {
    extension,
    mimeType,
    safeFilename: getSafeFilename(file.name),
  }
}

export async function writeResourceLibraryUpload(client, {
  id, clubId, teamId, title, description = '', category = 'general', file, body, uploadedByProfileId, uploadedBy,
}) {
  const validated = validateResourceLibraryFile(file)
  const storagePath = `${clubId}/${teamId}/${id}/${validated.safeFilename}`
  const bucket = client.storage.from(RESOURCE_LIBRARY_BUCKET)
  const { error: uploadError } = await bucket.upload(storagePath, body, {
    contentType: validated.mimeType,
    upsert: false,
  })
  if (uploadError) throw uploadError

  const { data, error } = await client
    .from('resource_library_items')
    .insert({
      id,
      club_id: clubId,
      team_id: teamId,
      title,
      description,
      category,
      storage_bucket: RESOURCE_LIBRARY_BUCKET,
      storage_path: storagePath,
      original_filename: normalizeText(file.name) || validated.safeFilename,
      mime_type: validated.mimeType,
      file_size_bytes: Number(file.size),
      uploaded_by_profile_id: uploadedByProfileId,
      ...uploadedBy,
    })
    .select('*, teams:team_id(id, name), resource_library_links(*), resource_library_external_links(external_url)')
    .single()

  if (error) {
    const { error: cleanupError } = await bucket.remove([storagePath])
    if (cleanupError) console.error('Could not remove the unlinked Resource Library upload.', cleanupError)
    throw error
  }
  return { data }
}
