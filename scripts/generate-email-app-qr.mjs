import { mkdir, writeFile } from 'node:fs/promises'
import QRCode from 'qrcode'
import sharp from 'sharp'
import jsQR from 'jsqr'
import { APP_DOWNLOAD_LINKS } from '../src/lib/app-download-links.js'

await mkdir('public/email-apps', { recursive: true })
for (const [role, links] of Object.entries(APP_DOWNLOAD_LINKS)) {
  for (const [store, platform] of [['apple', 'ios'], ['android', 'android']]) {
    let verified = false
    for (let maskPattern = 0; maskPattern < 8; maskPattern++) {
      // Integer-sized modules and a four-module quiet zone keep the codes sharp.
      const code = await QRCode.toBuffer(links[`${store}QrTarget`], { maskPattern, scale: 10, margin: 4, errorCorrectionLevel: 'H', color: { dark: '#000000', light: '#ffffff' } })
      const { width } = await sharp(code).metadata()
      const logoSize = Math.floor(width * 0.16)
      const logo = await sharp('public/football-player-logo.png').resize(logoSize, logoSize).flatten({ background: '#000000' }).png().toBuffer()
      const backingSize = logoSize + 12
      const backing = await sharp({ create: { width: backingSize, height: backingSize, channels: 3, background: '#ffffff' } }).composite([{ input: logo, gravity: 'centre' }]).png().toBuffer()
      const png = await sharp(code).composite([{ input: backing, gravity: 'centre' }]).png().toBuffer()
      const checks = await Promise.all([112, 136, 272, 530].map(async size => {
        const data = await sharp(png).resize(size, size).ensureAlpha().raw().toBuffer()
        return jsQR(new Uint8ClampedArray(data), size, size)?.data === links[`${store}QrTarget`]
      }))
      if (checks.every(Boolean)) {
        await writeFile(`public/email-apps/${role}-${platform}.png`, png)
        verified = true
        break
      }
    }
    if (!verified) throw new Error(`No readable branded QR generated for ${role} ${platform}`)
  }
}
console.log('Generated four local app download QR images from the shared public store registry.')
