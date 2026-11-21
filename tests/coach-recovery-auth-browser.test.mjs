import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = await readFile(path.join(root, 'apps/coach-mobile/App.js'), 'utf8')
const node = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(item => item.type === 'FunctionDeclaration' && item.id?.name === 'RecoveryNoticeBoundary')
assert.ok(node)
const mocks = {
  './MobilePasswordRecovery': 'export const MobilePasswordRecovery=()=>null',
  './biometrics': 'export const getBiometricEnabled=async()=>false; export const setBiometricEnabled=async()=>{}; export const authenticateWithBiometrics=async()=>{}',
  './config': 'export const getMobileRuntimeConfig=()=>({isUsable:true})',
  './liveMatchFollow': 'export const revokeLiveMatchFollowsBeforeSignOut=async()=>{}; export const clearLiveMatchOnSignOut=async()=>{}',
  './notifications': 'export const revokeNativePushDevice=async()=>{}',
  './profile': `export async function fetchMobileProfile(user){if(['startup','offline-reopen'].includes(window.mode))throw Error('network unavailable');if(window.mode.startsWith('revoked'))throw Object.assign(Error('denied'),{code:'42501'});return {id:user.id,role:'coach'}}`,
  './supabase': `export const supabase={get auth(){return window.mockAuth}};export const clearMobileSessionStorage=async()=>{if(window.mode==='revoked-credential-cleanup-unavailable')throw Error('Device storage unavailable');localStorage.setItem('session-cleared','1')};export const getAccessToken=async()=>'';export const isSupabaseConfigured=true;export const mobileConfigError='';export const mobileSessionStorageError='';export const readSavedMobileSession=async()=>localStorage.getItem('session-cleared')?null:window.testSession`,
  './mobileResourceCache': 'export const mobileResourceCache={clear(){}}',
}
const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text } from 'react-native-web';
import { AuthProvider, useMobileAuth } from './apps/mobile-core/src/auth.js';
import { createCoachRecoveryNotice } from './apps/coach-mobile/src/coachRecoveryNotice.js';
const SafeAreaView = View;
window.mode = new URLSearchParams(location.search).get('mode');
if (window.mode.startsWith('revoked')) localStorage.setItem('verified-profile','present');
window.testSession = localStorage.getItem('session-cleared') ? null : { user:{id:'test-user'},access_token:'synthetic',expires_at:4102444800 };
window.mockAuth = {
  startAutoRefresh(){},stopAutoRefresh(){},getSession:async()=>({data:{session:window.testSession}}),
  signOut:async()=>{window.authEvent?.('SIGNED_OUT',null);return {error:null}},
  onAuthStateChange(fn){window.authEvent=fn;return {data:{subscription:{unsubscribe(){}}}}},
};
const storage = {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value)};
const coachRecoveryNotice = createCoachRecoveryNotice(storage, 'auth-recovery');
const fail = () => { const error=Error('offline_storage_file_unavailable'); coachRecoveryNotice.report(error); throw error };
const offlineStore = {
  read: async id => {
    if (window.mode === 'startup') return fail()
    if (window.mode === 'slow-storage' || window.mode.startsWith('revoked')) return new Promise(resolve => { window.finishCacheRead = () => resolve({id,role:'coach'}) })
    if (window.mode === 'offline-reopen' && !localStorage.getItem('verified-profile')) return null
    return {id,role:'coach'}
  },
  write: async value => window.mode === 'slow-storage' ? new Promise(resolve => { window.finishCacheWrite = () => resolve(value) }) : value,
  clear: async () => { localStorage.setItem('drafts-cleared','1'); return fail() },
  revoke: async () => {
    if (window.mode !== 'revoked') throw Error('Device storage unavailable')
    localStorage.removeItem('verified-profile')
  },
};
${source.slice(node.start,node.end)}
function Screen(){const auth=useMobileAuth();window.testAuth=auth;return <Text>{auth.startupState}</Text>}
createRoot(document.getElementById('root')).render(<AuthProvider appRole="coach" offlineProfileStore={offlineStore}><RecoveryNoticeBoundary><Screen/></RecoveryNoticeBoundary></AuthProvider>);
`
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, loader: { '.js': 'jsx' }, platform: 'browser', format: 'iife', logLevel: 'silent', alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web'), 'react-native-web': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, plugins: [{ name: 'auth-fixtures', setup(b) { b.onResolve({ filter: /^\.\// }, args => /[/\\]auth\.js$/.test(args.importer) && mocks[args.path] ? { path: args.path, namespace: 'auth-mock' } : undefined); b.onLoad({ filter: /.*/, namespace: 'auth-mock' }, args => ({ contents: mocks[args.path], loader: 'js' })) } }] })
const server = createServer((request, response) => { if (request.url.startsWith('/test.js')) { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(bundle.outputFiles[0].text) } else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><div id="root"></div><script src="/test.js"></script>') } })
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const browser = await chromium.launch({ headless: true })
test.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)) })

test('Coach enters with a verified live profile before the cache read or write finishes', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=slow-storage`)
    await page.getByText('READY_SIGNED_IN').waitFor()
    assert.equal(await page.evaluate(() => typeof window.finishCacheRead), 'function')
    assert.equal(await page.evaluate(() => typeof window.finishCacheWrite), 'function')
    await page.evaluate(() => { window.finishCacheRead(); window.finishCacheWrite() })
    assert.equal(await page.evaluate(() => window.testAuth.user?.isOfflineProfile), undefined)
  } finally { await page.close() }
})

