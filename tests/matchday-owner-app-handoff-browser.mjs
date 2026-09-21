import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { APP_DOWNLOAD_LINKS } from '../src/lib/app-download-links.js'

const result = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import{ClubOwnerInvitePage}from'./src/pages/ClubOwnerInvitePage.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/workspace-owner-invite/:token' element={<ClubOwnerInvitePage/>}/><Route path='/billing' element={<h1>Billing destination</h1>}/></Routes></BrowserRouter>);`,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.webp': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'matchday-handoff-fixtures',
    setup(buildApi) {
      buildApi.onResolve({ filter: /supabase-client\.js$/ }, () => ({ path: 'supabase-client', namespace: 'fixture' }))
      buildApi.onResolve({ filter: /platform-analytics\.js$/ }, () => ({ path: 'platform-analytics', namespace: 'fixture' }))
      buildApi.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        contents: path === 'supabase-client'
          ? `export const supabase={auth:{signInWithPassword:async credentials=>{
              window.signInCalls.push(credentials)
              return window.signInFails
                ? {data:{},error:new Error('Fixture sign in failed')}
                : {data:{session:{access_token:'fixture-access-token'}},error:null}
            }}};`
          : `export function recordSuccessfulLoginAnalytics(){window.analyticsCalls++}`,
        loader: 'js',
      }))
    },
  }],
})

const browser = await chromium.launch({ headless: true })

async function openInvite({ planKey, signInFails = false }) {
  const context = await browser.newContext()
  await context.addInitScript(({ signInFails }) => {
    window.signInFails = signInFails
    window.signInCalls = []
    window.analyticsCalls = 0
  }, { signInFails })
  await context.route('https://fixture.test/.netlify/functions/get-club-owner-invite', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      invite: {
        invitedEmail: 'coach@example.test',
        billingMode: planKey === 'matchday' ? 'unpaid' : 'paid',
        planKey,
        planName: planKey === 'matchday' ? 'Matchday' : 'Team',
        scope: 'team',
        roleLabel: 'Team Admin',
        workspaceName: 'FP TEST U14',
        setupTitle: 'Create team admin access',
      },
    }),
  }))
  await context.route('https://fixture.test/.netlify/functions/create-club-owner-account', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      email: 'coach@example.test',
      redirectPath: planKey === 'matchday' ? '/coach' : '/billing',
    }),
  }))
  await context.route('https://fixture.test/workspace-owner-invite/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<main id="root"></main><script>${result.outputFiles[0].text}</script>`,
  }))
  const page = await context.newPage()
  await page.goto('https://fixture.test/workspace-owner-invite/fixture-token')
  await page.getByLabel('Create password').fill('Kestrel!River92Orbit')
  await page.getByLabel('Confirm password').fill('Kestrel!River92Orbit')
  await page.getByRole('button', { name: 'Create Team Admin access' }).click()
  return { context, page }
}

try {
  for (const signInFails of [false, true]) {
    const { context, page } = await openInvite({ planKey: 'matchday', signInFails })
    await page.getByRole('heading', { name: 'Continue in the Coach app' }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/workspace-owner-invite/fixture-token')
    assert.equal(await page.getByRole('link', { name: 'Open Coach app' }).getAttribute('href'), 'footballplayercoach://')
    assert.equal(await page.getByRole('link', { name: 'Download for iPhone' }).getAttribute('href'), APP_DOWNLOAD_LINKS.coach.apple)
    assert.equal(await page.getByRole('link', { name: 'Download for Android' }).getAttribute('href'), APP_DOWNLOAD_LINKS.coach.android)
    assert.match(await page.getByText(/Sign in with/).textContent(), /coach@example\.test.*same password/)
    for (const href of await page.locator('a').evaluateAll(links => links.map(link => link.href))) {
      assert.doesNotMatch(href, /fixture-token|Kestrel|coach%40example/)
    }
    assert.equal(await page.evaluate(() => window.signInCalls.length), 1)
    await context.close()
  }

  const { context, page } = await openInvite({ planKey: 'team' })
  await page.getByRole('heading', { name: 'Billing destination' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/billing')
  assert.equal(await page.getByRole('link', { name: 'Open Coach app' }).count(), 0)
  await context.close()

  console.log('PASS: Matchday acceptance stays on the invite page and offers the Coach app after successful or failed automatic sign-in; paid Team acceptance keeps its existing web redirect.')
} finally {
  await browser.close()
}
