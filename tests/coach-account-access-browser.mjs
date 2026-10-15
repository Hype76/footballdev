import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd(), modules = path.join(root, 'apps/coach-mobile/node_modules'), output = 'output/playwright/coach-account-access'
await mkdir(output, { recursive: true })
const source = await readFile('apps/coach-mobile/App.js', 'utf8'), nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
const selected = ['StartupRecoveryScreen', 'PrimaryAction', 'SecondaryAction', 'createCoachStyles'].map(name => {
  const node = nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, 'Exercise the actual Coach '+name)
  return source.slice(node.start, node.end).replaceAll("require('./assets/football-player-logo.png')", "require('./apps/coach-mobile/assets/football-player-logo.png')")
}).join('\n')
const result = await build({ stdin: { resolveDir: root, loader: 'jsx', contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{View,Text,Image,Pressable,ScrollView,StyleSheet}from'react-native';
import{MobileSignupScreen}from'./apps/mobile-core/src/MobileSignupScreen';
import{createCoachTheme}from'./apps/coach-mobile/src/coachThemeCore.js';import{getCoachBottomNavigationPadding}from'./apps/coach-mobile/src/coachNavigationCore.js';
const CoachThemeContext=React.createContext(null),Constants={expoConfig:{version:'1.0.25'}};
${selected}
const base=createCoachTheme({mode:'dark'}),defaultThemeContext={...base,palette:base.tokens,styles:createCoachStyles(base.tokens)};
const useCoachTheme=()=>defaultThemeContext;
function App(){const[mode,setMode]=React.useState(window.initialMode||'removed');window.show=setMode;
const signedIn=(email,password)=>{window.signedIn={email,password};setMode('done')};
return mode==='signup'?<MobileSignupScreen appRole="coach" logoSource={require('./apps/coach-mobile/assets/football-player-logo.png')} onBack={()=>setMode('login')} onFreshSignupSignIn={signedIn}/>:mode==='done'||mode==='login'?<p>Sign in ready</p>:<StartupRecoveryScreen diagnosticCode={mode==='removed'?'WORKSPACE_ACCESS_REMOVED':'COACH_PROFILE_LOAD_TIMEOUT'} message="Check your connection and try again." onRetry={()=>window.retried=true} onSignIn={()=>{window.signInClicks=(window.signInClicks||0)+1;setMode('login')}}/>}
createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, nodePaths: [modules],
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis', 'import.meta.env': '{}' },
  plugins: [{ name: 'controlled-auth', setup(b) {
    b.onResolve({ filter: /(?:^\.\/supabase$|\/lib\/auth\.js$|^\.\/config$|deviceAppearance$)/ }, args => {
      if (args.path === './supabase' && /mobileSignup/.test(args.importer)) return { path: 'mobile-auth', namespace: 'fixture' }
      if (args.path === './config') return { path: 'config', namespace: 'fixture' }
      if (args.path.endsWith('deviceAppearance')) return { path: 'appearance', namespace: 'fixture' }
    })
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ loader: 'js', contents: name === 'mobile-auth' ? `export const getAccessToken=async()=> 'synthetic';export const supabase={auth:{signUp:async args=>{window.signupArgs=args;return{data:{user:{id:'obfuscated',identities:[]},session:null}}},getSession:async()=>({data:{session:null}})}};` : name === 'config' ? `export const getMobileRuntimeConfig=()=>({apiBaseUrl:'https://fresh.example.test'});` : `export const useDeviceAppearance=()=> 'dark';` }))
  } }],
})
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [320, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 844 } }), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('https://fresh.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}*{box-sizing:border-box}input{max-width:100%}</style><div id="root"></div>' }))
    await page.goto('https://fresh.example.test/sign-in')
    await page.evaluate(() => {
      window.savedDraft = 'Unsynced match notes'; window.requestCount = 0; window.calls = []; window.failBeginOnce=true
      window.fetch = async (_url, options) => {
        const body = JSON.parse(options.body); window.calls.push(body)
        if(body.action==='request'&&window.failBeginOnce){window.failBeginOnce=false;throw new TypeError('Network request failed')}
        const ok = body.action !== 'verify' || body.code === '12345678'
        return { ok, json: async () => ok ? body.action === 'request' ? { success: true, requestId: '20000000-0000-4000-8000-'+String(++window.requestCount).padStart(12,'0') } : { success: true } : { success: false, message: 'That code could not be verified. Request another code and use the newest email.' } }
      }
    })
    await page.addScriptTag({ content: result.outputFiles[0].text })
    await page.getByText('Your account is no longer active', { exact: true }).waitFor()
    assert.equal(await page.getByRole('img', { name: 'Football Player', exact: true }).count(), 1)
    assert.equal(await page.getByText(/Reset local app data|COACH_PROFILE_LOAD_FAILED|Version 1\.0\.25/).count(), 0)
    assert.ok(await page.getByText(/please contact your club administrator/).isVisible())
    await page.getByRole('button', { name: 'Sign in with another account', exact: true }).scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${output}/removed-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Sign in with another account', exact: true }).click()
    assert.equal(await page.evaluate(() => window.savedDraft), 'Unsynced match notes')
    await page.evaluate(() => window.show('generic'))
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor()
    assert.equal(await page.getByText('Your account is no longer active', { exact: true }).count(), 0)
    await page.evaluate(() => window.show('signup'))
    for (const [label, value] of [['Your name','New Coach'], ['Team name','Fresh Team'], ['Email', 'returning@example.test'], ['Password','Safer!Demo9372'], ['Confirm password','Safer!Demo9372']]) await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByRole('checkbox').click(); await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByRole('button', { name: 'Enter verification code', exact: true }).click()
    await page.getByText(/If a fresh signup is available/).waitFor()
    await page.getByLabel('Verification code', { exact: true }).fill('00000000'); await page.getByRole('button', { name: 'Verify and continue', exact: true }).click()
    await page.getByText(/That code could not be verified/).waitFor()
    assert.equal(await page.evaluate(() => window.signedIn || null), null)
    await page.getByRole('button', { name: 'Send another code', exact: true }).click()
    await page.getByText(/A new code has been requested/).waitFor()
    await page.getByLabel('Verification code', { exact: true }).fill('12345678')
    await page.screenshot({ path: `${output}/fresh-code-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Verify and continue', exact: true }).click()
    await page.waitForFunction(() => Boolean(window.signedIn))
    assert.deepEqual(await page.evaluate(() => window.signedIn), { email: 'returning@example.test', password: 'Safer!Demo9372' })
    assert.equal(await page.evaluate(() => window.calls.at(-1).requestId), '20000000-0000-4000-8000-000000000002')
    assert.deepEqual(errors, [], 'No Coach render or signup errors')
    await page.close()
  }
  console.log('PASS: actual Coach recovery with FP logo, friendly removed-access copy, no destructive reset, generic-error distinction, preserved work, and actual fresh signup/resend/verification/sign-in at 320/390px.')
} finally { await browser.close() }
