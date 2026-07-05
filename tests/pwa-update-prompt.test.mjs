import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const promptUrl = new URL('../src/components/pwa/AppUpdatePrompt.jsx', import.meta.url)
const mainUrl = new URL('../src/main.jsx', import.meta.url)
const srcUrl = new URL('../src/', import.meta.url)

async function readSourceFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl)

    if (entry.isDirectory()) {
      files.push(...await readSourceFiles(entryUrl))
      continue
    }

    if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      files.push(entryUrl)
    }
  }

  return files
}

test('PWA service worker registration stays silent without the update prompt UI', async () => {
  const source = await readFile(mainUrl, 'utf8')

  assert.match(source, /registerSW\(\{\s*immediate: true,\s*\}\)/)
  assert.doesNotMatch(source, /AppUpdatePrompt/)
  assert.doesNotMatch(source, /football-player:update-ready/)
  assert.doesNotMatch(source, /footballPlayerApplyUpdate/)
  assert.doesNotMatch(source, /onNeedRefresh/)
})

test('visible update prompt source and copy are removed from app source', async () => {
  await assert.rejects(access(promptUrl), { code: 'ENOENT' })

  const sourceFiles = await readSourceFiles(srcUrl)
  const sources = await Promise.all(sourceFiles.map(async (fileUrl) => ({
    path: fileUrl.pathname,
    source: await readFile(fileUrl, 'utf8'),
  })))

  for (const { path, source } of sources) {
    assert.doesNotMatch(source, /Update ready/, path)
    assert.doesNotMatch(source, /Refresh when finished\./, path)
    assert.doesNotMatch(source, /football-player:update-prompt-dismissed/, path)
    assert.doesNotMatch(source, /aria-label="Refresh now"/, path)
  }
})
