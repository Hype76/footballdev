import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { chromium } from 'playwright'

const port = 4792
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
  await page.goto(`${baseUrl}/tests/fixtures/plan-insights-browser.html`, { waitUntil: 'networkidle' })

  const usage = page.getByRole('region', { name: 'Plan usage and change preview' })
  await assert.doesNotReject(async () => usage.getByText('Active teams', { exact: true }).waitFor())
  assert.match(await usage.innerText(), /3 \/ 10/)
  assert.match(await usage.innerText(), /40/)

  assert.match(await usage.getByRole('status').innerText(), /2 active teams exceed this allowance/)
  await usage.getByText(/Features no longer included/).click()
  assert.match(await usage.innerText(), /Assessments/)

  await usage.getByLabel('Preview plan').selectOption('team')
  assert.match(await usage.innerText(), /Target allowance: 1 team/)
  await usage.getByLabel('Preview plan').selectOption('club')
  assert.match(await usage.innerText(), /Target allowance: 10 teams/)
  assert.match(await usage.innerText(), /No currently available plan features would be removed/)

  await page.getByRole('button', { name: 'Toggle usage data' }).click()
  assert.match(await page.getByRole('status').innerText(), /Plan usage is unavailable/)
  assert.deepEqual(pageErrors, [])
  console.log('Plan insights browser check passed.')
} finally {
  await browser?.close()
  spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.pid} /T /F`], { stdio: 'ignore' })
}
