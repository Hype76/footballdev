import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import path from 'node:path'

const root = process.cwd()
const bundled = await build({
  stdin: { contents: "import React from 'react'; import {createRoot} from 'react-dom/client'; import {TeamBrandingOffer} from 'fixture'; createRoot(document.getElementById('root')).render(<TeamBrandingOffer teamId='team' teamName='Test'/>);", resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^fixture$/ }, () => ({ path: path.join(root, 'src/components/teams/TeamBrandingOffer.jsx') }))
    b.onResolve({ filter: /supabase-client\.js$/ }, () => ({ path: 'mock', namespace: 'mock' }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: "export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})},rpc:async()=>({data:window.fixture.display,error:window.fixture.rpcError})}", loader: 'js' }))
  }}],
})
const browser = await chromium.launch()
try {
  for (const [source, eligible] of [['paid_club', false], ['team', true], ['platform', true]]) {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div>')
    await page.evaluate(({ source }) => {
      window.fixture = { display: { teamId: 'team', clubId: 'club', source, logoAllowed: true, coloursAllowed: true, accent: '#123456' }, calls: [] }
      window.fetch = async (_, options) => {
        const body = JSON.parse(options.body); window.fixture.calls.push(body)
        return { ok: true, json: async () => ({ enabled: true, teamId: 'team', clubId: 'club', state: 'permanent', logoAllowed: true, coloursAllowed: true, accent: '#123456' }) }
      }
    }, { source })
    await page.addScriptTag({ content: bundled.outputFiles[0].text })
    await page.getByText('Permanent promotional branding').waitFor()
    assert.equal(await page.getByLabel('Team colour').count(), eligible ? 1 : 0)
    assert.equal(await page.getByLabel('Team logo').count(), 1)
    if (eligible) {
      await page.getByLabel('Team colour').fill('#abcdef')
      await page.getByRole('button', { name: 'Save branding' }).click()
      await page.getByText('Team branding updated.').waitFor()
      assert.equal(await page.evaluate(() => window.fixture.calls.find(x => x.action === 'save').accent), '#abcdef')
    } else {
      assert.equal(await page.getByRole('button', { name: 'Save branding' }).isDisabled(), true)
      await page.getByLabel('Team logo').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: Buffer.from('test') })
      await page.getByRole('button', { name: 'Save branding' }).click()
      await page.getByText('Team branding updated.').waitFor()
      assert.equal(await page.evaluate(() => window.fixture.calls.find(x => x.action === 'save').accent), undefined)
    }
    await page.close()
  }
  for (const offerState of ['unclaimed', 'provisional', 'failed']) {
    const paid = await browser.newPage()
    await paid.setContent('<div id="root"></div>')
    await paid.evaluate(({ offerState }) => {
      window.fixture = { display: { teamId:'team', clubId:'club', source:'team', logoAllowed:true, coloursAllowed:true, accent:'#123456' }, calls: [] }
      window.fetch = async () => ({ ok:true, json:async () => ({ enabled:true, teamId:'team', clubId:'club', state:offerState, paidTeam:true, claimAllowed:false, logoAllowed:true, coloursAllowed:true, accent:'#123456' }) })
    }, { offerState })
    await paid.addScriptTag({ content: bundled.outputFiles[0].text })
    await paid.getByText('Team branding is included in your plan.').waitFor()
    assert.equal(await paid.getByLabel('Team colour').count(),1)
    assert.equal(await paid.getByText(/New promotional places|Qualify by|qualification window/).count(),0)
    await paid.close()
  }
  const unclaimed = await browser.newPage()
  await unclaimed.setContent('<div id="root"></div>')
  await unclaimed.evaluate(() => {
    window.fixture = { display: null, calls: [] }
    window.fetch = async (_, options) => { const body = JSON.parse(options.body); window.fixture.calls.push(body); return { ok: true, json: async () => ({ enabled: true, teamId: 'team', clubId: 'club', state: 'unclaimed', claimAllowed: true, termsVersion: 'v1', logoAllowed: false, coloursAllowed: false }) } }
  })
  await unclaimed.addScriptTag({ content: bundled.outputFiles[0].text })
  await unclaimed.getByRole('checkbox').check()
  assert.equal(await unclaimed.getByRole('button', { name: /Claim this team/ }).isEnabled(), true)
  await unclaimed.close()
  const page = await browser.newPage()
  await page.setContent('<div id="root"></div>')
  await page.evaluate(() => {
    window.fixture = { rpcError: { message: 'offline' }, display: { teamId: 'team', clubId: 'club', source: 'team', logoAllowed: true, coloursAllowed: true, accent: '#123456' }, calls: [] }
    window.fetch = async (_, options) => { const body = JSON.parse(options.body); window.fixture.calls.push(body); return { ok: true, json: async () => ({ enabled: true, teamId: 'team', clubId: 'club', state: 'permanent', logoAllowed: true, coloursAllowed: true, accent: '#123456' }) } }
  })
  await page.addScriptTag({ content: bundled.outputFiles[0].text })
  await page.getByRole('alert').filter({ hasText: 'could not be verified' }).waitFor()
  await page.evaluate(() => { window.fixture.rpcError = null })
  await page.getByRole('button', { name: 'Retry branding check' }).click()
  await page.getByLabel('Team colour').waitFor()
  await page.getByLabel('Team colour').fill('#abcdef')
  await page.evaluate(() => { window.fixture.display.source = 'paid_club' })
  await page.getByRole('button', { name: 'Save branding' }).click()
  await page.getByText('Your colour is now managed by your Club.').waitFor()
  assert.equal(await page.getByLabel('Team colour').count(), 0)
  assert.equal(await page.evaluate(() => window.fixture.calls.some(x => x.action === 'save')), false)
  await page.close()
  console.log('Team branding browser checks passed for club, team and promotional display sources.')
} finally { await browser.close() }

