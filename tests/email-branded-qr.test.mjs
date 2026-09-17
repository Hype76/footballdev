import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import jsQR from 'jsqr'
import { APP_DOWNLOAD_LINKS } from '../src/lib/app-download-links.js'

for (const [role, links] of Object.entries(APP_DOWNLOAD_LINKS)) {
  for (const [store, platform] of [['apple', 'ios'], ['android', 'android']]) {
    test(`${role} ${platform} branded QR decodes at email display sizes`, async () => {
      const png = await readFile(`public/email-apps/${role}-${platform}.png`)
      const redirects = await readFile('public/_redirects', 'utf8')
      assert.ok(redirects.includes(`${new URL(links[`${store}QrTarget`]).pathname} ${links[store]} 302`))
      for (const size of [112, 136, 272, 530]) {
        const { data, info } = await sharp(png).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height)
        assert.equal(decoded?.data, links[`${store}QrTarget`], `${role} ${platform} at ${size}px`)
      }
    })
  }
}

test('only public email QR images opt into cross-origin embedding', async () => {
  const config = await readFile('netlify.toml', 'utf8')
  assert.match(config, /for = "\/email-apps\/\*"\s+\[headers.values\]\s+Cross-Origin-Resource-Policy = "cross-origin"/)
  assert.match(config, /Cross-Origin-Resource-Policy = "same-origin"/)
})

