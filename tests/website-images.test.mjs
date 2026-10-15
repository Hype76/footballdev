import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import jsQR from 'jsqr'

const assets = 'public/marketing-v70/assets'
const walk = async directory => (await Promise.all((await fs.readdir(directory, { withFileTypes: true })).map(entry => {
  const file = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(file) : file
}))).flat()

test('marketing raster images use valid WebP files and reduce total transfer size', async () => {
  const originals = (await walk(assets)).filter(file => /\.(png|jpe?g)$/i.test(file))
  let before = 0, after = 0
  for (const original of originals) {
    const target = original.replace(/\.(png|jpe?g)$/i, '.webp')
    assert.equal((await sharp(target).metadata()).format, 'webp', target)
    before += (await fs.stat(original)).size
    after += (await fs.stat(target)).size
    if (original.endsWith('.png')) {
      // Fully transparent RGB values are not visible and WebP may discard them.
      const pixels = async file => createHash('sha256').update(await sharp(file).flatten({ background: '#ffffff' }).raw().toBuffer()).digest('hex')
      assert.equal(await pixels(target), await pixels(original), `Lossless visible pixels: ${target}`)
    }
  }
  assert.ok(after < before * 0.7, `Expected substantial savings: ${before} -> ${after}`)
  const pages = JSON.parse(await fs.readFile('src/components/marketing/reference-pages.json', 'utf8'))
  for (const [name, page] of Object.entries(pages)) {
    assert.doesNotMatch(page.html, /\/marketing-v70\/assets\/[^"\s<>]+\.(?:png|jpe?g)(?:[?"\s])/i, name)
    for (const url of page.html.matchAll(/\/marketing-v70\/assets\/[^"\s<>?,]+\.webp/g)) {
      await fs.access('public' + url[0])
    }
  }
  console.log(JSON.stringify({ images: originals.length, before, after, reductionPercent: Math.round((1 - after / before) * 100) }))
})

test('all converted app QR codes decode to their original store URLs', async () => {
  for (const name of ['coach-ios', 'coach-android', 'parent-ios', 'parent-android']) {
    const decode = async extension => {
      const { data, info } = await sharp(`${assets}/${name}-qr.${extension}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data
    }
    const original = await decode('png')
    assert.ok(original, name)
    assert.equal(await decode('webp'), original, name)
  }
})
