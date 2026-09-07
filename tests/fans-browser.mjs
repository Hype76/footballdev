import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { buildFanEmail } from '../netlify/functions/lib/_fan-email.js'
const port = 43127
const origin = `http://127.0.0.1:${port}`
Object.assign(process.env, { VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true', VITE_APP_URL: origin, VITE_PARENT_APP_URL: origin, VITE_SUPABASE_URL: 'http://fixture.supabase.test', VITE_SUPABASE_ANON_KEY: 'fixture-anon-key' })
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, mode: 'development' })
await server.listen()
const browser = await chromium.launch({ headless: true })
const connections = []
const creates = []
let emailRequests = 0
let deleteRequests = 0
await mkdir('output/playwright/fans-local', { recursive: true })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript(() => {
    if (new URL(location.href).searchParams.has('signedout')) sessionStorage.removeItem('auth-access-browser-fixture-email')
    else sessionStorage.setItem('auth-access-browser-fixture-email', 'parent-multiple.fixture@footballplayer.test')
    sessionStorage.setItem('selected-access-mode', 'parent')
    sessionStorage.setItem('selected-access-mode-explicit', 'true')
    localStorage.setItem('app-theme-mode', 'light')
  })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'fixture.supabase.test') {
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
      if (action === 'schedule') return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({schedule:[{id:'training',title:'Shared Fan training',date:'2026-09-14',time:'18:00'}]}) })
      assert.equal(action,'send_invitation')
      emailRequests++
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
    }
    if (url.hostname === 'branding.example.test') return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#123abc"/><text x="18" y="44" fill="white" font-size="36">B</text></svg>'})
    if (url.pathname.startsWith('/.netlify/')) return route.fulfill({status:200,contentType:'application/json',body:'{}'})
    if (url.origin !== origin && !url.protocol.startsWith('data')) return route.abort()
    return route.continue()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${origin}/fans`)
  await page.getByLabel('Child', {exact:true}).selectOption('parent-link-fixture-second')
  await page.waitForURL('**/fans?parentLinkId=parent-link-fixture-second')
  await page.getByRole('button',{name:'Invite a Fan',exact:true}).click()
  await page.getByRole('button',{name:'QR code',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Enter a name'}).waitFor()
  assert.equal(creates.length,0)
  await page.getByLabel('Name',{exact:true}).fill('Alex Relative')
  await page.getByLabel('Email',{exact:true}).fill('alex@example.test')
  await page.getByRole('checkbox',{name:/Game Day/}).uncheck()
  await page.getByRole('checkbox',{name:/Schedule/}).check()
  assert.equal(await page.getByRole('checkbox',{name:/Include resources/}).isDisabled(),true)
  await page.getByRole('button',{name:'QR code',exact:true}).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText(/Alex Relative \(alex@example.test\)/).waitFor()
  assert.equal(await dialog.getByRole('listitem').count(),1)
  await page.screenshot({path:'output/playwright/fans-local/confirmation-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'output/playwright/fans-local/confirmation-phone.png',fullPage:true})
  await dialog.getByRole('button',{name:'Confirm invitation',exact:true}).click()
  await page.getByAltText('Invitation QR code for Alex Relative').waitFor()
  assert.equal(creates.length,1)
  assert.equal(creates[0].parent_link_id_value, 'parent-link-fixture-second')
  assert.equal(await page.getByLabel('Child',{exact:true}).inputValue(), 'parent-link-fixture-second')
  assert.deepEqual(creates[0].permissions_value,{schedule:true,game_day:false,development:false,resources:false})
  await page.getByRole('button',{name:'Invite a Fan',exact:true}).click()
  await page.getByLabel('Name',{exact:true}).fill('Jamie Relative')
  await page.getByLabel('Email',{exact:true}).fill('jamie@example.test')
  await page.getByRole('button',{name:'Email',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Confirm invitation',exact:true}).click()
  await page.getByText('jamie@example.test',{exact:true}).waitFor()
  assert.equal(connections.length,2)
  assert.equal(connections[0].status,'pending')
  assert.equal(emailRequests,1)
  assert.equal(creates[1].parent_link_id_value, 'parent-link-fixture-second')
  await page.reload()
  await page.getByText('jamie@example.test',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Child',{exact:true}).inputValue(), 'parent-link-fixture-second')
  const inviteBox = await page.getByRole('button',{name:'Invite a Fan',exact:true}).boundingBox()
  assert.ok(inviteBox.height >= 54 && inviteBox.width > 300)
  assert.equal(await page.getByRole('button',{name:'Delete',exact:true}).count(), 0)
  const alex = page.locator('.fans-person').filter({hasText:'alex@example.test'})
  await alex.getByRole('button',{name:'Cancel invitation',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Remove access',exact:true}).click()
  await alex.getByRole('button',{name:'Delete',exact:true}).click()
  await page.getByRole('dialog').getByText('Alex Relative (alex@example.test)',{exact:true}).waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'Go back',exact:true}).click()
  assert.equal(deleteRequests,0)
  await alex.getByRole('button',{name:'Delete',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click()
  await alex.waitFor({state:'hidden'})
  assert.equal(deleteRequests,1)
  await page.reload()
  await page.getByText('jamie@example.test',{exact:true}).waitFor()
  assert.equal(await page.getByText('alex@example.test',{exact:true}).count(),0)
  assert.equal(await page.getByLabel('Child',{exact:true}).inputValue(), 'parent-link-fixture-second')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:'output/playwright/fans-local/fans-phone.png',fullPage:true})
  connections.push({id:'30000000-0000-4000-8000-000000000001',is_owner:false,status:'active',relationship_type:'fan',player_name:'Followed child',club_name:'Test club',team_name:'Test team',permissions:{schedule:true,game_day:false,development:false,resources:false}})
  await page.reload()
  await page.getByRole('button',{name:'Schedule',exact:true}).click()
  await page.getByText('Shared Fan training',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Game Day',exact:true}).count(),0)
  await page.getByRole('button',{name:'Remove my access',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Remove access',exact:true}).click()
  await page.getByText('Shared Fan training',{exact:true}).waitFor({state:'hidden'})
  await page.getByText('Followed child',{exact:true}).waitFor({state:'hidden'})
  await page.screenshot({path:'output/playwright/fans-local/fan-access-removed.png',fullPage:true})
  connections.push(...['blue','purple'].map((club, index) => ({id:`40000000-0000-4000-8000-00000000000${index}`,is_owner:false,status:'active',relationship_type:'fan',player_name:`${club} child`,club_id:club,club_name:club === 'blue' ? 'Blue Club' : 'Purple Club',club_logo_url:`https://branding.example.test/${club}.svg`,theme_accent:club === 'blue' ? '#123abc' : '#7c3aed',permissions:{schedule:true}})))
  await page.reload()
  await page.locator('.fans-following').filter({hasText:'Blue Club'}).getByRole('button',{name:'Schedule',exact:true}).click()
  await page.locator('main > .fans-club-brand').getByText('Blue Club',{exact:true}).waitFor()
  assert.equal(await page.locator('main.fans').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent').trim()),'#123abc')
  await page.locator('.fans-following').filter({hasText:'Purple Club'}).getByRole('button',{name:'Schedule',exact:true}).click()
  await page.locator('main > .fans-club-brand').getByText('Purple Club',{exact:true}).waitFor()
  assert.equal(await page.locator('main.fans').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent').trim()),'#7c3aed')
  await page.screenshot({path:'output/playwright/fans-local/fans-club-branding-phone.png',fullPage:true})
  await page.goto(`${origin}/fan-invite/20000000-0000-4000-8000-000000000099`)
  await page.getByRole('heading',{name:'Follow Invitation child',exact:true}).waitFor()
  assert.equal(await page.getByRole('listitem').count(),1)
  await page.getByAltText('Blue Club logo').waitFor()
  await page.screenshot({path:'output/playwright/fans-local/fan-invite-branded-phone.png',fullPage:true})
  await page.getByRole('button',{name:'Accept invitation',exact:true}).click()
  await page.waitForURL('**/fans')
  await page.getByRole('heading',{name:'Fans',exact:true}).waitFor()
  await page.evaluate(() => document.documentElement.classList.add('theme-dark'))
  await page.locator('.fans-following').filter({hasText:'Blue Club'}).getByRole('button',{name:'Schedule',exact:true}).click()
  await page.screenshot({path:'output/playwright/fans-local/fans-branded-dark-phone.png',fullPage:true})
  const email = buildFanEmail({club:{name:'Blue Club',logo_url:'https://branding.example.test/blue.svg',theme_accent:'#123abc'},fan:{name:'Alex Relative',email:'alex@example.test',permissions:{schedule:true}},url:'https://example.test/invite'})
  await page.setContent(email.html)
  await page.getByAltText('Blue Club logo').waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:'output/playwright/fans-local/fan-email-branded-phone.png',fullPage:true})
  await page.goto(`${origin}/fan-invite/20000000-0000-4000-8000-000000000099?signedout=1`)
  await page.getByRole('button',{name:'Sign in',exact:true}).waitFor()
  await page.getByAltText('Blue Club logo').waitFor()
  assert.equal(await page.getByText('Invitation child',{exact:true}).count(),0)
  await page.screenshot({path:'output/playwright/fans-local/fan-invite-branded-signed-out-phone.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log('PASS: required identity, exact confirmation, Schedule-only access, QR, two pending invitations, simulated email, phone layout, permission-limited viewing, Fan self-removal clears content, recipient acceptance, multi-club logos and colour switching, branded invitation and no browser errors.')
  await context.close()
} finally { await browser.close(); await server.close() }
