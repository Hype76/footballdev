import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Actual Coach component with synthetic native adapters. This establishes React
// lifecycle behaviour, not iOS/Android binary support or handset receipt.
const root = process.cwd(), require = createRequire(import.meta.url)
const output = path.join(root, 'output', 'phone-branding-browser')
await mkdir(output, { recursive: true })
const teamId = '30000000-0000-4000-8000-000000000040', clubId = '10000000-0000-4000-8000-000000000001'
const actorId = '20000000-0000-4000-8000-000000000001'
const management = { enabled: true, teamId, clubId, state: 'unclaimed', claimAllowed: true, logoAllowed: false, coloursAllowed: false, termsVersion: 'v1' }
const mocks = {
  native: `import React from 'react';export const View=({children,style})=><div style={style}>{children}</div>;export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={style}>{children}</span>;export const Image=({source})=><img src={source?.uri}/>;export const TextInput=({value,onChangeText,accessibilityLabel})=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/>;export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityRole,style})=><button role={accessibilityRole||'button'} style={style} aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;const listen=(name,fn)=>{(window.fixture.listeners[name]||=new Set()).add(fn);return{remove:()=>window.fixture.listeners[name].delete(fn)}};export const Linking={getInitialURL:async()=>window.fixture.initialUrl||null,addEventListener:(_,fn)=>listen('url',fn),openURL:async url=>{window.fixture.opened.push(url);if(window.fixture.deferOpening)await new Promise((resolve,reject)=>(window.fixture.openPromises||=[]).push({resolve,reject}));if(window.fixture.openError)throw Error('failed')}};export const AppState={addEventListener:(_,fn)=>listen('state',fn)};`,
  storage: `export default {getItem:async key=>window.fixture.storage[key]||null,setItem:async(key,value)=>{window.fixture.storage[key]=value}}`,
  account: `export async function mobileAccountRequest(_,name,body,actor){window.fixture.reads.push({name,body,actor});if(window.fixture.denied)throw Error('denied');if(name==='create-coach-web-handoff'){if(window.fixture.deferHandoff)await new Promise(resolve=>(window.fixture.handoffs||=[]).push(resolve));return {actorId:actor,teamId:body.teamId,purpose:body.purpose,tokenHash:'a'.repeat(56)}}if(body.action==='claim')window.fixture.management={...window.fixture.management,state:'provisional',claimAllowed:false,logoAllowed:true,coloursAllowed:true};if(body.action==='save')window.fixture.management={...window.fixture.management,accent:body.accent};return window.fixture.management}`,

}
const compiled = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CoachTeamBrandingSetup} from 'fixture-native';function App(){const[props,set]=React.useState(window.fixture.props);window.changeProps=p=>set(old=>({...old,...p}));const refresh=React.useCallback(async()=>{window.fixture.refreshes++},[]);return <CoachTeamBrandingSetup {...props} refreshUserProfile={refresh}/>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'synthetic-native-adapters', setup(b) {
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|scheduler)$/ }, args => ({ path: realpathSync(require.resolve(args.path)), namespace: 'source' }))
    b.onResolve({ filter: /^fixture-native$/ }, () => ({ path: path.join(root, 'apps/coach-mobile/src/CoachTeamBrandingSetup.js'), namespace: 'source' }))
    b.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native', namespace: 'mock' }))
    b.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: 'storage', namespace: 'mock' }))
    b.onResolve({ filter: /mobileSignup$/ }, () => ({ path: 'account', namespace: 'mock' }))
    b.onResolve({ filter: /^\.{1,2}\//, namespace: 'source' }, args => ({ path: createRequire(args.importer).resolve(args.path), namespace: 'source' }))
    b.onLoad({ filter: /.*/, namespace: 'source' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'jsx', resolveDir: path.dirname(args.path) }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }))
  } }],
})
const browser = await chromium.launch()
let checks = 0
const errors = []
async function fixture({ state = management, prompt = true, initialUrl = '', contextPatch = {}, userPatch = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  await page.setContent('<html><body><div id="root"></div></body></html>')
  await page.evaluate(({ state, prompt, initialUrl, teamId, clubId, actorId, contextPatch, userPatch }) => {
    window.fixture = { management: state, initialUrl, opened: [], storage: {}, reads: [], listeners: {}, refreshes: 0,
      props: { prompt, apiBaseUrl: 'https://footballplayer.online', context: { teamId, clubId, role: 'head_manager', roleRank: 70, ...contextPatch }, user: { id: actorId, accountStatus: 'active', ...userPatch }, palette: { textPrimary: '#142a1d', textSecondary: '#324d3c', accentText: '#047857', border: '#ccd8d0' } } }
    window.emitNative = (type, value) => { for (const fn of window.fixture.listeners[type] || []) fn(value) }
  }, { state, prompt, initialUrl, teamId, clubId, actorId, contextPatch, userPatch })
  await page.addScriptTag({ content: compiled.outputFiles[0].text })
  return page
}
try {
  const page = await fixture()
  await page.getByRole('button', { name: 'Add or edit badge and colour' }).waitFor()
  await page.getByRole('button', { name: 'Do this later' }).click()
  assert.equal(await page.getByRole('button', { name: 'Add or edit badge and colour' }).count(), 0)
  await page.evaluate(() => window.changeProps({ prompt: false }))
  await page.getByRole('button', { name: 'Add or edit badge and colour' }).click()
  await page.getByText('Team badge and colour', {exact:true}).waitFor()
  assert.equal(await page.evaluate(() => window.fixture.opened.length), 0)
  await page.getByRole('checkbox').click()
  await page.getByRole('button', {name: "Claim this team's place"}).click()
  await page.getByRole('button', {name:'Upload team badge'}).waitFor()
  await page.getByRole('radio', {name:'blue team colour'}).click()
  await page.getByRole('button', {name:'Save team colour'}).click()
  await page.getByText('Team colour saved.', {exact:true}).waitFor()
  assert.equal(await page.evaluate(() => window.fixture.management.accent), 'blue')
  assert.equal(await page.evaluate(() => window.fixture.opened.length), 0)
  await page.getByRole('button', {name:'Upload team badge'}).click()
  await page.waitForFunction(() => window.fixture.opened.length === 1)
  assert.match(await page.evaluate(() => window.fixture.opened[0]), /^https:\/\/footballplayer\.online\/coach-app-handoff#token_hash=/)

  await page.evaluate(() => window.emitNative('state', 'active'))
  await page.waitForFunction(() => window.fixture.refreshes === 2)
  await page.evaluate(() => window.emitNative('url', { url: 'footballplayercoach://branding-return?token=forged' }))
  assert.equal(await page.evaluate(() => window.fixture.refreshes), 2)
  await page.evaluate(() => window.emitNative('url', { url: 'footballplayercoach://branding-return' }))
  await page.waitForFunction(() => window.fixture.refreshes === 3)
  await page.screenshot({ path: path.join(output, 'coach-branding-settings-synthetic.png'), fullPage: true })
  checks += 5; await page.close()
  const cold = await fixture({ prompt: false, initialUrl: 'footballplayercoach://branding-return' })
  await cold.waitForFunction(() => window.fixture.refreshes === 1)
  await cold.evaluate(() => window.changeProps({ visible: false }))
  await cold.evaluate(() => window.changeProps({ visible: true }))
  assert.equal(await cold.evaluate(() => window.fixture.refreshes), 1)
  checks++; await cold.close()
  const paid = await fixture({ prompt: false, contextPatch: { teamBrandingDisplay: { source: 'paid_club' } } })
  await paid.getByText('Your badge and colours are managed by your Club.').waitFor()
  assert.equal(await paid.getByRole('button', { name: 'Add or edit badge and colour' }).count(), 0)
  checks++; await paid.close()
  const paidTeam = await fixture({ state: { ...management, claimAllowed: false } })
  await paidTeam.waitForFunction(() => window.fixture.reads.length === 1)
  assert.equal(await paidTeam.getByRole('button').count(), 0)
  checks++; await paidTeam.close()
  for (const change of ['team', 'account']) {
    const changed = await fixture({prompt:false,state:{...management,state:'permanent',claimAllowed:false,logoAllowed:true,coloursAllowed:true}})
    await changed.getByRole('button',{name:'Add or edit badge and colour'}).click()
    await changed.evaluate(()=>window.fixture.deferHandoff=true)
    await changed.getByRole('button',{name:'Upload team badge'}).click()
    await changed.waitForFunction(()=>window.fixture.handoffs?.length===1)
    await changed.evaluate(change=>{
      if(change==='account')window.changeProps({user:{...window.fixture.props.user,id:'20000000-0000-4000-8000-000000000002'}})
      else{const context={...window.fixture.props.context,teamId:'30000000-0000-4000-8000-000000000041'};window.fixture.management={...window.fixture.management,teamId:context.teamId};window.changeProps({context})}
    },change)
    await changed.getByRole('button',{name:'Add or edit badge and colour'}).waitFor()
    await changed.evaluate(()=>window.fixture.handoffs[0]())
    assert.equal(await changed.evaluate(()=>window.fixture.opened.length),0)
    checks++;await changed.close()
  }
  const off = await fixture({ state: { enabled: false } })
  await off.waitForFunction(() => window.fixture.reads.length === 1)
  assert.equal(await off.getByRole('button').count(), 0)
  checks++; await off.close()
  for (const userPatch of [{ isOfflineProfile: true }, { accountStatus: 'suspended' }]) {
    const denied = await fixture({ userPatch })
    assert.equal(await denied.getByRole('button').count(), 0)
    assert.equal(await denied.evaluate(() => window.fixture.reads.length), 0)
    checks += 2; await denied.close()
  }
  const clubAdmin = await fixture({ prompt: false, contextPatch: { teamId: null, role: 'admin', roleRank: 90 }, userPatch: { role: 'admin', roleRank: 90, planKey: 'club' } })
  await clubAdmin.getByRole('button', { name: 'Add or edit Club badge and colour' }).waitFor()
  await clubAdmin.getByRole('button', { name: 'Add or edit Club badge and colour' }).click()
  assert.equal(await clubAdmin.evaluate(() => window.fixture.opened[0]), `https://footballplayer.online/club-appearance?clubId=${clubId}`)
  assert.equal(await clubAdmin.evaluate(() => window.fixture.reads.length), 0)
  await clubAdmin.evaluate(() => window.emitNative('url', { url: 'footballplayercoach://branding-return' }))
  await clubAdmin.waitForFunction(() => window.fixture.refreshes === 1)
  checks += 3; await clubAdmin.close()
  const clubTeamAdmin = await fixture({ prompt: false, userPatch: { role: 'head_manager', roleRank: 70, planKey: 'club' } })
  assert.equal(await clubTeamAdmin.getByRole('button').count(), 0)
  assert.equal(await clubTeamAdmin.evaluate(() => window.fixture.reads.length), 0)
  checks += 2; await clubTeamAdmin.close()
  assert.deepEqual(errors, [])
  console.log(`Synthetic Coach component rehearsal passed: ${checks} checks; no external requests or page errors. Native adapters were mocked.`)
} finally { await browser.close() }
