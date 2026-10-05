import assert from 'node:assert/strict'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Synthetic component rehearsal only. No application server, external request,
// real credentials or platform data is used.
const root = process.cwd()
const require = createRequire(import.meta.url)
const output = path.join(root, 'output', 'phone-branding-browser')
await mkdir(output, { recursive: true })
const teamId = '30000000-0000-4000-8000-000000000040'
const clubId = '10000000-0000-4000-8000-000000000001'
const actorId = '20000000-0000-4000-8000-000000000001'
const base = { enabled: true, teamId, clubId, state: 'unclaimed', claimAllowed: true, logoAllowed: false, coloursAllowed: false, termsVersion: 'v1', logoUrl: '', accent: '' }
const fixtureAuth = `import {useState} from 'react'; export function useAuth(){const [value,set]=useState(window.fixture.auth);window.changeAuth=v=>{window.fixture.auth=v;set(v)};return {...value,signInWithPassword:async()=>{window.changeAuth({session:{user:{id:'${actorId}'}},user:{id:'${actorId}'}})},signOut:async()=>window.changeAuth({})}}`
const fixtureSupabase = `export const supabase={auth:{getSession:async()=>({data:{session:window.fixture.auth.session?{...window.fixture.auth.session,access_token:'synthetic-browser-token'}:null}})},rpc:async()=>({data:window.fixture.display,error:window.fixture.displayError||null})}`
const compiled = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TeamBrandingSetupPage} from 'fixture-page';createRoot(document.getElementById('root')).render(<TeamBrandingSetupPage/>);`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'synthetic-branding-page', setup(b) {
    // Resolve trusted installed React packages via Node, avoiding esbuild's
    // inaccessible Windows ancestor-directory traversal in this sandbox.
    b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|scheduler)$/ }, args => ({ path: realpathSync(require.resolve(args.path)), namespace: 'fixture-entry' }))
    b.onResolve({ filter: /^fixture-page$/ }, () => ({ path: path.join(root, 'src/pages/TeamBrandingSetupPage.jsx'), namespace: 'fixture-entry' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture-entry' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'jsx', resolveDir: path.dirname(args.path) }))
    b.onResolve({ filter: /(?:^|\/)auth\.js$/ }, () => ({ path: 'auth', namespace: 'mock' }))
    b.onResolve({ filter: /supabase-client\.js$/ }, () => ({ path: 'supabase', namespace: 'mock' }))
    b.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'router', namespace: 'mock' }))
    b.onResolve({ filter: /^\.{1,2}\//, namespace: 'fixture-entry' }, args => ({ path: createRequire(args.importer).resolve(args.path), namespace: 'fixture-entry' }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'auth' ? fixtureAuth : args.path === 'supabase' ? fixtureSupabase : 'export const useLocation=()=>({search:window.fixture.search});', loader: 'js', resolveDir: root }))
  } }],
})
const cssName = (await readdir(path.join(root, 'dist/assets'))).find(name => /^index-.*\.css$/.test(name))
const css = await readFile(path.join(root, 'dist/assets', cssName), 'utf8')
const browser = await chromium.launch()
const errors = []
let assertions = 0
async function pageFor({ signedIn = true, state = base, display = null, status = 200, search = `?teamId=${teamId}&from=coach` } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', error => errors.push(error.message))
  const calls = []
  let current = { ...state }
  await page.route('**/*', async route => {
    if (route.request().url().includes('/.netlify/functions/manage-team-branding')) {
      const body = route.request().postDataJSON()
      calls.push(body)
      assert.equal(route.request().headers().authorization, 'Bearer synthetic-browser-token')
      if (status !== 200 && body.action !== 'read') return route.fulfill({ status, json: { message: status === 409 ? 'All promotional places have been claimed.' : 'Saved artwork was kept.' } })
      if (body.action === 'claim') current = { ...current, state: 'provisional', logoAllowed: true, coloursAllowed: true, deadlineAt: '2027-01-04T12:00:00Z', playersWithAcceptedParent: 0, completedMatches: 0 }
      if (body.action === 'save') current = { ...current, accent: body.accent || current.accent }
      return route.fulfill({ json: current })
    }
    return route.abort()
  })
  await page.addInitScript(() => {})
  await page.setContent(`<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(({ signedIn, search, display, actorId }) => {
    window.fixture = { search, display, auth: signedIn ? { session: { user: { id: actorId } }, user: { id: actorId } } : {} }
    // fetch relative API URLs against a synthetic origin. Playwright intercepts all requests.
    const realFetch = window.fetch.bind(window)
    window.fetch = (url, options) => realFetch(new URL(url, 'https://fixture.test').toString(), options)
  }, { signedIn, search, display, actorId })
  await page.addScriptTag({ content: compiled.outputFiles[0].text })
  return { page, calls, changeState: value => { current = value } }
}
try {
  const login = await pageFor({ signedIn: false, search: `?teamId=${teamId}&from=coach&returnTo=https://evil.test&token=secret` })
  await login.page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
  assert.equal(login.calls.length, 0)
  await login.page.getByLabel('Email', { exact: true }).fill('owner@example.test')
  await login.page.getByLabel('Password', { exact: true }).fill('synthetic-unused-password')
  await login.page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await login.page.getByRole('button', { name: "Claim this team's place" }).waitFor()
  assert.equal(await login.page.getByRole('link', { name: /return to Coach/ }).getAttribute('href'), 'footballplayercoach://branding-return')
  assert.equal(await login.page.getByRole('button', { name: "Claim this team's place" }).isDisabled(), true)
  await login.page.getByRole('checkbox').check()
  await login.page.getByRole('button', { name: "Claim this team's place" }).click()
  await login.page.getByText('Your place is reserved.', { exact: false }).waitFor()
  assert.equal(login.calls.filter(c => c.action === 'claim').length, 1)
  assert.equal(login.calls.find(c => c.action === 'claim').termsVersion, 'v1')
  assert.match(await login.page.locator('main').innerText(), /04:01:2027/)
  await login.page.getByLabel('Team colour', { exact: true }).fill('#123456')
  await login.page.getByRole('button', { name: 'Save team branding' }).click()
  await login.page.getByText('Team branding saved.', { exact: false }).waitFor()
  assert.equal(login.calls.find(c => c.action === 'save').accent, '#123456')
  await login.page.screenshot({ path: path.join(output, 'phone-claimed.png'), fullPage: true })
  assertions += 8; await login.page.close()

  for (const offerState of ['grandfathered', 'permanent']) {
    const f = await pageFor({ state: { ...base, state: offerState, logoAllowed: true, coloursAllowed: true, accent: 'blue' } })
    await f.page.getByText('Your team has permanent promotional branding.').waitFor()
    assert.equal(await f.page.getByRole('checkbox').count(), 0)
    await f.page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-image-only') })
    await f.page.getByRole('button', { name: 'Save team branding' }).click()
    await f.page.getByText('Team branding saved.', { exact: false }).waitFor()
    const save = f.calls.find(c => c.action === 'save')
    assert.equal(save.accent, undefined); assert.equal(save.dataBase64, Buffer.from('synthetic-image-only').toString('base64'))
    assert.equal(f.calls.some(c => c.action === 'claim'), false)
    assertions += 4; await f.page.close()
  }
  const paid = await pageFor({ state: { ...base, logoAllowed: true, coloursAllowed: true }, display: { teamId, clubId, source: 'paid_club', logoAllowed: true, coloursAllowed: true, logoUrl: '', accent: '#123456' } })
  await paid.page.getByText(/Branding managed by your Club/).waitFor()
  assert.equal(await paid.page.locator('input[type=file]').count(), 0)
  assert.equal(await paid.page.getByRole('button', { name: "Claim this team's place" }).count(), 0)
  assertions += 2; await paid.page.close()

  const paidTeam = await pageFor({ state: { ...base, claimAllowed: false, logoAllowed: true } })
  await paidTeam.page.getByText('New promotional places are available to Matchday teams only.').waitFor()
  assert.equal(await paidTeam.page.getByRole('button', { name: "Claim this team's place" }).count(), 0)
  assert.equal(await paidTeam.page.locator('input[type=file]').count(), 1)
  assert.equal(paidTeam.calls.some(c => c.action === 'claim'), false)
  assertions += 3; await paidTeam.page.close()

  const upgraded = await pageFor()
  await upgraded.page.getByRole('checkbox').check()
  upgraded.changeState({ ...base, claimAllowed: false, logoAllowed: true })
  await upgraded.page.getByRole('button', { name: "Claim this team's place" }).click()
  await upgraded.page.getByRole('alert').filter({ hasText: 'Matchday teams only' }).waitFor()
  assert.equal(upgraded.calls.some(c => c.action === 'claim'), false)
  assertions++; await upgraded.page.close()

  const exhausted = await pageFor({ status: 409 })
  await exhausted.page.getByRole('checkbox').check()
  await exhausted.page.getByRole('button', { name: "Claim this team's place" }).click()
  await exhausted.page.getByRole('alert').filter({ hasText: 'All promotional places' }).waitFor()
  assert.equal(await exhausted.page.locator('input[type=file]').count(), 0)
  assertions++; await exhausted.page.close()

  const changedTerms = await pageFor()
  await changedTerms.page.getByRole('checkbox').check()
  changedTerms.changeState({ ...base, termsVersion: 'v2' })
  await changedTerms.page.getByRole('button', { name: "Claim this team's place" }).click()
  await changedTerms.page.getByRole('alert').filter({ hasText: 'Read and accept the current offer terms' }).waitFor()
  assert.equal(changedTerms.calls.some(c => c.action === 'claim'), false)
  assert.equal(await changedTerms.page.getByRole('checkbox').isChecked(), false)
  assertions += 2; await changedTerms.page.close()

  const upload = await pageFor({ status: 502, state: { ...base, state: 'grandfathered', logoAllowed: true } })
  await upload.page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-image-only') })
  await upload.page.getByRole('button', { name: 'Save team branding' }).click()
  await upload.page.getByRole('alert').filter({ hasText: 'Saved artwork was kept.' }).waitFor()
  assert.equal(await upload.page.locator('input[type=file]').evaluate(node => node.files.length), 1)
  assertions++; await upload.page.close()

  const revoked = await pageFor({ state: { ...base, state: 'grandfathered', logoAllowed: true } })
  await revoked.page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-image-only') })
  revoked.changeState({ ...base, state: 'failed' })
  await revoked.page.getByRole('button', { name: 'Save team branding' }).click()
  await revoked.page.getByRole('alert').filter({ hasText: 'Badge access is no longer available.' }).waitFor()
  assert.equal(revoked.calls.some(c => c.action === 'save'), false)
  assertions++; await revoked.page.close()

  const transferred = await pageFor({ state: { ...base, state: 'grandfathered', logoAllowed: true } })
  await transferred.page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-image-only') })
  await transferred.page.evaluate(({ teamId, clubId }) => { window.fixture.display = { teamId, clubId, source: 'paid_club', logoAllowed: true, coloursAllowed: true, logoUrl: '', accent: '#123456' } }, { teamId, clubId })
  await transferred.page.getByRole('button', { name: 'Save team branding' }).click()
  await transferred.page.getByRole('alert').filter({ hasText: 'Your branding is managed by your Club.' }).waitFor()
  assert.equal(transferred.calls.some(c => c.action === 'save'), false)
  assertions++; await transferred.page.close()

  const off = await pageFor({ state: { enabled: false } })
  await off.page.getByText(/This offer is not available yet/).waitFor()
  assert.equal(await off.page.locator('input[type=file]').count(), 0)
  assertions++; await off.page.close()

  const wrong = await pageFor({ state: { ...base, teamId: actorId } })
  await wrong.page.getByRole('alert').filter({ hasText: /could not be verified/ }).waitFor()
  assert.equal(await wrong.page.getByRole('checkbox').count(), 0)
  assertions++; await wrong.page.close()
  assert.deepEqual(errors, [])
  console.log(`Synthetic phone browser rehearsal passed: ${assertions} assertions, no external requests or page errors.`)
} finally { await browser.close() }
