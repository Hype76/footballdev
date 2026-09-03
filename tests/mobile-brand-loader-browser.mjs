import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const output = path.join(root, 'output/playwright/brand-loader')
await mkdir(output, { recursive: true })
const appModules = path.join(root, 'apps/parent-mobile/node_modules')
const result = await build({
  stdin: {
    contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { BrandLoader } from './apps/mobile-core/src/BrandLoader.js'
      const root = createRoot(document.getElementById('root'))
      window.unmountLoaders = () => root.unmount()
      root.render(<main>
        <h1>Football Player</h1><p className="intro">The new loading logo</p>
        <div className="examples">
          <section className="light"><BrandLoader size="large" /><strong>Loading your club</strong><p>Parent app</p><button><BrandLoader accessible={false} /></button></section>
          <section className="dark"><BrandLoader size="large" /><strong>Loading Matchday</strong><p>Coach app</p><button><BrandLoader accessible={false} /></button></section>
        </div>
      </main>)`,
    resolveDir: root,
    loader: 'jsx',
  },
  bundle: true,
  jsx: 'automatic',
  write: false,
  format: 'iife',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  alias: {
    'react-native': path.join(appModules, 'react-native-web'),
    react: path.join(appModules, 'react'),
    'react-dom': path.join(appModules, 'react-dom'),
  },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
})
const script = result.outputFiles[0].text
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#eef3f0;color:#11221a;font-family:Arial,sans-serif}main{max-width:660px;margin:0 auto;padding:32px 24px}h1{font-size:24px;margin:0 0 8px}.intro{margin:0 0 28px;color:#50635a}.examples{display:flex;gap:20px}section{flex:1;border-radius:20px;padding:30px 20px;display:flex;align-items:center;flex-direction:column;gap:20px}section.light{background:white}section.dark{background:#08190e;color:#f4faf5}section p{font-size:13px;margin:0;opacity:.7}strong{font-size:15px}button{border:0;border-radius:12px;background:#9ce100;min-height:48px;width:100%;display:flex;align-items:center;justify-content:center} @media(max-width:450px){main{padding:24px 16px}.examples{gap:12px}section{padding:24px 12px}strong{font-size:12px}}
</style></head><body><div id="root"></div><script src="/loader.js"></script></body></html>`
await writeFile(path.join(output, 'preview.html'), html.replace('<script src="/loader.js"></script>', `<script>${script.replaceAll('</script', '<\\/script')}</script>`))
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/loader.js' ? 'application/javascript' : 'text/html')
  response.end(request.url === '/loader.js' ? script : html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 660, height: 470 }, reducedMotion: 'reduce' })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const discs = page.getByTestId('brand-loader-disc')
  await discs.first().waitFor()
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))
  assert.equal(await discs.count(), 4)
  const bounds = await discs.first().evaluate((element) => {
    const s = getComputedStyle(element)
    return { width: s.width, height: s.height, radius: s.borderRadius, overflow: s.overflow, background: s.backgroundColor }
  })
  assert.deepEqual(bounds, { width: '56px', height: '56px', radius: '28px', overflow: 'hidden', background: 'rgb(0, 0, 0)' })
  const transform = () => discs.first().evaluate((element) => getComputedStyle(element).transform)
  const still = await transform()
  await page.waitForTimeout(160)
  assert.equal(await transform(), still, 'Reduce Motion must show a still logo')
  await page.screenshot({ path: path.join(output, 'circular-loaders.png') })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForFunction((previous) => getComputedStyle(document.querySelector('[data-testid="brand-loader-disc"]')).transform !== previous, still)
  assert.match(await transform(), /^matrix3d\(/, 'The logo must turn in 3D around its vertical axis')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(80)
  const paused = await transform()
  await page.waitForTimeout(160)
  assert.equal(await transform(), paused, 'Backgrounding must pause the loader')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForFunction((previous) => getComputedStyle(document.querySelector('[data-testid="brand-loader-disc"]')).transform !== previous, paused)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(80)
  const reduced = await transform()
  await page.waitForTimeout(160)
  assert.equal(await transform(), reduced, 'Changing Reduce Motion while loading must stop the animation')
  await page.setViewportSize({ width: 320, height: 480 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: path.join(output, 'circular-loaders-320.png') })
  await page.evaluate(() => window.unmountLoaders())
  assert.equal(await discs.count(), 0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  assert.deepEqual(errors, [])
  for (const file of ['apps/mobile-core/src/ui.js', 'apps/parent-mobile/App.js', 'apps/coach-mobile/App.js', 'apps/coach-mobile/src/CoachFormationBoard.js', 'apps/coach-mobile/src/CoachFormationScreen.js', 'apps/coach-mobile/src/CoachMatchDayScreen.js', 'apps/coach-mobile/src/CoachOperationalScreens.js']) {
    assert.equal((await readFile(path.join(root, file), 'utf8')).includes('ActivityIndicator'), false, `${file} must use the branded loader`)
  }
  console.log('PASS: circular crop, two sizes in four placements, 3D rotation, reduced motion, background pause/resume, unmount cleanup, 320px layout and spinner replacement coverage.')
} catch (error) {
  if (errors.length) console.error('Browser errors:', errors)
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
