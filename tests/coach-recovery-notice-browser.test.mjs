import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const source = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
const node = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(item => item.type === 'FunctionDeclaration' && item.id?.name === 'RecoveryNoticeBoundary')
assert.ok(node)
const component = source.slice(node.start, node.end)
const entry = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text, TextInput } from 'react-native-web';
const SafeAreaView = View;
import { createCoachRecoveryNotice } from './src/coachRecoveryNotice.js';
const storage = { getItem: async key => localStorage.getItem(key), setItem: async (key, value) => localStorage.setItem(key, value) };
const coachRecoveryNotice = createCoachRecoveryNotice(storage, 'test-recovery');
${component}
window.reportRecovery = () => coachRecoveryNotice.report(new Error('offline_legacy_recovery_required'));
function Screen() { const [draft, setDraft] = useState(''); return <><Text>Sign in</Text><TextInput accessibilityLabel="Draft" value={draft} onChangeText={setDraft} /></> }
createRoot(document.getElementById('root')).render(<RecoveryNoticeBoundary><Screen /></RecoveryNoticeBoundary>);
`
const bundle = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../apps/coach-mobile/', import.meta.url)), loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' })
const server = createServer((request, response) => {
  if (request.url === '/test.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(bundle.outputFiles[0].text); return }
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/test.js"></script>')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const browser = await chromium.launch({ headless: true })
test.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)) })

test('recovery warning remains visible at sign-in and after a restart', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } })
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.getByLabel('Draft').fill('Unsaved text')
    await page.evaluate(() => window.reportRecovery())
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByLabel('Draft').inputValue(), 'Unsaved text')
    assert.match(await page.getByRole('alert').innerText(), /Keep app data and contact support/)
    assert.equal(await page.getByText('Sign in').count(), 1)
    await page.reload()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /Reference: RECOVERY/)
  } finally { await page.close() }
})
