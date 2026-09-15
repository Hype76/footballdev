import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { Buffer } from 'node:buffer'
import { safePartnerUrl } from '../../../src/lib/partners.js'

export function isPublicPartnerAddress(address) {
  if (address.includes(':')) return false
  const [a, b] = address.split('.').map(Number)
  return a > 0 && a < 224 && ![10,127].includes(a) && !(a===169 && b===254) && !(a===172 && b>=16 && b<=31) && !(a===192 && [0,168].includes(b)) && !(a===100 && b>=64 && b<=127) && !(a===198 && [18,19].includes(b))
}

export async function fetchPartnerImage(value, redirects = 0) {
  const safe = safePartnerUrl(value)
  if (!safe || redirects > 3) throw new Error('Use a public HTTPS image URL with no more than three redirects.')
  const url = new URL(safe)
  if (url.port && url.port !== '443') throw new Error('Image URLs must use the standard HTTPS port.')
  const addresses = await lookup(url.hostname, { all: true, family: 4 })
  if (!addresses.length || addresses.some(({ address }) => !isPublicPartnerAddress(address))) throw new Error('Private image addresses are not allowed.')
  // Pin the checked address for the connection to prevent DNS rebinding.
  const response = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers: { Accept: 'image/png,image/jpeg,image/webp' }, lookup: (_hostname, options, cb) => options.all ? cb(null, [addresses[0]]) : cb(null, addresses[0].address, 4) }, resolve)
    req.setTimeout(8000, () => req.destroy(new Error('Image download timed out.')))
    req.on('error', reject)
    req.end()
  })
  if ([301,302,303,307,308].includes(response.statusCode)) {
    response.resume()
    return fetchPartnerImage(new URL(response.headers.location, url).href, redirects + 1)
  }
  if (response.statusCode !== 200) { response.resume(); throw new Error('The image website did not return an image.') }
  const chunks = []; let size = 0
  for await (const chunk of response) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) { response.destroy(); throw new Error('Use an image smaller than 2MB.') }
    chunks.push(chunk)
  }
  const mimeType = String(response.headers['content-type'] || '').split(';')[0]
  const ext = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp' }[mimeType]
  if (!ext) throw new Error('Use a direct PNG, JPG or WebP image URL.')
  return { buffer: Buffer.concat(chunks), declaredMimeType: mimeType, fileName: `partner.${ext}` }
}
