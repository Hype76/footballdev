import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'node_modules')

function webFeedbackMocks() {
  return {
    name: 'web-feedback-mocks',
    setup(builder) {
      builder.onResolve({ filter: /domain[\\/]tester-feedback\.js$/ }, () => ({ path: 'tester-feedback-fixture', namespace: 'web-feedback-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'web-feedback-fixture' }, () => ({
        contents: 'export async function createTesterFeedbackReport({ report }) { return await globalThis.__submitFeedback(report) }',
        loader: 'js',
      }))
    },
  }
}

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { UserFeedbackPage } from './src/pages/UserFeedbackPage.jsx';
import { UserFeedbackLinks } from './src/components/layout/UserFeedbackLinks.jsx';
function FixtureApp() { const navigate = useNavigate(); window.setFeedbackType = (type) => navigate('/feedback/send?type=' + type); return <><UserFeedbackLinks /><UserFeedbackPage /></>; }
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/feedback/send?type=suggestion']}><FixtureApp /></MemoryRouter>);
`

const result = await build({
  plugins: [webFeedbackMocks()],
  stdin: { contents: entry, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, platform: 'browser',
  conditions: ['browser'], mainFields: ['browser', 'module', 'main'], resolveExtensions: ['.web.js', '.js', '.jsx', '.json'],
  nodePaths: [modules], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(5000)
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>')
  await page.addScriptTag({ content: result.outputFiles[0].text })

  const calls = []
  let mode = 'success'
  let resolveSave
  await page.exposeFunction('submitFeedbackFixture', async (report) => {
    calls.push(report)
    if (mode === 'pending') return new Promise((resolve) => { resolveSave = resolve })
    if (mode === 'failure') throw new Error('Save failed')
    return { id: 'fixture-report-id' }
  })
  await page.evaluate(() => { window.__submitFeedback = (report) => window.submitFeedbackFixture(report) })

  assert.equal(await page.getByRole('link', { name: 'Feedback & Suggestions' }).getAttribute('href'), '/feedback/send?type=suggestion')
  assert.equal(await page.getByRole('link', { name: 'Report a Bug' }).getAttribute('href'), '/feedback/send?type=bug')
  assert.equal(await page.getByLabel('Subject').getAttribute('required'), '')
  assert.equal(await page.getByLabel('Message').getAttribute('required'), '')

  await page.getByLabel('Subject').fill('Add a filter')
  await page.getByLabel('Message').fill('Please add a player filter.')
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Thank you'))
  assert.deepEqual(calls[0], {
    feedbackType: 'suggestion', title: 'Add a filter', summary: 'Please add a player filter.', phase: 'production', severity: 'medium',
    module: 'Other', route: '/more/feedback', browserDevice: await page.evaluate(() => navigator.userAgent),
  })
  assert.equal(await page.locator('form').count(), 0)
  assert.equal(await page.getByText('fixture-report-id').count(), 0)
  assert.equal(await page.getByText(/report history|history|id/i).count(), 0)

  await page.evaluate(() => window.setFeedbackType('bug'))
  await page.getByRole('heading', { name: 'Report a Bug' }).waitFor()
  assert.equal(await page.getByLabel('Subject').inputValue(), '')
  assert.equal(await page.getByLabel('Message').inputValue(), '')
  await page.getByLabel('Subject').fill('Save crash')
  await page.getByLabel('Message').fill('Saving crashes.')
  mode = 'failure'
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Save failed'))
  assert.equal(await page.getByLabel('Subject').inputValue(), 'Save crash')
  assert.equal(await page.getByLabel('Message').inputValue(), 'Saving crashes.')

  mode = 'pending'
  const beforeDuplicate = calls.length
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.getByRole('button', { name: 'Submitting...' }).click({ force: true }).catch(() => {})
  assert.equal(calls.length, beforeDuplicate + 1)
  assert.equal(await page.getByRole('button', { name: 'Submitting...' }).isDisabled(), true)
  resolveSave({ id: 'fixture-report-id-2' })
  await page.waitForFunction(() => document.body.innerText.includes('Thank you'))

  await page.evaluate(() => window.setFeedbackType('suggestion'))
  await page.getByRole('heading', { name: 'Feedback & Suggestions' }).waitFor()
  await page.getByLabel('Subject').fill('Mobile width')
  await page.getByLabel('Message').fill('Fits at phone width.')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.setViewportSize({ width: 320, height: 700 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  console.log('PASS: user-feedback-web-browser covers web payloads, success/failure states, duplicate guard, type reset, navigation links, accessibility, and 320px layout')
} finally {
  await browser.close()
}
