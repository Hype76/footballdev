import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Actual handoff components with synthetic native/auth adapters. No real accounts or uploads.
const root = process.cwd(), require = createRequire(import.meta.url)
const teamId = '30000000-0000-4000-8000-000000000040', clubId = '10000000-0000-4000-8000-000000000001'
const user = { id: 'actor', activeTeamId: teamId, clubId, roleRank: 50 }
const output = path.join(root, 'output/coach-resource-upload')
await mkdir(output, { recursive: true })
const mocks = {
  native: `import React from 'react';export const View=({children,style})=><div style={style}>{children}</div>;export const Text=({children,style})=><span style={style}>{children}</span>;export const Pressable=({children,onPress,disabled,style})=><button style={style} disabled={disabled} onClick={onPress}>{children}</button>;export const Keyboard={dismiss:()=>{window.f.dismissals=(window.f.dismissals||0)+1;document.activeElement?.blur()}};const listen=(name,fn)=>{(window.f.listeners[name]||=new Set()).add(fn);return{remove:()=>window.f.listeners[name].delete(fn)}};export const Linking={addEventListener:(_,fn)=>listen('url',fn),openURL:async url=>{window.f.opened.push(url);if(window.f.holdOpen)await new Promise((resolve,reject)=>window.f.releaseOpen={resolve,reject});if(window.f.openError)throw Error('failed')}};export const AppState={addEventListener:(_,fn)=>listen('state',fn)};`,
  config: `export const getMobileRuntimeConfig=()=>({apiBaseUrl:'https://footballplayer.online'});`,
  cache: `export const invalidateMobileResource=(user,key)=>window.f.invalidations.push({user,key});`,
  auth: `import React from 'react';export function useAuth(){const[value,set]=React.useState(window.f.auth);window.changeAuth=v=>set(v);return {...value,signInWithPassword:async()=>window.changeAuth({session:{user:{id:'actor'}},user:window.f.user}),signOut:async()=>window.changeAuth({})}}`,
  client: `export const supabase={rpc:async(name,args)=>{window.f.checks.push({name,args});if(window.f.holdCheck)await new Promise(resolve=>window.f.releaseCheck=resolve);return{data:window.f.allowed,error:null}},from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{id:window.f.teamId,club_id:window.f.clubId,name:'Requested team'},error:null})})})})})};`,
  router: `export const useLocation=()=>({search:window.f.search});`,
  uploader: `import React from 'react';export const ResourceLibraryPage=({scopedUser})=><div data-testid="verified-uploader">{scopedUser.activeTeamId}:{scopedUser.activeTeamName}</div>;`,
}
async function compile(native) {
  const component = native ? 'CoachResourceUploadAction' : 'CoachResourceUploadPage'
  const file = native ? 'apps/coach-mobile/src/CoachResourceUploadAction.js' : 'src/pages/CoachResourceUploadPage.jsx'
  const entry = native ? `function App(){const[props,set]=React.useState(window.f.props);window.changeProps=p=>set(old=>({...old,...p}));const load=React.useCallback(async()=>{window.f.loads++;return !window.f.loadFails},[]);return <${component} {...props} load={load}/>}createRoot(document.getElementById('root')).render(<App/>);` : `createRoot(document.getElementById('root')).render(<${component}/>);`
  const result = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {${component}} from 'fixture';${entry}`, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'owned-synthetic-adapters', setup(b) {
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|scheduler)$/ }, args => ({ path: realpathSync(require.resolve(args.path)), namespace: 'source' }))
    b.onResolve({ filter: /^fixture$/ }, () => ({ path: path.join(root, file), namespace: 'source' }))
    const aliases = [[/^react-native$/, 'native'], [/\/config$/, 'config'], [/\/mobileResourceCache$/, 'cache'], [/(?:^|\/)auth\.js$/, 'auth'], [/supabase-client\.js$/, 'client'], [/^react-router-dom$/, 'router'], [/ResourceLibraryPage\.jsx$/, 'uploader']]
    for (const [filter, name] of aliases) b.onResolve({ filter }, () => ({ path: name, namespace: 'mock' }))
    b.onResolve({ filter: /^\.{1,2}\//, namespace: 'source' }, args => ({ path: createRequire(args.importer).resolve(args.path), namespace: 'source' }))
    b.onLoad({ filter: /.*/, namespace: 'source' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'jsx', resolveDir: path.dirname(args.path) }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }))
  } }] })
  return result.outputFiles[0].text
}
const nativeCode = await compile(true), webCode = await compile(false)
const browser = await chromium.launch(), errors = [], timings = []
let checks = 0
async function fixture(native, patch = {}, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  await page.setContent('<div id="root"></div>')
  await page.evaluate(({ user, teamId, clubId, patch }) => {
    window.f = { user, teamId, clubId, allowed: true, search: `?teamId=${teamId}&clubId=${clubId}`, auth: { user, session: { user: { id: user.id } } }, checks: [], loads: 0, opened: [], invalidations: [], listeners: {}, props: { user, stale: false, styles: { divider: { backgroundColor: '#ddd' }, heading: { fontSize: 16 }, helper: { fontSize: 14 } } }, ...patch }
    window.emit = (name, value) => { for (const fn of window.f.listeners[name] || []) fn(value) }
  }, { user, teamId, clubId, patch })
  await page.addScriptTag({ content: native ? nativeCode : webCode })
  return page
}
try {
  for (const width of [320, 390]) {
    const page = await fixture(true, { holdOpen: true }, width)
    await page.evaluate(() => { const input = document.createElement('input'); input.id = 'keyboard-focused'; document.body.prepend(input); input.focus() })
    await page.getByRole('button', { name: 'Upload files or photos' }).waitFor()
    const started = performance.now()
    await page.getByRole('button', { name: 'Upload files or photos' }).click()
    await page.getByRole('button', { name: 'Opening upload...' }).waitFor()
    timings.push(Math.round(performance.now() - started))
    assert.ok(timings.at(-1) < 1000)
    assert.equal(await page.evaluate(() => window.f.opened.length), 1)
    assert.equal(await page.evaluate(() => document.activeElement.id === 'keyboard-focused'), false)
    assert.ok(await page.evaluate(() => window.f.dismissals) >= 1)
    assert.equal(await page.getByRole('button', { name: 'Opening upload...' }).isDisabled(), true)
    await page.evaluate(() => window.f.releaseOpen.resolve())
    await page.getByRole('button', { name: 'Upload files or photos' }).waitFor()
    await page.evaluate(() => window.changeProps({ user: { ...window.f.user } }))
    await page.evaluate(() => window.emit('url', { url: 'footballplayercoach://resources-return?forged=true' }))
    assert.equal(await page.evaluate(() => window.f.loads), 0)
    await page.evaluate(() => window.emit('url', { url: 'footballplayercoach://resources-return' }))
    await page.getByText('Resources refreshed.', { exact: false }).waitFor()
    assert.equal(await page.evaluate(() => window.f.loads), 1)
    await page.evaluate(() => window.emit('state', 'active'))
    assert.equal(await page.evaluate(() => window.f.loads), 1, 'URL and foreground returns refresh once')
    assert.equal(await page.evaluate(() => window.f.invalidations[0].key), 'coach:phase31e:resources')
    await page.screenshot({ path: path.join(output, `native-${width}.png`) })
    checks++; await page.close()
  }
  const revoked = await fixture(true, { holdOpen: true })
  await revoked.getByRole('button', { name: 'Upload files or photos' }).click()
  await revoked.evaluate(() => window.changeProps({ user: { ...window.f.user, roleRank: 20 } }))
  await revoked.getByRole('button').waitFor({ state: 'detached' })
  await revoked.evaluate(() => { window.f.releaseOpen.reject(new Error('late')); window.emit('state', 'active') })
  assert.equal(await revoked.evaluate(() => window.f.loads), 0)
  checks++; await revoked.close()
  const earlyReturn = await fixture(true, { holdOpen: true })
  await earlyReturn.getByRole('button', { name: 'Upload files or photos' }).click()
  await earlyReturn.evaluate(() => window.emit('state', 'active'))
  await earlyReturn.getByRole('button', { name: 'Upload files or photos' }).waitFor()
  await earlyReturn.getByText('Resources refreshed.', { exact: false }).waitFor()
  await earlyReturn.evaluate(() => window.f.releaseOpen.resolve())
  assert.equal(await earlyReturn.getByText('Choose files or photos in your browser', { exact: false }).count(), 0)
  assert.equal(await earlyReturn.evaluate(() => window.f.loads), 1)
  checks++; await earlyReturn.close()
  const reopen = await fixture(true, { holdOpen: true })
  await reopen.getByRole('button', { name: 'Upload files or photos' }).click()
  await reopen.evaluate(() => { window.firstOpen = window.f.releaseOpen; window.emit('state', 'active') })
  await reopen.getByText('Resources refreshed.', { exact: false }).waitFor()
  await reopen.getByRole('button', { name: 'Upload files or photos' }).click()
  await reopen.getByRole('button', { name: 'Opening upload...' }).waitFor()
  await reopen.evaluate(() => window.firstOpen.reject(new Error('old browser open failed')))
  assert.equal(await reopen.getByRole('button', { name: 'Opening upload...' }).isDisabled(), true)
  assert.equal(await reopen.getByText('The upload page could not open. Try again.', { exact: true }).count(), 0)
  await reopen.evaluate(() => window.f.releaseOpen.resolve())
  await reopen.getByRole('button', { name: 'Upload files or photos' }).waitFor()
  checks++; await reopen.close()
  const fail = await fixture(true, { loadFails: true })
  await fail.getByRole('button', { name: 'Upload files or photos' }).click()
  await fail.evaluate(() => window.emit('state', 'active'))
  await fail.getByText('Resources could not refresh.', { exact: false }).waitFor()
  checks++; await fail.close()
  const login = await fixture(false, { auth: {} })
  await login.getByLabel('Email', { exact: true }).fill('test@example.test')
  await login.getByLabel('Password', { exact: true }).fill('unused-synthetic-password')
  await login.getByRole('button', { name: 'Sign in', exact: true }).click()
  await login.getByTestId('verified-uploader').waitFor()
  assert.match(await login.getByTestId('verified-uploader').innerText(), new RegExp(teamId))
  assert.equal(await login.getByRole('link', { name: 'Return to Coach' }).getAttribute('href'), 'footballplayercoach://resources-return')
  await login.getByRole('button', { name: 'Use another account' }).click()
  await login.getByTestId('verified-uploader').waitFor({ state: 'detached' })
  checks++; await login.close()
  for (const patch of [{ allowed: false }, { teamId: 'different' }, { clubId: 'different' }, { auth: { user: { ...user, clubId: 'wrong' }, session: { user: { id: 'actor' } } } }]) {
    const page = await fixture(false, patch)
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByTestId('verified-uploader').count(), 0)
    checks++; await page.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ checks, interactionFeedbackMs: timings, pageErrors: errors, synthetic: true }, null, 2))
  console.log(`PASS: ${checks} actual-component browser scenarios, immediate feedback ${timings.join('/')} ms, selected-team authority, fixed return, account changes and refresh failures.`)
} finally { await browser.close() }
