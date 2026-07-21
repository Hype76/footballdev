import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

import {
  assertBrowserCompatibleInlineCsp,
  createBrowserCspHash,
} from '../scripts/csp-inline-integrity.mjs'

const baseUrl = String(process.env.SECURITY_SMOKE_BASE_URL || 'http://127.0.0.1:8888').replace(/\/$/, '')

const builtHtml = readFileSync('dist/index.html', 'utf8')
const netlifyConfig = readFileSync('netlify.toml', 'utf8')
const processingSection = netlifyConfig.match(/\[build\.processing\.html\]([\s\S]*?)(?=\n\[|$)/)?.[1] || ''
assert.match(processingSection, /^\s*pretty_urls\s*=\s*false\s*$/m)
assert.doesNotMatch(processingSection, /pretty_urls\s*=\s*true/)

const cspResult = assertBrowserCompatibleInlineCsp({ html: builtHtml, netlifyConfig })

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
  const browserScriptTexts = await page.locator('script:not([src])').evaluateAll(
    (scripts) => scripts.map((script) => script.textContent || ''),
  )
  const browserHashes = browserScriptTexts.map(createBrowserCspHash).sort()
  assert.deepEqual(browserScriptTexts, cspResult.normalizedScripts)
  assert.deepEqual(browserHashes, cspResult.configuredHashes)
  assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth + 1), true)
  const policyErrors = consoleErrors
    .filter((message) => /content security policy|refused to/i.test(message))
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
