import { Buffer } from 'node:buffer'
import sharp from 'sharp'

export const CLUB_LOGO_MAX_BYTES = 2 * 1024 * 1024
export const CLUB_LOGO_MAX_WIDTH = 2048
export const CLUB_LOGO_MAX_HEIGHT = 2048
export const CLUB_LOGO_MAX_PIXELS = CLUB_LOGO_MAX_WIDTH * CLUB_LOGO_MAX_HEIGHT
export const CLUB_LOGO_ALLOWED_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
])
export const CLUB_LOGO_ALLOWED_EXTENSIONS = Object.freeze(['.jpeg', '.jpg', '.png', '.webp'])

const MIME_BY_FORMAT = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
})

function validationError(message) {
  return Object.assign(new Error(message), { statusCode: 400 })
}

function normalizeMimeType(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase()
}

function fileExtension(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  const finalSegment = normalized.split(/[\\/]/).pop() || ''
  const dotIndex = finalSegment.lastIndexOf('.')
  return dotIndex >= 0 ? finalSegment.slice(dotIndex) : ''
}

function hasExactPngContainer(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  if (buffer.length < 20 || !buffer.subarray(0, 8).equals(signature)) {
    return false
  }

  let offset = 8

  while (offset + 12 <= buffer.length) {
    const dataLength = buffer.readUInt32BE(offset)
    const chunkEnd = offset + 12 + dataLength

    if (chunkEnd > buffer.length) {
      return false
    }

    const chunkType = buffer.toString('ascii', offset + 4, offset + 8)
    offset = chunkEnd

    if (chunkType === 'IEND') {
      return offset === buffer.length
    }
  }

  return false
}

function hasExactJpegContainer(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9
}

function hasExactWebpContainer(buffer) {
  return buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
    && buffer.readUInt32LE(4) + 8 === buffer.length
}

function hasExactContainer(buffer, format) {
  if (format === 'png') {
    return hasExactPngContainer(buffer)
  }

  if (format === 'jpeg') {
    return hasExactJpegContainer(buffer)
  }

  if (format === 'webp') {
    return hasExactWebpContainer(buffer)
  }

  return false
}

export function decodeClubLogoBase64(value) {
  const encoded = String(value ?? '').trim()

  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw validationError('The logo upload is not valid image data.')
  }

  const buffer = Buffer.from(encoded, 'base64')

  if (!buffer.length || buffer.length > CLUB_LOGO_MAX_BYTES) {
    throw validationError('Logo must be 2MB or smaller.')
  }

  return buffer
}

export async function validateAndNormalizeClubLogo({ buffer, declaredMimeType, fileName }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw validationError('A logo image is required.')
  }

  if (buffer.length > CLUB_LOGO_MAX_BYTES) {
    throw validationError('Logo must be 2MB or smaller.')
  }

  const mimeType = normalizeMimeType(declaredMimeType)
  const extension = fileExtension(fileName)

  if (!CLUB_LOGO_ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw validationError('Use a PNG, JPG, or WebP logo.')
  }

  if (!CLUB_LOGO_ALLOWED_EXTENSIONS.includes(extension)) {
    throw validationError('The logo filename must end in PNG, JPG, JPEG, or WebP.')
  }

  let metadata

  try {
    metadata = await sharp(buffer, {
      animated: true,
      failOn: 'error',
      limitInputPixels: CLUB_LOGO_MAX_PIXELS,
      sequentialRead: true,
    }).metadata()
  } catch {
    throw validationError('The logo could not be decoded as a safe image.')
  }

  const actualMimeType = MIME_BY_FORMAT[metadata.format]

  if (!actualMimeType || actualMimeType !== mimeType) {
    throw validationError('The logo file type does not match its image content.')
  }

  if (!hasExactContainer(buffer, metadata.format)) {
    throw validationError('The logo contains extra or invalid file content.')
  }

  const width = Number(metadata.width ?? 0)
  const height = Number(metadata.height ?? 0)
  const pages = Number(metadata.pages ?? 1)

  if (!width || !height || width > CLUB_LOGO_MAX_WIDTH || height > CLUB_LOGO_MAX_HEIGHT) {
    throw validationError('Logo dimensions must not exceed 2048 by 2048 pixels.')
  }

  if (width * height > CLUB_LOGO_MAX_PIXELS) {
    throw validationError('The logo has too many pixels.')
  }

  if (pages !== 1 || metadata.pageHeight || metadata.loop || metadata.delay) {
    throw validationError('Animated logos are not supported.')
  }

  let normalizedBuffer

  try {
    normalizedBuffer = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: CLUB_LOGO_MAX_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .png({ compressionLevel: 9, palette: false })
      .toBuffer()
  } catch {
    throw validationError('The logo could not be safely processed.')
  }

  if (!normalizedBuffer.length || normalizedBuffer.length > CLUB_LOGO_MAX_BYTES) {
    throw validationError('The processed logo must be 2MB or smaller.')
  }

  return {
    buffer: normalizedBuffer,
    contentType: 'image/png',
    height,
    sourceFormat: metadata.format,
    width,
  }
}
