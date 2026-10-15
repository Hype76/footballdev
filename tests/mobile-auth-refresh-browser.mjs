import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const mocks = {
  // Native password UI is exercised by mobile-signup-browser; this fixture tests Auth state transitions.
  './MobilePasswordRecovery': 'export const MobilePasswordRecovery=()=>null',
  './biometrics': 'export const getBiometricEnabled=async()=>{window.biometricCalls=(window.biometricCalls||0)+1;return Boolean(window.biometricEnabled)}; export const setBiometricEnabled=async()=>{}; export const authenticateWithBiometrics=async()=>{}',
  './config': 'export const getMobileRuntimeConfig=()=>({isUsable:true})',
  './notifications': 'export const revokeNativePushDevice=async()=>{}',
  './profile': `export async function fetchMobileProfile(user) { window.profileCalls++; if(window.insideAuthCallback) throw Error('profile called inside auth lock'); if(window.profileError) throw Error(window.profileError); if(window.deferProfile) return new Promise(resolve=>{window.resolveProfile=()=>resolve({id:user.id,role:'coach'})}); if(window.hangProfile) return new Promise(()=>{}); return {id:user.id, role:'parent_portal'} }`,
  './supabase': `export const supabase={auth:window.mockAuth}; export const clearMobileSessionStorage=async()=>{window.sessionClearCalls=(window.sessionClearCalls||0)+1}; export const getAccessToken=async()=>''; export const isSupabaseConfigured=true; export const mobileConfigError=''; export const mobileSessionStorageError=''; export const readSavedMobileSession=async()=>{if(window.savedSessionError) throw Error(window.savedSessionError); return window.savedSession||null}`,
  './mobileResourceCache': 'export const mobileResourceCache={clear(){}}',
}
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AuthProvider,useMobileAuth} from './apps/mobile-core/src/auth.js';
    function State(){const a=useMobileAuth(); window.authState=a; window.historyStates.push(a.startupState); (window.userHistory ||= []).push(a.user?.id||null); return <p>{a.startupState}</p>}
    createRoot(document.getElementById('root')).render(<AuthProvider appRole={window.testRole || 'parent'} offlineProfileStore={window.offlineStore}><State/></AuthProvider>)`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' },
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  plugins: [{ name: 'auth-fixtures', setup(b) {
    b.onResolve({ filter: /^\.\// }, args => args.importer.endsWith('/auth.js') || args.importer.endsWith('\\auth.js')
      ? mocks[args.path] ? { path: args.path, namespace: 'auth-mock' } : undefined : undefined)
    b.onLoad({ filter: /.*/, namespace: 'auth-mock' }, args => ({ contents: mocks[args.path], loader: 'js' }))
    b.onLoad({ filter: /startupStateCore\.js$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('= 12000', '= 80'), loader: 'js' }))
    b.onLoad({ filter: /mobileFetchCore\.js$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('= 20000', '= 80'), loader: 'js' }))
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
  assert.equal(await page.evaluate(() => window.loginFailure), 'The service is taking too long to respond. Please try again.')
  assert.doesNotMatch(await page.evaluate(() => window.authState.authError), /No connection|password not recognised/)

  const race = await browser.newPage()
  await race.setContent('<div id="root"></div>')
  await race.evaluate(() => {
    window.profileCalls = 0; window.historyStates = []
    window.offlineStore = { read: async () => null, write: async profile => ({ ...profile, persisted: true }) }
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
  assert.equal(await race.evaluate(() => window.authState.user.persisted), true, 'Use the canonical profile returned by the offline store')
  for (const role of ['parent', 'coach']) {
    const offline = await browser.newPage()
    await offline.setContent('<div id="root"></div>')
    await offline.evaluate(role => {
      window.testRole=role
      window.profileCalls=0;window.historyStates=[];window.hangProfile=true
      window.savedSession={user:{id:'saved-user'},expires_at:1,refresh_token:'synthetic-only'}
      window.offlineStore={read:async id=>({id,role:'coach'}),write:async profile=>profile,clear:async()=>{window.cacheCleared=true}}
      window.mockAuth={startAutoRefresh(){},stopAutoRefresh(){},getSession:()=>new Promise(()=>{}),onAuthStateChange(fn){window.authEvent=fn;return {data:{subscription:{unsubscribe(){}}}}}}
    }, role)
    await offline.addScriptTag({content:result.outputFiles[0].text})
    await offline.waitForFunction(()=>window.authState?.startupState==='READY_SIGNED_IN')
    assert.equal(await offline.evaluate(()=>window.authState.user.id),'saved-user',role+' cold start opens saved account while session renewal hangs')
    assert.equal(await offline.evaluate(()=>window.authState.user.isOfflineProfile),true)
    await offline.evaluate(()=>{window.hangProfile=false;window.authEvent('TOKEN_REFRESHED',window.savedSession)})
    await offline.waitForFunction(()=>window.authState?.user&&!window.authState.user.isOfflineProfile)
    await offline.evaluate(()=>window.authEvent('SIGNED_OUT',null))
    await offline.waitForFunction(()=>window.authState?.startupState==='READY_SIGNED_OUT')
    assert.equal(await offline.evaluate(()=>window.cacheCleared),true)
    await offline.close()
  }
  for (const failure of ['saved-session', 'profile']) {
    const recovery = await browser.newPage()
    await recovery.setContent('<div id="root"></div>')
    await recovery.evaluate(failure => {
      window.testRole = 'coach'
      window.profileCalls = 0; window.historyStates = []; window.offlineReadIds = []
      window.savedSession = { user: { id: 'saved-coach' }, refresh_token: 'synthetic-only' }
      window.savedSessionError = failure === 'saved-session' ? 'Native secure session restoration failed with a long uncoded device error' : ''
      window.profileError = failure === 'profile' ? 'Profile details could not be loaded during startup' : ''
      window.savedDraft = { accountId: 'saved-coach', notes: 'Unsynchronised match notes' }
      window.offlineClearCalls = 0; window.signOutCalls = 0; window.sessionClearCalls = 0
      window.offlineStore = {
        read: async id => { window.offlineReadIds.push(id); return window.cachedProfile?.id === id ? window.cachedProfile : null },
        write: async profile => profile,
        clear: async () => { window.offlineClearCalls++; window.savedDraft = null },
      }
      window.mockAuth = {
        startAutoRefresh() {}, stopAutoRefresh() {},
        getSession: async () => ({ data: { session: window.savedSession } }),
        signOut: async () => { window.signOutCalls++; window.authEvent('SIGNED_OUT', null); return { error: null } },
        signInWithPassword: async () => ({ error: new Error('Invalid login credentials') }),
        onAuthStateChange(fn) { window.authEvent = fn; return { data: { subscription: { unsubscribe() {} } } } },
      }
    }, failure)
    await recovery.addScriptTag({ content: result.outputFiles[0].text })
    await recovery.waitForFunction(() => window.authState?.startupState === 'RECOVERABLE_ERROR')
    await recovery.evaluate(() => window.authState.returnToSignIn())
    await recovery.waitForFunction(() => window.authState?.startupState === 'READY_SIGNED_OUT')
    await recovery.evaluate(() => {
      window.authEvent('TOKEN_REFRESHED', window.savedSession)
      window.authEvent('SIGNED_OUT', null)
      window.authEvent('USER_DELETED', null)
      window.authState.signIn('synthetic@example.test', 'incorrect').catch(error => { window.passwordFailure = error.message })
    })
    await recovery.waitForFunction(() => window.passwordFailure)
    await recovery.waitForTimeout(100)
    assert.equal(await recovery.evaluate(() => window.passwordFailure), 'Invalid login credentials')
    assert.equal(await recovery.evaluate(() => window.authState.startupState), 'READY_SIGNED_OUT')
    assert.equal(await recovery.evaluate(() => window.authState.user), null)
    assert.equal(await recovery.evaluate(() => window.authState.session), null)
    assert.deepEqual(await recovery.evaluate(() => [window.offlineClearCalls, window.signOutCalls, window.sessionClearCalls]), [0, 0, 0])
    const nextId = failure === 'saved-session' ? 'saved-coach' : 'different-coach'
    const before = await recovery.evaluate(() => ({ profiles: window.profileCalls, biometrics: window.biometricCalls }))
    await recovery.evaluate(nextId => {
      window.savedSessionError = ''; window.profileError = ''; window.biometricEnabled = true
      window.cachedProfile = { id: 'saved-coach', role: 'coach' }
      window.userHistory = []; window.offlineReadIds = []
      window.mockAuth.signInWithPassword = async () => {
        window.savedSession = { user: { id: nextId }, refresh_token: 'synthetic-new' }
        window.authEvent('SIGNED_IN', window.savedSession)
        return { data: { session: window.savedSession }, error: null }
      }
      window.authState.signIn('synthetic@example.test', 'correct').catch(error => { window.unexpectedLoginFailure = error.message })
    }, nextId)
    await recovery.waitForFunction(nextId => window.authState?.startupState === 'READY_SIGNED_IN' && window.authState.user?.id === nextId && !window.authState.user.isOfflineProfile, nextId)
    assert.equal(await recovery.evaluate(() => window.authState.isLocked), true, 'Password recovery must reapply the saved biometric lock')
    assert.ok(await recovery.evaluate(before => window.profileCalls > before.profiles && window.biometricCalls > before.biometrics, before), 'Successful password recovery must rerun startup and profile loading')
    assert.equal(await recovery.evaluate(() => window.unexpectedLoginFailure), undefined)
    assert.deepEqual(await recovery.evaluate(() => [window.offlineClearCalls, window.signOutCalls, window.sessionClearCalls]), [0, 0, 0])
    assert.equal(await recovery.evaluate(() => window.savedDraft?.notes), 'Unsynchronised match notes')
    if (nextId !== 'saved-coach') {
      assert.ok(await recovery.evaluate(() => window.offlineReadIds.every(id => id === 'different-coach')), 'A different account must only request its own cached profile')
      assert.ok(await recovery.evaluate(() => !window.userHistory.includes('saved-coach')), 'A different account must never expose the previous account profile')
    }
    await recovery.close()
  }

  const late = await browser.newPage()
  await late.setContent('<div id="root"></div>')
  await late.evaluate(() => {
    window.testRole = 'coach'; window.profileCalls = 0; window.historyStates = []; window.deferProfile = true
    window.savedSession = { user: { id: 'old-coach' }, refresh_token: 'synthetic-only' }
    window.mockAuth = { startAutoRefresh() {}, stopAutoRefresh() {}, getSession: async () => ({ data: { session: window.savedSession } }),
      onAuthStateChange(fn) { window.authEvent = fn; return { data: { subscription: { unsubscribe() {} } } } } }
  })
  await late.addScriptTag({ content: result.outputFiles[0].text })
  await late.waitForFunction(() => window.resolveProfile)
  await late.evaluate(() => { window.authState.returnToSignIn(); window.resolveProfile() })
  await late.waitForFunction(() => window.authState?.startupState === 'READY_SIGNED_OUT')
  await late.waitForTimeout(100)
  assert.equal(await late.evaluate(() => window.authState.user), null, 'Late profile completion cannot restore access after sign-in recovery')
  assert.equal(await late.evaluate(() => window.authState.session), null)
  await late.close()
  console.log('PASS: actual AuthProvider handles login, refresh, account switching, non-destructive sign-in recovery, biometric relocking, late profiles and sign-out without auth-lock calls.')
} finally { await browser.close() }
