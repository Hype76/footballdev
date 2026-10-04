import { Buffer } from 'buffer'
import UPNG from 'upng-js'
import jpeg from 'jpeg-js'

const MAX_BYTES = 2_000_000
const MAX_DIMENSION = 2048
const OUTPUT_SIZE = 256

export function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function validDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= MAX_DIMENSION && height <= MAX_DIMENSION
}

export function convertParentPdfLogo(bytes) {
  if (!bytes?.length || bytes.length > MAX_BYTES) return {}
  let image
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    if (bytes.length < 33) return {}
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (!validDimensions(header.getUint32(16), header.getUint32(20))) return {}
    const png = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    image = { width: png.width, height: png.height, data: new Uint8Array(UPNG.toRGBA8(png)[0]) }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    image = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 4.2, maxMemoryUsageInMB: 64, tolerantDecoding: false })
  } else return {}
  if (!validDimensions(image.width, image.height)) return {}

  const data = new Uint8Array(OUTPUT_SIZE * OUTPUT_SIZE * 4).fill(255)
  const scale = Math.min(OUTPUT_SIZE / image.width, OUTPUT_SIZE / image.height)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const left = Math.floor((OUTPUT_SIZE - width) / 2)
  const top = Math.floor((OUTPUT_SIZE - height) / 2)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (Math.min(image.height - 1, Math.floor(y / scale)) * image.width + Math.min(image.width - 1, Math.floor(x / scale))) * 4
      const target = ((top + y) * OUTPUT_SIZE + left + x) * 4
      const alpha = image.data[source + 3] / 255
      for (let channel = 0; channel < 3; channel += 1) data[target + channel] = Math.round(image.data[source + channel] * alpha + 255 * (1 - alpha))
    }
  }
  // jpeg-js uses Buffer for its output in CommonJS, including Metro on Hermes.
  if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer
  return { clubLogoData: `data:image/jpeg;base64,${bytesToBase64(jpeg.encode({ data, width: OUTPUT_SIZE, height: OUTPUT_SIZE }, 90).data)}`, logoWidth: OUTPUT_SIZE, logoHeight: OUTPUT_SIZE }
}

export async function prepareParentPdfLogo(match, { storageOrigin, fetchLogo = globalThis.fetch, timeoutMs = 5000 } = {}) {
  let url
  try {
    url = new URL(match.clubLogoUrl)
    const prefix = `/storage/v1/object/public/club-logos/${match.clubId}/`
    const pathname = decodeURIComponent(url.pathname)
    if (url.protocol !== 'https:' || url.origin !== new URL(storageOrigin).origin || url.username || url.password
      || !match.clubId || !pathname.startsWith(prefix) || pathname.includes('..') || pathname.includes('\\')) return {}
  } catch { return {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchLogo(url.href, { credentials: 'omit', redirect: 'error', signal: controller.signal })
    if (!response.ok || Number(response.headers?.get('content-length')) > MAX_BYTES) return {}
    return convertParentPdfLogo(new Uint8Array(await response.arrayBuffer()))
  } catch { return {} } finally { clearTimeout(timer) }
}
