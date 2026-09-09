import assert from 'node:assert/strict'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { themeContrastRatio } from '../apps/mobile-core/src/themeContrast.js'

// Exercise the real Fans screen and hook; replace device services and network only.
const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const out = 'output/playwright/fans-mobile'
await mkdir(out, { recursive: true })
const app = await readFile('apps/parent-mobile/App.js', 'utf8')
const handler = app.slice(app.indexOf('  function handleChildChange('), app.indexOf('  async function handleOpenMessage('))
const sectionReset = app.match(/setMoreSection\(\(section\) => section === 'fans' \? section : ''\)/)?.[0]
assert.ok(sectionReset, 'Authority refresh preserves the Fans route')
assert.match(app, /selectedParentLinkId=\{selectedLink\?\.id\} onSelectedParentLinkChange=\{\(linkId\) => handleChildChange\(linkId, \{ stayOnFans: true \}\)\}/)
const mocks = {
  auth: `export const useMobileAuth=()=>({user:window.user,refreshUserProfile:async()=>window.remount(),signOut:async()=>{}});`,
  supabase: `export const getAccessToken=async()=> 'synthetic'; export const supabase={rpc:async(name,args)=>({data:await window.rpc(name,args)})};`,
  config: `export const getMobileRuntimeConfig=()=>({apiBaseUrl:'http://localhost:9877'});`,
  'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
  'expo-notifications': `export const useLastNotificationResponse=()=>null; export const requestPermissionsAsync=async()=>({status:'denied'}); export const getExpoPushTokenAsync=async()=>({data:'synthetic'});`,
  'expo-secure-store': `export const getItemAsync=async()=>null; export const deleteItemAsync=async()=>{}; export const setItemAsync=async()=>{};`,
  'expo-constants': `export default {};`,
  '@react-native-async-storage/async-storage': `export default {getItem:async()=>null,setItem:async()=>{}};`,
  'expo-keep-awake': `export const activateKeepAwakeAsync=async()=>{},deactivateKeepAwake=()=>{},isAvailableAsync=async()=>false;`,
  'expo-file-system/legacy': `export const cacheDirectory='',downloadAsync=async()=>({}),deleteAsync=async()=>{};`,
  'expo-sharing': `export const isAvailableAsync=async()=>false,shareAsync=async()=>{};`,
  'react-native-safe-area-context': `import React from 'react';import {View} from 'react-native';export const SafeAreaView=({children,style})=><View style={[style,{paddingTop:59,height:844}]}>{children}</View>;`,
}
const entry = `
import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
import {Alert,AppState,Share} from 'react-native';
import {FansScreen} from './apps/parent-mobile/src/FansScreen.js';
window.user={id:'parent-test',parentPortalLinks:[{id:'first',playerName:'First Child',clubName:'Demo FC',themeAccent:'#414b92'},{id:'second',playerName:'Second Child',clubName:'Demo FC',themeAccent:'#414b92'}]};
window.calls=[];window.rows=[];window.saved='';window.alert=null;
window.rpc=async(name,args)=>{
  window.calls.push({name,args});
  if(name==='list_fan_connections')return window.rows.filter(r=>!r.deleted);
  if(name==='create_fan_invitation'){
    const row={id:crypto.randomUUID(),name:args.name_value,email:args.email_value,parent_link_id:args.parent_link_id_value,is_owner:true,status:'pending',permissions:args.permissions_value,invite_token:crypto.randomUUID(),expires_at:new Date(Date.now()+86400000).toISOString()};window.rows.push(row);return row;
  }
  if(name==='delete_cancelled_fan_invitation'){
    if(window.failDelete)throw Error('Could not delete. Try again.');
    const row=window.rows.find(r=>r.id===args.connection_id_value);if(row.status!=='cancelled')throw Error('Only cancelled');row.deleted=true;
  }
};
window.readRequests=[];window.responses={};window.failRead=false;window.delayRead=false;
window.emailRequests=0;window.fetch=async(_url,options)=>{
 const body=JSON.parse(options.body);if(body.action==='send_invitation'){window.emailRequests++;return {ok:true,status:200,json:async()=>({success:true})}}
 window.readRequests.push(body);const payload=window.responses[body.action]||{};const fail=window.failRead;
 if(window.delayRead)await new Promise(resolve=>{window.finishRead=resolve});
 return {ok:!fail,status:fail?503:200,json:async()=>fail?{message:'Could not load shared items. Try again.'}:payload};
};
Alert.alert=(title,message,buttons)=>{window.alert={title,message,buttons}};
let appListener;AppState.addEventListener=(_event,fn)=>{appListener=fn;return {remove(){appListener=null}}};window.background=()=>{appListener?.('background');appListener?.('active')};
Share.share=async()=>{window.background();return {action:'sharedAction'}};
function App(){
 const [selectedLinkId,setSelectedLinkId]=useState('first'),[activeTab,setActiveTab]=useState('more'),[moreSection,setMoreSection]=useState('fans'),[key,setKey]=useState(0),[mode,setMode]=useState('dark');
 const parentLinks=window.user.parentPortalLinks,selectedMobileUser=window.user;
 const saveParentOfflineSelection=async(_user,id)=>{window.saved=id};const setChildSwitcherOpen=()=>{};
 ${handler}
 useEffect(()=>{${sectionReset}},[selectedLinkId]);
 window.remount=()=>setKey(k=>k+1);window.mode=setMode;window.navigate=()=>{setMoreSection('fans');setActiveTab('more')};window.normalSwitch=id=>handleChildChange(id);
 return <div data-mode={mode} data-tab={activeTab} data-section={moreSection}><div data-testid="header">{parentLinks.find(p=>p.id===selectedLinkId)?.playerName}</div>{activeTab==='more'&&moreSection==='fans'?<FansScreen key={key} embedded={!window.standalone} themeMode={mode} selectedParentLinkId={selectedLinkId} onSelectedParentLinkChange={id=>handleChildChange(id,{stayOnFans:true})}/>:null}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic',
  loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules],
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
  plugins: [{ name: 'fans-services', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const key = args.path.split('/').at(-1)
      if (mocks[args.path] || mocks[key]) return { path: mocks[args.path] ? args.path : key, namespace: 'mock' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }))
  } }],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://localhost:9877/**', route => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:system-ui,sans-serif"><div id="root"></div></body></html>' }))
  await page.goto('http://localhost:9877')
  await page.clock.install({time:new Date('2026-09-09T10:00:00Z')});
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const button = name => page.getByRole('button', { name, exact: true })
  await button('Second Child').click()
  await button('Second Child (selected)').waitFor()
  assert.equal(await page.getByTestId('header').innerText(), 'Second Child')
  assert.equal(await page.evaluate(() => window.saved), 'second')
  for (const mode of ['dark', 'light']) {
    await page.evaluate(mode => window.mode(mode), mode)
    await page.locator(`[data-mode="${mode}"]`).waitFor()
    const box = await button('Invite a Fan').boundingBox()
    assert.ok(box.height >= 54 && box.width > 300)
    await assertRenderedTextContrast(page, `Fans ${mode}`)
    await page.screenshot({ path: `${out}/invite-${mode}.png`, fullPage: true })
  }
  for (const method of ['Email', 'QR code', 'Share link']) {
    await button('Invite a Fan').click()
    await page.getByLabel('Fan name', { exact: true }).fill(`${method} Fan`)
    await page.getByLabel('Fan email', { exact: true }).fill('test@example.test')
    await assertRenderedTextContrast(page, `Fans invitation ${method}`)
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => window.mode(mode), mode)
      await page.locator(`[data-mode="${mode}"]`).waitFor()
      const gameDay = page.getByRole('switch', { name: 'Game Day', exact: true })
      await gameDay.waitFor()
      assert.equal(await gameDay.isChecked(), true)
      const assertSwitchContrast = async () => {
        await page.waitForFunction(() => Array.from(document.querySelector('[role="switch"][aria-label="Game Day"]').parentElement.children).slice(0, 2).every(el => getComputedStyle(el).backgroundColor === el.style.backgroundColor))
        const colors = await gameDay.evaluate(input => Array.from(input.parentElement.children).slice(0, 2).map(el => getComputedStyle(el).backgroundColor))
        const hex = rgb => '#' + rgb.match(/\d+/g).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')
        assert.ok(themeContrastRatio(hex(colors[0]), hex(colors[1])) >= 4.5, 'Switch thumb contrasts with its track')
        assert.ok(themeContrastRatio(hex(colors[0]), mode === 'light' ? '#ffffff' : '#10231f') >= 3, `Switch track contrasts with the page: ${mode} ${colors}`)
      }
      await assertSwitchContrast()
      await gameDay.uncheck()
      assert.equal(await gameDay.isChecked(), false)
      await assertSwitchContrast()
      await gameDay.check()
      assert.equal(await page.getByRole('switch', { name: 'Include resources' }).isDisabled(), true)
      await page.getByText('Unavailable', {exact:true}).waitFor()
      await page.getByText('On', {exact:true}).first().waitFor()
      await page.getByText('Off', {exact:true}).first().waitFor()
      await assertRenderedTextContrast(page, `Fan switches ${mode}`)
      await page.screenshot({path: `${out}/switches-${mode}.png`,fullPage:true})
    }
    await button(method).click()
    await page.getByText(/to follow Second Child/).waitFor()
    await assertRenderedTextContrast(page, `Fans confirmation ${method}`)
    await button('Confirm invitation').click()
    await page.getByText(`${method} Fan`, { exact: true }).waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
    await page.evaluate(() => window.remount())
    await button('Second Child (selected)').waitFor()
    assert.equal(await page.getByTestId('header').innerText(), 'Second Child')
  }
  const creates = await page.evaluate(() => window.calls.filter(c => c.name === 'create_fan_invitation'))
  assert.equal(creates.length, 3)
  assert.equal(await page.evaluate(() => window.emailRequests), 1)
  assert.ok(creates.every(c => c.args.parent_link_id_value === 'second'))
  assert.equal(await button('Delete').count(), 0)
  await page.evaluate(() => { window.rows[0].status='cancelled'; window.rows[1].status='revoked'; window.remount() })
  await button('Delete').click()
  assert.match(await page.evaluate(() => window.alert.message), /Email Fan/)
  await page.evaluate(() => window.alert.buttons[0].onPress?.())
  assert.equal(await page.evaluate(() => window.calls.filter(c=>c.name==='delete_cancelled_fan_invitation').length), 0)
  await button('Delete').click()
  await page.evaluate(() => { window.failDelete=true; window.alert.buttons[1].onPress() })
  await page.getByRole('alert').getByText('Could not delete. Try again.').waitFor()
  await button('Delete').click()
  await page.evaluate(() => { window.failDelete=false; window.alert.buttons[1].onPress() })
  await page.getByText('Email Fan', { exact: true }).waitFor({ state: 'hidden' })
  await page.evaluate(() => window.remount())
  await page.getByText('QR code Fan', { exact: true }).waitFor()
  assert.equal(await button('Delete').count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: `${out}/after-delete.png`, fullPage: true })
  await page.evaluate(() => window.normalSwitch('first'))
  await page.locator('[data-tab="home"]').waitFor()
  await page.evaluate(() => window.navigate())
  await button('First Child (selected)').waitFor()
  await page.evaluate(() => {
    window.standalone=true;window.user={id:'fan-test',parentPortalLinks:[]};
    window.rows=[{id:'followed-child',is_owner:false,status:'active',player_name:'Followed Child',club_name:'Demo FC',team_name:'Under 17',permissions:{schedule:true,game_day:true,development:true,resources:true}}];
    window.responses={schedule:{schedule:[{id:'training',title:'Shared training',date:'2026-09-14',time:'18:00'}]},matches:{matches:[{id:'match',opponent:'Away Club',home_score:0,away_score:0,match_date:'2026-09-15',status:'scheduled'}]},development:{reports:[{id:'report',form:{name:'Shared report'},recordDate:'2026-09-01'}]},resources:{resources:[{id:'resource',title:'Shared practice'}]},notifications:{notifications:[{id:'notice',title:'Shared goal',body:'Goal scored'}]}};
    window.remount();
  });
  await page.getByText('Followed Child',{exact:true}).waitFor();
  for(const mode of ['light','dark']) {
    await page.evaluate(mode=>window.mode(mode),mode);
    for(const [label,title,expected] of [['Schedule','Calendar','Shared training'],['Game Day','Matchday','Under 17 v Away Club'],['Development records','Development','Shared report'],['Include resources','Resources','Shared practice'],['View notifications','Notifications','Shared goal']]) {
      await button(label).click();
      await page.getByRole('heading',{name:title,exact:true}).waitFor();
      await page.getByText(expected,{exact:expected!=='Shared report'}).waitFor();
      await page.waitForFunction(title=>[...document.querySelectorAll('[role=heading]')].some(el=>el.textContent===title&&el.getBoundingClientRect().y>=0&&el.getBoundingClientRect().y<330),title);
      const heading=await page.getByRole('heading',{name:title,exact:true}).boundingBox();
      assert.ok(heading.y>=59&&heading.y<330,'Opened section heading is visible immediately');
      const backBox=await button('Back to Fans').boundingBox();assert.ok(backBox.y>=59&&backBox.height>=44,'Back is below the iPhone status area and has a usable touch target');
      assert.equal(await button('Hide Development report').count(),0);assert.equal(await button('Hide resource').count(),0);
      if(title==='Calendar'){assert.equal(await button('History').count(),0);assert.equal(await button('Needs response').count(),0);await page.getByText(/14 Sep/).waitFor();}
      await assertRenderedTextContrast(page,`Fan content ${mode} ${title}`);
      await page.screenshot({path:`${out}/content-${mode}-${title.replaceAll(' ','-')}.png`});
      if(title==='Matchday'){await page.getByText('Under 17 v Away Club',{exact:true}).click();await page.getByRole('heading',{name:'Under 17 v Away Club',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/See squad|Register interest|Start match/}).count(),0);await page.getByText('15 Sept 2026',{exact:true}).waitFor();}
      if(title==='Development'){await button('View Development report').click();await button('Back to Development').waitFor();assert.equal(await button('Share PDF').count(),0);await page.getByText(/1 Sept 2026/).waitFor();}
      await button('Back to Fans').click();
    }
  }
  await page.evaluate(()=>{window.responses.schedule={schedule:[]}});
  await button('Schedule').click();
  await page.getByText('There are no shared calendar events for this child.').waitFor();
  await button('Back to Fans').click();
  await page.evaluate(()=>{window.failRead=true});
  await button('Schedule').click();
  await page.getByRole('alert').getByText('Could not load shared items. Try again.').waitFor();
  await page.evaluate(()=>{window.failRead=false});
  await button('Try again').click();
  await page.getByText('There are no shared calendar events for this child.').waitFor();
  await button('Back to Fans').click();
  await page.evaluate(()=>{window.delayRead=true});
  await button('Schedule').click();
  await page.getByText('Loading schedule...').waitFor();
  await button('Back to Fans').click();
  await page.evaluate(()=>{window.delayRead=false;window.finishRead()});
  await button('Game Day').click();
  await page.getByText('Under 17 v Away Club',{exact:true}).waitFor();
  assert.equal(await page.getByText('There are no shared calendar events for this child.').count(),0);
  await page.evaluate(()=>{window.rows[0].permissions.game_day=false;window.background()});
  await button('Back to Fans').waitFor({state:'hidden'});
  await button('Game Day').waitFor({state:'hidden'});
  assert.deepEqual(errors, [])
  console.log('PASS: native Fans child/header sync, persisted selection, email/QR/share remount, prominent branded action, confirmed cancelled-only deletion, retry after failure, normal child navigation.')
} finally { await browser.close() }
