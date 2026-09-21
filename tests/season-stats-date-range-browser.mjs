import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const currentDate = new Date()
const defaultStartYear = currentDate.getMonth() < 6 ? currentDate.getFullYear() - 1 : currentDate.getFullYear()
const defaultStartDate = `${defaultStartYear}-07-01`
const defaultEndDate = `${defaultStartYear + 1}-06-30`
const replacementStartDate = `${defaultStartYear - 1}-07-01`
const invalidStartDate = `${defaultStartYear + 2}-07-01`

const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {EndSeasonStatsPage} from '/src/pages/EndSeasonStatsPage.jsx';
import '/src/index.css';
window.__user={id:'manager',clubId:'club',role:'admin',roleRank:100,activeTeamId:''};
window.requests=[];
window.responses=[
  new Promise(resolve=>{window.resolveInitial=()=>resolve([{playerId:'old',playerName:'Old Player',teamId:'team-1',teamName:'Test U14',goals:99,assists:0,motmVotes:0}])}),
  new Promise(resolve=>{window.resolveNext=()=>resolve([{playerId:'new',playerName:'New Player',teamId:'team-1',teamName:'Test U14',goals:2,assists:1,motmVotes:1}])}),
];
createRoot(document.getElementById('root')).render(<EndSeasonStatsPage/>);
`

const server = await createServer({
  cacheDir: 'node_modules/.vite-season-stats-range',
  server: { host: '127.0.0.1', port: 0 },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://fixture.supabase.test'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('fixture-key'),
  },
  plugins: [{
    name: 'render-season-stats-range',
    enforce: 'pre',
    resolveId(id) {
      if (['/__season-stats-entry.jsx', '/__season-auth.js', '/__season-supabase.js'].includes(id)) return id
    },
    load(id) {
      if (id === '/__season-stats-entry.jsx') return entry
      if (id === '/__season-auth.js') return `
        export function useAuth(){return {user:window.__user}}
        export function isClubAdmin(user){return user?.role==='admin'}
        export function canViewEndSeasonStats(){return true}
      `
      if (id === '/__season-supabase.js') return `
        export async function getAvailableTeamsForUser(){return [{id:'team-1',name:'Test U14'}]}
        export async function getEndSeasonStats(request){window.requests.push(request);return window.responses.shift()}
        export async function withRequestTimeout(operation){return operation()}
      `
    },
    transform(code, id) {
      if (id.split('?')[0].endsWith('/src/pages/EndSeasonStatsPage.jsx')) {
        return code
          .replace("from '../lib/auth.js'", "from '/__season-auth.js'")
          .replace("from '../lib/supabase.js'", "from '/__season-supabase.js'")
      }
      if (id.split('?')[0].endsWith('/src/index.css')) return code.replace(/^@import url\([^\n]+\);\r?\n/, '')
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url !== '/season-stats.html') return next()
        const html = await vite.transformIndexHtml(request.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script type="module" src="/__season-stats-entry.jsx"></script></body></html>')
        response.setHeader('Content-Type', 'text/html')
        response.end(html)
      })
    },
  }],
})

await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/season-stats.html`, { timeout: 120000, waitUntil: 'domcontentloaded' })

  const from = page.getByLabel('From')
  const to = page.getByLabel('To')
  await from.waitFor({ timeout: 10000 })
  assert.equal(await from.inputValue(), defaultStartDate)
  assert.equal(await to.inputValue(), defaultEndDate)
  await page.waitForFunction(() => window.requests.length === 1)

  await from.fill(replacementStartDate)
  await page.waitForFunction(() => window.requests.length === 2)
  await page.evaluate(() => window.resolveInitial())
  await page.waitForTimeout(50)
  assert.equal(await page.getByText('Old Player').count(), 0, 'Old request results stay hidden after the date changes')
  await page.evaluate(() => window.resolveNext())
  await page.getByText('New Player').waitFor({ timeout: 10000 })
  assert.deepEqual(await page.evaluate(() => window.requests[1]), {
    user: { id: 'manager', clubId: 'club', role: 'admin', roleRank: 100, activeTeamId: '' },
    teamId: '',
    startDate: replacementStartDate,
    endDate: defaultEndDate,
  })

  await from.fill(invalidStartDate)
  await page.locator('#season-date-range-error').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Generate end of season awards' }).isDisabled(), true)
  assert.equal(await page.getByText('New Player').count(), 0, 'Invalid dates clear the displayed totals and player rows')
  assert.equal(await page.evaluate(() => window.requests.length), 2, 'Invalid dates do not request stats')

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${width}px`)
  }
  assert.deepEqual(errors, [])
  console.log('PASS: season stats applies selected dates, hides stale data, blocks invalid awards, and remains responsive.')
} finally {
  await browser.close()
  await server.close()
}
