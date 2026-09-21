import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const entry = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { CalendarEventModal, getFormFromCalendarEvent } from '/src/pages/SessionsPage.jsx';
import '/src/index.css';
const event = { id: 'poll:potm', sourceId: 'potm', sourceType: 'poll', date: '2026-09-20', title: 'Player of the Match closes', href: '/polls', data: { id: 'potm', title: 'Player of the Match', status: 'open', closesAt: '2026-09-20T18:00:00.000Z', options: [{ id: 'alex', label: 'Alex' }, { id: 'blake', label: 'Blake' }, { id: 'casey', label: 'Casey' }], votes: [{ optionId: 'alex' }, { optionId: 'blake', count: 2 }, { optionId: 'casey', count: 2 }] } };
function App() { return <CalendarEventModal isOpen mode="view" event={event} form={getFormFromCalendarEvent(event)} teams={[]} user={{ id: 'staff', roleRank: 50, clubId: 'club' }} onCancel={() => {}} onOpenWorkflow={() => { window.pollOpened = true }} /> }
createRoot(document.getElementById('root')).render(<App />);
`

const server = await createServer({
  cacheDir: 'node_modules/.vite-calendar-poll-modal',
  server: { host: '127.0.0.1', port: 0 },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://fixture.supabase.test'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('fixture-key'),
  },
  plugins: [{
    name: 'calendar-poll-modal',
    enforce: 'pre',
    resolveId(id) { if (id === '/__calendar-poll-modal-entry.jsx') return id },
    load(id) { if (id === '/__calendar-poll-modal-entry.jsx') return entry },
    transform(code, id) {
      if (id.split('?')[0].endsWith('/src/pages/SessionsPage.jsx')) return `${code}\nexport { CalendarEventModal, getFormFromCalendarEvent };`
      if (id.split('?')[0].endsWith('/src/index.css')) return code.replace(/^@import url\([^\n]+\);\r?\n/, '')
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url !== '/calendar-poll-modal.html') return next()
        const html = await vite.transformIndexHtml(request.url, '<!doctype html><html><body><main id="root"></main><script type="module" src="/__calendar-poll-modal-entry.jsx"></script></body></html>')
        response.setHeader('Content-Type', 'text/html')
        response.end(html)
      })
    },
  }],
})

await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/calendar-poll-modal.html`, { timeout: 120000 })

  const results = page.getByTestId('calendar-poll-results')
  await results.waitFor({ timeout: 30000 })
  assert.match(await results.innerText(), /Final results/)
  assert.match(await results.innerText(), /Joint winners: Blake, Casey/)
  assert.doesNotMatch(await page.getByTestId('calendar-event-modal-content').innerText(), /No players have been added/)
  await page.getByRole('button', { name: 'Open poll' }).click()
  assert.equal(await page.evaluate(() => window.pollOpened), true)
  assert.deepEqual(errors, [])
  console.log('PASS: expired Player of the Match calendar deadline shows joint final results and opens Polls.')
} finally {
  await browser.close()
  await server.close()
}
