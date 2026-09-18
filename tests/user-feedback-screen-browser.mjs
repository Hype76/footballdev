import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')

function mobileFeedbackMocks() {
  return {
    name: 'mobile-feedback-mocks',
    setup(builder) {
      builder.onResolve({ filter: /(?:^\.\/supabase$|^\.\/config$|^\.\/http$)/ }, (args) => ({
        path: args.path.slice(2),
        namespace: 'mobile-feedback-fixture',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'mobile-feedback-fixture' }, (args) => {
        const contents = args.path === 'supabase'
          ? 'export async function getAccessToken() { return "fixture-token" }'
          : args.path === 'config'
            ? 'export function getMobileRuntimeConfig() { return { apiBaseUrl: "https://fixture.invalid" } }'
            : 'export function joinApiPath(base, path) { return `${base}/${path}` }\nexport async function fetchJsonWithTimeout() { return await globalThis.__submitFeedback() }'
        return { contents, loader: 'js' }
      })
    },
  }
}

const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text } from 'react-native';
import { UserFeedbackScreen } from './apps/mobile-core/src/UserFeedbackScreen.js';
function App() {
  const [type, setType] = useState('feedback');
  window.setFeedbackType = setType;
  return <View style={{ padding: 8, width: '100%' }}><UserFeedbackScreen key={type} type={type} appRole="coach" textStyle={{}} headingStyle={{}} /></View>;
}
createRoot(document.getElementById('root')).render(<App />);
`

const result = await build({
  plugins: [mobileFeedbackMocks()],
  stdin: { contents: entry, resolveDir: root, loader: 'jsx' },
  bundle: true,
  write: false,
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  platform: 'browser',
  conditions: ['browser'],
  mainFields: ['browser', 'module', 'main'],
  resolveExtensions: ['.web.js', '.js', '.jsx', '.json'],
  nodePaths: [modules],
  alias: {
    'react-native': path.join(modules, 'react-native-web'),
    react: path.join(modules, 'react'),
    'react-dom': path.join(modules, 'react-dom'),
  },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 } })
  page.setDefaultTimeout(3000)
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  let calls = 0
  let resolveSave
  await page.exposeFunction('submitFeedbackFixture', async () => {
    calls += 1
    return new Promise((resolve) => { resolveSave = resolve })
  })

  for (const type of ['feedback', 'bug']) {
    await page.evaluate((nextType) => window.setFeedbackType(nextType), type)
    const heading = type === 'bug' ? 'Report a Bug' : 'Feedback & Suggestions'
    await page.getByRole('heading', { name: heading }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)

    await page.getByLabel('Subject').fill(`${type} subject`)
    await page.getByLabel('Message').fill(`${type} message`)
    calls = 0
    await page.evaluate(() => {
      window.__submitFeedback = () => window.submitFeedbackFixture()
    })
    await page.evaluate(() => {
      const submit = [...document.querySelectorAll('*')].find((node) => node.textContent === 'Submit')
      for (let index = 0; index < 2; index += 1) submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    assert.equal(calls, 1)
    await page.waitForFunction(() => {
      const input = document.querySelector('[aria-label="Subject"]')
      return input?.disabled || input?.getAttribute('aria-disabled') === 'true' || input?.readOnly
    })
    resolveSave({ ok: true, result: { success: true } })
    await page.getByRole('heading', { name: 'Thank you' }).waitFor()
    assert.equal(await page.getByText(/subject|message/i).count(), 0)
  }

  await page.evaluate(() => window.setFeedbackType('feedback'))
  await page.getByRole('heading', { name: 'Feedback & Suggestions' }).waitFor()
  await page.getByLabel('Subject').fill('Keep this subject')
  await page.getByLabel('Message').fill('Keep this message')
  await page.evaluate(() => {
    window.__submitFeedback = async () => ({ ok: false, result: { success: false, message: 'Save failed' } })
  })
  await page.getByText('Submit', { exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByLabel('Subject').inputValue(), 'Keep this subject')
  assert.equal(await page.getByLabel('Message').inputValue(), 'Keep this message')
  assert.equal(await page.getByText('Save failed').count(), 1)
  console.log('PASS: UserFeedbackScreen covers feedback and bug success, failed-save preservation, double-submit guard, and 320px layout')
} finally {
  await browser.close()
}
