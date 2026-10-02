import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{CoachReminderOptions}from'/src/components/coach-reminders/CoachReminderOptions.jsx';
import{normalizeCoachReminderPolicy}from'/src/lib/coach-reminder-policy.js';import'/src/index.css';
window.changes=[];function App(){const[value,setValue]=useState(),[disabled,setDisabled]=useState(false),[error,setError]=useState('');
window.disable=setDisabled;return <main style={{padding:16,maxWidth:640}}><CoachReminderOptions value={value} disabled={disabled} error={error}
onChange={next=>{window.changes.push(next);setValue(next);try{normalizeCoachReminderPolicy(next);setError('')}catch(e){setError(e.message)}}}/></main>};
createRoot(document.getElementById('root')).render(<App/>);`
const server = await createServer({
  cacheDir: 'node_modules/.vite-reminder-options',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'reminder-options-fixture',
    resolveId(id) { if (id === '/__reminder-options.jsx') return id },
    load(id) { if (id === '/__reminder-options.jsx') return entry },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url !== '/reminder-options.html') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__reminder-options.jsx"></script></body></html>'))
    }) },
  }],
})
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/reminder-options.html`)
  const automatic = page.getByRole('checkbox', { name: 'Automatically remind players with no answer' })
  const squad = page.getByRole('checkbox', { name: 'Remind team coaches when the match squad is unselected' })
  await automatic.waitFor()
  assert.equal(await automatic.isChecked(), false)
  assert.equal(await squad.isChecked(), false)
  assert.equal(await page.getByLabel('Deadline option').inputValue(), 'reminders_only')
  assert.equal(await page.getByLabel('Reminder hours').count(), 0)
  await automatic.check()
  await page.getByLabel('Reminder hours').fill('12')
  await page.getByLabel('Deadline option').selectOption('exclude_from_planning')
  await page.getByLabel('Deadline hours').fill('6')
  await page.getByRole('alert').filter({ hasText: 'The reminder must be earlier' }).waitFor()
  await page.getByLabel('Deadline hours').fill('48')
  assert.equal(await page.getByRole('alert').count(), 0)
  await page.getByLabel('Deadline option').selectOption('automatic_not_attending')
  await page.getByText('Automatic not attending is labelled as a coach deadline action. Explicit answers stay unchanged.').waitFor()
  await squad.check()
  await page.getByLabel('Squad reminder days').fill('3')
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 850 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}`)
    const heights = await page.locator('input[type="number"], select').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
    assert.ok(heights.every(height => height >= 44))
  }
  await page.evaluate(() => window.disable(true))
  assert.equal(await automatic.isDisabled(), true)
  assert.equal(await page.getByLabel('Deadline option').isDisabled(), true)
  await page.evaluate(() => window.disable(false))
  for (let i = 0; i < 6; i++) { await automatic.click(); await squad.click() }
  assert.equal(await automatic.isChecked(), true)
  assert.equal(await squad.isChecked(), true)
  await automatic.uncheck(); await squad.uncheck()
  await page.getByLabel('Deadline option').selectOption('reminders_only')
  assert.equal(await page.getByLabel('Reminder hours').count(), 0)
  assert.equal(await page.getByLabel('Deadline hours').count(), 0)
  assert.equal(await page.getByLabel('Squad reminder days').count(), 0)
  await automatic.check(); await squad.check()
  assert.equal(await page.getByLabel('Reminder hours').inputValue(), '12', 'Opt-out retains chosen hours for a later explicit enable')
  assert.equal(await page.getByLabel('Squad reminder days').inputValue(), '3')
  await page.setViewportSize({ width: 390, height: 850 })
  await mkdir('output/playwright/coach-reminder-options', { recursive: true })
  await page.screenshot({ path: 'output/playwright/coach-reminder-options/mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: reminder option editor defaults, all modes, validation, repeat clicks, opt-out, retained values, disabled controls and 320/390/1280 layout.')
} finally { await browser.close(); await server.close() }
