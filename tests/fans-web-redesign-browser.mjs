import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
const port = 43129
const origin = `http://127.0.0.1:${port}`
Object.assign(process.env, { VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true', VITE_APP_URL: origin, VITE_PARENT_APP_URL: origin, VITE_SUPABASE_URL: 'http://fixture.supabase.test', VITE_SUPABASE_ANON_KEY: 'fixture-anon-key' })
const server = await createServer({ cacheDir: 'node_modules/.vite-fans-redesign', optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port, strictPort: true }, mode: 'development' })
await server.listen()
const browser = await chromium.launch({ headless: true })
const connections = []
const creates = []
let emailRequests = 0
let deleteRequests = 0
let signupRequests = 0
let signupShouldFail = true
await mkdir('output/playwright/fans-local', { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript(() => {
    if (new URL(location.href).searchParams.has('signedout')) sessionStorage.removeItem('auth-access-browser-fixture-email')
    else sessionStorage.setItem('auth-access-browser-fixture-email', 'parent-multiple.fixture@footballplayer.test')
    localStorage.setItem('auth-access-browser-fixture-profile-patch:parent-multiple.fixture@footballplayer.test',JSON.stringify({parentPortalLinks:[]}))
    sessionStorage.setItem('selected-access-mode', 'parent')
    sessionStorage.setItem('selected-access-mode-explicit', 'true')
    localStorage.setItem('app-theme-mode', 'light')
  })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'fixture.supabase.test') {
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') return route.fulfill({ status: 400, headers: { 'X-Supabase-Api-Version': '2024-01-01', 'Access-Control-Expose-Headers': 'X-Supabase-Api-Version' }, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_credentials', msg: 'Invalid login credentials' }) })
      const name = url.pathname.split('/').at(-1)
      const args = route.request().postDataJSON() || {}
      let result = []
      if (name === 'list_fan_connections') result = connections.filter(c => !c.owner_deleted_at)
      if (name === 'get_fan_invitation_branding') result = {club_id:'blue',club_name:'Blue Club',club_logo_url:'https://branding.example.test/blue.svg',theme_accent:'#123abc'}
      if (name === 'get_fan_invitation') result = {club_id:'blue',club_name:'Blue Club',club_logo_url:'https://branding.example.test/blue.svg',theme_accent:'#123abc',name:'Invited Fan',email:'parent-multiple.fixture@footballplayer.test',player_name:'Invitation child',permissions:{schedule:true,game_day:false,development:false,resources:false}}
      if (name === 'accept_fan_invitation') result = '30000000-0000-4000-8000-000000000002'
      if (name === 'manage_fan_connection') {
        const row = connections.find((c) => c.id === args.connection_id_value)
        assert.ok(['remove','revoke'].includes(args.action_value)); row.status = args.action_value === 'remove' ? 'removed' : 'cancelled'
      }
      if (name === 'delete_cancelled_fan_invitation') {
        const row = connections.find(c => c.id === args.connection_id_value)
        assert.equal(row.status, 'cancelled'); row.owner_deleted_at = new Date().toISOString(); deleteRequests++
      }
      if (name === 'create_fan_invitation') {
        creates.push(args)
        const row = { id: `10000000-0000-4000-8000-${String(creates.length).padStart(12,'0')}`, name: args.name_value, email: args.email_value,
          permissions: args.permissions_value, parent_link_id: args.parent_link_id_value, status: 'pending', is_owner: true, relationship_type: 'fan',
          invite_token: `20000000-0000-4000-8000-${String(creates.length).padStart(12,'0')}`, expires_at: new Date(Date.now()+86400000).toISOString() }
        connections.push(row); result = row
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
    }
    if (url.pathname === '/.netlify/functions/fans') {
      const action = route.request().postDataJSON().action
      if (action === 'schedule') return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({schedule:[{id:'training',title:'Shared Fan training',date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),time:'18:00'}]}) })
      if(action === 'matches') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({matches:[{id:'match1',opponent:'Away United',club_name:'Cambourne Town FC',home_away:'home',match_date:'2026-10-20',kickoff_time:'10:00',status:'scheduled'}]})})
      assert.equal(action,'send_invitation')
      emailRequests++
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
    }
    if (url.pathname === '/.netlify/functions/create-fan-account') {
      signupRequests++
      assert.equal(route.request().postDataJSON().email, 'newfan@example.test')
      return route.fulfill({ status: signupShouldFail ? 502 : 200, contentType: 'application/json', body: JSON.stringify(signupShouldFail ? { message: 'Account creation could not be completed. Please try Create account again.' } : { needsEmailVerification: true }) })
    }
    if (url.hostname === 'branding.example.test') return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#123abc"/><text x="18" y="44" fill="white" font-size="36">B</text></svg>'})
    if (url.pathname.startsWith('/.netlify/')) return route.fulfill({status:200,contentType:'application/json',body:'{}'})
    if (url.origin !== origin && !url.protocol.startsWith('data')) return route.abort()
    return route.continue()
  })
  connections.push({id:'fan1',is_owner:false,status:'active',relationship_type:'fan',player_name:'Lucas Turner',club_name:'Football Player Demo FC',team_name:'U17 Green',notifications_enabled:true,permissions:{schedule:true,game_day:true,development:true,resources:true}}, {id:'fan2',is_owner:false,status:'active',relationship_type:'fan',player_name:'Jenson Bailey',club_name:'Cambourne Town FC',team_name:'U14 JPL 26/27',permissions:{game_day:true}})
  const page = await context.newPage()
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`${origin}/fans`)
  await page.getByRole('heading',{name:'Players',exact:true}).waitFor()
  for(const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:900})
    for(const theme of ['light','dark']) {
      await page.evaluate(mode=>document.documentElement.classList.toggle('theme-dark',mode==='dark'),theme)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      const buttons=page.locator('.fans-following').filter({hasText:'Lucas Turner'}).locator('.fans-feature-grid button')
      assert.equal(await buttons.count(),4)
      for(const button of await buttons.all()) {const box=await button.boundingBox();assert.ok(box.width>=110);assert.ok(box.height>=44)}
      assert.equal(await page.getByRole('button',{name:/Remove my access/}).count(),0)
      assert.equal(await page.getByRole('button',{name:'Sign out',exact:true}).count(),0)
      await page.screenshot({path:`output/playwright/fans-local/redesign-${theme}-${width}.png`,fullPage:true})
    }
  }
  await page.setViewportSize({width:390,height:844})
  await page.locator('.fans-following').filter({hasText:'Jenson Bailey'}).getByRole('button',{name:'Game Day',exact:true}).click()
  await page.getByRole('heading',{name:'Game Day',exact:true}).waitFor()
  await page.getByText('Cambourne Town FC v Away United',{exact:true}).waitFor()
  assert.equal(await page.locator('.fans-following').count(),0)
  await page.screenshot({path:'output/playwright/fans-local/redesign-gameday-phone.png',fullPage:true})
  await page.getByRole('button',{name:'Back to players',exact:true}).click()
  await page.getByRole('button',{name:'Schedule',exact:true}).click()
  await page.getByText('Shared Fan training',{exact:true}).waitFor()
  await page.screenshot({path:'output/playwright/fans-local/redesign-schedule-phone.png',fullPage:true})
  await page.getByRole('navigation',{name:'Fan navigation'}).getByRole('button',{name:'Settings',exact:true}).click()
  assert.equal(await page.getByText('Shared Fan training',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Remove my access to Lucas Turner',exact:true}).click()
  await page.getByRole('dialog').getByText('Lucas Turner',{exact:true}).waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'Go back',exact:true}).click()
  assert.equal(connections[0].status,'active')
  await page.screenshot({path:'output/playwright/fans-local/redesign-settings-phone.png',fullPage:true})
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await page.getByRole('dialog').getByRole('heading',{name:'Sign out?',exact:true}).waitFor()
  await page.screenshot({path:'output/playwright/fans-local/redesign-signout-phone.png',fullPage:true})
  await page.getByRole('dialog').getByRole('button',{name:'Go back',exact:true}).click()
  assert.equal(await page.evaluate(()=>Boolean(sessionStorage.getItem('auth-access-browser-fixture-email'))),true)
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Sign out',exact:true}).click()
  await page.waitForFunction(()=>!sessionStorage.getItem('auth-access-browser-fixture-email'))
  assert.deepEqual(errors,[])
  console.log('PASS: Fans standalone 320/390/768/1280 light/dark, readable features, permission filtering, exclusive content views, club match labels, settings-only removal, named cancellation and signout confirmation/cancel/submit.')
  await context.close()
} finally { await browser.close(); await server.close() }
