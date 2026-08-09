import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { chromium } from 'playwright'

const port = 4785
const baseUrl = `http://127.0.0.1:${port}`

function waitForPort(host, targetPort, timeoutMs = 30000) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port: targetPort })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Vite did not start on ${host}:${targetPort}.`))
          return
        }
        setTimeout(attempt, 100)
      })
    }

    attempt()
  })
}

const command = `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`
const server = process.platform === 'win32'
  ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
      },
      stdio: 'ignore',
    })
  : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    })

let browser

try {
  await waitForPort('127.0.0.1', port)
  browser = await chromium.launch()
  const page = await browser.newPage()
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto(`${baseUrl}/tests/fixtures/billing-access-window-browser.html`, { waitUntil: 'networkidle' })
  const arrangement = page.getByLabel('Billing arrangement')
  const startDate = page.getByLabel('Billing start date')
  const save = page.getByRole('button', { name: 'Save billing access' })

  await arrangement.selectOption('immediate')
  assert.equal(await startDate.inputValue(), '')
  assert.equal(await startDate.isDisabled(), true)
  await save.click()

  await arrangement.selectOption('complimentary')
  assert.equal(await startDate.inputValue(), '')
  assert.equal(await startDate.isDisabled(), true)
  await save.click()

  await arrangement.selectOption('deferred')
  assert.equal(await startDate.isEnabled(), true)
  await save.click()
  await page.getByRole('alert').getByText('Choose a billing start date before saving Deferred access.').waitFor()
  await startDate.fill('2027-02-15')
  await save.click()

  const calls = await page.evaluate(() => window.billingSaveCalls)
  assert.deepEqual(calls, [
    { fieldName: 'billingConfiguration', value: { billingArrangement: 'immediate', billingStartDate: null } },
    { fieldName: 'billingConfiguration', value: { billingArrangement: 'complimentary', billingStartDate: null } },
    { fieldName: 'billingConfiguration', value: { billingArrangement: 'deferred', billingStartDate: '2027-02-15' } },
  ])
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(consoleErrors, [])
  console.log('Billing access browser matrix passed with one atomic request per save.')
} finally {
  await browser?.close()
  if (process.platform === 'win32' && server.pid) {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.kill()
  }
}
