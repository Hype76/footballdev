import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const mocks = {
  './biometrics': 'export const getBiometricEnabled=async()=>false; export const setBiometricEnabled=async()=>{}; export const authenticateWithBiometrics=async()=>{}',
  './config': 'export const getMobileRuntimeConfig=()=>({isUsable:true})',
  './notifications': 'export const revokeNativePushDevice=async()=>{}',
  './profile': `export async function fetchMobileProfile(user) { window.profileCalls++; if(window.insideAuthCallback) throw Error('profile called inside auth lock'); if(window.hangProfile) return new Promise(()=>{}); return {id:user.id, role:'parent_portal'} }`,
  './supabase': `export const supabase={auth:window.mockAuth}; export const clearMobileSessionStorage=async()=>{}; export const getAccessToken=async()=>''; export const isSupabaseConfigured=true; export const mobileConfigError=''; export const mobileSessionStorageError=''`,
  './mobileResourceCache': 'export const mobileResourceCache={clear(){}}',
}
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AuthProvider,useMobileAuth} from './apps/mobile-core/src/auth.js';
    function State(){const a=useMobileAuth(); window.authState=a; window.historyStates.push(a.startupState); return <p>{a.startupState}</p>}
    createRoot(document.getElementById('root')).render(<AuthProvider appRole="parent"><State/></AuthProvider>)`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' },
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  plugins: [{ name: 'auth-fixtures', setup(b) {
    b.onResolve({ filter: /^\.\// }, args => args.importer.endsWith('/auth.js') || args.importer.endsWith('\\auth.js')
      ? mocks[args.path] ? { path: args.path, namespace: 'auth-mock' } : undefined : undefined)
    b.onLoad({ filter: /.*/, namespace: 'auth-mock' }, args => ({ contents: mocks[args.path], loader: 'js' }))
    b.onLoad({ filter: /startupStateCore\.js$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('= 12000', '= 80'), loader: 'js' }))
  } }],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<div id="root"></div>')
  await page.evaluate(() => {
    window.profileCalls = 0; window.historyStates = []; window.hangProfile = false
    window.mockAuth = {
      startAutoRefresh() {}, stopAutoRefresh() {},
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange(fn) { window.authEvent = fn; return { data: { subscription: { unsubscribe() {} } } } },
    }
    window.emitAuth = (event, id = 'fan-one') => {
      window.insideAuthCallback = true
      window.authEvent(event, id ? { user: { id }, access_token: 'synthetic-only' } : null)
      window.insideAuthCallback = false
    }
  })
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.waitForFunction(() => window.authState?.startupState === 'READY_SIGNED_OUT')
  await page.evaluate(() => window.emitAuth('SIGNED_IN'))
  await page.waitForFunction(() => window.authState?.startupState === 'READY_SIGNED_IN')
  assert.equal(await page.evaluate(() => window.profileCalls), 1)
  await page.evaluate(() => { window.historyStates = []; window.emitAuth('TOKEN_REFRESHED'); window.emitAuth('SIGNED_IN') })
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.profileCalls), 1, 'Refresh must not reload the profile')
  assert.ok((await page.evaluate(() => window.historyStates)).every(s => s === 'READY_SIGNED_IN'), 'Refresh must not unmount screens')
  await page.evaluate(() => { window.hangProfile = true; window.emitAuth('SIGNED_IN', 'fan-two') })
  await page.waitForFunction(() => window.authState?.startupState === 'RECOVERABLE_ERROR')
  assert.equal(await page.evaluate(() => window.authState.user), null, 'Do not retain another account profile')
  await page.evaluate(() => { window.hangProfile = false; window.emitAuth('SIGNED_IN', 'fan-two') })
  await page.waitForFunction(() => window.authState?.startupState === 'READY_SIGNED_IN')
  await page.evaluate(() => { window.emitAuth('USER_UPDATED', 'fan-two'); window.emitAuth('SIGNED_OUT', null) })
  await page.waitForFunction(() => window.authState?.startupState === 'READY_SIGNED_OUT')
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.authState.user), null, 'Late refresh cannot restore a signed-out profile')
  await page.evaluate(() => {
    window.mockAuth.signInWithPassword = () => new Promise(() => {})
    window.authState.signIn('synthetic@example.test', 'synthetic').catch(error => { window.loginFailure = error.message })
  })
  await page.waitForFunction(() => window.loginFailure)
  assert.match(await page.evaluate(() => window.loginFailure), /Check your connection and try again/)

  const race = await browser.newPage()
  await race.setContent('<div id="root"></div>')
  await race.evaluate(() => {
    window.profileCalls = 0; window.historyStates = []
    window.mockAuth = {
      startAutoRefresh() {}, stopAutoRefresh() {},
      getSession: () => new Promise(resolve => { window.resolveInitial = resolve }),
      onAuthStateChange(fn) { window.authEvent = fn; return { data: { subscription: { unsubscribe() {} } } } },
    }
  })
  await race.addScriptTag({ content: result.outputFiles[0].text })
  await race.waitForFunction(() => window.resolveInitial && window.authEvent)
  await race.evaluate(() => window.authEvent('SIGNED_IN', { user: { id: 'new-account' } }))
  await race.waitForFunction(() => window.authState?.user?.id === 'new-account')
  await race.evaluate(() => window.resolveInitial({ data: { session: { user: { id: 'old-account' } } } }))
  await race.waitForTimeout(100)
  assert.equal(await race.evaluate(() => window.authState.session.user.id), 'new-account')
  assert.equal(await race.evaluate(() => window.authState.user.id), 'new-account', 'Late bootstrap cannot replace the current account')
  console.log('PASS: actual AuthProvider handles login, token refresh, repeated sign-in, hung profile, account switching, recovery and sign-out without auth-lock calls.')
} finally { await browser.close() }
