import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const source = await readFile('src/components/platform/PlatformPartnersSection.jsx', 'utf8')
const css = await readFile('src/components/platform/partners.css', 'utf8')
const functions = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
  .map((node) => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
  .filter((node) => node?.type === 'FunctionDeclaration')
const selected = ['ReferralOfferIcon', 'CoachReferralOfferSummary'].map((name) => {
  const node = functions.find((candidate) => candidate.id.name === name)
  assert.ok(node, `${name} must exist`)
  return source.slice(node.start, node.end)
}).join('\n')
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {COACH_CLUB_PROMOTION_TERMS} from './src/lib/coach-club-promotion.js';
${selected}
createRoot(document.getElementById('root')).render(<main className="partners-admin"><CoachReferralOfferSummary/></main>);
`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 720 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:20px;background:#f5f8f6"><div id="root"></div></body></html>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await mkdir('output/playwright/platform-partners-coach-referral', { recursive: true })
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 720 })
    const summary = page.locator('section.partner-referral-summary')
    await page.waitForTimeout(250)
    assert.equal(await summary.count(), 1, `Coach referral summary did not render. Page errors: ${errors.join(' | ')}. Body: ${await page.locator('body').innerText()}`)
    await page.getByRole('heading', { name: 'Give a club 50% off', exact: true }).waitFor()
    assert.match(await summary.innerText(), /50% off the first 3 monthly payments/)
    assert.match(await summary.innerText(), /Coach app > Partners and Special Offers/)
    assert.equal(await summary.getByRole('button').count(), 0)
    assert.equal(await summary.locator('.partner-referral-icon svg').count(), 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `output/playwright/platform-partners-coach-referral/${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('PASS: Platform Partners shows the fixed Coach referral offer, exact shared terms and custom icon at 390/1280px')
} finally {
  await browser.close()
}
