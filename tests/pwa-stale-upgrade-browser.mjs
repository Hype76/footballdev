import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { access, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const [oldDistArgument, newDistArgument, outputArgument] = process.argv.slice(2)

if (!oldDistArgument || !newDistArgument) {
  throw new Error('Usage: node tests/pwa-stale-upgrade-browser.mjs <old-dist> <new-dist> [output-dir]')
}

const oldDist = path.resolve(oldDistArgument)
const newDist = path.resolve(newDistArgument)
const outputDir = path.resolve(outputArgument || 'output/playwright/pwa-stale-upgrade')
let activeDist = oldDist

await Promise.all([
  access(path.join(oldDist, 'index.html')),
  access(path.join(oldDist, 'sw.js')),
  access(path.join(newDist, 'index.html')),
  access(path.join(newDist, 'sw.js')),
])
await mkdir(outputDir, { recursive: true })

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
])

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
    const requestPath = decodeURIComponent(requestUrl.pathname)
    const relativePath = requestPath === '/'
      ? 'index.html'
      : requestPath.replace(/^\/+/, '')
    const candidatePath = path.resolve(activeDist, relativePath)
    const relativeCandidate = path.relative(activeDist, candidatePath)
    const isInsideActiveDist =
      relativeCandidate !== '..' &&
      !relativeCandidate.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeCandidate)
    let filePath = isInsideActiveDist ? candidatePath : path.join(activeDist, 'index.html')

    if (isInsideActiveDist) {
      try {
        const fileStat = await stat(filePath)
        if (!fileStat.isFile()) {
          filePath = path.join(activeDist, 'index.html')
        }
      } catch {
        filePath = path.join(activeDist, 'index.html')
      }
    }

    const extension = path.extname(filePath).toLowerCase()
    response.setHeader('Content-Type', mimeTypes.get(extension) || 'application/octet-stream')

    if (filePath.endsWith(`${path.sep}sw.js`) || filePath.endsWith(`${path.sep}index.html`)) {
      response.setHeader('Cache-Control', 'no-store')
    }

    if (filePath.endsWith(`${path.sep}sw.js`)) {
      response.setHeader('Service-Worker-Allowed', '/')
    }

    response.end(await readFile(filePath))
  } catch (error) {
    response.statusCode = 500
    response.end(String(error?.message || 'Fixture server error'))
  }
})

await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', resolve)
})

const address = server.address()
const origin = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  serviceWorkers: 'allow',
})
const page = await context.newPage()
const consoleErrors = []
let currentPhase = 'browser-launched'
const watchdog = setTimeout(() => {
  console.error(JSON.stringify({
    phase: currentPhase,
    timedOut: true,
  }))
  process.exitCode = 1
  server.closeAllConnections?.()
  void browser.close().finally(() => process.exit(1))
}, 45_000)

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text())
  }
})

try {
  currentPhase = 'opening-old-build'
  console.log(JSON.stringify({ phase: 'opening-old-build', origin }))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
    undefined,
    { timeout: 15_000 },
  )
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Old service worker did not become ready.')), 15_000)
      }),
    ])
  })

  const oldEntryUrl = await page.locator('script[type="module"][src]').getAttribute('src')
  assert.match(oldEntryUrl || '', /\/assets\/index-[^/]+\.js$/)

  currentPhase = 'requesting-candidate-update'
  console.log(JSON.stringify({ oldEntryUrl, phase: 'requesting-candidate-update' }))
  activeDist = newDist
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    void registration.update()
  })

  await page.waitForFunction(
    (previousEntryUrl) => {
      const currentEntryUrl = document.querySelector('script[type="module"][src]')?.getAttribute('src')
      return Boolean(currentEntryUrl && currentEntryUrl !== previousEntryUrl)
    },
    oldEntryUrl,
    { timeout: 15_000 },
  )

  const newEntryUrl = await page.locator('script[type="module"][src]').getAttribute('src')
  assert.match(newEntryUrl || '', /\/assets\/index-[^/]+\.js$/)
  assert.notEqual(newEntryUrl, oldEntryUrl)
  assert.equal(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js') === true),
    true,
  )

  const navigationCountBeforeSameVersionCheck = await page.evaluate(() => performance.getEntriesByType('navigation').length)
  currentPhase = 'checking-same-version-update'
  console.log(JSON.stringify({ newEntryUrl, phase: 'checking-same-version-update' }))
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    void registration.update()
  })
  await page.waitForTimeout(1_500)
  const navigationCountAfterSameVersionCheck = await page.evaluate(() => performance.getEntriesByType('navigation').length)

  assert.equal(navigationCountAfterSameVersionCheck, navigationCountBeforeSameVersionCheck)
  await page.screenshot({
    path: path.join(outputDir, 'candidate-after-stale-pwa-upgrade.png'),
    fullPage: true,
  })

  console.log(JSON.stringify({
    consoleErrors: consoleErrors.length,
    newEntryUrl,
    oldEntryUrl,
    staleClientRecovered: true,
    sameVersionReloaded: false,
    serviceWorkerControlled: true,
  }))
} finally {
  clearTimeout(watchdog)
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  server.closeAllConnections?.()
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}
