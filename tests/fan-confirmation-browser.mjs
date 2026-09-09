import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const fansCss = await readFile('src/pages/fans.css', 'utf8')
const origin = 'https://parent.footballplayer.test'
const invitation = '/fan-invite/20000000-0000-4000-8000-000000000099'
const result = await build({
  stdin: { contents: `import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import{FanInvitePage}from'./src/pages/FanInvitePage.jsx';import{AuthContext,supabase}from'./src/lib/auth.js';
  function App(){const[session,setSession]=useState(null);useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session));const{data}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));return()=>data.subscription.unsubscribe()},[]);return <AuthContext.Provider value={{session}}><BrowserRouter><Routes><Route path='/fan-invite/:token' element={<FanInvitePage/>}/><Route path='/fans' element={<h1>Accepted Fan access</h1>}/></Routes></BrowserRouter></AuthContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader:'jsx' },
  bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'confirmation-services',setup(b){
    b.onResolve({filter:/\/auth\.js$/},()=>({path:'auth',namespace:'fixture'}))
    b.onResolve({filter:/supabase-client\.js$/},()=>({path:'client',namespace:'fixture'}))
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth'?`import{createContext}from'react';export{ supabase }from'./src/lib/supabase-client.js';export const AuthContext=createContext({});import{useContext}from'react';export const useAuth=()=>useContext(AuthContext);`:`import{createClient}from'@supabase/supabase-js';export const supabase=createClient('https://fixture.supabase.test','fixture-anon-key');`,loader:'js',resolveDir:process.cwd()}))
  }}],
})
await mkdir('output/playwright/fan-confirmation',{recursive:true})
const browser=await chromium.launch({headless:true})
try{
  for(const expired of [false,true]){
    const context=await browser.newContext({viewport:{width:390,height:844}})
    let verifies=0,accepts=0
    const errors=[]
    const user={id:'10000000-0000-4000-8000-000000000099',email:'newfan@example.test',aud:'authenticated',role:'authenticated',email_confirmed_at:new Date().toISOString()}
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url())
      if(url.origin===origin)return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+fansCss+'</style><div id="root"></div><script>'+result.outputFiles[0].text+'</script>'})
      if(url.pathname==='/auth/v1/verify'){
        verifies++
        assert.deepEqual(route.request().postDataJSON(),{token_hash:'synthetic-confirmation-hash',type:'email',gotrue_meta_security:{}})
        return route.fulfill({status:expired?403:200,contentType:'application/json',body:JSON.stringify(expired?{code:'otp_expired',msg:'Token expired'}:{access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',token_type:'bearer',expires_in:3600,user})})
      }
      if(url.pathname==='/auth/v1/user')return route.fulfill({contentType:'application/json',body:JSON.stringify(user)})
      const name=url.pathname.split('/').at(-1)
      let data={club_name:'Test Club',theme_accent:'#414b92'}
      if(name==='get_fan_invitation'){
        assert.ok(route.request().headers().authorization?.includes('synthetic-access-token'))
        data={...data,player_name:'Invited child',permissions:{game_day:true}}
      }
      if(name==='accept_fan_invitation'){accepts++;assert.equal(route.request().postDataJSON().token_value,invitation.split('/').at(-1));data='accepted'}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
    })
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
    await page.goto(origin+invitation+'#fan_confirmation=synthetic-confirmation-hash')
    await page.getByRole('button',{name:'Confirm email',exact:true}).waitFor()
    assert.equal(new URL(page.url()).hash,'')
    assert.equal(verifies,0,'Email opening does not consume the confirmation token')
    assert.equal(accepts,0)
    await page.getByRole('button',{name:'Confirm email',exact:true}).click()
    if(expired){
      await page.getByRole('alert').getByText(/expired or has already been used/).waitFor()
      assert.equal(accepts,0)
      assert.equal(await page.getByRole('button',{name:'Accept invitation',exact:true}).count(),0)
      await page.getByRole('button',{name:'Sign in',exact:true}).waitFor()
    }else{
      await page.getByRole('heading',{name:'Follow Invited child'}).waitFor()
      await page.getByRole('status').getByText(/Email confirmed/).waitFor()
      assert.equal(accepts,0,'Confirmation alone grants no Fan access')
      assert.ok(page.url().includes(invitation))
      const acceptButton=page.getByRole('button',{name:'Accept invitation',exact:true})
      const appearance=await acceptButton.evaluate(el=>({height:el.getBoundingClientRect().height,background:getComputedStyle(el).backgroundColor,width:el.getBoundingClientRect().width}))
      assert.ok(appearance.height>=54)
      assert.ok(appearance.width>=300)
      assert.notEqual(appearance.background,'rgba(0, 0, 0, 0)')
      await page.screenshot({path:'output/playwright/fan-confirmation/confirmed-phone.png',fullPage:true})
      await page.getByRole('button',{name:'Accept invitation',exact:true}).click()
      await page.getByRole('heading',{name:'Accepted Fan access'}).waitFor()
      assert.equal(accepts,1)
    }
    assert.equal(verifies,1)
    assert.deepEqual(errors,[])
    await context.close()
  }
  console.log('PASS: fresh-browser email confirmation preserves invitation, strips secret fragment, waits for explicit confirmation and acceptance, and handles expired links without granting access.')
}finally{await browser.close()}
