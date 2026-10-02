import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const port = 4897
const origin = `http://127.0.0.1:${port}`
const serverArgs = ['node_modules/vite/bin/vite.js']
if (process.env.INVITE_BROWSER_PREVIEW === 'true') serverArgs.push('preview')
serverArgs.push('--host', '127.0.0.1', '--port', String(port), '--strictPort')
const server = spawn(process.execPath, serverArgs, {
  env: { ...process.env, VITE_SUPABASE_URL: 'http://fixture.supabase.test', VITE_SUPABASE_ANON_KEY: 'fixture-anon-key' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', (chunk) => { output += chunk })
server.stderr.on('data', (chunk) => { output += chunk })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* server starting */ }
    if (attempt > 100 || server.exitCode !== null) throw new Error(output || 'Local server failed')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  const lookupTokens = []
  let mutationCount = 0
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname.startsWith('/.netlify/functions/')) {
      if (url.pathname !== '/.netlify/functions/get-club-owner-invite') {
        mutationCount++
        return route.abort()
      }
      const { token } = request.postDataJSON()
      lookupTokens.push(token)
      return route.fulfill({ json: token ? {
        success: true,
        invite: { workspaceName: 'Synthetic workspace', invitedEmail: 'owner@example.test', planKey: 'large_club', roleLabel: 'Club Admin', billingMode: 'unpaid' },
      } : { success: false, message: 'Workspace invite could not be opened.' }, status: token ? 200 : 400 })
    }
    return route.continue()
  })
  const opened = () => page.getByText('Synthetic workspace', { exact: true }).waitFor()
  await page.goto(`${origin}/workspace-invite?token=synthetic-query`)
  await opened()
  assert(lookupTokens.every((value) => value === 'synthetic-query'), 'initial StrictMode lookup lost token')
  console.log('PASS initial StrictMode render')
  await page.reload()
  if (process.env.INVITE_BASELINE_REPRO === 'true') {
    await page.getByText('Workspace invite could not be opened.', { exact: true }).waitFor()
    assert.equal(lookupTokens.at(-1), '')
    console.log('REPRODUCED baseline reload sends empty token and displays reported error')
  } else {
    await opened()
    assert.equal(lookupTokens.at(-1), 'synthetic-query')
    assert.equal(new URL(page.url()).search, '')
    assert.equal(new URL(page.url()).hash, '#token=synthetic-query')
    console.log('PASS reload with fragment token')
    for (const [path, token] of [
      ['/workspace-invite#token=synthetic-fragment', 'synthetic-fragment'],
      ['/club-invite?token=synthetic-alias&source=tutorial', 'synthetic-alias'],
      ['/workspace-invite/synthetic-legacy', 'synthetic-legacy'],
    ]) {
      await page.goto(origin + path)
      await opened()
      assert.equal(lookupTokens.at(-1), token)
      await page.reload()
      await opened()
      assert.equal(lookupTokens.at(-1), token)
    }
    console.log('PASS fragment, alias and legacy links plus reload')
    await page.evaluate(() => { window.history.pushState(null, '', '/sign-in'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await page.goBack()
    await opened()
    assert.equal(lookupTokens.at(-1), 'synthetic-legacy')
    await page.goForward()
    await page.goBack()
    await opened()
    assert.equal(lookupTokens.at(-1), 'synthetic-legacy')
    console.log('PASS back and forward remount')
    const secondLookup = page.waitForResponse((response) => response.url().endsWith('get-club-owner-invite'))
    await page.evaluate(() => { window.history.pushState(null, '', '/workspace-invite#token=synthetic-second'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await page.waitForFunction(() => window.location.hash === '#token=synthetic-second')
    await secondLookup
    assert.equal(lookupTokens.at(-1), 'synthetic-second')
    console.log('PASS same-component second invite')
    await page.goto(`${origin}/workspace-invite`)
    await page.getByText('Workspace invite could not be opened.', { exact: true }).waitFor()
    assert.equal(lookupTokens.at(-1), '')
    assert.equal(await page.evaluate(() => Object.values({ ...localStorage, ...sessionStorage }).some((value) => value.includes('synthetic-'))), false)
    console.log('PASS bare URL cannot recover an unrelated invite and no token storage')
  }
  assert.equal(mutationCount, 0)
  console.log('PASS no acceptance or other function mutations')
} finally {
  await browser?.close()
  server.kill()
}

