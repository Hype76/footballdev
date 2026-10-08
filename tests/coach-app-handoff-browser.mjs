import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd(), require = createRequire(import.meta.url)
const actorId = '20000000-0000-4000-8000-000000000001'
const teamId = '30000000-0000-4000-8000-000000000001'
const tokenHash = 'a'.repeat(56)
const authSource = await readFile('src/lib/auth.js', 'utf8')
const selectAccessStart = authSource.indexOf('  const selectAccessMode = async')
const selectAccessMethod = authSource.slice(selectAccessStart, authSource.indexOf('  const selectTeam = async', selectAccessStart))
assert.ok(selectAccessMethod.includes('fetchUserProfile'))
const themeCss = (await readFile('src/index.css', 'utf8')).replace(/^@import.*$/gm, '')
const mocks = {
  auth: `import {useState} from 'react';export const canViewBilling=user=>user.roleRank>=70;
export function useAuth(){
 const[value,set]=useState(window.fixture.auth);window.changeAuth=value=>set(value);
 const authUser=value.authUser,userRef={current:value.user},accessRouteMismatch=null,session=value.session,hasPlatformAdminAccess=false;
 const setAuthError=()=>{},setIsProfileLoading=flag=>set(current=>({...current,isProfileLoading:flag}));
 const setUser=user=>set(current=>({...current,user})),setAccessModeOptions=()=>{},setClubOptions=()=>{},setAccessRouteMismatch=()=>{};
 const clearLoginAccessIntent=()=>{},isParentPortalUser=user=>user?.role==='parent_portal';
 const applyTeamSelection=async profile=>profile,applyDemoRolePreview=profile=>profile,buildAccessModeOptions=values=>values;
 const recordAnalyticsEvent=async()=>{},openPlatformAdminProfile=async()=>value.user;
 const SELECTED_CLUB_STORAGE_KEY='selected-club-id',SELECTED_TEAM_STORAGE_KEY='selected-team-id',SELECTED_ACCESS_MODE_STORAGE_KEY='selected-access-mode',SELECTED_ACCESS_MODE_EXPLICIT_KEY='selected-access-mode-explicit';
 const loadAuthDataModule=async()=>({fetchUserProfile:async(actor,options)=>{window.fixture.profileReads.push({actor:actor.id,options});
  if(window.fixture.denied)return {teamAccessUnavailable:true};
  if(window.fixture.wrongProfile)return {...value.user,id:'40000000-0000-4000-8000-000000000001'};
  return value.user}});
 ${selectAccessMethod}
 return {...value,selectAccessMode:async(...args)=>{window.fixture.selected.push(args[0]);return selectAccessMode(...args)}};
}`,

  supabase: `export const supabase={auth:{verifyOtp:async args=>{window.fixture.verified.push(args);if(window.fixture.expired)return {error:Error('Expired')};return {data:{session:{user:{id:window.fixture.auth.user.id}}}}},signOut:async()=>{}}}`,
  router: 'export const useNavigate=()=>destination=>{window.fixture.destination=destination};',
}
const compiled = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CoachAppHandoffPage} from './src/pages/CoachAppHandoffPage.jsx';import {CoachAppUpgradePage} from './src/pages/CoachAppUpgradePage.jsx';createRoot(document.getElementById('root')).render(<React.StrictMode>{window.fixture.page==='upgrade'?<CoachAppUpgradePage/>:<CoachAppHandoffPage/>}</React.StrictMode>);`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'synthetic-handoff-services', setup(b) {
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|scheduler)$/ }, args => ({ path: realpathSync(require.resolve(args.path)), namespace: 'source' }))
    b.onResolve({ filter: /(?:^|\/)auth\.js$/ }, () => ({ path: 'auth', namespace: 'mock' }))
    b.onResolve({ filter: /supabase-client\.js$/ }, () => ({ path: 'supabase', namespace: 'mock' }))
    b.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'router', namespace: 'mock' }))
    b.onResolve({ filter: /^\.{1,2}\// }, args => ({ path: createRequire(args.importer && path.isAbsolute(args.importer) ? args.importer : path.join(root, 'fixture.js')).resolve(args.path), namespace: 'source' }))
    b.onLoad({ filter: /.*/, namespace: 'source' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'jsx', resolveDir: path.dirname(args.path) }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx' }))
  } }],
})
const browser = await chromium.launch(), errors = []
await mkdir('output/playwright/coach-handoff', { recursive: true })
async function open({ page: mode = 'handoff', purpose = 'badge', expired = false, denied = false, wrongProfile = false, loading = false, theme = 'dark', width = 390 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } }), calls = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    if (route.request().url().includes('/.netlify/functions/create-workspace-checkout-session')) {
      calls.push({ body: route.request().postDataJSON(), headers: route.request().headers() })
      return route.fulfill({ json: { success: true, url: 'https://checkout.stripe.com/c/pay/synthetic' } })
    }
    if (route.request().url().startsWith('https://checkout.stripe.com/')) return route.fulfill({ contentType: 'text/html', body: '<p>Synthetic Stripe destination</p>' })
    if (route.request().url().startsWith('https://fixture.test/')) return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' })
    return route.abort()
  })
  await page.goto(`https://fixture.test/${mode === 'upgrade' ? 'app-upgrade' : `coach-app-handoff#token_hash=${tokenHash}&actor=${actorId}&purpose=${purpose}&team=${teamId}`}`)
  await page.evaluate(({ mode, actorId, expired, denied, wrongProfile, loading, theme }) => {
    window.fixture = { page: mode, expired, denied, wrongProfile, selected: [], verified: [], profileReads: [], auth: {
      user: { id: actorId, roleRank: 70, planKey: 'matchday', clubName: 'Synthetic club' }, authUser: { id: actorId },
      session: { access_token: 'synthetic-browser-token' }, isLoading: loading, isProfileLoading: loading,
    } }
    document.documentElement.classList.toggle('theme-light', theme === 'light')
  }, { mode, actorId, expired, denied, wrongProfile, loading, theme })
  await page.addStyleTag({ content: themeCss })
  await page.addScriptTag({ content: compiled.outputFiles[0].text })
  return { page, calls }
}
try {
  const success = await open({ loading: true })
  await success.page.waitForFunction(() => window.fixture.verified.length === 1)
  assert.equal(new URL(success.page.url()).hash, '')
  assert.equal(await success.page.evaluate(() => window.fixture.destination), undefined)
  await success.page.evaluate(() => window.changeAuth({ ...window.fixture.auth, isLoading: false, isProfileLoading: false }))
  await success.page.waitForFunction(() => window.fixture.destination?.includes('uploadOnly=1'), null, { timeout: 5000 })
  assert.deepEqual(await success.page.evaluate(() => window.fixture.selected), ['team'])
  assert.equal(await success.page.evaluate(() => window.fixture.verified.length), 1)
  await success.page.close()
  for (const options of [{ expired: true }, { denied: true }, { wrongProfile: true }]) {
    const blocked = await open(options)
    await blocked.page.getByRole('alert').waitFor()
    assert.equal(await blocked.page.evaluate(() => window.fixture.destination), undefined)
    assert.equal(new URL(blocked.page.url()).hash, '')
    await blocked.page.close()
  }
  const upgradeHandoff = await open({ purpose: 'upgrade' })
  await upgradeHandoff.page.waitForFunction(() => window.fixture.destination === '/app-upgrade')
  assert.deepEqual(await upgradeHandoff.page.evaluate(() => window.fixture.selected), ['team'])
  assert.equal(await upgradeHandoff.page.evaluate(() => window.fixture.verified.length), 1)
  await upgradeHandoff.page.close()
  for (const theme of ['light', 'dark']) for (const width of [320, 390]) {
    const readable = await open({ expired: true, theme, width })
    await readable.page.getByRole('alert').waitFor()
    const colours = await readable.page.evaluate(() => {
      const main = document.querySelector('main'), style = getComputedStyle(document.documentElement)
      const expected = document.createElement('span');expected.style.color = style.getPropertyValue('--text-primary');main.append(expected)
      const result = { actual: getComputedStyle(main).color, expected: getComputedStyle(expected).color,
        background: getComputedStyle(document.body).backgroundColor, text: main.textContent }
      expected.remove();return result
    })
    assert.equal(colours.actual, colours.expected, `${theme} ${width}px handoff text uses the active theme`)
    const rgb = value => value.match(/\d+/g).slice(0, 3).map(Number)
    const luminance = value => rgb(value).map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4).reduce((sum,x,i)=>sum+x*[0.2126,0.7152,0.0722][i],0)
    const light = luminance(colours.actual), dark = luminance(colours.background)
    assert.ok((Math.max(light,dark)+0.05)/(Math.min(light,dark)+0.05) >= 4.5, `${theme} readable handoff failure`)
    await readable.page.screenshot({ path: `output/playwright/coach-handoff/error-${theme}-${width}.png`, fullPage: true })
    await readable.page.close()
  }
  const upgrade = await open({ page: 'upgrade' })
  await upgrade.page.getByText('£59.99 per month', { exact: true }).waitFor()
  await upgrade.page.getByText('Club: up to 20 teams', { exact: true }).waitFor()
  await upgrade.page.getByRole('button', { name: 'Annual', exact: true }).click()
  await upgrade.page.getByText('£599.90 per year', { exact: true }).waitFor()
  await upgrade.page.getByText('£79.90 per year', { exact: true }).waitFor()
  await upgrade.page.screenshot({ path: 'output/playwright/coach-handoff/upgrade.png', fullPage: true })
  await upgrade.page.getByRole('button', { name: 'Upgrade to Club', exact: true }).click()
  await upgrade.page.waitForURL('https://checkout.stripe.com/**')
  assert.deepEqual(upgrade.calls[0].body, { planKey: 'club', billingCycle: 'annual', teamCapacity: 20, offerKey: 'club_20', fromCoach: true })
  assert.equal(upgrade.calls[0].headers.authorization, 'Bearer synthetic-browser-token')
  await upgrade.page.close()
  assert.deepEqual(errors, [])
  console.log('PASS actual access-mode function, handoff and upgrade pages: fragment cleared, one-use verification, loading coordination, revoked/expired rejection, wrong-profile rejection, readable light/dark errors at320/390px, correct 20-team pricing and fixed Stripe checkout.')
} finally { await browser.close() }
