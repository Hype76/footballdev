import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd(), require = createRequire(import.meta.url)
const clubId = '10000000-0000-4000-8000-000000000001'
const user = { id: 'actor', clubId, role: 'admin', roleRank: 90, planKey: 'club' }
const output = path.join(root, 'output/club-appearance-phone')
await mkdir(output, { recursive: true })
const mocks = {
  auth: `import React from 'react';export function useAuth(){const[value,set]=React.useState(window.f.auth);window.changeAuth=set;return {...value,signInWithPassword:async()=>set({user:window.f.user,session:{user:{id:window.f.user.id}}}),signOut:async()=>set({})}}`,
  client: `export const supabase={rpc:async name=>({data:name==='current_user_role'?window.f.role:name==='current_user_role_rank'?window.f.rank:name==='current_user_club_id'?window.f.club.id:window.f.entitled,error:null}),from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:window.f.club,error:null})})})})};`,
  router: `export const useLocation=()=>({search:window.f.search});`,
  writes: `export const uploadClubLogo=async args=>{window.f.writes.push({kind:'badge',clubId:args.clubId,name:args.file.name});if(window.f.failUpload)throw Error('Upload failed. Your saved badge was kept.');if(window.f.holdUpload)await new Promise(resolve=>window.f.releaseUpload=resolve);return 'https://example.test/saved.png'};export const updateClubDisplaySettings=async args=>{window.f.writes.push({kind:'colour',clubId:args.clubId,colour:args.themeAccent,style:args.themeButtonStyle});return{themeAccent:args.themeAccent}};`,
}
const compiled = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ClubAppearanceSetupPage}from'fixture';createRoot(document.getElementById('root')).render(<ClubAppearanceSetupPage/>);`, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'synthetic-club-appearance', setup(b) {
  b.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|scheduler)$/ }, args => ({ path: realpathSync(require.resolve(args.path)), namespace: 'source' }))
  b.onResolve({ filter: /^fixture$/ }, () => ({ path: path.join(root, 'src/pages/ClubAppearanceSetupPage.jsx'), namespace: 'source' }))
  for (const [filter, name] of [[/(?:^|\/)auth\.js$/, 'auth'], [/supabase-client\.js$/, 'client'], [/^react-router-dom$/, 'router'], [/club-settings-actions\.js$/, 'writes']]) b.onResolve({ filter }, () => ({ path: name, namespace: 'mock' }))
  b.onResolve({ filter: /^\.{1,2}\//, namespace: 'source' }, args => ({ path: createRequire(args.importer).resolve(args.path), namespace: 'source' }))
  b.onLoad({ filter: /.*/, namespace: 'source' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'jsx', resolveDir: path.dirname(args.path) }))
  b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }))
} }] })
const browser = await chromium.launch(), errors = [], timings = []
let checks = 0
async function fixture(patch = {}, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  await page.setContent('<div id="root"></div>')
  await page.evaluate(({ user, clubId, patch }) => { window.f = { user, role: 'admin', rank: 90, entitled: true, auth: { user, session: { user: { id: user.id } } }, club: { id: clubId, plan_key: 'club', status: 'active', logo_url: '', theme_accent: 'blue', theme_button_style: 'gradient' }, search: `?clubId=${clubId}&returnTo=https://evil.test`, writes: [], ...patch } }, { user, clubId, patch })
  await page.addScriptTag({ content: compiled.outputFiles[0].text })
  return page
}
try {
  for (const width of [320, 390]) {
    const page = await fixture({ holdUpload: true }, width)
    await page.getByRole('button', { name: 'Upload Club badge' }).waitFor()
    await page.locator('input[type=file]').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-png') })
    const started = performance.now()
    await page.getByRole('button', { name: 'Upload Club badge' }).click()
    await page.getByRole('status').getByText('Uploading badge...').waitFor()
    timings.push(Math.round(performance.now() - started)); assert.ok(timings.at(-1) < 1000)
    await page.evaluate(() => window.f.releaseUpload())
    await page.getByText('Club badge saved.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Club colour', { exact: true }).inputValue(), '#1d4ed8')
    await page.getByLabel('Club colour', { exact: true }).fill('#123456')
    await page.getByRole('button', { name: 'Save Club colour' }).click()
    await page.getByText('Club colour saved.', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.f.writes[1]), { kind: 'colour', clubId, colour: '#123456', style: 'gradient' })
    assert.equal(await page.getByRole('link', { name: 'Return to Coach' }).getAttribute('href'), 'footballplayercoach://branding-return')
    await page.getByRole('button', { name: 'Use another account' }).click()
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    checks++; await page.close()
  }
  for (const patch of [{ role: 'head_manager' }, { rank: 70 }, { entitled: false }, { club: { id: clubId, plan_key: 'team', status: 'active' } }, { club: { id: clubId, plan_key: 'club', status: 'suspended' } }, { auth: { user: { ...user, role: 'head_manager', roleRank: 70 }, session: { user: { id: 'actor' } } } }]) {
    const page = await fixture(patch)
    await page.getByRole('alert').waitFor()
    assert.equal(await page.locator('input[type=file]').count(), 0)
    assert.equal(await page.evaluate(() => window.f.writes.length), 0)
    checks++; await page.close()
  }
  const failed = await fixture({ failUpload: true })
  await failed.getByRole('button', { name: 'Upload Club badge' }).waitFor()
  await failed.locator('input[type=file]').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-png') })
  await failed.getByRole('button', { name: 'Upload Club badge' }).click()
  await failed.getByRole('alert').getByText('Upload failed.', { exact: false }).waitFor()
  assert.equal(await failed.getByRole('button', { name: 'Upload Club badge' }).isDisabled(), false)
  checks++; await failed.close()
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ checks, interactionFeedbackMs: timings, synthetic: true, pageErrors: errors }, null, 2))
  console.log(`PASS: ${checks} actual Club appearance phone browser scenarios, immediate feedback ${timings.join('/')} ms, Club-only authority, retained artwork on failure and preserved button style.`)
} finally { await browser.close() }
