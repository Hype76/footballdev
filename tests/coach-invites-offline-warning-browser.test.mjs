import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const source = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
function declaration(name) {
  const node = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id?.name === name)
  assert.ok(node, `Missing actual ${name} implementation`)
  return source.slice(node.start, node.end)
}
const warning = source.match(/message: `(Offline copy unavailable\.[^`]+)`/)?.[1]
assert.ok(warning, 'Missing actual offline warning')
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text, Pressable, StyleSheet } from 'react-native-web';
import { createCoachTheme } from './src/coachThemeCore.js';
${declaration('phaseStyles')}
${declaration('CoachOfflineCopyWarning')}
const mode = new URLSearchParams(location.search).get('mode');
const palette = createCoachTheme({ mode }).tokens;
document.body.style.backgroundColor = palette.background;
window.retries = 0;
createRoot(document.getElementById('root')).render(<CoachOfflineCopyWarning
  message={${JSON.stringify(warning)}.replace('${'${reference}'}', 'ACCESS')}
  onRetry={() => { window.retries += 1 }} palette={palette} styles={phaseStyles(palette)} />);
`
const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../apps/coach-mobile/', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' })
const server = createServer((request, response) => {
  if (request.url.startsWith('/test.js')) { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(bundle.outputFiles[0].text); return }
  response.writeHead(200, { 'Content-Type': 'text/html' })
  response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:16px}</style><div id="root"></div><script src="/test.js"></script>')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const browser = await chromium.launch({ headless: true })
test.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)) })

for (const width of [320, 390]) for (const mode of ['light', 'dark']) {
  test(`offline warning is readable and retryable at ${width}px in ${mode} mode`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 700 }, colorScheme: mode })
    const dialogs = []
    page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss() })
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`)
      const status = page.getByText(/Offline copy unavailable/)
      const retry = page.getByRole('button', { name: 'Retry saving offline copy' })
      await status.waitFor({ state: 'visible' })
      assert.match(await status.innerText(), /Reference: ACCESS/)
      assert.doesNotMatch(await page.locator('body').innerText(), /private player|confidential@example\.test|offline_context_scope_mismatch/i)
      const metrics = await page.evaluate(() => {
        const status = [...document.querySelectorAll('*')].find(element => element.textContent?.startsWith('Offline copy unavailable') && element.childElementCount === 0)
        const button = document.querySelector('[aria-label="Retry saving offline copy"]')
        const rect = element => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width, height: box.height } }
        const colour = getComputedStyle(status).color.match(/[\d.]+/g).slice(0, 3).map(Number)
        const bg = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number)
        const luminance = values => values.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0)
        const a = luminance(colour), b = luminance(bg)
        return { warning: rect(status), retry: rect(button), font: parseFloat(getComputedStyle(status).fontSize), contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), scrollWidth: document.documentElement.scrollWidth, innerWidth }
      })
      assert.ok(metrics.warning.width > 80 && metrics.warning.height >= 20)
      assert.ok(metrics.warning.left >= 0 && metrics.warning.right <= width && metrics.retry.right <= width)
      assert.ok(metrics.retry.width >= 44 && metrics.retry.height >= 44)
      assert.ok(metrics.font >= 14 && metrics.contrast >= 4.5, JSON.stringify(metrics))
      assert.ok(metrics.scrollWidth <= metrics.innerWidth)
      assert.equal(await page.locator('[role="dialog"], [aria-modal="true"]').count(), 0)
      await retry.click()
      assert.equal(await page.evaluate(() => window.retries), 1)
      assert.deepEqual(dialogs, [])
    } finally { await page.close() }
  })
}
