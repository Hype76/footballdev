import { mkdir } from 'node:fs/promises'
import QRCode from 'qrcode'
import { APP_DOWNLOAD_LINKS } from '../src/lib/app-download-links.js'

await mkdir('public/email-apps', { recursive: true })
for (const [role, links] of Object.entries(APP_DOWNLOAD_LINKS)) {
  for (const [store, platform] of [['apple', 'ios'], ['android', 'android']]) {
    await QRCode.toFile(`public/email-apps/${role}-${platform}.png`, links[store], { width: 400, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
  }
}
console.log('Generated four local app download QR images from the shared public store registry.')
