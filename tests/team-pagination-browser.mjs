import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'output/playwright/team-pagination'
await mkdir(output, { recursive: true })
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Pagination}from'/src/components/ui/Pagination.jsx';import{TeamStaffAllocationsSection,TeamTvSettingsEditor}from'/src/components/teams/TeamStaffAllocationsSection.jsx';import'/src/index.css';
const team={id:'team-a',name:'U10 Boys Blue',staffIds:[]};
const empty=[], drafts={}, noop=()=>{};
function App(){
  const[page,setPage]=useState(2),[showSettings,setShowSettings]=useState(false);
  window.showTeamTvSettings=()=>setShowSettings(true);
  return showSettings ? <TeamStaffAllocationsSection
    canRenameTeam canDeleteTeam canManageStaffAllocations selectedTeam={team} teamAssignments={[team]}
    paginatedTeams={{items:[team]}} teamPage={1} teamPageSize={8} onSelectedTeamChange={noop}
    teamNameDrafts={drafts} teamNotificationNameDrafts={drafts} staffSearch="" staffToAddId=""
    availableStaff={empty} selectedTeamStaff={empty} paginatedSelectedTeamStaff={{items:empty}}
    staffPage={1} staffPageSize={8} teamRoleOptions={empty}
    matchdayTvSettings={<TeamTvSettingsEditor team={team} onSave={(id,settings)=>window.savedTeamTvSettings={id,...settings}}/>}
  /> : <div style={{width:280,maxWidth:'100%',padding:16}}><Pagination compact currentPage={page} onPageChange={setPage} pageSize={8} totalItems={14}/></div>;
}
createRoot(document.getElementById('root')).render(<App/>);`
const server = await createServer({
  cacheDir: 'node_modules/.vite-team-pagination',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'pagination-fixture',
    resolveId(id) { if (id === '/__pagination.jsx') return id },
    load(id) { if (id === '/__pagination.jsx') return entry },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url !== '/pagination.html') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__pagination.jsx"></script></body></html>'))
    }) },
  }],
})
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pagination.html`)
  for (const [width, font] of [[1346, ''], [390, ''], [1346, 'monospace'], [390, 'monospace']]) {
    await page.setViewportSize({ width, height: 700 })
    await page.evaluate(font => { document.getElementById('root').style.fontFamily = font }, font)
    const label = page.getByText('2 of 2', { exact: true })
    await label.waitFor()
    assert.equal(await label.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el)
      return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size
    }), 1, 'page indicator remains on one line')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const controls = await page.getByRole('button').evaluateAll(buttons => buttons.map(el => ({height:el.getBoundingClientRect().height,overflows:el.scrollWidth>el.clientWidth, rowOverflows:el.parentElement.scrollWidth>el.parentElement.clientWidth})))
    assert.ok(controls.every(button => button.height >= 44 && !button.overflows && !button.rowOverflows), JSON.stringify({ width, font, controls }))
    if (!font) await page.screenshot({ path: `${output}/${width}.png` })
  }
  assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.getByText('Showing 1 to 8 of 14').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Previous', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByText('Showing 9 to 14 of 14').waitFor()
  await page.evaluate(() => { document.getElementById('root').style.fontFamily = ''; window.showTeamTvSettings() })
  const publicAnnouncements = page.getByRole('checkbox', { name: 'Public Announcements', exact: true })
  const goalCelebrations = page.getByRole('checkbox', { name: 'Show goal celebrations on Matchday TV' })
  const saveTv = page.getByRole('button', { name: 'Save Matchday TV settings' })
  for (const width of [1346, 768, 390]) {
    await page.setViewportSize({ width, height: 840 })
    const rows = await page.getByRole('checkbox').evaluateAll(boxes => boxes.map(box => {
      const input = box.getBoundingClientRect()
      const label = box.closest('label').querySelector('span').getBoundingClientRect()
      return { left: input.left, width: input.width, gap: label.left - input.right, textCentre: (label.top + label.bottom) / 2, inputCentre: (input.top + input.bottom) / 2 }
    }))
    assert.equal(rows.length, 2)
    assert.ok(rows.every(row => row.width === 16 && row.gap >= 6 && row.gap <= 12 && Math.abs(row.textCentre - row.inputCentre) <= 1), JSON.stringify({ width, rows }))
    assert.ok(Math.abs(rows[0].left - rows[1].left) <= 1, 'checkboxes share their left edge')
    if (width >= 768) {
      const fields = await Promise.all(['Team name', 'Notification Team name'].map(name => page.getByRole('textbox', { name, exact: true }).boundingBox()))
      const actions = await Promise.all(['Save name', 'Save notification name'].map(name => page.getByRole('button', { name, exact: true }).boundingBox()))
      assert.ok(Math.abs(fields[0].x + fields[0].width - fields[1].x - fields[1].width) < 1, 'name inputs have the same right edge')
      assert.ok(fields.every((field, index) => Math.abs(field.y - actions[index].y) < 1 && Math.abs(field.height - actions[index].height) < 1), 'each save aligns with its input')
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('group', { name: 'Matchday TV' }).screenshot({ path: `${output}/matchday-tv-${width}.png` })
  }
  assert.equal(await publicAnnouncements.isChecked(), true)
  assert.equal(await goalCelebrations.isChecked(), true)
  assert.equal(await saveTv.isDisabled(), true)
  await page.getByRole('button', { name: 'About Public Announcements' }).click()
  await page.getByText(/Normal notifications still go out/).waitFor()
  await publicAnnouncements.uncheck()
  await saveTv.click()
  assert.deepEqual(await page.evaluate(() => window.savedTeamTvSettings), {
    id: 'team-a', tvPublicAnnouncements: false, tvGoalCelebrations: true,
  })
  await goalCelebrations.uncheck()
  await saveTv.click()
  assert.deepEqual(await page.evaluate(() => window.savedTeamTvSettings), {
    id: 'team-a', tvPublicAnnouncements: false, tvGoalCelebrations: false,
  })
  assert.deepEqual(errors, [])
  console.log('PASS: compact Teams pagination fits narrow desktop and phone columns, retains touch targets and paging.')
} finally { await browser.close(); await server.close() }
