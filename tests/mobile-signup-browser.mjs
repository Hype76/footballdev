import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const output = 'output/playwright/mobile-signup'
await mkdir(output, { recursive: true })
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MobileSignupScreen} from './apps/mobile-core/src/MobileSignupScreen';
    import {createParentMobileTheme} from './apps/mobile-core/src/parentThemeCore.js';
    import {UnlinkedParentScreen} from './apps/parent-mobile/src/UnlinkedParentScreen';
    function App(){const [dark,setDark]=React.useState(false);window.setDark=setDark;const [mode,setMode]=React.useState('coach');window.setMode=setMode;return mode==='unlinked'?<div style={{padding:20}}><UnlinkedParentScreen themeTokens={createParentMobileTheme({mode:dark?'dark':'light'}).tokens}/></div>:<MobileSignupScreen key={mode} appRole={mode} logoSource={{uri:'https://example.test/logo.png'}} onBack={()=>{window.back=true}}/>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', platform: 'browser', mainFields: ['browser', 'module', 'main'],
  loader: { '.js': 'jsx', '.png': 'dataurl' }, nodePaths: [modules],
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  plugins: [{ name: 'controlled-services', setup(b) {
    b.onResolve({ filter: /(?:^|\/)supabase$/ }, () => ({ path: 'supabase', namespace: 'mock' }))
    b.onResolve({ filter: /mobile-core\/src\/auth$/ }, () => ({ path: 'auth', namespace: 'mock' }))
    b.onResolve({ filter: /^\.\/config$/ }, () => ({ path: 'config', namespace: 'mock' }))
    b.onResolve({ filter: /BrandLoader$/ }, () => ({ path: 'loader', namespace: 'mock' }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'jsx', contents: args.path === 'supabase' ? `export const getAccessToken=async()=> 'test-token'; export const supabase={auth:{signUp:async(args)=>{window.signup=args;return window.signupFailure?{error:{message:'Email service unavailable'}}:{data:{session:null}}}},rpc:async(name,args)=>{window.accepted={name,args};return window.inviteFailure?{error:{message:'This invitation is for a different email address.'}}:{data:{id:'accepted-link'}}}};` : args.path === 'auth' ? `export const useMobileAuth=()=>({user:{displayName:'Test Parent',email:'parent@example.test'},refreshUserProfile:async()=>{window.refreshed=true;return {parentPortalLinks:[]}},signOut:async()=>{window.signedOut=true}});` : args.path === 'config' ? `export const getMobileRuntimeConfig=()=>({apiBaseUrl:'https://example.test'});` : `export const BrandLoader=()=>null;` }))
  } }],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let sendCount = 0
  await page.route('https://example.test/**', async route => {
    if (route.request().url().includes('/.netlify/functions/')) {
      const body = route.request().postDataJSON()
      assert.equal(route.request().headers().authorization, 'Bearer test-token')
      if (body.action === 'send') sendCount++
      return route.fulfill({ json: body.action === 'preview' ? { success: true, subject: 'An invitation for your team', text: 'Start with free Match Day. Your Coach receives app links and QR codes.' } : { success: true } })
    }
    if (route.request().url().endsWith('.png')) return route.fulfill({contentType:'image/png',body:await readFile('apps/coach-mobile/assets/football-player-logo.png')})
    return route.fulfill({ contentType: 'text/html', body: '<html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#f4f7f6"><div id="root"></div></body></html>' })
  })
  await page.route('https://footballplayer.online/**', async route => {const url=new URL(route.request().url()); return route.fulfill({contentType:'image/png',body:await readFile(`public${url.pathname}`)})})
  await page.goto('https://example.test/')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const fill = (label, value) => page.getByRole('textbox', { name: label, exact: true }).fill(value)
  await fill('Your name', 'Test Coach'); await fill('Team name', 'FP TEST United'); await fill('Email', 'coach@example.test')
  await page.getByLabel('Password', { exact: true }).fill('SafeSignup!42')
  await page.getByLabel('Confirm password', { exact: true }).fill('Mismatch!42')
  await page.getByRole('checkbox').click()
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByText('Your passwords do not match.').waitFor()
  assert.equal(await page.evaluate(() => window.signup), undefined)
  await page.getByLabel('Confirm password', { exact: true }).fill('SafeSignup!42')
  await page.screenshot({ path: `${output}/coach-signup.png`, fullPage: true })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByText('Check your email', { exact: true }).waitFor()
  const signup = await page.evaluate(() => window.signup)
  assert.equal(signup.options.data.signup_plan_key, 'matchday')
  assert.equal(signup.options.data.club_name, 'FP TEST United')
  assert.equal('age_group' in signup.options.data, false)
  assert.equal(signup.options.emailRedirectTo, 'https://footballplayer.online/sign-in')
  await page.evaluate(() => window.setMode('parent'))
  await fill('Your name', 'Test Parent'); await fill('Email', 'parent@example.test')
  assert.equal(await page.getByLabel('Team name', { exact: true }).count(), 0)
  await page.getByLabel('Password', { exact: true }).fill('SafeSignup!42'); await page.getByLabel('Confirm password', { exact: true }).fill('SafeSignup!42')
  await page.getByRole('checkbox').click()
  await page.evaluate(() => { window.signupFailure = true })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByText('Email service unavailable').waitFor()
  await page.evaluate(() => { window.signupFailure = false })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByText('Check your email', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.signup.options.data.account_type), 'parent')
  assert.equal(await page.evaluate(() => window.signup.options.emailRedirectTo), 'https://parent.footballplayer.online/sign-in')
  assert.equal(await page.evaluate(() => window.signup.options.data.club_name), undefined)
  await page.evaluate(() => window.setMode('unlinked'))
  await page.getByRole('button', { name: 'Invite your Coach', exact: true }).click()
  await fill('Coach email address', 'coach@example.test')
  await page.getByRole('button', { name: 'Preview invitation' }).click()
  await page.getByText('An invitation for your team').waitFor()
  assert.equal(sendCount, 0)
  await page.screenshot({ path: `${output}/coach-invitation-preview.png`, fullPage: true })
  await page.evaluate(() => window.setDark(true))
  await page.screenshot({path:`${output}/coach-invitation-dark.png`,fullPage:true})
  await page.evaluate(() => window.setDark(false))
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click()
  await page.getByText('Invitation sent', { exact: true }).waitFor()
  assert.equal(sendCount, 1)
  await page.getByRole('button', { name: 'I already have an invitation', exact: true }).click()
  await fill('Player invitation link', 'https://attacker.test/parent-invite/token')
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await page.getByText('Paste the full Football Player invitation link from your email.').waitFor()
  assert.equal(await page.evaluate(() => window.accepted), undefined)
  await fill('Player invitation link', 'https://parent.footballplayer.online/parent-invite/test-token')
  await page.evaluate(() => { window.inviteFailure = true })
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await page.getByText('This invitation is for a different email address.').waitFor()
  await page.evaluate(() => { window.inviteFailure = false })
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await page.waitForFunction(() => window.refreshed)
  assert.equal(await page.evaluate(() => window.accepted.name), 'accept_parent_player_link')
  assert.deepEqual(errors, [])
  console.log('PASS: Coach and Parent signup, password mismatch, service failure, email confirmation, referral preview/send, invitation host validation and server rejection.')
} finally { await browser.close() }
