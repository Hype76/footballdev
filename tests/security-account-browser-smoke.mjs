import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const baseUrl = String(process.env.SECURITY_SMOKE_BASE_URL || 'http://127.0.0.1:8888').replace(/\/$/, '')
const localNetlifyDevInlineHash = 'sha256-gFxI4Ow5y43sJk7XGw6ATe67pBxbTSHUs2uHBtyURyw='

const builtHtml = readFileSync('dist/index.html', 'utf8')
const netlifyConfig = readFileSync('netlify.toml', 'utf8')
const builtInlineScripts = [...builtHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
assert.ok(builtInlineScripts.length > 0, 'The built application must expose its inline scripts for CSP verification')
for (const script of builtInlineScripts) {
  const hash = `sha256-${createHash('sha256').update(script[1]).digest('base64')}`
  assert.ok(netlifyConfig.includes(`'${hash}'`), `The built inline script hash ${hash} must be allowed by CSP`)
}

async function smokeViewport(browser, { height, label, width }) {
  const context = await browser.newContext({ viewport: { height, width } })
  const page = await context.newPage()
  const consoleErrors = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })

  const response = await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'networkidle' })
  assert.equal(response?.ok(), true, `${label} sign-in response must be successful`)
  await page.getByRole('button', { name: /log in/i }).first().waitFor()
  assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth + 1), true)
  const policyErrors = consoleErrors
    .filter((message) => /content security policy|refused to/i.test(message))
    .filter((message) => !(baseUrl.startsWith('http://127.0.0.1:') && message.includes(localNetlifyDevInlineHash)))
  assert.deepEqual(policyErrors, [], policyErrors.join('\n'))
  await context.close()

  return { height, label, width }
}

const browser = await chromium.launch({ headless: true })

try {
  const desktop = await smokeViewport(browser, { height: 900, label: 'desktop', width: 1440 })
  const mobile = await smokeViewport(browser, { height: 844, label: 'mobile', width: 390 })
  const request = await browser.newContext()
  const manifestResponse = await request.request.get(`${baseUrl}/manifest.webmanifest`)
  const serviceWorkerResponse = await request.request.get(`${baseUrl}/sw.js`)
  const manifestText = await manifestResponse.text()

  assert.equal(manifestResponse.ok(), true)
  assert.match(manifestResponse.headers()['content-type'] || '', /^application\/manifest\+json\b/i)
  assert.doesNotThrow(() => JSON.parse(manifestText))
  assert.equal(serviceWorkerResponse.ok(), true)
  assert.match(serviceWorkerResponse.headers()['content-type'] || '', /javascript/i)
  assert.match(manifestResponse.headers()['content-security-policy'] || '', /frame-ancestors 'none'/)

  console.log(JSON.stringify({ desktop, manifest: 'ok', mobile, serviceWorker: 'ok' }))
  await request.close()
} finally {
  await browser.close()
}
