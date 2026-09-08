import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const output = 'output/playwright/matchday-report-theme'
await mkdir(output, { recursive: true })
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { FinalMatchReportPanel } from '/src/pages/MatchDayPage.jsx';
  import { normalizeMatchDay } from '/src/lib/domain/match-day.js';
  import '/src/index.css';
  const match = normalizeMatchDay({
    id:'theme-fixture',club_id:'test-club',team_id:'test-team',team_name:'U14 Test Team',
    opponent:'Test Opponent',home_away:'home',status:'concluded',match_date:'2026-09-05',
    match_duration_minutes:80,home_score:6,away_score:3,
    match_day_final_reports:[{id:'report',staff_notes:'A strong second half.',created_at:'2026-09-05T13:00:00Z',updated_at:'2026-09-05T13:00:00Z'}],
    match_day_events:[
      {id:'goal',event_type:'goal',event_status:'active',team_side:'club',minute:12,scorer_name:'Alex Player',home_score:1,away_score:0,match_phase:'first_half'},
      {id:'card',event_type:'yellow_card',event_status:'active',team_side:'opponent',minute:24,scorer_name:'Sam Player'},
      {id:'sub',event_type:'substitution',event_status:'active',team_side:'club',minute:44,scorer_name:'Alex Player',assist_name:'Taylor Player'},
      {id:'water',event_type:'water_break',event_status:'active',team_side:'club',minute:52},
      {id:'void',event_type:'goal',event_status:'voided',team_side:'club',minute:60,correction_reason:'Goal awarded in error',voided_at:'2026-09-05T12:00:00Z'},
    ]
  });
  const root=createRoot(document.getElementById('root'));
  window.renderReport=(tone='success')=>root.render(React.createElement(FinalMatchReportPanel,{
    match,clubIdentity:{clubName:'Test Club'},onSave:()=>{},onClose:()=>{},isBusy:false,
    status:{tone,message:tone==='error'?'Report could not be saved.':'Final match report saved.'}
  }));
  window.renderReport();
`
const server = await createServer({
  cacheDir: 'node_modules/.vite-report-theme',
  server: { host: '127.0.0.1', port: 0 },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://fixture.supabase.test'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('fixture-key'),
  },
  plugins: [{
    name: 'render-actual-final-report',
    enforce: 'pre',
    resolveId(id) { if (id === '/__report-theme-entry.js') return id },
    load(id) { if (id === '/__report-theme-entry.js') return entry },
    transform(code, id) {
      if (id.split('?')[0].endsWith('/src/pages/MatchDayPage.jsx')) return `${code}\nexport { FinalMatchReportPanel };`
      if (id.split('?')[0].endsWith('/src/index.css')) return code.replace(/^@import url\([^\n]+\);\r?\n/, '')
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url !== '/report-theme.html') return next()
        const html = await vite.transformIndexHtml(request.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:1000px;margin:auto"></main><script type="module" src="/__report-theme-entry.js"></script></body></html>')
        response.setHeader('Content-Type', 'text/html'); response.end(html)
      })
    },
  }],
})
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/report-theme.html`, { timeout: 120000 })
  const report = page.getByRole('region', { name: 'Final Match Report' })
  await report.waitFor({ timeout: 120000 })
  for (const mode of ['dark', 'light']) {
    await page.evaluate(mode => {
      document.documentElement.className = `theme-${mode}`
      document.body.className = `theme-${mode} app-theme-scope`
    }, mode)
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const buttons = report.getByLabel('Completed match report sections').getByRole('button')
      for (let index = 0; index < await buttons.count(); index++) {
        const button = buttons.nth(index)
        if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
        await page.waitForTimeout(180)
        await assertRenderedTextContrast(page, `${mode} ${width} ${await button.innerText()}`)
        if (index === 0 || index === 4) await report.screenshot({ path: `${output}/${mode}-${width}-section-${index}.png` })
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.evaluate(() => window.renderReport('error'))
      await report.getByRole('alert').waitFor()
      await assertRenderedTextContrast(page, `${mode} ${width} save error`)
      await page.evaluate(() => window.renderReport())
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS: real Final Match Report and all five expanded sections meet 4.5:1 text contrast in light/dark themes at desktop/mobile widths, including notes, exports, errors and voided events.')
} finally {
  await browser.close()
  await server.close()
}
