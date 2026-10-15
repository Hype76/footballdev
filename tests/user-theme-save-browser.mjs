import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd(), require = createRequire(import.meta.url)
const output = 'output/playwright/user-theme-save'
await mkdir(output, { recursive: true })
const sectionNames = ['AccountProfileSection', 'LoginEmailSection', 'PasswordSettingsSection', 'PrivilegedMfaSection', 'SetupChecklistSettingsSection']
const mocks = {
  auth: `export function useAuth(){const user=window.currentProfile;return {user,authUser:{id:window.authIdOverride||user?.id},resetPassword:async()=>{},updateCurrentUserDetails:(patch,options)=>{window.profileOptions=options;if(options?.expectedAuthUserId!==window.currentProfile?.id)return false;window.setProfile(current=>({...current,...patch}));return true}}};export const isDemoAccount=u=>!!u?.demo,isParentPortalUser=u=>u?.role==='parent_portal',isClubAdmin=u=>u?.role==='admin',canManageClubSettings=()=>false,canManageTeamSettings=()=>false;`,
  api: `export async function updateOwnThemeSettings({authUser,mode}){try{const r=await fetch('/theme',{method:'POST',body:JSON.stringify({id:authUser.id,mode})});if(!r.ok)throw Error('Synthetic save rejected');return r.json()}finally{window.finishedWrites=(window.finishedWrites||0)+1}};export const requestLoginEmailChange=async()=>{},requestPasswordReauthentication=async()=>{},updateClubDisplaySettings=async()=>{},updateOwnUserSettings=async()=>{},updateSignedInPassword=async()=>{};`,
  client: `export const supabase={};`,
  router: `export const useSearchParams=()=>[new URLSearchParams('area=display'),()=>{}];`,
  toast: `export const useToast=()=>({showToast:value=>window.emitToast(value)});`,
  onboarding: `export const buildOnboardingPlan=()=>({steps:[],manualState:{}}),getOnboardingProgress=()=>({}),loadOnboardingSnapshot=async()=>({}),openOnboarding=()=>{};`,
  attendance: `export const canChooseTrainingAttendanceVisibility=()=>false,getTrainingAttendanceVisibility=async()=>true,setTrainingAttendanceVisibility=async()=>true;`,
}
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{UserSettingsPage}from'fixture';
function Harness(){const[profile,setProfile]=useState(window.initialProfile),[visible,setVisible]=useState(true),[messages,setMessages]=useState([]);window.currentProfile=profile;window.setProfile=setProfile;window.emitToast=value=>setMessages(old=>[...old,value]);window.clearToasts=()=>setMessages([]);window.signOut=()=>{setVisible(false);setProfile(null)};window.signIn=async id=>{const r=await fetch('/profile?id='+id);setProfile(await r.json());setVisible(true)};window.unmountSettings=()=>setVisible(false);return <>{visible&&profile?<UserSettingsPage key={profile.id}/>:null}<div data-testid="toasts">{messages.map((m,i)=><p key={i} data-tone={m.tone||'success'}>{m.title}</p>)}</div></>};createRoot(document.getElementById('root')).render(<Harness/>);`
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'actual-settings-fixture', setup(b) {
  b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|scheduler)$/ }, args => ({ path: require.resolve(args.path), namespace: 'source' }))
  b.onResolve({ filter: /^fixture$/ }, () => ({ path: path.join(root, 'src/pages/UserSettingsPage.jsx'), namespace: 'source' }))
  for (const [filter, name] of [[/(?:^|\/)auth\.js$/, 'auth'], [/(?:^|\/)supabase\.js$/, 'api'], [/supabase-client\.js$/, 'client'], [/^react-router-dom$/, 'router'], [/toast-context\.js$/, 'toast'], [/(?:^|\/)onboarding\.js$/, 'onboarding'], [/training-attendance-visibility\.js$/, 'attendance']]) b.onResolve({ filter }, () => ({ path: name, namespace: 'mock' }))
  for (const name of sectionNames) b.onResolve({ filter: new RegExp('/'+name+'\\.jsx$') }, () => ({ path: name, namespace: 'section' }))
  b.onResolve({ filter: /^\.{1,2}\//, namespace: 'source' }, args => ({ path: createRequire(args.importer).resolve(args.path), namespace: 'source' }))
  b.onLoad({ filter: /.*/, namespace: 'source' }, async args => ({ contents: await readFile(path.basename(args.path)==='UserSettingsPage.jsx' && process.env.USER_SETTINGS_SOURCE ? process.env.USER_SETTINGS_SOURCE : args.path, 'utf8'), loader: 'jsx', resolveDir: path.dirname(args.path) }))
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }))
  b.onLoad({ filter: /.*/, namespace: 'section' }, args => ({ contents: 'export function '+args.path+'(){return null}', loader: 'jsx', resolveDir: root }))
} }] })
const browser = await chromium.launch(), errors = []
const profile = (id, mode='light') => ({ id, authUserId:id, clubId:'club', clubName:'Test Club', role:'coach',roleRank:30,themeMode:mode,themeAccent:'blue',themeButtonStyle:'solid' })
const stored = new Map([['actor-a', profile('actor-a')], ['actor-b', profile('actor-b')]])
const control = { fail:false,hold:false,writes:[],release:null }
let completed = 0
const page = await browser.newPage({ viewport:{width:1280,height:850} })
page.on('pageerror', e=>errors.push(e.message))
await page.route('http://settings.test/**', async route => {
  const url = new URL(route.request().url())
  if(url.pathname==='/theme') {
    const change = route.request().postDataJSON(), fail = control.fail
    control.writes.push(change)
    if(control.hold) await new Promise(resolve=>{control.release=resolve})
    if(!fail) stored.set(change.id,{...stored.get(change.id),themeMode:change.mode})
    await route.fulfill({status:fail?500:200,contentType:'application/json',body:JSON.stringify(fail?{error:'Save rejected'}:stored.get(change.id))})
    completed++
  } else if(url.pathname==='/profile') {
    await route.fulfill({contentType:'application/json',body:JSON.stringify(stored.get(url.searchParams.get('id')))})
  } else {
    await route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div><script>window.initialProfile='+JSON.stringify(stored.get('actor-a'))+';localStorage.setItem("app-theme-mode","light");localStorage.setItem("app-theme-accent","blue");localStorage.setItem("app-theme-button-style","solid");</script><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>'})
  }
})
const theme = () => page.getByRole('combobox',{name:/^Theme/})
const notices = () => page.locator('[data-testid=toasts] p').allTextContents()
async function releaseWrite() { const expected=completed+1;control.release();control.release=null;await page.waitForFunction(n=>window.finishedWrites===n,expected) }
async function login(id) {await page.evaluate(()=>window.signOut());await page.evaluate(id=>window.signIn(id),id);await theme().waitFor()}
try {
  await page.goto('http://settings.test/settings?area=display');await page.waitForTimeout(50);assert.deepEqual(errors,[]);await theme().waitFor()
  control.fail=true
  await theme().selectOption('dark');await page.getByText('Theme not saved',{exact:true}).waitFor()
  assert.deepEqual(await notices(),['Theme not saved'],'A rejected save must never announce success')
  assert.equal(await theme().inputValue(),'light')
  assert.equal(await page.evaluate(()=>localStorage.getItem('app-theme-mode')),'light')
  assert.equal(stored.get('actor-a').themeMode,'light')
  await page.evaluate(()=>window.clearToasts());control.fail=false;control.hold=true
  await theme().selectOption('dark');await page.getByText('Saving display preference...',{exact:true}).waitFor()
  assert.equal(await theme().isDisabled(),true);assert.equal(await theme().getAttribute('aria-busy'),'true');assert.deepEqual(await notices(),[])
  await page.setViewportSize({width:320,height:750});await page.screenshot({path:output+'/pending-320.png',fullPage:true})
  await page.evaluate(()=>{localStorage.setItem('app-theme-accent','#193e7c');localStorage.setItem('app-theme-button-style','gradient');localStorage.setItem('app-theme-button-style-version','2')})
  await releaseWrite();control.hold=false
  await page.getByText('Theme updated',{exact:true}).waitFor();assert.equal(await theme().inputValue(),'dark');assert.equal(await theme().isEnabled(),true)
  assert.equal(await page.evaluate(()=>localStorage.getItem('app-theme-accent')),'#193e7c')
  assert.equal(await page.evaluate(()=>localStorage.getItem('app-theme-button-style')),'gradient')
  assert.equal(await page.evaluate(()=>window.profileOptions.expectedAuthUserId),'actor-a');assert.equal(await page.evaluate(()=>window.profileOptions.invalidateProfileSync),true)
  for(const mode of ['dark','light','system']) {
    await page.evaluate(()=>window.clearToasts())
    if(await theme().inputValue()!==mode){await theme().selectOption(mode);await page.getByText('Theme updated',{exact:true}).waitFor()}
    assert.equal(stored.get('actor-a').themeMode,mode)
    await page.evaluate(()=>localStorage.setItem('app-theme-mode','invalid'))
    await login('actor-a');await page.waitForFunction(mode=>document.querySelector('select').value===mode,mode)
    assert.equal(await theme().inputValue(),mode,'A fresh signed-in page must restore the server preference')
  }
  await page.evaluate(()=>window.clearToasts());control.hold=true
  await theme().selectOption('dark');await page.getByText('Saving display preference...').waitFor()
  await login('actor-b');assert.equal(await theme().isEnabled(),true)
  const before = await page.evaluate(()=>localStorage.getItem('app-theme-mode'))
  await releaseWrite();control.hold=false
  assert.equal(await theme().inputValue(),'light');assert.equal(await page.evaluate(()=>window.currentProfile.id),'actor-b')
  assert.equal(await page.evaluate(()=>localStorage.getItem('app-theme-mode')),before);assert.deepEqual(await notices(),[])
  control.fail=true;control.hold=true
  await theme().selectOption('dark');await page.getByText('Saving display preference...').waitFor()
  await page.evaluate(()=>window.unmountSettings());await releaseWrite();assert.deepEqual(await notices(),[])
  assert.deepEqual(errors,[])
  console.log('PASS: actual User Settings and Display controls wait for server confirmation, reject false success, retain saved mode on failure, restore Light/Dark/System after sign-out/sign-in, show pending disabled state at320px, preserve latest branding, and ignore late success/error after account change or unmount.')
} catch(error) {console.error(JSON.stringify({pageErrors:errors,body:await page.locator('body').innerText()}));throw error} finally {await browser.close()}
