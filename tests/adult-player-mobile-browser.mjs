import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium, devices, webkit } from 'playwright'

const modules = path.resolve('apps/parent-mobile/node_modules')
const sharedBadge = 'https://assets.example.test/cambourne.png'
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'jsx',
    contents: `
      import React, { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppState } from 'react-native'
      import { AdultPlayerEntry } from './apps/parent-mobile/src/AdultPlayerEntry.js'
      AppState.addEventListener = (_event, handler) => {
        window.refreshAccess = () => handler('active')
        return { remove() { window.refreshAccess = null } }
      }
      function App() {
        const [id, setId] = useState('adult')
        window.changeAccount = setId
        return <AdultPlayerEntry key={id} userId={id} links={window.parentLinks}
          onSignOut={async () => setId('signed-out')}
          renderParent={({ openPlayer, playerAccess }) => <main>
            <h1>{window.parentLinks.length ? 'Parent Home' : 'Welcome to Football Player'}</h1>
            {openPlayer ? <button onClick={openPlayer}>Open Player account</button> : null}
            {playerAccess.error ? <p role="alert">{playerAccess.error}</p> : null}
            <button onClick={playerAccess.refresh}>Check for access</button>
          </main>}
          renderFan={openPlayer => <main>Fan Home{openPlayer ? <button onClick={openPlayer}>Open Player account</button> : null}</main>} />
      }
      createRoot(document.getElementById('root')).render(<App />)
    `,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  nodePaths: [modules],
  alias: {
    'react-native': path.join(modules, 'react-native-web'),
    react: path.join(modules, 'react'),
    'react-dom': path.join(modules, 'react-dom'),
  },
  plugins: [{
    name: 'adult-player-device-services',
    setup(builder) {
      builder.onResolve({ filter: /(^|\/)(supabase|expo-status-bar|react-native-safe-area-context)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        if (args.path.endsWith('/supabase')) return { contents: 'export const supabase = { rpc: (...args) => window.rpc(...args) }' }
        if (args.path === 'expo-status-bar') return { contents: 'export const StatusBar = () => null' }
        return { contents: 'import { View } from "react-native"; export const SafeAreaView = View', resolveDir: process.cwd() }
      })
    },
  }],
})

async function launchFixture(page, { links = [], state = 'linked' } = {}) {
  await page.route('https://fixture.example.test/', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>',
  }))
  await page.route(sharedBadge, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="navy"/></svg>',
  }))
  await page.goto('https://fixture.example.test/')
  await page.evaluate(({ links, state, sharedBadge }) => {
    window.parentLinks = links
    window.playerAccess = state
    window.calls = []
    let response = 'awaiting_response'
    window.rpc = async (name, args) => {
      window.calls.push([name, args])
      if (name === 'get_own_adult_player_account_state') {
        if (window.playerAccess === 'unlinked') return { data: [] }
        if (window.playerAccess === 'error') return { error: { message: 'Network unavailable' } }
        return { data: [{
          access_granted: window.playerAccess === 'linked', access_mode: 'player',
          user_id: 'adult', verified_at: '2026-11-20T09:00:00Z',
          link_id: 'adult-link', link_status: window.playerAccess === 'linked' ? 'active' : 'revoked',
          player_id: 'adult-player', player_name: 'Test Player',
          team_id: 'ladies', team_name: 'Ladies', club_id: 'cambourne', club_name: 'Cambourne Town FC',
        }] }
      }
      if (name === 'get_team_branding_display') {
        if (args.team_value !== 'ladies' || args.club_value !== 'cambourne') throw Error('Unexpected scope')
        return { data: { teamId: 'ladies', clubId: 'cambourne', source: 'team', logoAllowed: true, coloursAllowed: true, logoUrl: sharedBadge, accent: '#193e7c' } }
      }
      if (name === 'get_own_adult_player_invitation_state') return { data: [{
        invitation_id: 'match:invite', invitation_type: 'match_attendance', source_record_id: 'invite',
        event_title: 'Ladies league match', event_start: '2026-11-22T10:00:00Z', response_state: response,
        can_respond: true,
      }] }
      if (name === 'respond_own_adult_player_match_invitation') {
        response = args.response_value
        return { data: { success: true } }
      }
      throw Error(`Unexpected call ${name}`)
    }
  }, { links, state, sharedBadge })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
}

for (const [engine, device] of [[webkit, 'iPhone 13'], [chromium, 'Pixel 7']]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage(devices[device])
    await launchFixture(page)
    await page.getByRole('heading', { name: 'Cambourne Town FC' }).waitFor()
    await page.getByText('Ladies', { exact: true }).waitFor()
    await page.getByText('22:11:2026 at 10:00', { exact: true }).waitFor()
    await page.waitForFunction(url => Array.from(document.images).some(image => image.src === url && image.naturalWidth > 0), sharedBadge)
    const available = page.getByRole('button', { name: 'Available', exact: true })
    await available.click()
    await page.getByText('Your response has been saved.', { exact: true }).waitFor()
    await page.getByText('Response: Available', { exact: true }).waitFor()
    const mutations = await page.evaluate(() => window.calls.filter(([name]) => name.startsWith('respond_')))
    assert.deepEqual(mutations, [['respond_own_adult_player_match_invitation', { request_id_value: 'invite', response_value: 'available' }]])
    await page.evaluate(() => { window.playerAccess = 'revoked'; window.refreshAccess() })
    await page.getByText('Your Player access is unavailable.', { exact: false }).waitFor()
    assert.equal(await page.getByText('Ladies league match', { exact: true }).count(), 0)
    await page.evaluate(() => { window.playerAccess = 'linked'; window.changeAccount('wrong-account') })
    await page.getByText('Your Player access is unavailable.', { exact: false }).waitFor()
    assert.equal(await page.getByText('Cambourne Town FC', { exact: true }).count(), 0)
    await page.close()

    const dual = await browser.newPage(devices[device])
    await launchFixture(dual, { links: [{ linkType: 'parent' }] })
    await dual.getByText('Parent Home', { exact: true }).waitFor()
    await dual.getByRole('button', { name: 'Open Player account' }).click()
    await dual.getByRole('heading', { name: 'Cambourne Town FC' }).waitFor()
    await dual.getByRole('button', { name: 'Open Parent account' }).click()
    await dual.getByText('Parent Home', { exact: true }).waitFor()
    await dual.close()

    const recover = await browser.newPage(devices[device])
    await launchFixture(recover, { state: 'unlinked' })
    await recover.getByText('Welcome to Football Player').waitFor()
    await recover.evaluate(() => { window.playerAccess = 'error' })
    await recover.getByRole('button', { name: 'Check for access' }).click()
    await recover.getByRole('alert').waitFor()
    await recover.getByText('Welcome to Football Player', { exact: true }).waitFor()
    await recover.evaluate(() => { window.playerAccess = 'linked' })
    await recover.getByRole('button', { name: 'Check for access' }).click()
    await recover.getByRole('heading', { name: 'Cambourne Town FC' }).waitFor()
    console.log(`${device} Player-only branding, RSVP, revoked access, Parent switching and access retry passed`)
  } finally {
    await browser.close()
  }
}
