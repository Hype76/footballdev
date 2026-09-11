import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'output/playwright/calendar-vote-edit'
await mkdir(output, { recursive: true })
const entry = `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {CalendarEventModal,getFormFromCalendarEvent} from '/src/pages/SessionsPage.jsx';
import {motmExpiryDurationToHours} from '/src/lib/expiry-duration.js';
import {applyThemeColorVariables} from '/src/lib/theme.js';import '/src/index.css';
const event={id:'match-day:fixture',sourceId:'fixture',sourceType:'match-day',date:'2099-09-12',title:'Match Day vs St Neots',data:{id:'fixture',matchDate:'2099-09-12',opponent:'St Neots',teamId:'team',status:'scheduled',kickoffTimeTbc:true,enableMotmPoll:false,motmPollExpiryHours:6,motmNotifyResultsOnClose:false,fixtureType:'league',homeAway:'home',shirtChoice:'home',matchDurationMinutes:80}};
function App(){const[form,setForm]=useState(getFormFromCalendarEvent(event)),[key,setKey]=useState(0);window.form=()=>form;window.reopen=()=>{setForm(getFormFromCalendarEvent({...event,data:{...event.data,...window.saved}}));setKey(k=>k+1)};window.setTheme=mode=>{document.documentElement.className='theme-'+mode;document.body.className='theme-'+mode;applyThemeColorVariables(document.getElementById('root'),'blue',mode)};
return <CalendarEventModal key={key} isOpen mode="edit" event={event} form={form} teams={[{id:'team',name:'Test U14'}]} user={{id:'staff',role:'team_admin',roleRank:50,clubId:'club',activeTeamId:'team'}} onChange={e=>setForm(f=>({...f,[e.target.name]:e.target.type==='checkbox'?e.target.checked:e.target.value}))} onSubmit={e=>{e.preventDefault();window.saved={...JSON.parse(JSON.stringify(form)),motmPollExpiryHours:motmExpiryDurationToHours(form.motmPollExpiryDuration)}}} onCancel={()=>{}} onOpenWorkflow={()=>{}}/>};createRoot(document.getElementById('root')).render(<App/>);
`
const server = await createServer({
  cacheDir: 'node_modules/.vite-calendar-vote',
  server: { host: '127.0.0.1', port: 0 },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://fixture.supabase.test'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('fixture-key'),
  },
  plugins: [{
    name: 'render-actual-final-report',
    enforce: 'pre',
    resolveId(id) { if (id === '/__calendar-vote-entry.jsx') return id },
    load(id) { if (id === '/__calendar-vote-entry.jsx') return entry },
    transform(code, id) {
      if (id.split('?')[0].endsWith('/src/pages/SessionsPage.jsx')) return `${code}\nexport { CalendarEventModal, getFormFromCalendarEvent };`
      if (id.split('?')[0].endsWith('/src/index.css')) return code.replace(/^@import url\([^\n]+\);\r?\n/, '')
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url !== '/report-theme.html') return next()
        const html = await vite.transformIndexHtml(request.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:1000px;margin:auto"></main><script type="module" src="/__calendar-vote-entry.jsx"></script></body></html>')
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
  const vote = page.getByRole('checkbox', {name:'Create Player of the Match vote at full time'})
  try { await vote.waitFor({timeout:30000}) } catch(error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error }
  assert.equal(await vote.isChecked(),false,'Existing disabled setting is loaded')
  await vote.check()
  const expiry=page.getByLabel('Vote expiry (DD:HH:MM)')
  assert.equal(await expiry.inputValue(),'00:06:00','Existing expiry is preserved')
  await expiry.fill('00:00:02')
  await page.getByRole('checkbox',{name:'Send vote results when voting closes'}).check()
  await page.getByRole('button',{name:'Save changes',exact:true}).click()
  await page.waitForFunction(()=>window.saved?.enableMotmPoll===true)
  assert.equal(await page.evaluate(()=>window.saved.motmPollExpiryHours),2 / 60)
  await page.evaluate(()=>window.reopen())
  assert.equal(await vote.isChecked(),true)
  assert.equal(await expiry.inputValue(),'00:00:02')
  for(const mode of ['dark','light']) {
    await page.evaluate(mode=>window.setTheme(mode),mode)
    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:900})
      await vote.scrollIntoViewIfNeeded()
      await page.screenshot({path:`${output}/${mode}-${width}.png`})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    }
  }
  await vote.uncheck()
  assert.equal(await page.getByLabel('Vote expiry (DD:HH:MM)').count(),0)
  assert.deepEqual(errors,[])
  console.log('PASS: real Calendar edit loads vote settings, toggles, saves and reopens, with responsive dark/light rendering.')
} finally { await browser.close();await server.close() }
