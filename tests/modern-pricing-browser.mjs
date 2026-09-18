import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { chromium } from 'playwright'

const port = 4791
const baseUrl = `http://127.0.0.1:${port}`
const waitForPort = () => new Promise((resolve, reject) => {
  const started = Date.now()
  const attempt = () => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolve() })
    socket.once('error', () => { socket.destroy(); if (Date.now() - started > 30000) reject(new Error('Vite did not start')); else setTimeout(attempt, 100) })
  }
  attempt()
})
const server = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`], { cwd: process.cwd(), env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore' })
let browser
try {
  await waitForPort()
  browser = await chromium.launch()
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${baseUrl}/tests/fixtures/modern-pricing-browser.html`, { waitUntil: 'networkidle' })
  assert.equal(await page.getByLabel('Team capacity').inputValue(), '30')
  assert.match(await page.locator('[aria-live="polite"]').innerText(), /£159\.79 per month/)
  await page.getByRole('button', { name: 'Annual' }).click()
  assert.match(await page.locator('[aria-live="polite"]').innerText(), /£1,597\.90 per year/)
  await page.getByLabel('Team capacity').selectOption('40')
  assert.match(await page.locator('[aria-live="polite"]').innerText(), /£2,096\.90 per year/)
  await page.getByRole('button', { name: 'team', exact: true }).click()
  assert.match(await page.locator('[aria-live="polite"]').innerText(), /£7\.99 per month/)
  assert.deepEqual(pageErrors, [])
  console.log('Modern pricing browser check passed.')
} finally {
  await browser?.close()
  spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.pid} /T /F`], { stdio: 'ignore' })
}
