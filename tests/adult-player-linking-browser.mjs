import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AdultPlayerInvitePage} from './src/pages/AdultPlayerInvitePage.jsx';
createRoot(document.getElementById('root')).render(<AdultPlayerInvitePage/>);
`
const built = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'fake-auth', setup(buildApi) {
    buildApi.onResolve({ filter: /\/lib\/supabase-client\.js$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
    buildApi.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: `export function createTemporaryPlayerInviteClient(){return {auth:{signInWithPassword:async credentials=>{window.signedIn=credentials;if(window.holdSignIn)await new Promise(resolve=>{window.releaseSignIn=resolve});return {data:{session:{access_token:'fixture-token',refresh_token:'fixture-refresh'}}}}}}};export const supabase={auth:{setSession:async session=>{window.persistedSession=session;return new Promise(()=>{})}}}`,
      loader: 'js',
    }))
  } }],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('http://127.0.0.1/player-invite', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('http://127.0.0.1/player-invite#invite=00000000-0000-4000-8000-000000000006')
  await page.evaluate(() => {
    window.requests = []
    window.persistedSession = { access_token: 'original-token', refresh_token: 'original-refresh' }
    window.rejectAcceptance = true
    window.fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      window.requests.push({ body, authorization: options.headers.Authorization })
      if (body.action === 'accept') {
        window.sessionBeforeAcceptance = window.persistedSession || null
        if (window.rejectAcceptance) return { ok: false, json: async () => ({ success: false, message: 'This account cannot accept the invitation.' }) }
        return { ok: true, json: async () => ({ success: true }) }
      }
      return { ok: false, json: async () => ({ success: false, state: 'account_exists', message: 'This email already has an account. Sign in to accept the invitation.' }) }
    }
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByLabel('Player email').fill('player@example.test')
  await page.getByLabel('Create a password', { exact: true }).fill('LongEnough123!')
  await page.getByRole('button', { name: 'Create Player login' }).click()
  await page.getByRole('button', { name: 'Sign in and accept' }).waitFor()
  assert.equal(await page.getByLabel('Player email').inputValue(), 'player@example.test')
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '')
  assert.equal((await page.evaluate(() => window.requests))[0].body.action, 'create')
  await page.getByText('This email already has an account. Sign in to accept the invitation.').waitFor()
  await page.getByLabel('Password', { exact: true }).fill('ExistingPassword1!')
  await page.getByRole('button', { name: 'Sign in and accept' }).click()
  await page.getByText('This account cannot accept the invitation.').waitFor()
  assert.equal(await page.evaluate(() => window.persistedSession.access_token), 'original-token')
  await page.evaluate(() => { window.rejectAcceptance = false })
  await page.getByRole('button', { name: 'Sign in and accept' }).click()
  await page.waitForFunction(() => window.persistedSession?.access_token === 'fixture-token')
  const requests = await page.evaluate(() => window.requests)
  assert.equal(await page.evaluate(() => window.sessionBeforeAcceptance.access_token), 'original-token')
  assert.equal(requests[1].authorization, 'Bearer fixture-token')
  assert.equal(requests[1].body.token, '00000000-0000-4000-8000-000000000006')
  assert.deepEqual(await page.evaluate(() => window.persistedSession), { access_token: 'fixture-token', refresh_token: 'fixture-refresh' })
  const changed = await browser.newPage()
  await changed.route('http://127.0.0.1/player-invite', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await changed.goto('http://127.0.0.1/player-invite#invite=00000000-0000-4000-8000-000000000006')
  await changed.evaluate(() => { window.holdSignIn = true; window.requests = []; window.fetch = async (_url, options) => { window.requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ success: true }) } } })
  await changed.addScriptTag({ content: built.outputFiles[0].text })
  await changed.getByRole('button', { name: 'I already have an account' }).click()
  await changed.getByLabel('Player email').fill('player@example.test')
  await changed.getByLabel('Password', { exact: true }).fill('ExistingPassword1!')
  await changed.getByRole('button', { name: 'Sign in and accept' }).click()
  await changed.waitForFunction(() => typeof window.releaseSignIn === 'function')
  await changed.evaluate(() => { window.location.hash = '#invite=00000000-0000-4000-8000-000000000007' })
  await changed.waitForFunction(() => window.location.hash.endsWith('0007'))
  await changed.evaluate(() => window.releaseSignIn())
  await changed.getByRole('button', { name: 'Sign in and accept' }).waitFor({ state: 'visible' })
  assert.deepEqual(await changed.evaluate(() => window.requests), [])
  assert.equal(await changed.evaluate(() => window.persistedSession || null), null)
  console.log('PASS existing-account invitation signs in and accepts using the same invite')
} finally { await browser.close() }
