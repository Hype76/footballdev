import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import puppeteer from 'puppeteer-core'
import { buildPdfBuffer, buildProgressionChartPngBuffer, countPdfPages, getActivePdfRenderCount } from '../src/lib/pdf-builder.js'
import { buildParentMessagePdfDocument } from '../src/lib/pdf-document.js'

const document = buildParentMessagePdfDocument({
  clubName: 'Example Club', playerName: 'Example Player', teamName: 'Under 12',
  subject: 'Fixture update', body: 'Please bring both kits.', assessmentFields: [],
})
const launchBrowser = () => puppeteer.launch({
  executablePath: chromium.executablePath(), headless: true, args: ['--no-sandbox'],
})
const pdf = await buildPdfBuffer(document, { launchBrowser })
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
assert.equal(countPdfPages(pdf), 1)
const png = await buildProgressionChartPngBuffer([
  { label: 'First', value: 5 }, { label: 'Second', value: 7 },
], { launchBrowser })
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
assert.equal(getActivePdfRenderCount(), 0)
console.log('PASS: updated Puppeteer renders the protected PDF and progression PNG paths with complete cleanup')