test('A confirmed denial clears saved Coach access even when the cache read is still stalled', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=revoked`)
    await page.getByText('RECOVERABLE_ERROR').waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('verified-profile')), null)
    await page.evaluate(() => window.finishCacheRead())
    assert.equal(await page.evaluate(() => window.testAuth.user), null)
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=offline-reopen`)
    await page.getByText('RECOVERABLE_ERROR').waitFor()
    assert.equal(await page.evaluate(() => window.testAuth.user), null)
  } finally { await page.close() }
})

test('A confirmed denial removes the saved sign-in if neither storage can save the marker', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=revoked-storage-unavailable`)
    await page.getByText('RECOVERABLE_ERROR').waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('session-cleared')), '1')
    assert.equal(await page.evaluate(() => localStorage.getItem('drafts-cleared')), null)
    assert.equal(await page.evaluate(() => localStorage.getItem('verified-profile')), 'present')
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=offline-reopen`)
    await page.getByText('READY_SIGNED_OUT').waitFor()
    assert.equal(await page.evaluate(() => window.testAuth.user), null)
  } finally { await page.close() }
})

test('Failed credential cleanup keeps Coach in sign-in recovery even after an old token refresh', async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=revoked-credential-cleanup-unavailable`)
    await page.getByText('RECOVERABLE_ERROR').waitFor()
    assert.equal(await page.evaluate(() => window.testAuth.startupDiagnosticCode), 'COACH_SAVED_ACCESS_CLEAR_FAILED')
    await page.evaluate(() => window.authEvent('TOKEN_REFRESHED', window.testSession))
    assert.equal(await page.evaluate(() => window.testAuth.user), null)
    assert.equal(await page.evaluate(() => window.testAuth.session), null)
    assert.equal(await page.evaluate(() => localStorage.getItem('drafts-cleared')), null)
    await page.evaluate(() => window.testAuth.retryStartup())
    await page.getByText('READY_SIGNED_OUT').waitFor()
  } finally { await page.close() }
})

for (const mode of ['startup', 'signout', 'reset']) test(`actual auth flow surfaces recovery warning during ${mode}`, async () => {
  const page = await browser.newPage()
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`)
    if (mode !== 'startup') {
      await page.waitForFunction(() => window.testAuth?.user?.id === 'test-user')
      if (mode === 'signout') await page.evaluate(() => window.testAuth.signOut())
      else await page.evaluate(() => window.testAuth.resetLocalAppData())
    }
    await page.getByRole('alert').waitFor({ timeout: 10000 })
    assert.match(await page.getByRole('alert').innerText(), /Keep app data and contact support/)
  } finally { await page.close() }
})
