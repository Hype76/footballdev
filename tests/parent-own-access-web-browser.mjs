import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve))
const base=`http://127.0.0.1:${port}`
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:process.cwd(),env:{...process.env,VITE_AUTH_ACCESS_BROWSER_FIXTURES:'true',VITE_APP_URL:base,VITE_PARENT_APP_URL:base,VITE_SUPABASE_URL:'http://fixture.supabase.test',VITE_SUPABASE_ANON_KEY:'fixture-anon-key'},stdio:['ignore','pipe','pipe']})
let serverOutput='';server.stdout.on('data',data=>serverOutput+=data);server.stderr.on('data',data=>serverOutput+=data)
let browser
try {
  for(let attempt=0;;attempt++){try{if((await fetch(base)).ok)break}catch{}if(attempt>150)throw Error(serverOutput);await new Promise(resolve=>setTimeout(resolve,200))}
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext({viewport:{width:390,height:844}})
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,prefer,x-client-info','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}
  let fail=true;const requests=[]
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.hostname==='127.0.0.1'&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/.netlify/'))return route.continue()
    if(url.pathname.endsWith('/rpc/revoke_own_parent_player_access')&&route.request().method()==='POST'){
      const body=route.request().postDataJSON();requests.push(body)
      return route.fulfill({status:fail?400:200,headers,contentType:'application/json',body:JSON.stringify(fail?{message:'Synthetic access removal failure'}:{player_id:body.target_player_id,revoked_count:1})})
    }
    return route.fulfill({status:200,headers,contentType:'application/json',body:url.pathname.startsWith('/api/')?'{}':'[]'})
  })
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(base+'/sign-in?tab=parent')
  await page.getByRole('button',{name:'Parent',exact:true}).click()
  await page.getByPlaceholder('you@club.com').fill('parent-multiple.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill('FixturePass123!')
  await page.locator('form').getByRole('button',{name:/^Log in$/i}).click()
  await page.waitForURL('**/parent-portal')
  await page.goto(base+'/parent-portal?section=settings&settingsArea=account&parentLinkId=parent-link-fixture')
  await page.getByRole('button',{name:'Remove my access to Fixture Child',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Remove my access to Fixture Child?'})
  await dialog.waitFor();await dialog.getByRole('button',{name:'Keep my access'}).click()
  assert.deepEqual(requests,[])
  await page.getByRole('button',{name:'Remove my access to Fixture Child',exact:true}).click()
  await dialog.getByRole('button',{name:'Remove my access',exact:true}).click()
  await dialog.getByText('Synthetic access removal failure',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Remove my access to Second Fixture Child',exact:true}).count(),1)
  fail=false
  await dialog.getByRole('button',{name:'Remove my access',exact:true}).click()
  await dialog.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'Remove my access to Second Fixture Child',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Remove my access to Fixture Child',exact:true}).count(),0)
  assert.ok(page.url().includes('parentLinkId=parent-link-fixture-second'))
  assert.deepEqual(requests,[{target_player_id:'player-fixture'},{target_player_id:'player-fixture'}])
  await mkdir('output/playwright/parent-own-access',{recursive:true})
  await page.screenshot({path:'output/playwright/parent-own-access/remaining-player.png',fullPage:true})
  await page.reload()
  await page.getByRole('button',{name:'Remove my access to Second Fixture Child',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Remove my access to Fixture Child',exact:true}).count(),0)
  await page.getByRole('button',{name:'Remove my access to Second Fixture Child',exact:true}).click()
  await page.getByRole('dialog',{name:'Remove my access to Second Fixture Child?'}).getByRole('button',{name:'Remove my access',exact:true}).click()
  await page.getByRole('heading',{name:'Parent access is not available for this account',exact:true}).waitFor()
  await page.getByText('Your current session has been kept active. Continue with an available workspace, or choose to sign in with a different account.',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('auth-access-browser-fixture-email')),'parent-multiple.fixture@footballplayer.test')
  assert.equal(await page.getByRole('button',{name:/Remove my access to/}).count(),0)
  assert.ok(!page.url().includes('parentLinkId='))
  assert.deepEqual(requests.at(-1),{target_player_id:'player-fixture-second'})
  await page.screenshot({path:'output/playwright/parent-own-access/no-linked-players.png',fullPage:true})
  await page.reload()
  await page.getByRole('heading',{name:'Parent access is not available for this account',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('auth-access-browser-fixture-email')),'parent-multiple.fixture@footballplayer.test')
  assert.deepEqual(errors,[])
  console.log('PASS: Parent web named confirmation, cancel without mutation, visible failure, retry, remaining player/account preserved, last-player removal keeps the session active with no accessible records, stale URL cleared and reload retained.')
}finally{await browser?.close();server.kill()}
