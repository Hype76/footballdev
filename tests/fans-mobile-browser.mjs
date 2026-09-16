import assert from 'node:assert/strict'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
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
assert.match(app, /moreSection && moreSection !== 'fans' \? <BackButton/, 'Embedded Fans uses the More tab instead of a duplicate Back row')
assert.match(app, /selectedParentLinkId=\{selectedLink\?\.id\} onSelectedParentLinkChange=\{\(linkId\) => handleChildChange\(linkId, \{ stayOnFans: true \}\)\}/)
const mocks = {
  auth: `export const useMobileAuth=()=>({user:window.user,refreshUserProfile:async()=>window.remount(),signOut:async()=>{if(window.failSignOut)throw Error('Could not sign out. Try again.');window.signedOut=(window.signedOut||0)+1}});`,
  supabase: `export const getAccessToken=async()=> 'synthetic'; export const supabase={rpc:async(name,args)=>({data:await window.rpc(name,args)}),from:()=>{window.directKitReads=(window.directKitReads||0)+1;throw Error('Fan has no direct club access')},storage:{from:()=>({getPublicUrl:key=>({data:{publicUrl:'http://localhost:9877/kits/'+key}})})}};`,
  config: `export const getMobileRuntimeConfig=()=>({apiBaseUrl:'http://localhost:9877'});`,
  'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
  'expo-notifications': `export const useLastNotificationResponse=()=>null; export const getPermissionsAsync=async()=>window.phonePermission||{status:'denied'}; export const requestPermissionsAsync=getPermissionsAsync; export const getExpoPushTokenAsync=async()=>({data:'ExpoPushToken[synthetic]'});`,
  'expo-secure-store': `export const getItemAsync=async()=>window.phoneToken||null; export const deleteItemAsync=async()=>{window.phoneToken=null}; export const setItemAsync=async(_key,value)=>{window.phoneToken=value};`,
  'expo-constants': `export default {};`,
  '@react-native-async-storage/async-storage': `export default {getItem:async()=>null,setItem:async()=>{}};`,
  'expo-keep-awake': `export const activateKeepAwakeAsync=async()=>{},deactivateKeepAwake=()=>{},isAvailableAsync=async()=>false;`,
  'expo-file-system/legacy': `export const cacheDirectory='',downloadAsync=async()=>({}),deleteAsync=async()=>{};`,
  'expo-sharing': `export const isAvailableAsync=async()=>false,shareAsync=async()=>{};`,
  'react-native-safe-area-context': `import React from 'react';import {View} from 'react-native';export const SafeAreaView=({children,style})=><View style={[style,{paddingTop:59,height:844}]}>{children}</View>;`,
}
const entry = `
import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
import {Alert,AppState,Share,Platform} from 'react-native';
window.phonePlatform=value=>{Platform.OS=value};
import {FansScreen} from './apps/parent-mobile/src/FansScreen.js';
window.user={id:'parent-test',parentPortalLinks:[{id:'first',playerName:'First Child',clubName:'Demo FC',themeAccent:'#414b92'},{id:'second',playerName:'Second Child',clubName:'Demo FC',themeAccent:'#414b92'}]};
window.calls=[];window.rows=[];window.saved='';window.alert=null;
window.ownerFixture=()=>{
 window.ownerCompact=true;window.standalone=false;
 window.user={id:'parent-test',parentPortalLinks:[{id:'first',playerName:'Jenson Bailey',clubName:'Cambourne Town FC',themeAccent:'#073e83'},{id:'second',playerName:'Lucas Turner',clubName:'Football Player Demo FC',themeAccent:'#073e83'}]};
 window.rows=['Jenson Bailey','Steve','Julie','Elyse','Grandad','Brian'].map((name,index)=>({id:'compact-'+index,parent_link_id:'first',is_owner:true,name,email:name.toLowerCase().replaceAll(' ','.')+'@example.test',relationship_type:index===0?'player':'fan',status:index===4?'expired':'active',permissions:{schedule:true,game_day:true,development:index===0,resources:false}}));
};
const ownerPreview=location.pathname.endsWith('/owner-preview.html');
if(ownerPreview)window.ownerFixture();
window.rpc=async(name,args)=>{
  window.calls.push({name,args});
  if(name==='list_fan_connections')return window.rows.filter(r=>!r.deleted);
  if(name==='partner_feed')return {items:[],linkedAnalytics:null};
  if(name==='set_fan_player_account') {const row=window.rows.find(r=>r.id===args.connection_id_value);row.relationship_type='player';row.permissions.schedule=true;return null;}
  if(name==='create_fan_invitation'){
    const row={id:crypto.randomUUID(),name:args.name_value,email:args.email_value,parent_link_id:args.parent_link_id_value,is_owner:true,status:'pending',permissions:args.permissions_value,invite_token:crypto.randomUUID(),expires_at:new Date(Date.now()+86400000).toISOString()};window.rows.push(row);return row;
  }
  if(name==='renew_fan_invitation'){
    const row=window.rows.find(r=>r.id===args.connection_id_value);row.status='pending';row.invite_token=crypto.randomUUID();row.expires_at=new Date(Date.now()+86400000).toISOString();return row;
  }
  if(name==='delete_cancelled_fan_invitation'){
    if(window.failDelete)throw Error('Could not delete. Try again.');
    const row=window.rows.find(r=>r.id===args.connection_id_value);if(row.status!=='cancelled')throw Error('Only cancelled');row.deleted=true;
  }
};
window.readRequests=[];window.responses={};window.failRead=false;window.delayRead=false;
window.emailRequests=0;window.fetch=async(_url,options)=>{
 const body=JSON.parse(options.body);if(body.action==='send_invitation'){window.emailRequests++;return {ok:true,status:200,json:async()=>({success:true})}}
 if(body.action==='device_status')return {ok:true,status:200,json:async()=>({registered:window.phoneRegistered===true})};
 if(body.action==='register_device'){if(window.failPhoneRegistration)return {ok:false,status:503,json:async()=>({message:'Phone registration failed. Try again.'})};window.phoneRegistered=true;return {ok:true,status:200,json:async()=>({success:true})}}
 window.readRequests.push(body);const payload=window.responses[body.action]||{};const fail=window.failRead;
 if(window.delayRead)await new Promise(resolve=>{window.finishRead=resolve});
 return {ok:!fail,status:fail?503:200,json:async()=>fail?{message:'Could not load shared items. Try again.'}:payload};
};
Alert.alert=(title,message,buttons)=>{window.alert={title,message,buttons}};
let appListener;AppState.addEventListener=(_event,fn)=>{appListener=fn;return {remove(){appListener=null}}};window.background=()=>{appListener?.('background');appListener?.('active')};
Share.share=async()=>{window.background();return {action:'sharedAction'}};
function App(){
 const [selectedLinkId,setSelectedLinkId]=useState('first'),[activeTab,setActiveTab]=useState('more'),[moreSection,setMoreSection]=useState('fans'),[key,setKey]=useState(0),[mode,setMode]=useState(ownerPreview?'light':'dark');
 const parentLinks=window.user.parentPortalLinks,selectedMobileUser=window.user;
 const saveParentOfflineSelection=async(_user,id)=>{window.saved=id};const setChildSwitcherOpen=()=>{};
 ${handler}
 useEffect(()=>{${sectionReset}},[selectedLinkId]);
 window.remount=()=>setKey(k=>k+1);window.mode=setMode;window.navigate=()=>{setMoreSection('fans');setActiveTab('more')};window.normalSwitch=id=>handleChildChange(id);
 return <div data-mode={mode} data-tab={activeTab} data-section={moreSection} style={window.ownerCompact?{padding:16,maxWidth:518,margin:'auto',background:mode==='light'?'#f4f8f7':'#071916'}:undefined}>{!window.ownerCompact?<div data-testid="header">{parentLinks.find(p=>p.id===selectedLinkId)?.playerName}</div>:null}{activeTab==='more'&&moreSection==='fans'?<FansScreen key={key} embedded={!window.standalone} themeMode={mode} selectedParentLinkId={selectedLinkId} onSelectedParentLinkChange={id=>handleChildChange(id,{stayOnFans:true})}/>:null}</div>;
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
await writeFile(`${out}/owner-preview.js`, result.outputFiles[0].text)
await writeFile(`${out}/owner-preview.html`, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:system-ui,sans-serif"><div id="root"></div><script src="./owner-preview.js"></script></body></html>')
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
    assert.ok(box.height >= 44 && box.width >= 120 && box.width < 200,'Invite action is compact beside Players')
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
  await button('Expand Email Fan details').click()
  await button('Edit access').click()
  await page.getByRole('textbox',{name:'Fan name',exact:true}).waitFor()
  assert.equal(await page.getByRole('textbox',{name:'Fan name',exact:true}).inputValue(),'Email Fan')
  await button('Cancel').click()
  await button('Cancel invitation').click()
  assert.equal(await page.evaluate(()=>window.alert.title),'End Fan access')
  await page.evaluate(()=>window.alert.buttons[0].onPress?.())
  await button('Collapse Email Fan details').click()
  await button('Show QR code').first().click()
  await page.getByLabel('Fan invitation QR code').waitFor()
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='renew_fan_invitation').length),0)
  await button('Resend link').first().click()
  assert.match(await page.evaluate(()=>window.alert.message),/previous link will stop working/)
  await page.evaluate(()=>window.alert.buttons[0].onPress?.())
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='renew_fan_invitation').length),0)
  await button('Resend link').first().click()
  await page.evaluate(()=>window.alert.buttons[1].onPress())
  await page.waitForFunction(()=>window.emailRequests===2)
  assert.equal(await page.evaluate(()=>window.rows.length),3)
  await page.evaluate(()=>{window.rows[1].expires_at=new Date(Date.now()-60000).toISOString();window.rows[1].status='expired';window.remount()})
  await page.getByText('Expired',{exact:true}).waitFor()
  await button('Show QR code').nth(1).click()
  await page.evaluate(()=>window.alert.buttons[1].onPress())
  await page.getByLabel('Fan invitation QR code').waitFor()
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='renew_fan_invitation').length),2)
  await page.screenshot({path:`${out}/renewed-qr.png`,fullPage:true})

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
    window.responses={schedule:{schedule:[{id:'training',title:'Shared training',date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),time:'18:00'}]},matches:{matches:[{id:'match',opponent:'Away Club',home_score:0,away_score:0,match_date:new Date(Date.now()+8*86400000).toISOString().slice(0,10),status:'live'}]},development:{reports:[{id:'report',form:{name:'Shared report'},recordDate:'2026-09-01'}]},resources:{resources:[{id:'resource',title:'Shared practice'}]},notifications:{notifications:[{id:'notice',title:'Shared goal',body:'Goal scored'}]}};
    window.remount();
  });
  await page.getByText('Followed Child',{exact:true}).waitFor();
  await page.getByRole('heading',{name:'Players',exact:true}).waitFor();
  assert.equal(await button('Join club').count(),0,'Join club is removed from Home');
  assert.equal(await button('Open Followed Child').count(),0,'Player identity does not duplicate a content shortcut');
  await page.getByRole('tab',{name:'More',exact:true}).click();
  await button('Partners and Special Offers').click();
  await page.getByRole('heading',{name:'Partners & Special Offers',exact:true}).waitFor();
  await page.getByText('Our partners and their offers will appear here. Check back soon.').waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='partner_feed').at(-1).args.p_app),'parent');
  await button('Back to More').click();
  await button('Settings').click();
  await button('Open a Fan invitation').click();
  await page.getByLabel('Invitation link',{exact:true}).fill('https://unrelated.example/fan-invite/test');
  assert.equal(await button('Open invitation').isDisabled(),true);
  await page.getByLabel('Invitation link',{exact:true}).fill('https://parent.footballplayer.online/fan-invite/test-token');
  assert.equal(await button('Open invitation').isEnabled(),true);
  await button('Cancel').click();
  await button('Open invitation').waitFor({state:'hidden'});
  await page.getByRole('tab',{name:'Home',exact:true}).click();
  assert.equal(await button('Remove my access to Followed Child').count(),0,'Removal is absent from the player card');
  assert.equal(await page.getByRole('button',{name:/More actions|Player options/}).count(),0);
  assert.equal(await button('Sign out').count(),0,'Sign out is absent from Home');
  await page.getByRole('tab',{name:'More',exact:true}).click();
  await button('Settings').click();
  await button('Remove my access to Followed Child').waitFor();
  await page.getByText('Phone notifications are available in the mobile app.').waitFor();
  await page.evaluate(()=>{window.phonePlatform('ios');window.phonePermission={status:'granted',canAskAgain:true}});
  await button('Back to More').click();await button('Settings').click();
  await page.getByText('This device is not registered for phone notifications.').waitFor();
  await button('Enable phone notifications').click();
  await page.getByText('Phone notifications are enabled on this device.').waitFor();
  assert.equal(await button('Enable phone notifications').count(),0,'Enabled registration replaces the enable action');
  await page.screenshot({path:`${out}/phone-notifications-enabled.png`,fullPage:true});
  await page.evaluate(()=>{window.phonePermission={status:'denied',canAskAgain:false}});
  await button('Back to More').click();await button('Settings').click();
  await page.getByText('Phone notifications are off on this device.').waitFor();
  await button('Open phone settings').waitFor();
  await page.evaluate(()=>{window.phonePermission={status:'granted'};window.phoneRegistered=false;window.failPhoneRegistration=true});
  await button('Back to More').click();await button('Settings').click();
  await button('Enable phone notifications').click();
  await page.getByRole('alert').getByText('Phone registration failed. Try again.').waitFor();
  assert.equal(await page.getByText('Phone notifications are enabled on this device.').count(),0,'Registration failure cannot show enabled');
  await page.evaluate(()=>{window.failPhoneRegistration=false});
  await button('Enable phone notifications').click();
  await page.getByText('Phone notifications are enabled on this device.').waitFor();
  await page.evaluate(()=>window.phonePlatform('web'));

  await page.evaluate(()=>window.mode('light'));
  await page.locator('[data-mode="light"]').waitFor();
  await page.screenshot({path:`${out}/settings-light-390.png`,fullPage:true});
  await button('Sign out').click();
  await button('Stay signed in').waitFor();
  await page.waitForFunction(()=>{let el=[...document.querySelectorAll('[role=heading]')].find(el=>el.textContent==='Sign out?'); if(!el)return false; while(el){if(Number(getComputedStyle(el).opacity)<0.99)return false;el=el.parentElement}return true});
  await page.screenshot({path:`${out}/signout-confirmation-light-390.png`,fullPage:true});
  await button('Stay signed in').click();
  assert.equal(await page.evaluate(()=>window.signedOut||0),0);
  await button('Sign out').click();
  await page.evaluate(()=>{window.failSignOut=true});
  await button('Confirm sign out').click();
  await page.getByRole('alert').filter({hasText:'Could not sign out. Try again.'}).last().waitFor();
  assert.equal(await page.evaluate(()=>window.signedOut||0),0);
  await page.evaluate(()=>{window.failSignOut=false});
  await button('Confirm sign out').click();
  await page.waitForFunction(()=>window.signedOut===1);
  await button('Confirm sign out').waitFor({state:'hidden'});
  await page.getByRole('tab',{name:'Home',exact:true}).click();
  for(const width of [320,390,430,512]) {
    await page.setViewportSize({width,height:850});
    for(const mode of ['light','dark']) {
      await page.evaluate(mode=>window.mode(mode),mode);
      await page.screenshot({path:`${out}/players-cards-${mode}-${width}.png`,fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await assertRenderedTextContrast(page,`Player cards ${mode} ${width}`);
      const developmentBox=await button('Development records').boundingBox();
      assert.ok(developmentBox.width >= 220 && developmentBox.height >= 56,'Feature rows retain readable width and touch targets');
      const nav=await page.getByRole('tablist').boundingBox();
      assert.ok(nav.y > 700 && nav.height >= 64,'Navigation stays at bottom of the viewport');
    }
  }
  await page.setViewportSize({width:390,height:844});
  for(const mode of ['light','dark']) {
    await page.evaluate(mode=>window.mode(mode),mode);
    for(const [label,title,expected] of [['Schedule','Calendar','Shared training'],['Game Day','Game Day','Demo FC v Away Club'],['Development records','Development','Shared report'],['Resources','Resources','Shared practice'],['View notifications','Notifications','Shared goal']]) {
      await button(label).click();
      await page.getByRole('heading',{name:title,exact:true}).waitFor();
      await page.getByText(expected,{exact:expected!=='Shared report'}).waitFor();
      await page.waitForFunction(title=>[...document.querySelectorAll('[role=heading]')].some(el=>el.textContent===title&&el.getBoundingClientRect().y>=0&&el.getBoundingClientRect().y<330),title);
      const heading=await page.getByRole('heading',{name:title,exact:true}).boundingBox();
      assert.ok(heading.y>=59&&heading.y<330,'Opened section heading is visible immediately');
      const backBox=await button('Back to Fans').boundingBox();assert.ok(backBox.y>=59&&backBox.height>=44,'Back is below the iPhone status area and has a usable touch target');
      assert.equal(await button('Hide Development report').count(),0);assert.equal(await button('Hide resource').count(),0);
      if(title==='Calendar'){assert.equal(await button('History').count(),0);assert.equal(await button('Needs response').count(),0);const date=new Date((await page.evaluate(()=>window.responses.schedule.schedule[0].date))+'T12:00:00Z');const label=date.getUTCDate()+' '+new Intl.DateTimeFormat('en-GB',{month:'short',timeZone:'Europe/London'}).format(date).slice(0,3);await page.getByText(new RegExp(label)).waitFor();}
      await assertRenderedTextContrast(page,`Fan content ${mode} ${title}`);
      await page.screenshot({path:`${out}/content-${mode}-${title.replaceAll(' ','-')}.png`});
      if(title==='Game Day'){
        await page.route('http://localhost:9877/kits/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><path fill="#af2555" d="M16 5h24l12 12-8 8-5-5v31H17V20l-5 5-8-8z"/></svg>'}));
        for(const choice of ['home','away','tbc']) {
          await page.evaluate(choice=>{window.responses.matches.matches[0].shirt_choice=choice;window.responses.matches.clubKits={home:{colour:'#123456',imagePath:'club/home/custom.png'},away:{colour:'#af2555',imagePath:'club/away/custom.png'}}},choice);
          await page.getByText('Demo FC v Away Club',{exact:true}).click();
          await page.getByRole('heading',{name:'Demo FC v Away Club',exact:true}).waitFor();
          assert.equal(await page.getByRole('button',{name:/See squad|Register interest|Start match/}).count(),0);
          const matchDate=new Date((await page.evaluate(()=>window.responses.matches.matches[0].match_date))+'T12:00:00Z');await page.getByText(new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}).format(matchDate),{exact:true}).waitFor();
          const label=choice==='tbc'?'Kit to be confirmed':choice==='home'?'Home kit':'Away kit';
          await page.getByText(label,{exact:true}).waitFor();
          if(choice!=='tbc') {
            await page.waitForFunction(choice=>[...document.querySelectorAll('img')].some(img=>img.src.endsWith('/'+choice+'/custom.png')&&img.complete&&img.naturalWidth>0),choice);
            await page.screenshot({path:`${out}/custom-kit-${mode}-${choice}.png`});
          } else assert.equal(await page.locator('img[src*="/kits/"]').count(),0);
          assert.equal(await page.evaluate(()=>window.directKitReads||0),0);
          await button('Back to Matchday').click();
        }
      }
      if(title==='Development'){await button('View Development report').click();await button('Back to Development').waitFor();assert.equal(await button('Share PDF').count(),0);await page.getByText(/1 Sept 2026/).waitFor();}
      if(title==='Resources'){await page.evaluate(()=>{window.failRead=true});await page.getByText('Shared practice',{exact:true}).click();await page.getByRole('alert').getByText('Could not load shared items. Try again.').waitFor();await page.evaluate(()=>{window.failRead=false});}
      await button('Back to Fans').click();
    }
  }
  await page.evaluate(()=>{window.responses.schedule={schedule:[]}});
  await button('Schedule').click();
  await page.getByText('There are no shared calendar events for this player.').waitFor();
  await button('Back to Fans').click();
  await page.evaluate(()=>{window.failRead=true});
  await button('Schedule').click();
  await page.getByRole('alert').getByText('Could not load shared items. Try again.').waitFor();
  await page.evaluate(()=>{window.failRead=false});
  await button('Try again').click();
  await page.getByText('There are no shared calendar events for this player.').waitFor();
  await button('Back to Fans').click();
  await page.evaluate(()=>{window.delayRead=true});
  await button('Schedule').click();
  await page.getByText('Loading schedule...').waitFor();
  await button('Back to Fans').click();
  await page.evaluate(()=>{window.delayRead=false;window.finishRead()});
  await button('Game Day').click();
  await page.getByText('Demo FC v Away Club',{exact:true}).waitFor();
  assert.equal(await page.getByText('There are no shared calendar events for this player.').count(),0);
  await button('Back to Fans').click();
  await page.evaluate(()=>{window.rows[0].permissions.schedule=false;window.responses.matches.matches.push({id:'future-private',status:'scheduled',opponent:'Hidden upcoming fixture',match_date:'2099-01-01'});window.remount()});
  await button('Game Day').waitFor();
  await button('Schedule').waitFor({state:'hidden'});
  assert.equal(await button('Schedule').count(),0,'Schedule shortcut is absent without permission');
  assert.equal(await button('Open Followed Child').count(),0,'Identity row never opens a fallback destination');
  await button('Game Day').click();
  await page.getByRole('heading',{name:'Live matches',exact:true}).waitFor();
  await page.getByText('Demo FC v Away Club',{exact:true}).waitFor();
  assert.equal(await page.getByText(/Hidden upcoming fixture/).count(),0,'Defensive client filter hides an unstarted match');
  assert.equal(await page.getByRole('button',{name:/Coming up/}).count(),0,'Game Day has no schedule tab');
  await page.evaluate(()=>{window.rows[0].permissions.game_day=false;window.background()});
  await button('Back to Fans').waitFor({state:'hidden'});
  await button('Game Day').waitFor({state:'hidden'});
  await page.evaluate(()=>{
    window.rows=[
      {id:'sample-a',is_owner:false,status:'active',player_name:'Jenson Bailey',club_name:'Cambourne Town FC',team_name:'U14 JPL 26/27',theme_accent:'#0645a6',notifications_enabled:true,permissions:{schedule:true,game_day:true,development:true,resources:false}},
      {id:'sample-b',is_owner:false,status:'active',player_name:'John Barnes',club_name:'Football Player Demo FC',team_name:'U17 Green',theme_accent:'#0645a6',notifications_enabled:true,permissions:{schedule:true,game_day:true,development:true,resources:true}},
    ];window.mode('light');window.remount();
  });
  await page.getByText('Jenson Bailey',{exact:true}).waitFor();
  assert.equal(await button('Resources').count(),1,'Each card retains its own permission set');
  await page.getByRole('tab',{name:'More',exact:true}).click();
  await button('Settings').click();
  await button('Remove my access to Jenson Bailey').waitFor();
  await page.setViewportSize({width:512,height:850});
  await page.screenshot({path:`${out}/players-reference-layout.png`,fullPage:true});
  await assertRenderedTextContrast(page,'Players reference layout');
  await button('Remove my access to Jenson Bailey').click();
  assert.equal(await page.evaluate(()=>window.alert.title),'Remove my access');
  await page.evaluate(()=>{
    window.standalone=false;window.user={id:'parent-test',parentPortalLinks:[{id:'second',playerName:'FP TEST Player',clubName:'Demo FC'}]};
    window.rows=[{id:'convert-player',is_owner:true,parent_link_id:'second',status:'active',relationship_type:'fan',name:'FP TEST Account',email:'player@example.test',player_name:'FP TEST Player',permissions:{schedule:false,game_day:true,development:false,resources:false}}];window.remount();
  });
  await button('Edit access').click();await button('Make this the Player account').click();
  await page.getByText('Make this the Player account?',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='set_fan_player_account').length),0);
  await button('Confirm Player account').click();
  await page.waitForFunction(()=>window.rows[0].relationship_type==='player');
  await page.evaluate(()=>{window.standalone=true;window.user={id:'fan-test',parentPortalLinks:[]};window.rows[0].is_owner=false;window.responses.attendance={attendance:[{id:'event',title:'FP TEST Match',date:'2026-09-19',response:'available'}]};window.remount()});
  await button('Attendance').click();await page.getByText('My attendance',{exact:true}).waitFor();
  await page.getByText('Available',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/^(Accept|Decline|Maybe)$/}).count(),0);
  await page.evaluate(()=>{window.ownerFixture();window.mode('light');window.remount();window.normalSwitch('first');window.navigate()});
  await button('Jenson Bailey (selected)').waitFor();
  assert.equal(await page.getByTestId('owner-fan-compact-0').count(),1,'The real Player account is retained alongside Fans');
  assert.equal(await page.getByLabel('6 accounts and invitations',{exact:true}).count(),1);
  assert.equal(await page.getByText('You are not following any players yet. Open a Fan invitation to get started.').count(),0,'Parent owner view has no irrelevant follow invitation footer');
  for(const width of [320,390,518]) {
    await page.setViewportSize({width,height:850});
    for(const mode of ['light','dark']) {
      await page.evaluate(mode=>window.mode(mode),mode);
      await page.locator('[data-mode="'+mode+'"]').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await assertRenderedTextContrast(page,'Compact owner Fans '+mode+' '+width);
      for(const label of ['Edit access','Revoke access','Show QR code','Resend link']) {
        const box=await button(label).first().boundingBox();assert.ok(box.width>=44&&box.height>=44,'Icon actions retain 44px targets');
      }
      const first=await page.getByTestId('owner-fan-compact-0').boundingBox();
      const last=await page.getByTestId('owner-fan-compact-5').boundingBox();
      assert.ok(last.y+last.height-first.y<=324,'All six rows remain compact');
      await page.screenshot({path:`${out}/owner-compact-${mode}-${width}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:390,height:844});
  await button('Expand Jenson Bailey details').click();
  await page.getByText('Player account | Active',{exact:true}).waitFor();
  await page.getByText('jenson.bailey@example.test',{exact:true}).last().waitFor();
  await button('Collapse Jenson Bailey details').click();
  await button('Revoke access').nth(1).click();
  assert.equal(await page.evaluate(()=>window.alert.title),'End Fan access');
  await page.evaluate(()=>window.alert.buttons[0].onPress?.());
  assert.equal(await page.getByTestId('owner-fan-compact-0').count(),1);
  assert.equal(await page.getByTestId('owner-fan-compact-1').count(),1,'Cancelling revoke keeps the Fan');
  await button('Show QR code').click();
  assert.equal(await page.evaluate(()=>window.alert.title),'Renew Fan invitation?');
  await page.evaluate(()=>window.alert.buttons[0].onPress?.());
  await button('Edit access').first().click();
  await page.getByRole('textbox',{name:'Fan name',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Fan name',exact:true}).inputValue(),'Jenson Bailey');
  assert.equal(await button('Make this the Player account').count(),0,'Existing Player account is preserved, not converted again');
  await button('Cancel').click();
  await button('Lucas Turner').click();
  await button('Lucas Turner (selected)').waitFor();
  await page.getByText('No Fan accounts for this player yet.').waitFor();
  assert.equal(await page.getByTestId('owner-fan-compact-0').count(),0,'Changing child scopes the owner list');
  await button('Jenson Bailey').click();
  await button('Jenson Bailey (selected)').waitFor();
  await page.getByTestId('owner-fan-compact-0').waitFor();
  assert.deepEqual(errors, [])
  console.log('PASS: native Fans child/header sync, persisted selection, email/QR/share remount, prominent branded action, confirmed cancelled-only deletion, retry after failure, normal child navigation.')
} finally { await browser.close() }
