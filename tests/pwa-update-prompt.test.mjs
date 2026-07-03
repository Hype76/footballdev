import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const promptUrl = new URL('../src/components/pwa/AppUpdatePrompt.jsx', import.meta.url)
const mainUrl = new URL('../src/main.jsx', import.meta.url)

test('PWA update detection still raises the app update prompt', async () => {
  const mainSource = await readFile(mainUrl, 'utf8')
  const promptSource = await readFile(promptUrl, 'utf8')

  assert.match(mainSource, /onNeedRefresh\(\)[\s\S]*football-player:update-ready/)
  assert.match(mainSource, /window\.footballPlayerApplyUpdate = \(\) => updateServiceWorker\(true\)/)
  assert.match(promptSource, /window\.addEventListener\('football-player:update-ready', handleUpdateReady\)/)
  assert.match(promptSource, /setIsUpdateReady\(true\)/)
})

test('PWA update prompt uses compact non-bottom layout away from quick actions', async () => {
  const source = await readFile(promptUrl, 'utf8')

  assert.match(source, /Update ready/)
  assert.match(source, /Refresh when finished\./)
  assert.match(source, /top-\[max\(0\.75rem,env\(safe-area-inset-top\)\)\]/)
  assert.match(source, /pointer-events-none fixed inset-x-3/)
  assert.match(source, /max-w-\[min\(100%,26rem\)\]/)
  assert.doesNotMatch(source, /bottom-4/)
  assert.doesNotMatch(source, /sm:left-auto sm:w-\[26rem\]/)
  assert.doesNotMatch(source, /shadow-xl shadow-black\/30/)
  assert.doesNotMatch(source, /A newer version of Football Player is ready/)
})

test('PWA update prompt keeps Later dismissal quiet for the current session', async () => {
  const source = await readFile(promptUrl, 'utf8')

  assert.match(source, /const updateDismissedKey = 'football-player:update-prompt-dismissed'/)
  assert.match(source, /sessionStorage\?\.setItem\(updateDismissedKey, 'true'\)/)
  assert.match(source, /sessionStorage\?\.getItem\(updateDismissedKey\) === 'true'/)
  assert.match(source, /if \(!hasDismissedUpdatePrompt\(\)\) \{[\s\S]*setIsUpdateReady\(true\)/)
  assert.match(source, /onClick=\{handleDismiss\}[\s\S]*Later/)
})

test('PWA update prompt keeps refresh action available without forced refresh', async () => {
  const source = await readFile(promptUrl, 'utf8')

  assert.match(source, /if \(typeof window\.footballPlayerApplyUpdate === 'function'\)/)
  assert.match(source, /window\.footballPlayerApplyUpdate\(\)/)
  assert.match(source, /window\.location\.reload\(\)/)
  assert.match(source, /aria-label="Refresh now"/)
  assert.match(source, /onClick=\{handleUpdate\}[\s\S]*Refresh/)
  assert.doesNotMatch(source, /setTimeout\([\s\S]*location\.reload/)
})
